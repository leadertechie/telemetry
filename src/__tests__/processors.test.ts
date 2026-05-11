/**
 * @leadertechie/telemetry — Processor unit tests
 */

import { describe, it, expect, vi } from 'vitest';
import { SimpleLogProcessor } from '../processors/simple-processor';
import { BatchLogProcessor } from '../processors/batch-processor';
import { LogAdapter, LogRecord, LogLevel } from '../types';

function makeRecord(body = 'test'): LogRecord {
  return {
    severityNumber: LogLevel.INFO,
    severityText: 'INFO',
    body,
    timestamp: new Date().toISOString(),
    observedTimestamp: new Date().toISOString(),
    attributes: {},
    resource: { serviceName: 'test' },
  };
}

// ── SimpleLogProcessor ───────────────────────────────────────────────────────

describe('SimpleLogProcessor', () => {
  it('exports each record immediately', async () => {
    const exported: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'test',
      async export(records) { exported.push(...records); },
    };

    const processor = new SimpleLogProcessor(adapter);
    processor.onEmit(makeRecord('a'));
    processor.onEmit(makeRecord('b'));
    await processor.forceFlush();

    expect(exported).toHaveLength(2);
  });

  it('calls adapter.shutdown on shutdown', async () => {
    const shutdownFn = vi.fn();
    const adapter: LogAdapter = {
      name: 'test',
      async export() {},
      shutdown: shutdownFn,
    };

    const processor = new SimpleLogProcessor(adapter);
    await processor.shutdown();
    expect(shutdownFn).toHaveBeenCalledTimes(1);
  });

  it('ignores records after shutdown', async () => {
    const exported: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'test',
      async export(records) { exported.push(...records); },
    };

    const processor = new SimpleLogProcessor(adapter);
    await processor.shutdown();
    processor.onEmit(makeRecord('after-shutdown'));

    await processor.forceFlush();
    expect(exported).toHaveLength(0);
  });

  it('handles adapter export failure gracefully', async () => {
    const adapter: LogAdapter = {
      name: 'failing',
      async export() { throw new Error('fail'); },
    };

    const processor = new SimpleLogProcessor(adapter);
    // Must not throw
    expect(() => processor.onEmit(makeRecord())).not.toThrow();
    await processor.forceFlush();
  });
});

// ── BatchLogProcessor ────────────────────────────────────────────────────────

describe('BatchLogProcessor', () => {
  it('buffers records and exports on forceFlush', async () => {
    const exported: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'batch',
      async export(records) { exported.push(...records); },
    };

    const processor = new BatchLogProcessor(adapter, { scheduledDelayMillis: 5000 });
    processor.onEmit(makeRecord('1'));
    processor.onEmit(makeRecord('2'));
    processor.onEmit(makeRecord('3'));

    expect(exported).toHaveLength(0); // not flushed yet

    await processor.forceFlush();
    expect(exported).toHaveLength(3);
  });

  it('exports in batches respecting maxExportBatchSize', async () => {
    const batches: LogRecord[][] = [];
    const adapter: LogAdapter = {
      name: 'batch',
      async export(records) { batches.push([...records]); },
    };

    const processor = new BatchLogProcessor(adapter, {
      maxExportBatchSize: 2,
      scheduledDelayMillis: 5000,
    });

    processor.onEmit(makeRecord('1'));
    processor.onEmit(makeRecord('2'));
    processor.onEmit(makeRecord('3'));

    await processor.forceFlush();

    // Should have been exported as 2 batches: [1, 2] and then [3]
    expect(exportedLength(batches)).toBe(3);
    expect(batches.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores records after shutdown', async () => {
    const exported: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'batch',
      async export(records) { exported.push(...records); },
    };

    const processor = new BatchLogProcessor(adapter, { scheduledDelayMillis: 5000 });
    await processor.shutdown();
    processor.onEmit(makeRecord('after'));
    await processor.forceFlush();

    expect(exported).toHaveLength(0);
  });

  it('calls adapter.shutdown on shutdown', async () => {
    const shutdownFn = vi.fn();
    const adapter: LogAdapter = {
      name: 'test',
      async export() {},
      shutdown: shutdownFn,
    };

    const processor = new BatchLogProcessor(adapter, { scheduledDelayMillis: 5000 });
    await processor.shutdown();
    expect(shutdownFn).toHaveBeenCalledTimes(1);
  });

  it('handles adapter export failure gracefully', async () => {
    const adapter: LogAdapter = {
      name: 'failing',
      async export() { throw new Error('batch-fail'); },
    };

    const processor = new BatchLogProcessor(adapter, { scheduledDelayMillis: 5000 });
    expect(() => processor.onEmit(makeRecord())).not.toThrow();
    await processor.forceFlush();
  });
});

function exportedLength(batches: LogRecord[][]): number {
  return batches.reduce((sum, b) => sum + b.length, 0);
}
