import { useEffect } from 'react';

/** Owns the application frame, never the message scroller or the focused field. */
export function installVisualViewport(win: Window = window) {
  const root = win.document.documentElement;
  const viewport = win.visualViewport;
  const names = ['--app-height', '--app-offset-top'] as const;
  const previousStyles = names.map(name => [name, root.style.getPropertyValue(name)] as const);
  const previousKeyboard = root.getAttribute('data-keyboard');
  const previousViewport = root.getAttribute('data-viewport');
  let frame = 0, stopped = false, closedHeight = 0, keyboardOpen = false, lastWidth = win.innerWidth;
  const editable = () => {
    const element = win.document.activeElement;
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') return true;
    if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
    return element instanceof HTMLInputElement && !element.disabled && !element.readOnly &&
      !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'image'].includes(element.type);
  };
  const update = () => {
    frame = 0;
    if (stopped) return;
    // Safari may dispatch orientationchange before the new dimensions settle.
    // A later layout-width change resets the baseline again; keyboard resizes
    // change height alone and deliberately keep the remembered closed frame.
    if (win.innerWidth !== lastWidth) { closedHeight = 0; keyboardOpen = false; lastWidth = win.innerWidth; }
    const mobile = win.innerWidth < 1024;
    root.setAttribute('data-viewport', mobile ? 'mobile' : 'desktop');
    if (!mobile) {
      keyboardOpen = false; closedHeight = 0;
      names.forEach(name => root.style.removeProperty(name));
      root.setAttribute('data-keyboard', 'closed');
      return;
    }
    // Pinch zoom deliberately changes the visible region. Resizing the application
    // to that region would reflow the text while the user is trying to magnify it.
    if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
    const height = viewport?.height || win.innerHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    const layoutHeight = Math.max(win.innerHeight, root.clientHeight, height);
    if (!closedHeight || (!editable() && !keyboardOpen)) closedHeight = layoutHeight;
    if (!keyboardOpen && editable()) closedHeight = Math.max(closedHeight, layoutHeight);
    const obscured = closedHeight - height;
    // Dynamic browser chrome is much shorter than a keyboard. A remembered closed
    // frame also handles Android's resize-content mode, where innerHeight shrinks.
    const threshold = Math.max(120, closedHeight * 0.18);
    keyboardOpen = obscured > threshold && (editable() || keyboardOpen);
    if (!keyboardOpen && !editable()) closedHeight = layoutHeight;
    root.style.setProperty('--app-height', `${Math.round(height * 100) / 100}px`);
    root.style.setProperty('--app-offset-top', `${Math.max(0, viewport?.offsetTop || 0)}px`);
    root.setAttribute('data-keyboard', keyboardOpen ? 'open' : 'closed');
  };
  const schedule = () => { if (!stopped && !frame) frame = win.requestAnimationFrame(update); };
  const rotate = () => { closedHeight = 0; keyboardOpen = false; schedule(); };
  // A resize caused by the keyboard is not an orientation change. Only use the
  // orientation event, rather than the changing innerHeight aspect ratio.
  const screenOrientation = win.screen?.orientation;
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', rotate);
  screenOrientation?.addEventListener('change', rotate);
  win.document.addEventListener('focusin', schedule);
  win.document.addEventListener('focusout', schedule);
  update();
  return () => {
    stopped = true;
    if (frame) win.cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('orientationchange', rotate);
    screenOrientation?.removeEventListener('change', rotate);
    win.document.removeEventListener('focusin', schedule);
    win.document.removeEventListener('focusout', schedule);
    for (const [name, value] of previousStyles) value ? root.style.setProperty(name, value) : root.style.removeProperty(name);
    if (previousKeyboard === null) root.removeAttribute('data-keyboard'); else root.setAttribute('data-keyboard', previousKeyboard);
    if (previousViewport === null) root.removeAttribute('data-viewport'); else root.setAttribute('data-viewport', previousViewport);
  };
}

export function useVisualViewport() {
  useEffect(() => installVisualViewport(), []);
}
