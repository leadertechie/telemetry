/**
 * @leadertechie/telemetry — adapters barrel
 */

export { consoleAdapter } from './console';
export type { ConsoleAdapterOptions } from './console';

export { sentryAdapter } from './sentry';
export type { SentryAdapterOptions } from './sentry';

export { noopAdapter } from './noop';

export { r2Adapter } from './r2';
export type { R2AdapterOptions } from './r2';

export { fetchAdapter } from './fetch';
export type { FetchAdapterOptions } from './fetch';
