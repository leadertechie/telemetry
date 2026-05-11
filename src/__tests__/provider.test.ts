/**
 * @leadertechie/telemetry — LoggerProvider tests
 */

import { describe, it, expect, vi } from 'vitest';
import { LoggerProvider } from '../provider';
import { SimpleLogProcessor } from '../processors/simple-processor';
import { BatchLogProcessor } from '../processors/batch-processor';
import { noopAdapter } from '../adapters/noop';
import { LogAdapter, LogRecord } from '../types';

describe('LoggerProvider', () => {
  it('creates a logger with default resource', () => {
    const provider = new LoggerProvider();
    const logger = provider.getLogger();
    expect(logger).toBeTruthy();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.flush).toBe('function');
  });

  it('creates a logger with configured resource', () => {
    const provider = new LoggerProvider({
      serviceName: 'my-service',
      environment: 'production',
      version: '1.0.0',
    });
    // We can't directly inspect the resource from LoggerInterface,
    // but it's validated via adapter capture
    expect(provider).toBeTruthy();
  });

  it('getLogger with name sets processName', async () => {
    const received: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'test',
      async export(records) { received.push(...records); },
    };

    const provider = new LoggerProvider({ serviceName: 'test-app' });
    provider.addAdapter(adapter);
    const logger = provider.getLogger('my-worker');
    logger.info('test');
    await provider.flush();

    expect(received).toHaveLength(1);
    expect(received[0].resource.serviceName).toBe('test-app');
    expect(received[0].resource.processName).toBe('my-worker');
  });

  it('addAdapter creates a SimpleLogProcessor', async () => {
    const received: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'test',
      async export(records) { received.push(...records); },
    };

    const provider = new LoggerProvider({ serviceName: 'test' });
    provider.addAdapter(adapter);
    const logger = provider.getLogger();
    logger.info('hello');
    await provider.flush();

    expect(received).toHaveLength(1);
    expect(received[0].body).toBe('hello');
  });

  it('addProcessor accepts a custom processor', async () => {
    const received: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'test',
      async export(records) { received.push(...records); },
    };

    const provider = new LoggerProvider({ serviceName: 'test' });
    provider.addProcessor(new SimpleLogProcessor(adapter));
    const logger = provider.getLogger();
    logger.info('via-processor');
    await provider.flush();

    expect(received).toHaveLength(1);
    expect(received[0].body).toBe('via-processor');
  });

  it('addProcessor with BatchLogProcessor works end-to-end', async () => {
    const received: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'batch-test',
      async export(records) { received.push(...records); },
    };

    const provider = new LoggerProvider({ serviceName: 'test' });
    provider.addProcessor(new BatchLogProcessor(adapter, { scheduledDelayMillis: 5000 }));
    const logger = provider.getLogger();
    logger.info('msg1');
    logger.info('msg2');
    await provider.flush();

    expect(received).toHaveLength(2);
  });

  it('multiple loggers share the same providers processors', async () => {
    const received: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'shared',
      async export(records) { received.push(...records); },
    };

    const provider = new LoggerProvider({ serviceName: 'shared' });
    provider.addAdapter(adapter);

    const loggerA = provider.getLogger('A');
    const loggerB = provider.getLogger('B');

    loggerA.info('from-a');
    loggerB.info('from-b');
    await provider.flush();

    expect(received).toHaveLength(2);
    const bodies = received.map((r) => r.body).sort();
    expect(bodies).toEqual(['from-a', 'from-b']);
  });

  it('fluid API — addAdapter returns this', () => {
    const provider = new LoggerProvider();
    const result = provider.addAdapter(noopAdapter());
    expect(result).toBe(provider);
  });

  it('flush and shutdown on provider', async () => {
    const received: LogRecord[] = [];
    const adapter: LogAdapter = {
      name: 'test',
      async export(records) { received.push(...records); },
    };

    const provider = new LoggerProvider({ serviceName: 'test' });
    provider.addAdapter(adapter);

    const logger = provider.getLogger();
    logger.info('before-shutdown');
    await provider.shutdown();

    // After shutdown, flushing should not throw
    await expect(provider.flush()).resolves.toBeUndefined();
  });
});
