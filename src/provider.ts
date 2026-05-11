/**
 * @leadertechie/telemetry
 *
 * LoggerProvider — creates and manages Logger instances.
 *
 * OTEL-inspired: LoggerProvider holds a shared Resource and processor pipeline.
 * Call LoggerProvider.getLogger(name) to get a named logger.
 *
 * @example
 * ```ts
 * import { LoggerProvider, consoleAdapter } from '@leadertechie/telemetry';
 *
 * const provider = new LoggerProvider({
 *   serviceName: 'toldby-routing',
 *   environment: 'production',
 * });
 *
 * provider.addAdapter(consoleAdapter());
 *
 * const logger = provider.getLogger('fetch-handler');
 * logger.info('Hello, world!');
 * ```
 */

import { Logger } from './logger';
import { LogAdapter, LogProcessor, LoggerInterface, Resource } from './types';
import { SimpleLogProcessor } from './processors/simple-processor';

export interface LoggerProviderOptions {
  serviceName?: string;
  environment?: string;
  version?: string;
  processName?: string;
  /** Additional resource attributes. */
  [key: string]: unknown;
}

export class LoggerProvider {
  private processors: LogProcessor[] = [];
  private resource: Resource;

  constructor(opts?: LoggerProviderOptions) {
    this.resource = {
      serviceName: opts?.serviceName ?? 'unknown',
      environment: opts?.environment,
      version: opts?.version,
      processName: opts?.processName,
    };
  }

  /**
   * Register an adapter via a SimpleLogProcessor (immediate export).
   * For batching, use addProcessor(new BatchLogProcessor(adapter, opts)).
   */
  addAdapter(adapter: LogAdapter): this {
    return this.addProcessor(new SimpleLogProcessor(adapter));
  }

  /**
   * Register a custom processor (SimpleLogProcessor, BatchLogProcessor,
   * or your own implementation).
   */
  addProcessor(processor: LogProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /**
   * Get a named Logger instance.
   * The logger inherits the provider's resource and processors.
   * Optionally provide initial context attributes.
   */
  getLogger(
    name?: string,
    attributes?: Record<string, unknown>,
  ): LoggerInterface {
    const resource = {
      ...this.resource,
      ...(name ? { processName: name } : {}),
    };
    return new Logger(this.processors, resource, attributes);
  }

  /**
   * Force-flush all registered processors.
   */
  async flush(): Promise<void> {
    await Promise.all(this.processors.map((p) => p.forceFlush()));
  }

  /**
   * Shutdown: flush + release all processor resources.
   */
  async shutdown(): Promise<void> {
    await this.flush();
    await Promise.all(this.processors.map((p) => p.shutdown()));
  }
}
