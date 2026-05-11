/**
 * @leadertechie/telemetry
 *
 * Sentry adapter — sends ERROR-level log records to Sentry via
 * its envelope API. Uses fetch() (native in CF Workers) rather than
 * the Sentry SDK to avoid bloat.
 *
 * Lazy activation: if no DSN is provided, the adapter silently
 * becomes a noop. This lets you ship the same code to environments
 * with and without Sentry configuration.
 *
 * @example
 * ```ts
 * import { LoggerProvider, sentryAdapter } from '@leadertechie/telemetry';
 *
 * const provider = new LoggerProvider({ serviceName: 'my-app' });
 * provider.addProcessor(new BatchLogProcessor(sentryAdapter({
 *   dsn: env.SENTRY_DSN,
 *   environment: 'production',
 * })));
 * ```
 */

import { LogLevel, LogAdapter, LogRecord } from '../types';

/** Options for the Sentry adapter. */
export interface SentryAdapterOptions {
  /**
   * Sentry DSN. If omitted or empty, the adapter becomes a noop.
   */
  dsn?: string;
  /** Environment label sent with each event. */
  environment?: string;
  /** Release version sent with each event. */
  release?: string;
}

interface ParsedDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

export function sentryAdapter(opts?: SentryAdapterOptions): LogAdapter {
  if (!opts?.dsn) {
    return inactiveAdapter('no DSN');
  }

  const parsed = parseDsn(opts.dsn);
  if (!parsed) {
    return inactiveAdapter('invalid DSN');
  }

  const { host, projectId, publicKey } = parsed;
  const envelopeUrl = `https://${host}/api/${projectId}/envelope/`;
  const environment = opts.environment ?? 'production';
  const release = opts.release ?? 'unknown';

  return {
    name: 'sentry',

    async export(records: LogRecord[]): Promise<void> {
      // Only send ERROR-level events to Sentry.
      const errors = records.filter(
        (r) => r.severityNumber >= LogLevel.ERROR,
      );
      if (errors.length === 0) return;

      // Send each error as a separate envelope
      for (const record of errors) {
        const envelope = buildEnvelope(record, environment, release, opts.dsn!);
        await sendToSentry(envelopeUrl, envelope);
      }
    },
  };

  // ── Internal helpers ──────────────────────────────────────────────────

  function inactiveAdapter(reason: string): LogAdapter {
    return {
      name: `sentry (inactive – ${reason})`,
      async export(_records: LogRecord[]): Promise<void> {
        // silently ignored
      },
    };
  }

  async function sendToSentry(url: string, envelope: string): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: envelope,
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
        },
      });

      if (!response.ok) {
        console.warn(
          `[telemetry] Sentry adapter: HTTP ${response.status}`,
          await response.text().catch(() => ''),
        );
      }
    } catch (err) {
      console.warn('[telemetry] Sentry adapter: network error', err);
    }
  }

  function buildEnvelope(
    record: LogRecord,
    environment: string,
    release: string,
    dsn: string,
  ): string {
    const eventId = generateEventId();

    const envelopeHeaders = JSON.stringify({
      event_id: eventId,
      sent_at: record.timestamp,
      dsn,
    });

    const itemHeaders = JSON.stringify({
      type: 'event',
      content_type: 'application/json',
    });

    const payload = buildPayload(eventId, record, environment, release);

    return `${envelopeHeaders}\n${itemHeaders}\n${payload}`;
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    if (url.protocol !== 'https:') return null;
    const publicKey = url.username || '';
    const host = url.host;
    const pathParts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const projectId = pathParts.pop() || '';
    return { host, projectId, publicKey };
  } catch {
    return null;
  }
}

function buildPayload(
  eventId: string,
  record: LogRecord,
  environment: string,
  release: string,
): string {
  const payload: Record<string, unknown> = {
    event_id: eventId,
    timestamp: record.timestamp,
    level: record.severityText.toLowerCase(),
    logger: record.resource.serviceName,
    platform: 'javascript',
    environment,
    release,
    message: { formatted: record.body },
    exception: record.error
      ? {
          values: [
            {
              type: record.error.name || 'Error',
              value: record.error.message,
              stacktrace: record.error.stack
                ? { frames: parseStackFrames(record.error.stack) }
                : undefined,
            },
          ],
        }
      : undefined,
    extra: { ...record.attributes, caller: record.caller },
  };

  // Strip undefined fields
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }

  return JSON.stringify(payload);
}

function generateEventId(): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += hex[Math.floor(Math.random() * 16)];
  }
  return id;
}

function parseStackFrames(
  stack: string,
): Array<Record<string, unknown>> {
  const lines = stack.split('\n').slice(1);
  const frames: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(
      /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/,
    );
    if (match) {
      frames.push({
        function: match[1] || '<anonymous>',
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
      });
    }
  }
  return frames;
}
