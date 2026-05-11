/**
 * @leadertechie/telemetry
 *
 * BatchLogProcessor — buffers log records and exports them
 * periodically or when the buffer reaches a maximum size.
 *
 * OTEL-inspired: identical to OpenTelemetry's BatchLogRecordProcessor.
 *
 * Ideal for:
 * - Reducing HTTP calls to Sentry
 * - Avoiding excessive console output
 * - Environments where batching is preferred (CF Workers with waitUntil)
 */

import { LogProcessor, LogRecord, LogAdapter } from '../types';

export interface BatchProcessorOptions {
  /** Maximum number of records to buffer before forcing an export. */
  maxQueueSize?: number;
  /** Maximum delay (ms) before a buffered record is exported. */
  maxExportBatchSize?: number;
  /** Interval (ms) between periodic flushes. */
  scheduledDelayMillis?: number;
  /** How long (ms) to wait for an export to complete during flush. */
  exportTimeoutMillis?: number;
}

const DEFAULT_OPTIONS = {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 30000,
};

export class BatchLogProcessor implements LogProcessor {
  private adapter: LogAdapter;
  private buffer: LogRecord[] = [];
  private shutdownFlag = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  private readonly maxQueueSize: number;
  private readonly maxExportBatchSize: number;
  private readonly scheduledDelayMillis: number;
  private readonly exportTimeoutMillis: number;

  constructor(adapter: LogAdapter, opts?: BatchProcessorOptions) {
    this.adapter = adapter;
    this.maxQueueSize = opts?.maxQueueSize ?? DEFAULT_OPTIONS.maxQueueSize;
    this.maxExportBatchSize =
      opts?.maxExportBatchSize ?? DEFAULT_OPTIONS.maxExportBatchSize;
    this.scheduledDelayMillis =
      opts?.scheduledDelayMillis ?? DEFAULT_OPTIONS.scheduledDelayMillis;
    this.exportTimeoutMillis =
      opts?.exportTimeoutMillis ?? DEFAULT_OPTIONS.exportTimeoutMillis;
  }

  onEmit(record: LogRecord): void {
    if (this.shutdownFlag) return;

    this.buffer.push(record);

    // Force export if buffer is too large
    if (this.buffer.length >= this.maxQueueSize) {
      this.flushBuffer().catch(() => {});
      return;
    }

    // Start periodic flush timer on first record
    if (!this.timerId && !this.shutdownFlag) {
      this.timerId = setTimeout(() => {
        this.timerId = null;
        this.flushBuffer().catch(() => {});
      }, this.scheduledDelayMillis);
    }
  }

  async forceFlush(): Promise<void> {
    await this.flushBuffer();
  }

  async shutdown(): Promise<void> {
    this.shutdownFlag = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    await this.flushBuffer();
    await this.adapter.shutdown?.();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.maxExportBatchSize);
    const remaining = this.buffer.length;

    try {
      await withTimeout(
        this.adapter.export(batch),
        this.exportTimeoutMillis,
      );
    } catch (err) {
      console.error(
        `[telemetry] BatchLogProcessor: adapter "${this.adapter.name}" export failed:`,
        err,
      );
    }

    // If there are still records and we haven't been shut down,
    // schedule the next flush (recursive).
    if (remaining > 0 && !this.shutdownFlag) {
      // Yield to event loop to avoid starving it
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await this.flushBuffer();
    }
  }
}

/** Helper: race a promise against a timeout. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`export timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
