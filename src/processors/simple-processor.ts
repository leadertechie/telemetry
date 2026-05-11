/**
 * @leadertechie/telemetry
 *
 * SimpleLogProcessor — exports each log record immediately.
 *
 * The adapter.export() promise is captured so forceFlush() can
 * await any in-flight exports. The hot path (onEmit) is fire-and-forget
 * from the caller's perspective (returns void).
 *
 * Use this when you want every log record dispatched right away.
 * For batching, use BatchLogProcessor.
 */

import { LogProcessor, LogRecord, LogAdapter } from '../types';

export class SimpleLogProcessor implements LogProcessor {
  private adapter: LogAdapter;
  private shutdownFlag = false;
  /** Track the most recent in-flight export promise. */
  private pendingExport: Promise<void> = Promise.resolve();

  constructor(adapter: LogAdapter) {
    this.adapter = adapter;
  }

  onEmit(record: LogRecord): void {
    if (this.shutdownFlag) return;

    // Fire-and-forget: chain onto pendingExport so
    // forceFlush() can await it, but don't block the hot path.
    this.pendingExport = this.pendingExport
      .then(() => this.adapter.export([record]))
      .catch((err) => {
        console.error(
          `[telemetry] SimpleLogProcessor: adapter "${this.adapter.name}" export failed:`,
          err,
        );
      });
  }

  async forceFlush(): Promise<void> {
    await this.pendingExport;
  }

  async shutdown(): Promise<void> {
    this.shutdownFlag = true;
    await this.forceFlush();
    await this.adapter.shutdown?.();
  }
}
