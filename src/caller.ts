/**
 * @leadertechie/telemetry
 *
 * Caller info extraction from stack traces.
 * Injects source location (file:line:column) into every log record.
 */

import { CallerInfo } from './types';

/** Path segments that identify telemetry internals (not real callers). */
const INTERNAL_SKIP_PATTERNS = [
  '/telemetry/src/logger.ts',
  '/telemetry/src/caller.ts',
  '/telemetry/src/index.ts',
];

/**
 * Extract caller info by walking up the stack.
 * Skips internal telemetry frames and test runner frames
 * to find the actual application call site.
 */
export function extractCaller(): CallerInfo | undefined {
  const err = new Error();
  const stack = err.stack;
  if (!stack) return undefined;

  const lines = stack.split('\n');
  // Skip first line (Error message)
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const parsed = parseStackLine(trimmed);
    if (!parsed) continue;

    const { file } = parsed;

    // Skip internal telemetry files (NOT test files under __tests__)
    if (file && INTERNAL_SKIP_PATTERNS.some((p) => file.includes(p))) {
      continue;
    }

    // Skip node_modules (test runner, etc.)
    if (file && file.includes('/node_modules/')) {
      continue;
    }

    if (file) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * Parse a single V8-style stack frame line.
 * Supports: at fn (file:line:col), at file:line:col, at async fn (file:line:col)
 */
function parseStackLine(
  line: string,
): CallerInfo | null {
  const match = line.match(
    /at\s+(?:(?:async\s+)?(?:(.+?)\s+\()?)?(?:(.+?):(\d+):(\d+)\)?)$/,
  );
  if (!match) return null;

  const functionName = match[1] || '<anonymous>';
  const file = match[2];
  const lineNum = parseInt(match[3], 10);
  const colNum = parseInt(match[4], 10);

  if (!file) return null;

  return { file, line: lineNum, column: colNum, functionName };
}
