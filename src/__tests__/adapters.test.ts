/**
 * @leadertechie/telemetry — Adapter tests
 */

import { describe, it, expect, vi } from 'vitest';
import { consoleAdapter } from '../adapters/console';
import { sentryAdapter } from '../adapters/sentry';
import { noopAdapter } from '../adapters/noop';
import { LogLevel, LogRecord } from '../types';

function makeRecord(
  level: LogLevel = LogLevel.INFO,
  overrides: Partial<LogRecord> = {},
): LogRecord {
  return {
    severityNumber: level,
    severityText: LogLevel[level],
    body: 'test message',
    timestamp: new Date().toISOString(),
    observedTimestamp: new Date().toISOString(),
    attributes: {},
    resource: { serviceName: 'test' },
    ...overrides,
  };
}

// ── Noop Adapter ─────────────────────────────────────────────────────────────

describe('noopAdapter', () => {
  it('returns an adapter named "noop"', () => {
    const adapter = noopAdapter();
    expect(adapter.name).toBe('noop');
  });

  it('does not throw when called', async () => {
    const adapter = noopAdapter();
    await expect(adapter.export([makeRecord()])).resolves.toBeUndefined();
  });
});

// ── Console Adapter ──────────────────────────────────────────────────────────

describe('consoleAdapter', () => {
  it('returns an adapter named "console"', () => {
    const adapter = consoleAdapter();
    expect(adapter.name).toBe('console');
  });

  it('does not throw when exporting', async () => {
    const adapter = consoleAdapter();
    await expect(adapter.export([makeRecord()])).resolves.toBeUndefined();
  });

  it('filters out entries below the configured level', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const adapter = consoleAdapter({ level: LogLevel.INFO });

    await adapter.export([makeRecord(LogLevel.DEBUG)]);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('passes through entries at or above the configured level', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const adapter = consoleAdapter({ level: LogLevel.INFO });

    await adapter.export([makeRecord(LogLevel.INFO)]);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handles error entries', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = consoleAdapter();

    await adapter.export([makeRecord(LogLevel.ERROR, { error: new Error('test') })]);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('supports JSON output mode', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const adapter = consoleAdapter({ json: true });

    await adapter.export([makeRecord(LogLevel.INFO, { attributes: { key: 'val' } })]);

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.message).toBe('test message');
    expect(parsed.level).toBe('INFO');
    spy.mockRestore();
  });
});

// ── Sentry Adapter ───────────────────────────────────────────────────────────

describe('sentryAdapter', () => {
  it('returns inactive adapter when no DSN is provided', () => {
    const adapter = sentryAdapter();
    expect(adapter.name).toContain('inactive');
  });

  it('returns inactive adapter when DSN is empty', () => {
    const adapter = sentryAdapter({ dsn: '' });
    expect(adapter.name).toContain('inactive');
  });

  it('returns inactive adapter when DSN is invalid', () => {
    const adapter = sentryAdapter({ dsn: 'not-a-valid-dsn' });
    expect(adapter.name).toContain('inactive');
  });

  it('returns active adapter with valid DSN', () => {
    const adapter = sentryAdapter({
      dsn: 'https://publickey@o123.ingest.sentry.io/456',
    });
    expect(adapter.name).toBe('sentry');
  });

  it('filters non-ERROR entries when active', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const adapter = sentryAdapter({
      dsn: 'https://publickey@o123.ingest.sentry.io/456',
    });

    await adapter.export([makeRecord(LogLevel.INFO)]);

    expect(mockFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sends ERROR entries to Sentry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    const adapter = sentryAdapter({
      dsn: 'https://publickey@o123.ingest.sentry.io/456',
      environment: 'test',
      release: '1.0.0',
    });

    await adapter.export([
      makeRecord(LogLevel.ERROR, {
        body: 'something broke',
        timestamp: '2024-01-01T00:00:00.000Z',
        error: new Error('boom'),
        attributes: { requestId: 'abc' },
      }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://o123.ingest.sentry.io/api/456/envelope/');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-sentry-envelope');

    const body = options.body as string;
    const parts = body.split('\n');
    expect(parts).toHaveLength(3);

    const envelopeHeaders = JSON.parse(parts[0]);
    expect(envelopeHeaders.event_id).toBeTruthy();
    expect(envelopeHeaders.dsn).toBe('https://publickey@o123.ingest.sentry.io/456');

    const payload = JSON.parse(parts[2]);
    expect(payload.level).toBe('error');
    expect(payload.message.formatted).toBe('something broke');
    expect(payload.environment).toBe('test');
    expect(payload.release).toBe('1.0.0');
    expect(payload.extra.requestId).toBe('abc');

    vi.unstubAllGlobals();
  });
});
