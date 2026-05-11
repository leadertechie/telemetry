/**
 * @leadertechie/telemetry
 *
 * OTEL-inspired telemetry facade with pluggable adapters, batching,
 * caller injection, resource attributes, and explicit flush/shutdown.
 *
 * ## Quick Start
 *
 * ```ts
 * import { LoggerProvider, consoleAdapter, BatchLogProcessor, fetchAdapter } from '@leadertechie/telemetry';
 *
 * const provider = new LoggerProvider({ serviceName: 'my-pkg', environment: 'production' });
 *
 * // Dev: log to console
 * provider.addAdapter(consoleAdapter());
 *
 * // Prod: batch POST to telemetry worker
 * provider.addProcessor(new BatchLogProcessor(fetchAdapter({
 *   endpoint: 'https://telemetry.example.com/ingest',
 *   apiKey: env.TELEMETRY_KEY,
 * })));
 *
 * const log = provider.getLogger();
 * log.info('Hello', { requestId: 'abc' });
 *
 * // Before worker idle
 * ctx.waitUntil(log.flush());
 * ```
 */

// ─── Core ────────────────────────────────────────────────────────────────────
export { Logger } from './logger';
export { LoggerProvider } from './provider';
export type { LoggerProviderOptions } from './provider';

// ─── Types ───────────────────────────────────────────────────────────────────
export {
  LogLevel,
  LogLevelLabel,
} from './types';
export type {
  LogRecord,
  LogAdapter,
  LogProcessor,
  Resource,
  CallerInfo,
  LoggerInterface,
} from './types';

// ─── Processors ──────────────────────────────────────────────────────────────
export { SimpleLogProcessor } from './processors/simple-processor';
export { BatchLogProcessor } from './processors/batch-processor';
export type { BatchProcessorOptions } from './processors/batch-processor';

// ─── Adapters ────────────────────────────────────────────────────────────────
export { consoleAdapter } from './adapters/console';
export type { ConsoleAdapterOptions } from './adapters/console';

export { r2Adapter } from './adapters/r2';
export type { R2AdapterOptions, R2Bucket } from './adapters/r2';

export { sentryAdapter } from './adapters/sentry';
export type { SentryAdapterOptions } from './adapters/sentry';

export { fetchAdapter } from './adapters/fetch';
export type { FetchAdapterOptions } from './adapters/fetch';

export { noopAdapter } from './adapters/noop';
