// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installVisualViewport } from '../../frontend/src/viewport';
let cleanup: (() => void) | undefined, viewport: EventTarget & { height: number; offsetTop: number; scale: number };
let frames: Map<number, FrameRequestCallback>, nextFrame = 1;
const root = () => document.documentElement;
function size(width: number, height: number, visible = height) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  viewport.height = visible;
}
function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }
function resize() { viewport.dispatchEvent(new Event('resize')); flush(); }
beforeEach(() => {
  frames = new Map();
  viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { const id = nextFrame++; frames.set(id, fn); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  document.body.innerHTML = '';
  root().removeAttribute('style'); root().removeAttribute('data-keyboard'); root().removeAttribute('data-viewport');
  size(390, 844);
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); });
it('tracks the visible frame and its pan offset without moving focus or document scroll', () => {
  cleanup = installVisualViewport();
  expect(root().style.getPropertyValue('--app-height')).toBe('844px');
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  viewport.height = 490; viewport.offsetTop = 28;
  resize();
  expect(root().getAttribute('data-keyboard')).toBe('open');
  expect(root().style.getPropertyValue('--app-height')).toBe('490px');
  expect(root().style.getPropertyValue('--app-offset-top')).toBe('28px');
  expect(document.activeElement).toBe(input); expect(window.scrollY).toBe(0);
});
it('restores the closed frame and navigation state after keyboard dismissal', () => {
  cleanup = installVisualViewport();
  const input = document.createElement('input'); document.body.append(input); input.focus();
  viewport.height = 480; resize(); expect(root().dataset.keyboard).toBe('open');
  input.blur(); flush(); expect(root().dataset.keyboard).toBe('open');
  viewport.height = 844; viewport.offsetTop = 0; resize();
  expect(root().dataset.keyboard).toBe('closed'); expect(root().style.getPropertyValue('--app-height')).toBe('844px');
});
it('handles Android resize-content and does not confuse browser chrome with a keyboard', () => {
  cleanup = installVisualViewport();
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  size(390, 500); resize(); expect(root().dataset.keyboard).toBe('open');
  size(390, 844); resize(); expect(root().dataset.keyboard).toBe('closed');
  viewport.height = 780; resize(); expect(root().dataset.keyboard).toBe('closed');
});
it('leaves layout dimensions unchanged during pinch zoom and resumes at normal scale', () => {
  cleanup = installVisualViewport();
  viewport.scale = 2; viewport.height = 422; viewport.offsetTop = 150; resize();
  expect(root().style.getPropertyValue('--app-height')).toBe('844px');
  expect(root().style.getPropertyValue('--app-offset-top')).toBe('0px');
  viewport.scale = 1; viewport.height = 800; viewport.offsetTop = 0; resize();
  expect(root().style.getPropertyValue('--app-height')).toBe('800px');
});
it('resets keyboard history on rotation and clears mobile dimensions on desktop', () => {
  cleanup = installVisualViewport();
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  viewport.height = 480; resize(); expect(root().dataset.keyboard).toBe('open');
  size(844, 390); window.dispatchEvent(new Event('orientationchange')); flush();
  expect(root().dataset.keyboard).toBe('closed'); expect(root().style.getPropertyValue('--app-height')).toBe('390px');
  size(1280, 800); window.dispatchEvent(new Event('resize')); flush();
  expect(root().dataset.viewport).toBe('desktop'); expect(root().style.getPropertyValue('--app-height')).toBe('');
});
it('coalesces events and restores owned attributes/styles on cleanup, including pending work', () => {
  root().style.setProperty('--app-height', '700px'); root().dataset.keyboard = 'existing';
  cleanup = installVisualViewport();
  viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(1);
  cleanup(); cleanup = undefined;
  expect(frames.size).toBe(0); expect(root().style.getPropertyValue('--app-height')).toBe('700px');
  expect(root().dataset.keyboard).toBe('existing'); expect(root().dataset.viewport).toBeUndefined();
  viewport.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); expect(frames.size).toBe(0);
});
it('uses the window height when visualViewport is unavailable', () => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
  cleanup = installVisualViewport();
  expect(root().style.getPropertyValue('--app-height')).toBe('844px');
  size(390, 790); window.dispatchEvent(new Event('resize')); flush();
  expect(root().style.getPropertyValue('--app-height')).toBe('790px'); expect(root().dataset.keyboard).toBe('closed');
});
it('does not hide navigation for non-editable controls or a narrow landscape viewport alone', () => {
  size(844, 390); cleanup = installVisualViewport();
  const button = document.createElement('button'); document.body.append(button); button.focus();
  viewport.height = 210; resize();
  expect(root().dataset.keyboard).toBe('closed'); expect(document.activeElement).toBe(button);
});

it('handles orientationchange arriving before Safari publishes the new layout dimensions', () => {
  cleanup = installVisualViewport();
  const input = document.createElement('textarea'); document.body.append(input); input.focus();
  viewport.height = 480; resize(); expect(root().dataset.keyboard).toBe('open');
  window.dispatchEvent(new Event('orientationchange')); flush();
  size(844, 390); window.dispatchEvent(new Event('resize')); flush();
  expect(root().dataset.keyboard).toBe('closed'); expect(root().style.getPropertyValue('--app-height')).toBe('390px');
  viewport.height = 190; resize(); expect(root().dataset.keyboard).toBe('open');
});
