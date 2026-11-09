import { afterEach, expect, it, vi } from 'vitest';
import { TypingReporter } from '../../frontend/src/typing-reporter';
import { coalescedRefresh } from '../../frontend/src/coalesced-refresh';

afterEach(() => vi.useRealTimers());

it('reports typing immediately, not once per character, and stops once on idle', () => {
  vi.useFakeTimers();
  const emit = vi.fn(), reporter = new TypingReporter(emit);
  for (let i = 0; i < 140; i++) { reporter.update(true); vi.advanceTimersByTime(5); }
  expect(emit.mock.calls).toEqual([[true]]);
  vi.advanceTimersByTime(1500);
  reporter.stop();
  expect(emit.mock.calls).toEqual([[true], [false]]);
});

it('renews typing during sustained input without letting the peer indicator expire', () => {
  vi.useFakeTimers();
  const emit = vi.fn(), reporter = new TypingReporter(emit);
  for (let i = 0; i <= 50; i++) { reporter.update(true); vi.advanceTimersByTime(100); }
  expect(emit.mock.calls).toEqual([[true], [true], [true]]);
  reporter.stop();
  vi.advanceTimersByTime(10000);
  expect(emit.mock.calls).toEqual([[true], [true], [true], [false]]);
});

it('clears pending typing on erase, send, blur or navigation and can start again', () => {
  vi.useFakeTimers();
  const emit = vi.fn(), reporter = new TypingReporter(emit);
  reporter.update(true); reporter.update(false); reporter.stop();
  vi.advanceTimersByTime(5000);
  reporter.update(true); reporter.stop(); reporter.stop();
  vi.advanceTimersByTime(5000);
  expect(emit.mock.calls).toEqual([[true], [false], [true], [false]]);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

it('coalesces a burst of message, conversation and receipt refreshes into one following pass', async () => {
  const first = deferred(), second = deferred();
  const work = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const refresh = coalescedRefresh(work);
  const pending = refresh();
  await Promise.resolve();
  for (let i = 0; i < 100; i++) expect(refresh()).toBe(pending);
  expect(work).toHaveBeenCalledTimes(1);
  first.resolve();
  await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
  second.resolve(); await pending;
  expect(work).toHaveBeenCalledTimes(2);
});

it('serializes refreshes and observes an event arriving during the following pass', async () => {
  const first = deferred(), second = deferred();
  let active = 0, peak = 0;
  const work = vi.fn(async () => {
    active++; peak = Math.max(peak, active);
    if (work.mock.calls.length === 1) await first.promise;
    else if (work.mock.calls.length === 2) await second.promise;
    active--;
  });
  const refresh = coalescedRefresh(work), pending = refresh();
  await Promise.resolve(); refresh(); first.resolve();
  await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
  expect(refresh()).toBe(pending); second.resolve(); await pending;
  expect(work).toHaveBeenCalledTimes(3); expect(peak).toBe(1);
  await refresh(); expect(work).toHaveBeenCalledTimes(4);
});

it('propagates a failed refresh to all callers and permits the next retry', async () => {
  const work = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const refresh = coalescedRefresh(work), pending = refresh();
  expect(refresh()).toBe(pending);
  await expect(pending).rejects.toThrow('offline');
  await refresh(); expect(work).toHaveBeenCalledTimes(2);
});

it('recovers after a synchronous failure without retaining a rejected in-flight promise', async () => {
  let fail = true;
  const refresh = coalescedRefresh(() => {
    if (fail) throw new Error('offline');
    return Promise.resolve();
  });
  await expect(refresh()).rejects.toThrow('offline'); fail = false;
  await expect(refresh()).resolves.toBeUndefined();
});
