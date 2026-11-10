// Exercise the app's Router for internal navigation. A hard reload is tested
// separately, without cancelling live fetches at every ordinary route change.
export async function navigate(page, target) {
  const current = new URL(page.url()), next = new URL(target);
  if (current.origin === next.origin && current.protocol.startsWith('http')) {
    const path = next.pathname + next.search + next.hash;
    const link = page.locator(`a[href=${JSON.stringify(path)}]:visible`).first();
    if (await link.count()) {
      await link.click();
      await page.waitForURL(next.href);
      return;
    }
    await page.evaluate(path => {
      const idx = Number.isFinite(history.state?.idx) ? history.state.idx + 1 : 0;
      history.pushState({idx, key: crypto.randomUUID(), usr: null}, '', path);
      dispatchEvent(new PopStateEvent('popstate', {state: history.state}));
    }, path);
    await page.waitForURL(next.href);
  } else await page.goto(next.href);
}
