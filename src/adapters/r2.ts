/**
 * @leadertechie/telemetry
 *
 * R2 adapter — writes log records as NDJSON files to a Cloudflare R2 bucket.
 *
 * WHY?
 * Cloudflare Log Explorer charges based on ingestion (console.log output).
 * By writing logs directly to R2 as plain files, you bypass those charges
 * entirely. You can then download the files periodically and build a local
 * dashboard.
 *
 * HOW IT WORKS
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Your Worker                                                │
 * │  ├─ Logger.error / info / warn / debug                      │
 * │  └─ BatchLogProcessor → r2Adapter                           │
 * │                           └─ PUT {bucket}/logs/YYYY/MM/     │
 * │                               DD/HH-{workerId}-{seq}.ndjson │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Each export batch is written as a single NDJSON file in R2.
 * Files are partitioned by time (year/month/day/hour) so you can
 * do incremental downloads.
 *
 * USAGE
 * ```ts
 * import { LoggerProvider, BatchLogProcessor } from '@leadertechie/telemetry';
 * import { r2Adapter } from '@leadertechie/telemetry/r2-adapter';
 *
 * // In your CF Worker's fetch handler:
 * const provider = new LoggerProvider({
 *   serviceName: 'my-worker',
 *   environment: 'production',
 * });
 *
 * provider.addProcessor(
 *   new BatchLogProcessor(r2Adapter({
 *     binding: env.MY_LOG_BUCKET,   // R2 bucket binding
 *     prefix: 'logs',                // folder prefix in the bucket
 *     workerId: 'worker-a',          // unique per worker instance
 *     maxFileSize: 1024 * 1024,      // 1 MB — rotate files when they reach this
 *   }), {
 *     scheduledDelayMillis: 10_000,  // flush every 10s
 *     maxExportBatchSize: 200,
 *   })
 * );
 *
 * const logger = provider.getLogger('fetch-handler');
 * logger.info('Request started', { method: 'GET', path: '/' });
 * // ...
 * ctx.waitUntil(logger.flush());  // guarantee delivery before worker idle
 * ```
 *
 * LOCAL DOWNLOAD & DASHBOARD
 * ```bash
 * # List logs for a given day
 * npx wrangler r2 object list my-bucket --prefix logs/2026/03/20/
 *
 * # Download all logs for a day
 * npx wrangler r2 object get my-bucket logs/2026/03/20/10-worker-a-001.ndjson
 *
 * # Concatenate & parse locally
 * cat *.ndjson | node scripts/ingest-to-sqlite.js
 * ```
 *
 * @see https://developers.cloudflare.com/r2/
 */

import { LogAdapter, LogRecord } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface R2AdapterOptions {
  /**
   * The R2 bucket binding object (e.g., `env.MY_BUCKET`).
   * Must conform to the Workers R2 bucket API:
   *   { put(key: string, value: ReadableStream|ArrayBuffer|string): Promise<R2Object> }
   */
  binding: R2Bucket;

  /**
   * Key prefix for all log files.
   * @default "logs"
   */
  prefix?: string;

  /**
   * Unique identifier for this worker/instance.
   * Useful when running multiple workers writing to the same bucket.
   * @default "unknown"
   */
  workerId?: string;

  /**
   * Maximum file size (in bytes) before rotating to a new file.
   * Larger files mean fewer R2 PUT operations but larger downloads.
   * @default 1_048_576 (1 MB)
   */
  maxFileSize?: number;
}

/**
 * Minimal R2 bucket interface matching Cloudflare Workers runtime.
 * Users pass their `env.BUCKET` binding directly.
 */
export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { httpMetadata?: Record<string, string> },
  ): Promise<{ key: string; size: number; httpEtag: string }>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  list(options?: { prefix?: string; limit?: number }): Promise<{
    objects: Array<{ key: string; size: number; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

// ─── Adapter Factory ─────────────────────────────────────────────────────────

export function r2Adapter(opts: R2AdapterOptions): LogAdapter {
  const {
    binding,
    prefix = 'logs',
    workerId = 'unknown',
    maxFileSize = 1_048_576, // 1 MB default
  } = opts;

  /** Buffer accumulating NDJSON lines before writing to R2. */
  let buffer = '';
  /** Sequence number for rotation within the same time slot. */
  let sequence = 0;

  return {
    name: 'r2',

    async export(records: LogRecord[]): Promise<void> {
      // Serialise each record as a single NDJSON line
      for (const record of records) {
        // Strip the full resource to save space in R2 — we already know
        // the workerId and serviceName from context. But let's keep it
        // in case of multi-service buckets.
        buffer += JSON.stringify({
          ts: record.timestamp,
          level: record.severityText,
          msg: record.body,
          attrs: record.attributes,
          caller: record.caller,
          err: record.error
            ? {
                name: record.error.name,
                message: record.error.message,
                stack: firstNLines(record.error.stack, 5),
              }
            : undefined,
          svc: record.resource.serviceName,
          env: record.resource.environment,
          ver: record.resource.version,
        }) + '\n';

        // If buffer exceeds the file size threshold, flush immediately
        if (buffer.length >= maxFileSize) {
          await flushBuffer();
        }
      }
    },

    async shutdown(): Promise<void> {
      // Write any remaining buffered records
      if (buffer.length > 0) {
        await flushBuffer();
      }
    },
  };

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Determine the R2 object key for the current time window.
   * Pattern: {prefix}/YYYY/MM/DD/HH-{workerId}-{seq}.ndjson
   *
   * Uses a single Date call per flush to keep it simple.
   * In production, consider injecting the date from outside
   * or using a monotonic clock.
   */
  function getTimeBasedKey(seqNum: number): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hour = String(now.getUTCHours()).padStart(2, '0');
    const seqStr = String(seqNum).padStart(3, '0');

    return `${prefix}/${year}/${month}/${day}/${hour}-${workerId}-${seqStr}.ndjson`;
  }

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;

    const data = buffer;
    buffer = '';
    const seq = sequence++;

    // Generate a fresh key for each file — the sequence number ensures uniqueness
    // even for multiple flushes within the same hour.
    const key = getTimeBasedKey(seq);

    try {
      await binding.put(key, data, {
        httpMetadata: {
          'content-type': 'application/x-ndjson',
        },
      });
    } catch (err) {
      console.error(
        `[telemetry] R2 adapter: failed to write "${key}"`,
        err,
      );
      // Re-buffer the data to avoid data loss?
      // In a fire-and-forget scenario, we accept potential loss.
      // For critical logs, consider a fallback (e.g., console.error).
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Keep stack traces short in R2 (first N lines) to save space. */
function firstNLines(stack: string | undefined, n: number): string | undefined {
  if (!stack) return undefined;
  return stack.split('\n').slice(0, n).join('\n');
}
