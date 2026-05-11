/**
 * @leadertechie/telemetry
 *
 * Fetch adapter — POSTs batched log records to a remote telemetry endpoint.
 *
 * This is the bridge adapter: every package (md2html, r2tohtml, toldby-composer,
 * etc.) creates a FetchAdapter pointing at the central telemetry worker.
 * The telemetry worker receives the batch and writes it to its own R2 sink.
 *
 * USAGE
 * ```ts
 * import { LoggerProvider, BatchLogProcessor, fetchAdapter } from '@leadertechie/telemetry';
 *
 * const provider = new LoggerProvider({ serviceName: 'md2html', environment: 'production' });
 * provider.addProcessor(new BatchLogProcessor(fetchAdapter({
 *   endpoint: 'https://telemetry.toldby.pages/ingest',
 *   apiKey: env.TELEMETRY_KEY,        // shared key from KV
 * })));
 * ```
 *
 * SECURITY
 * The adapter sends an `X-Telemetry-Key` header with every request.
 * The receiving telemetry worker validates this against its KV-stored key.
 * No logs are sent if the key is empty/undefined (adapter becomes noop).
 */

import { LogAdapter, LogRecord } from '../types';

export interface FetchAdapterOptions {
  /**
   * URL of the telemetry ingest endpoint.
   * @example "https://telemetry.toldby.pages/ingest"
   */
  endpoint: string;

  /**
   * Shared API key for authentication.
   * Sent as the `X-Telemetry-Key` header.
   * If empty or undefined, the adapter silently becomes a noop
   * (safe to deploy without configuring telemetry).
   */
  apiKey?: string;

  /**
   * Maximum number of retries on network failure.
   * @default 2
   */
  maxRetries?: number;

  /**
   * Base delay between retries (exponential backoff).
   * @default 1000 (1 second)
   */
  retryDelayMs?: number;

  /**
   * Request timeout in milliseconds.
   * @default 10_000 (10 seconds)
   */
  timeoutMs?: number;
}

/**
 * A minimal, serialisable log record for transport.
 * Strips non-serialisable fields (Error objects, etc.) before sending.
 */
interface WireRecord {
  ts: string;
  level: string;
  msg: string;
  attrs: Record<string, unknown>;
  caller?: { file: string; line: number; column: number; functionName?: string };
  svc: string;
  env?: string;
  ver?: string;
  err?: { name: string; message: string; stack?: string };
}

export function fetchAdapter(opts: FetchAdapterOptions): LogAdapter {
  const {
    endpoint,
    apiKey,
    maxRetries = 2,
    retryDelayMs = 1000,
    timeoutMs = 10_000,
  } = opts;

  if (!apiKey) {
    return {
      name: 'fetch (inactive – no API key)',
      async export(_records: LogRecord[]): Promise<void> {
        // silently noop — safe to deploy without configuring
      },
    };
  }

  if (!endpoint) {
    return {
      name: 'fetch (inactive – no endpoint)',
      async export(_records: LogRecord[]): Promise<void> {
        // silently noop
      },
    };
  }

  return {
    name: 'fetch',

    async export(records: LogRecord[]): Promise<void> {
      if (records.length === 0) return;

      const wire: WireRecord[] = records.map(serialiseRecord);

      let lastError: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Telemetry-Key': apiKey,
            },
            body: JSON.stringify(wire),
            signal: controller.signal,
          });

          clearTimeout(timer);

          if (response.ok) return; // success

          // Non-retryable status codes
          if (response.status === 401 || response.status === 403) {
            console.warn(
              `[telemetry] FetchAdapter: auth rejected (${response.status}) — check TELEMETRY_KEY`
            );
            return; // don't retry auth failures
          }

          lastError = new Error(`HTTP ${response.status}`);
        } catch (err) {
          lastError = err;
        }

        // Exponential backoff before retry
        if (attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }
      }

      // All retries exhausted — log to console as last-resort fallback
      console.error(
        `[telemetry] FetchAdapter: failed after ${maxRetries + 1} attempts:`,
        lastError,
      );
    },
  };
}

/** Convert a full LogRecord to a compact wire format. */
function serialiseRecord(r: LogRecord): WireRecord {
  return {
    ts: r.timestamp,
    level: r.severityText,
    msg: r.body,
    attrs: r.attributes,
    caller: r.caller,
    svc: r.resource.serviceName,
    env: r.resource.environment,
    ver: r.resource.version,
    err: r.error
      ? {
          name: r.error.name,
          message: r.error.message,
          stack: r.error.stack?.split('\n').slice(0, 5).join('\n'),
        }
      : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
