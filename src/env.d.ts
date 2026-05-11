/**
 * Ambient declarations for runtime globals not in ES2020 lib.
 * These exist globally in CF Workers, Node.js 18+, and browsers.
 */

declare const console: {
  debug(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare function fetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response>;

declare class URL {
  constructor(url: string, base?: string | URL);
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  username: string;
  password: string;
  searchParams: URLSearchParams;
  toString(): string;
  toJSON(): string;
}

declare function setTimeout(callback: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

// ── Web APIs used by adapters ───────────────────────────────────────────

declare class AbortController {
  constructor();
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

declare class AbortSignal {
  readonly aborted: boolean;
}

declare class ReadableStream<R = unknown> {
  constructor(underlyingSource?: unknown);
  getReader(): ReadableStreamDefaultReader<R>;
}

declare interface ReadableStreamDefaultReader<R = unknown> {
  read(): Promise<ReadableStreamReadResult<R>>;
  releaseLock(): void;
}

declare interface ReadableStreamReadResult<R> {
  done: boolean;
  value: R;
}
