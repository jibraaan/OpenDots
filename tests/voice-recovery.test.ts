import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRecoveryWindow } from '../src/client/voice-recovery';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('keeps the call when a transient control-poll failure recovers', () => {
  const expire = vi.fn();
  const recovery = createRecoveryWindow(5000, expire);
  recovery.fault('control', 'Call control connection was lost.');
  vi.advanceTimersByTime(2000);
  recovery.recover('control');
  vi.advanceTimersByTime(10_000);
  expect(expire).not.toHaveBeenCalled();
});
it('ends once when a fault persists past the grace window', () => {
  const expire = vi.fn();
  const recovery = createRecoveryWindow(5000, expire);
  recovery.fault('control', 'Call control connection was lost.');
  vi.advanceTimersByTime(2000);
  recovery.fault('control', 'Call control connection was lost.');
  recovery.fault('peer', 'The voice connection dropped.');
  vi.advanceTimersByTime(3000);
  expect(expire).toHaveBeenCalledOnce();
  expect(expire).toHaveBeenCalledWith('Call control connection was lost.');
  recovery.fault('peer', 'The voice connection dropped.');
  vi.advanceTimersByTime(10_000);
  expect(expire).toHaveBeenCalledOnce();
});
it('shares one window across channels until every channel recovers', () => {
  const expire = vi.fn();
  const recovery = createRecoveryWindow(5000, expire);
  recovery.fault('peer', 'The voice connection dropped.');
  vi.advanceTimersByTime(3000);
  recovery.fault('control', 'Call control connection was lost.');
  recovery.recover('peer');
  vi.advanceTimersByTime(2000);
  expect(expire).toHaveBeenCalledWith('Call control connection was lost.');
});
it('does nothing after disposal', () => {
  const expire = vi.fn();
  const recovery = createRecoveryWindow(5000, expire);
  recovery.fault('peer', 'The voice connection dropped.');
  recovery.dispose();
  vi.advanceTimersByTime(10_000);
  expect(expire).not.toHaveBeenCalled();
});
