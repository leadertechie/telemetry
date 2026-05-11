/**
 * @leadertechie/telemetry
 *
 * Noop adapter — silently discards all log records.
 * Used as a safe default before any real adapter is configured.
 */

import { LogAdapter, LogRecord } from '../types';

export function noopAdapter(): LogAdapter {
  return {
    name: 'noop',
    async export(_records: LogRecord[]): Promise<void> {
      // deliberately no-op
    },
  };
}
