# @leadertechie/telemetry

**OTEL-inspired telemetry facade with pluggable adapters.**

Zero-dependency logging and observability for Cloudflare Workers, Node.js, and browsers. Modeled after the OpenTelemetry `LoggerProvider → LogProcessor → LogAdapter` pipeline — a thin API surface with pluggable backends.

## Features

- **OTEL-aligned pipeline** — `LoggerProvider` → `LogProcessor` → `LogAdapter`
- **5 built-in adapters** — Console, R2, Fetch, Sentry, Noop (plus roll-your-own)
- **Batch processing** — `BatchLogProcessor` buffers and exports on interval or queue size
- **Request-scoped context** — `logger.withContext({ requestId })` creates a child logger
- **Caller info** — stack-trace extraction for every log record
- **Fire-and-forget** — `log.info()` is synchronous; async export happens in the processor
- **Level filtering** — each adapter configures its minimum level
- **Zero runtime deps** — uses only `fetch`, `console`, `crypto`, `URL`

## Installation

```bash
npm install @leadertechie/telemetry
```

## Quick Start

```ts
import {
  LoggerProvider,
  BatchLogProcessor,
  consoleAdapter,
  fetchAdapter,
} from '@leadertechie/telemetry';

// 1. Create a provider with resource identity
const provider = new LoggerProvider({
  serviceName: 'toldby-composer',
  environment: 'production',
  version: '0.1.0',
});

// 2. Add adapters via processors
provider.addAdapter(consoleAdapter());                          // dev — immediate

provider.addProcessor(new BatchLogProcessor(fetchAdapter({      // prod — batched
  endpoint: 'https://telemetry.example.com/ingest',
  apiKey: env.TELEMETRY_KEY,
}), {
  scheduledDelayMillis: 10_000,  // flush every 10s
  maxExportBatchSize: 200,
}));

// 3. Get a logger
const log = provider.getLogger('fetch-handler');

// 4. Use it
log.info('Request started', { method: 'GET', path: '/' });
log.warn('Rate limit approaching', { remaining: 5 });
log.error('Something broke', new Error('Kaboom'));

// 5. Flush before worker idle
ctx.waitUntil(log.flush());
```

## Architecture

```
LoggerProvider                          ← creates named Loggers
  └─ Logger                             ← debug/info/warn/error + withContext()
       └─ LogProcessor                  ← SimpleLogProcessor (immediate)
          │                               BatchLogProcessor (buffered)
          └─ LogAdapter                 ← pluggable backend
               ├─ consoleAdapter         → console.log/warn/error
               ├─ r2Adapter              → R2 bucket (NDJSON, time-partitioned)
               ├─ fetchAdapter           → POST to telemetry worker
               ├─ sentryAdapter          → Sentry envelope API
               └─ noopAdapter            → /dev/null
```

## Adapters

| Adapter | Backend | Batching | Notes |
|---------|---------|----------|-------|
| `consoleAdapter` | `console.log/warn/error` | Per-record | JSON mode available |
| `r2Adapter` | Cloudflare R2 bucket | Batch | NDJSON, time-partitioned keys, rotation |
| `fetchAdapter` | Remote HTTP endpoint | Batch | `X-Telemetry-Key` auth, retry, noop if no key |
| `sentryAdapter` | Sentry envelope API | Per-record | ERROR-only, lazy noop if no DSN |
| `noopAdapter` | Silent discard | — | Safe default before config |

### Console Adapter

```ts
import { consoleAdapter, LogLevel } from '@leadertechie/telemetry';

// Formatted output (default)
provider.addAdapter(consoleAdapter());

// JSON lines for structured ingestion
provider.addAdapter(consoleAdapter({ json: true }));

// Only WARN and above
provider.addAdapter(consoleAdapter({ level: LogLevel.WARN }));
```

### Fetch Adapter (for central telemetry worker)

```ts
import { fetchAdapter, BatchLogProcessor } from '@leadertechie/telemetry';

provider.addProcessor(new BatchLogProcessor(fetchAdapter({
  endpoint: 'https://telemetry.toldby.pages/ingest',
  apiKey: env.TELEMETRY_KEY,       // from KV, shared across packages
  maxRetries: 2,
  timeoutMs: 10_000,
})));
```

If `apiKey` is empty/undefined, the adapter silently becomes a noop — safe to deploy to environments without telemetry configured.

### R2 Adapter (direct bucket write)

```ts
import { r2Adapter, BatchLogProcessor } from '@leadertechie/telemetry';

provider.addProcessor(new BatchLogProcessor(r2Adapter({
  binding: env.MY_LOG_BUCKET,     // R2 bucket binding
  prefix: 'logs',
  workerId: 'composer-a',
  maxFileSize: 1024 * 1024,       // 1 MB
})));
```

Files land at: `logs/2026/05/10/14-composer-a-001.ndjson`

### Custom Adapter

```ts
import { LogAdapter, LogRecord } from '@leadertechie/telemetry';

const myAdapter: LogAdapter = {
  name: 'my-backend',
  async export(records: LogRecord[]): Promise<void> {
    await fetch('https://my-backend.example/logs', {
      method: 'POST',
      body: JSON.stringify(records),
    });
  },
};

provider.addAdapter(myAdapter);
```

## Processors

| Processor | Behaviour |
|-----------|-----------|
| `SimpleLogProcessor` | Exports each record immediately to the adapter |
| `BatchLogProcessor` | Buffers records, exports on interval (`scheduledDelayMillis`) or queue size (`maxQueueSize`) |

## Logger API

```ts
const log = provider.getLogger('component', { baseAttribute: 'value' });

log.debug('Verbose detail', { extra: 42 });
log.info('Something happened', { key: 'val' });
log.warn('Heads up', { threshold: 0.9 });
log.error('Failure', new Error('reason'), { requestId: 'abc' });

// Request-scoped child
const reqLog = log.withContext({ requestId: 'xyz', userId: 'alice' });
reqLog.info('Handling request');

// Force flush (await before worker idle)
await log.flush();
await log.shutdown();   // flush + release
```

## LogRecord Format

Each record flowing through the pipeline:

| Field | Type | Description |
|-------|------|-------------|
| `severityNumber` | `LogLevel` | 1=DEBUG, 9=INFO, 13=WARN, 17=ERROR |
| `severityText` | `string` | "DEBUG", "INFO", "WARN", "ERROR" |
| `body` | `string` | The log message |
| `timestamp` | `string` | ISO-8601 when event occurred |
| `attributes` | `Record<string, unknown>` | Arbitrary context |
| `caller` | `CallerInfo` | Source file, line, column, function |
| `resource` | `Resource` | serviceName, environment, version |
| `error` | `Error?` | Error object (ERROR-level only) |

## Cost (Cloudflare)

| Approach | Ingestion | Storage | Egress | Notes |
|----------|-----------|---------|--------|-------|
| CF Log Explorer | $0.50/GB | Included | N/A | Per-query cost |
| **R2 Adapter** | **$0** | $0.015/GB/mo | **$0** | Query locally for free |
| Fetch → Worker → R2 | $0 | $0.015/GB/mo | $0 | Centralised, key-auth'd |

## What goes where

| Concern | Home |
|---------|------|
| Log emission (`log.info()`) | **This package** — imported by every toldby package |
| Log batching & buffering | **This package** — `BatchLogProcessor` |
| Adapter backends | **This package** — Console, R2, Fetch, Sentry, Noop |
| Receiving logs centrally | **Telemetry worker** (separate) — validates key, writes to R2 |
| Log download / admin API | **Telemetry worker** — `/api/admin/logs` endpoints |
| Log retention / TTL purge | **Telemetry worker** — cron trigger |
| Local analysis / SQLite | **CLI tool** (future) — downloads .ndjson → SQLite |
| Gzip compression | **Worker** (future) — compress on ingest, not in adapter |

## License

MIT
