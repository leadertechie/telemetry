/**
 * @leadertechie/telemetry
 *
 * Console adapter — writes log records to console.log/warn/error.
 *
 * Works out-of-the-box in:
 * - Cloudflare Workers runtime (console output appears in CF dashboard logs)
 * - Node.js
 * - Browsers
 *
 * @example
 * ```ts
 * import { LoggerProvider, consoleAdapter, LogLevel } from '@leadertechie/telemetry';
 *
 * const provider = new LoggerProvider({ serviceName: 'my-app' });
 * provider.addAdapter(consoleAdapter({ level: LogLevel.INFO }));
 * ```
 */

import { LogLevel, LogAdapter, LogRecord } from '../types';

/** Options for the console adapter. */
export interface ConsoleAdapterOptions {
  /**
   * Minimum severity level to output.
   * @default LogLevel.DEBUG
   */
  level?: LogLevel;
  /**
   * If true, outputs each record as a single JSON line.
   * Ideal for structured log ingestion (e.g. CF Logpush).
   * @default false
   */
  json?: boolean;
}

export function consoleAdapter(opts?: ConsoleAdapterOptions): LogAdapter {
  const minLevel = opts?.level ?? LogLevel.DEBUG;
  const jsonMode = opts?.json ?? false;

  return {
    name: 'console',

    async export(records: LogRecord[]): Promise<void> {
      for (const record of records) {
        if (record.severityNumber < minLevel) continue;

        if (jsonMode) {
          writeJson(record);
        } else {
          writeFormatted(record);
        }
      }
    },
  };
}

// ── Standalone helpers ───────────────────────────────────────────────────────

function writeFormatted(record: LogRecord): void {
  const logFn = getConsoleMethod(record.severityNumber);
  const ts = record.timestamp;
  const label = record.severityText;
  const caller = record.caller
    ? ` (${record.caller.file}:${record.caller.line})`
    : '';
  const hasExtra = Object.keys(record.attributes).length > 0;
  const hasError = !!record.error;

  if (hasError) {
    logFn(
      `[${ts}] [${label}]${caller} ${record.body}`,
      record.attributes,
      record.error,
    );
  } else if (hasExtra) {
    logFn(`[${ts}] [${label}]${caller} ${record.body}`, record.attributes);
  } else {
    logFn(`[${ts}] [${label}]${caller} ${record.body}`);
  }
}

function writeJson(record: LogRecord): void {
  const output: Record<string, unknown> = {
    timestamp: record.timestamp,
    level: record.severityText,
    message: record.body,
    service: record.resource.serviceName,
    environment: record.resource.environment,
    attributes: record.attributes,
    caller: record.caller,
  };
  if (record.error) {
    output.error = {
      name: record.error.name,
      message: record.error.message,
      stack: record.error.stack,
    };
  }
  console.log(JSON.stringify(output));
}

function getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case LogLevel.ERROR:
      return console.error.bind(console);
    case LogLevel.WARN:
      return console.warn.bind(console);
    case LogLevel.INFO:
      return console.log.bind(console);
    case LogLevel.DEBUG:
    default:
      return console.debug.bind(console);
  }
}
