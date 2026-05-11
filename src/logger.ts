/**
 * @leadertechie/telemetry
 *
 * Logger facade — the primary API consumers interact with.
 *
 * Architecture (OTEL-inspired):
 *   Logger → LogProcessor → LogAdapter → backend
 *
 * - The Logger creates a LogRecord with full context (timestamp, caller,
 *   resource, attributes) and hands it to the LogProcessor.
 * - The LogProcessor decides when/how to batch and calls adapter.export().
 * - The LogAdapter sends the records to the backend (console, Sentry, etc.).
 *
 * All emit() calls are synchronous from the caller's perspective —
 * they return void. Async work happens in the processor.
 * Call flush() explicitly before the end of a request to guarantee delivery.
 */

import {
  LogLevel,
  LogLevelLabel,
  LogRecord,
  LogProcessor,
  Resource,
  LoggerInterface,
} from './types';
import { extractCaller } from './caller';

export class Logger implements LoggerInterface {
  private processors: LogProcessor[];
  private baseAttributes: Record<string, unknown>;
  private resource: Resource;

  constructor(
    processors: LogProcessor[] = [],
    resource?: Resource,
    baseAttributes: Record<string, unknown> = {},
  ) {
    this.processors = [...processors];
    this.resource = resource ?? { serviceName: 'unknown' };
    this.baseAttributes = { ...baseAttributes };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  debug(message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, undefined, attributes);
  }

  info(message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, undefined, attributes);
  }

  warn(message: string, attributes?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, undefined, attributes);
  }

  error(
    message: string,
    error?: Error,
    attributes?: Record<string, unknown>,
  ): void {
    this.emit(LogLevel.ERROR, message, error, attributes);
  }

  /**
   * Create a child logger with merged base attributes.
   * Returns a NEW Logger — original is immutable.
   */
  withContext(attributes: Record<string, unknown>): LoggerInterface {
    return new Logger(this.processors, this.resource, {
      ...this.baseAttributes,
      ...attributes,
    });
  }

  /**
   * Append a processor to the pipeline.
   * Returns a NEW Logger — original is immutable.
   */
  withProcessor(processor: LogProcessor): LoggerInterface {
    return new Logger(
      [...this.processors, processor],
      this.resource,
      this.baseAttributes,
    );
  }

  /**
   * Force-flush all pending records in all processors.
   * Await before the end of a CF Worker request (inside ctx.waitUntil).
   */
  async flush(): Promise<void> {
    await Promise.all(this.processors.map((p) => p.forceFlush()));
  }

  /**
   * Shutdown: flush + release resources. No logging after shutdown.
   */
  async shutdown(): Promise<void> {
    await this.flush();
    await Promise.all(this.processors.map((p) => p.shutdown()));
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private emit(
    severityNumber: LogLevel,
    body: string,
    error?: Error,
    attributes?: Record<string, unknown>,
  ): void {
    if (this.processors.length === 0) return;

    const now = new Date().toISOString();

    const record: LogRecord = {
      severityNumber,
      severityText: LogLevelLabel[severityNumber],
      body,
      timestamp: now,
      observedTimestamp: now,
      attributes: { ...this.baseAttributes, ...attributes },
      caller: extractCaller(),
      ...(error ? { error } : {}),
      resource: { ...this.resource },
    };

    for (const processor of this.processors) {
      try {
        processor.onEmit(record);
      } catch (err) {
        // Processor errors must never bubble to the caller
        console.error(
          '[telemetry] Processor threw in onEmit:',
          err,
        );
      }
    }
  }
}
