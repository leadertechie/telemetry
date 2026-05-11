/**
 * @leadertechie/telemetry — Caller info extraction tests
 */

import { describe, it, expect } from 'vitest';
import { extractCaller } from '../caller';

describe('extractCaller', () => {
  it('returns caller info when called from a known location', () => {
    const info = extractCaller();
    expect(info).toBeTruthy();
    expect(info!.file).toContain('caller.test.ts');
    expect(info!.line).toBeGreaterThan(0);
    expect(info!.column).toBeGreaterThan(0);
    expect(info!.functionName).toBeTruthy();
  });

  it('skips internal telemetry files', () => {
    const info = extractCaller();
    expect(info).toBeTruthy();
    expect(info!.file).not.toContain('/telemetry/src/logger.ts');
    expect(info!.file).not.toContain('/telemetry/src/caller.ts');
  });
});
