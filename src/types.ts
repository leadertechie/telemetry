/**
 * @leadertechie/telemetry
 *
 * Core types for the telemetry facade.
 * Modeled after OpenTelemetry LogRecord format.
 */

// ─── Log Level (OTEL SeverityNumber) ─────────────────────────────────────────

export enum LogLevel {
  DEBUG = 1,
  INFO = 9,
  WARN = 13,
  ERROR = 17,
}

/** Human-readable labels for log levels. */
export const LogLevelLabel: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

// ─── Resource (identifies the producer) ──────────────────────────────────────

/**
 * Describes the entity producing telemetry (OTEL Resource).
 * Injected automatically into every log record.
 */
export interface Resource {
  /** Service/application name. */
  serviceName: string;
  /** Deployment environment (production, staging, development). */
  environment?: string;
  /** Release/version identifier. */
  version?: string;
  /** Cloudflare Worker script name, Node.js process name, etc. */
  processName?: string;
  /** Arbitrary additional resource attributes. */
  [key: string]: unknown;
}

// ─── Caller Info ─────────────────────────────────────────────────────────────

/**
 * Information about the source location that emitted the log.
 * Derived from stack trace capture at the call site.
 */
export interface CallerInfo {
  file: string;
  line: number;
  column: number;
  functionName?: string;
}

// ─── Log Record (OTEL LogRecord model) ───────────────────────────────────────

/**
 * A single log record — the core data type flowing through the pipeline.
 * Aligned with OpenTelemetry LogRecord data model.
 */
export interface LogRecord {
  /** OTEL severity number (1=DEBUG, 9=INFO, 13=WARN, 17=ERROR). */
  severityNumber: LogLevel;
  /** Human-readable severity text. */
  severityText: string;
  /** The log message body. */
  body: string;
  /** ISO-8601 timestamp when the event occurred (set by logger). */
  timestamp: string;
  /** ISO-8601 timestamp when the logger observed the event. */
  observedTimestamp: string;
  /** Arbitrary key-value attributes (context). */
  attributes: Record<string, unknown>;
  /** OTEL trace ID (if tracing is active). */
  traceId?: string;
  /** OTEL span ID (if tracing is active). */
  spanId?: string;
  /** Source code location that emitted the log. */
  caller?: CallerInfo;
  /** Error object (for ERROR-level records). */
  error?: Error;
  /** Resource identifying the producer. */
  resource: Resource;
}

// ─── Adapter Interface ───────────────────────────────────────────────────────

/**
 * A pluggable backend that consumes log records.
 *
 * Adapters may receive records one at a time (via SimpleProcessor)
 * or in batches (via BatchProcessor).
 *
 * @example consoleAdapter – writes to console.log/warn/error
 * @example sentryAdapter – sends ERROR entries to Sentry
 */
export interface LogAdapter {
  /** Human-readable adapter name (for debugging). */
  readonly name: string;
  /**
   * Export log records to the backend.
   * Called by LogProcessor — may receive single or batched records.
   * Must be safe to call concurrently.
   */
  export(records: LogRecord[]): Promise<void>;
  /**
   * Optional cleanup. Called on Logger.shutdown().
   */
  shutdown?(): Promise<void>;
}

// ─── Processor Interface (OTEL LogRecordProcessor) ───────────────────────────

/**
 * OTEL-inspired LogRecordProcessor.
 *
 * Two built-in implementations:
 * - SimpleLogProcessor  — exports each record immediately
 * - BatchLogProcessor   — buffers and exports on interval/size
 */
export interface LogProcessor {
  /** Called when a log record is emitted. Must not throw. */
  onEmit(record: LogRecord): void;
  /** Force-flush all pending records. Must resolve when done. */
  forceFlush(): Promise<void>;
  /** Flush + release resources. No further calls after shutdown. */
  shutdown(): Promise<void>;
}

// ─── Logger Interface ────────────────────────────────────────────────────────

/** The public API surface of the telemetry facade. */
export interface LoggerInterface {
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, error?: Error, attributes?: Record<string, unknown>): void;

  /**
   * Create a child logger with merged attributes.
   * Useful for request-scoped context (requestId, userId, etc.).
   */
  withContext(attributes: Record<string, unknown>): LoggerInterface;

  /**
   * Attach a processor to the pipeline.
   */
  withProcessor(processor: LogProcessor): LoggerInterface;

  /**
   * Force-flush all pending records in all processors.
   * Await this before the event loop might idle
   * (e.g. at end of a CF Worker request).
   */
  flush(): Promise<void>;

  /**
   * Shutdown the logger: flush + release resources.
   * No logging after shutdown.
   */
  shutdown(): Promise<void>;
}
