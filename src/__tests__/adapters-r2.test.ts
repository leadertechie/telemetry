/**
 * @leadertechie/telemetry — R2 adapter tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { r2Adapter, R2Bucket } from '../adapters/r2';
import { LogLevel, LogRecord } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    attributes: { requestId: 'abc' },
    resource: {
      serviceName: 'test-svc',
      environment: 'test',
      version: '1.0.0',
    },
    ...overrides,
  };
}

/** Creates a mock R2 bucket that captures all PUT calls. */
function createMockBucket(): {
  bucket: R2Bucket;
  puts: Array<{ key: string; value: string }>;
} {
  const puts: Array<{ key: string; value: string }> = [];
  const bucket: R2Bucket = {
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
    ) {
      const strValue = typeof value === 'string' ? value : '[non-string]';
      puts.push({ key, value: strValue });
      return { key, size: strValue.length, httpEtag: '"mock-etag"' };
    },
    async get(_key: string) {
      return null;
    },
    async list(_opts?: { prefix?: string; limit?: number }) {
      return { objects: [], truncated: false };
    },
  };
  return { bucket, puts };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('r2Adapter', () => {
  it('returns an adapter named "r2"', () => {
    const { bucket } = createMockBucket();
    const adapter = r2Adapter({ binding: bucket });
    expect(adapter.name).toBe('r2');
  });

  it('writes NDJSON records to R2 on export', async () => {
    const { bucket, puts } = createMockBucket();
    const adapter = r2Adapter({
      binding: bucket,
      workerId: 'test-worker',
      prefix: 'logs',
    });

    await adapter.export([
      makeRecord(LogLevel.INFO, { body: 'hello' }),
      makeRecord(LogLevel.ERROR, {
        body: 'oops',
        error: new Error('boom'),
      }),
    ]);

    // Flush buffered data
    await adapter.shutdown?.();

    expect(puts.length).toBeGreaterThanOrEqual(1);

    // Verify the key structure
    const key = puts[0].key;
    expect(key).toMatch(/^logs\/\d{4}\/\d{2}\/\d{2}\/\d{2}-test-worker-\d+\.ndjson$/);

    // Verify NDJSON content — each line should be valid JSON
    const lines = puts[0].value.trim().split('\n');
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    expect(first.msg).toBe('hello');
    expect(first.level).toBe('INFO');
    expect(first.attrs.requestId).toBe('abc');
    expect(first.svc).toBe('test-svc');

    const second = JSON.parse(lines[1]);
    expect(second.msg).toBe('oops');
    expect(second.level).toBe('ERROR');
    expect(second.err).toBeDefined();
    expect(second.err.message).toBe('boom');
  });

  it('rotates files when buffer exceeds maxFileSize', async () => {
    const { bucket, puts } = createMockBucket();
    const adapter = r2Adapter({
      binding: bucket,
      workerId: 'rotator',
      prefix: 'logs',
      maxFileSize: 100, // tiny: flush after ~100 bytes buffered
    });

    // This record's JSON will be ~180+ bytes — well over 100
    // The adapter should flush during this single export call
    const bigAttrs = { data: 'x'.repeat(200) };
    await adapter.export([
      makeRecord(LogLevel.INFO, { body: 'big record', attributes: bigAttrs }),
    ]);

    // One write should have happened (buffer exceeded maxFileSize during export)
    expect(puts.length).toBe(1);

    // Send a second record — should result in a new file (different seq)
    await adapter.export([
      makeRecord(LogLevel.INFO, { body: 'also big', attributes: bigAttrs }),
    ]);
    await adapter.shutdown?.();

    // Two separate files with distinct keys
    expect(puts.length).toBe(2);
    expect(puts[0].key).not.toBe(puts[1].key);
  });

  it('handles empty export gracefully', async () => {
    const { bucket, puts } = createMockBucket();
    const adapter = r2Adapter({ binding: bucket });

    await adapter.export([]);
    await adapter.shutdown?.();

    expect(puts.length).toBe(0);
  });

  it('handles R2 put failures without crashing', async () => {
    const { bucket } = createMockBucket();
    // Make put throw
    bucket.put = async () => {
      throw new Error('R2 unavailable');
    };

    const adapter = r2Adapter({
      binding: bucket,
      maxFileSize: 10, // flush immediately
    });

    // Spy on console.error to suppress expected noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await adapter.export([makeRecord(LogLevel.INFO, { body: 'should fail' })]);
    await adapter.shutdown?.();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('truncates error stacks to save space', async () => {
    const { bucket, puts } = createMockBucket();
    const adapter = r2Adapter({
      binding: bucket,
      maxFileSize: 1024 * 1024,
      workerId: 'stack-test',
    });

    const error = new Error('deep stack');
    error.stack = [
      'Error: deep stack',
      '    at fn1 (file.ts:1:1)',
      '    at fn2 (file.ts:2:2)',
      '    at fn3 (file.ts:3:3)',
      '    at fn4 (file.ts:4:4)',
      '    at fn5 (file.ts:5:5)',
      '    at fn6 (file.ts:6:6)',
    ].join('\n');

    await adapter.export([
      makeRecord(LogLevel.ERROR, { body: 'stacked', error }),
    ]);
    await adapter.shutdown?.();

    const lines = puts[0].value.trim().split('\n');
    const parsed = JSON.parse(lines[0]);
    // Should have at most 5 lines of stack (Error line + 4 frames)
    const stackLines = parsed.err.stack.split('\n');
    expect(stackLines.length).toBeLessThanOrEqual(5);
  });
});
