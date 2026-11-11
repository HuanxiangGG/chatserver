// Real local services, isolated accounts and communities. Never target production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { navigate } from "./browser-navigation.mjs";
const base = new URL(process.env.UI_TEST_BASE_URL || "http://localhost:5173");
assert(
  ["localhost", "127.0.0.1"].includes(base.hostname) &&
    base.protocol === "http:",
);
assert(
  new URL(
    process.env.DATABASE_URL || "postgresql://invalid/unsafe",
  ).pathname.endsWith("_test"),
);
const output = new URL(
  process.env.ADMIN_OUTPUT || "../test-results/browser/ticket-admin/",
  import.meta.url,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const dictionary = JSON.parse(
  await readFile(
    new URL("../frontend/src/locales/ticket-admin.json", import.meta.url),
    "utf8",
  ),
);
async function call(path, method = "GET", body, person) {
  const r = await fetch(`${base.origin}/api${path}`, {
    method,
    headers: {
      Origin: base.origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(person
        ? { Cookie: person.cookie, "X-CSRF-Token": person.csrfToken }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const label = path.replace(/\/invites\/[a-f0-9]{64}/g, "/invites/<redacted>").split("?")[0];
  assert(r.ok, `${method} ${label}: HTTP ${r.status}`);
  const data = await r.json();
  return {
    ...data,
    cookie: r.headers.get("set-cookie")?.split(";")[0] || person?.cookie,
  };
}
let f;
if (process.env.ADMIN_FIXTURE)
  f = JSON.parse(await readFile(process.env.ADMIN_FIXTURE, "utf8"));
else {
  const prefix = randomUUID().replaceAll("-", "").slice(0, 10),
    password = `Ticket-${randomUUID()}-7!`;
  const actor = (name, displayName) =>
    call("/auth/register", "POST", {
      username: `ta_${name}_${prefix}`,
      displayName,
      email: `ta_${name}_${prefix}@example.test`,
      password,
    });
  const owner = await actor("owner", "社区主"),
    first = await actor("first", "小林 Very Long Administrator Name"),
    second = await actor("second", "Another administrator"),
    member = await actor("member", "普通成员");
  const a = await call(
      "/servers",
      "POST",
      { name: "泊岸测试社区 A · Friends" },
      owner,
    ),
    b = await call("/servers", "POST", { name: "泊岸测试社区 B" }, owner);
  for (const server of [a, b]) {
    const invite = await call(
      `/servers/${server.id}/invites`,
      "POST",
      { hours: 24, maxUses: 10 },
      owner,
    );
    for (const p of [first, second, member])
      await call(`/invites/${invite.token}/join`, "POST", {}, p);
  }
  f = { owner, first, second, member, a, b };
  if (process.env.ADMIN_SAVE_FIXTURE)
    await writeFile(process.env.ADMIN_SAVE_FIXTURE, JSON.stringify(f), {
      mode: 0o600,
    });
}
async function makeContext(browser, person, width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 640 ? 800 : 960 },
    isMobile: width < 640,
    hasTouch: width < 640,
  });
  if (person) {
    const n = person.cookie.indexOf("=");
    await context.addCookies([
      {
        name: person.cookie.slice(0, n),
        value: person.cookie.slice(n + 1),
        url: base.origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  await context.addInitScript(
    ({ width }) => {
      const v = new EventTarget();
      Object.assign(v, {
        height: width < 640 ? 800 : 960,
        width,
        offsetTop: 0,
        scale: 1,
      });
      Object.defineProperty(window, "visualViewport", {
        value: v,
        configurable: true,
      });
      window.reviewKeyboard = (height) => {
        v.height = height;
        v.dispatchEvent(new Event("resize"));
      };
      window.reviewErrors = [];
      window.addEventListener("unhandledrejection", () =>
        window.reviewErrors.push("Unhandled rejection"),
      );
    },
    { width },
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.name));
  return { context, page, errors };
}
async function visit(page, path) {
  await page.waitForLoadState("networkidle");
  await navigate(page, `${base.origin}${path}`);
}
async function language(page, lang) {
  await visit(page, "/settings");
  await page.locator(".sound-settings select").first().selectOption(lang);
}
async function memberMenu(page, p) {
  const row = page
    .locator(".community-member")
    .filter({ has: page.locator(`a[href="/profile/${p.user.id}"]`) });
  await row.getByRole("button").click();
  return page.getByRole("dialog");
}
async function snapshot(page, name) {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `Horizontal overflow: ${name}`,
  );
  await page.screenshot({ path: new URL(`${name}.png`, output).pathname });
}
async function checkQueue(
  page,
  language,
  ownTicketId,
  screenshotName,
  assignedTicketId,
) {
  const title = language === "en" ? "Ticket queue" : "工单队列";
  await page
    .locator(".ticket-queue header")
    .getByRole("heading", { name: title, exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".ticket-queue header h1").textContent(),
    title,
  );
  const scope = page.locator(".ticket-scope-filter");
  const all = scope.getByRole("link", {
    name: language === "en" ? "All" : "全部",
    exact: true,
  });
  const assigned = scope.getByRole("link", {
    name: language === "en" ? "Assigned to me" : "分配给我",
    exact: true,
  });
  await all.click();
  await page.locator(`.ticket-row[href*="/tickets/${ownTicketId}/"]`).waitFor();
  await page.locator(".claimable-tickets").waitFor();
  assert.equal(await all.getAttribute("aria-current"), "page");
  assert(
    await page.locator(".ticket-filters").evaluate((filters) => {
      const claims = document.querySelector(".claimable-tickets");
      return (
        !!claims &&
        !!(
          filters.compareDocumentPosition(claims) &
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      );
    }),
    "Search/status filters must precede the claim queue",
  );
  await snapshot(page, screenshotName);
  const assignedResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/tickets?assigned=1&") &&
      r.request().method() === "GET" &&
      r.status() === 200,
  );
  await assigned.click();
  await page.waitForURL("**/tickets?assigned=1");
  await assignedResponse;
  await page
    .locator(".ticket-queue > .ticket-list,.ticket-queue > .empty")
    .first()
    .waitFor();
  assert.equal(await assigned.getAttribute("aria-current"), "page");
  assert.equal(await page.locator(".claimable-tickets").count(), 0);
  assert.equal(
    await page.locator(`.ticket-row[href*="/tickets/${ownTicketId}/"]`).count(),
    0,
    "My participant-only ticket must not appear in Assigned to me",
  );
  if (assignedTicketId)
    await page
      .locator(`.ticket-row[href*="/tickets/${assignedTicketId}/"]`)
      .waitFor();
  await snapshot(page, `${screenshotName}-assigned`);
  await all.click();
  await page.locator(`.ticket-row[href*="/tickets/${ownTicketId}/"]`).waitFor();
  await page.locator(".claimable-tickets").waitFor();
}
const results = [];
for (const [engine, type] of Object.entries({ chromium, webkit }).filter(
  ([k]) => !process.env.REVIEW_ENGINE || k === process.env.REVIEW_ENGINE,
)) {
  const browser = await type.launch();
  try {
    for (const width of [1440, 360].filter(
      (w) =>
        !process.env.REVIEW_WIDTH || Number(process.env.REVIEW_WIDTH) === w,
    )) {
      const contexts = await Promise.all([
        makeContext(browser, f.owner, width),
        makeContext(browser, f.first, width),
        makeContext(browser, null, width),
      ]);
      const [owner, admin, guest] = contexts,
        op = owner.page,
        ap = admin.page,
        gp = guest.page;
      try {
        await call(
          `/servers/${f.a.id}/members/${f.first.user.id}`,
          "PATCH",
          { role: "MEMBER" },
          f.owner,
        );
        await call(
          `/servers/${f.a.id}/members/${f.second.user.id}`,
          "PATCH",
          { role: "ADMIN" },
          f.owner,
        );
        await visit(op, `/servers/${f.a.id}/settings`);
        const dialog = await memberMenu(op, f.first);
        await dialog
          .getByRole("button", {
            name: dictionary["zh-CN"].adminAppoint,
            exact: true,
          })
          .click();
        assert((await dialog.textContent()).includes(f.a.name));
        assert((await dialog.textContent()).includes(f.first.user.displayName));
        await snapshot(op, `${engine}-${width}-appoint-zh`);
        await dialog
          .getByRole("button", {
            name: dictionary["zh-CN"].adminConfirm,
            exact: true,
          })
          .click();
        await dialog.waitFor({ state: "detached" });
        assert.equal(
          (await call(`/servers/${f.a.id}`, "GET", undefined, f.first)).role,
          "ADMIN",
        );
        assert.equal(
          (await call(`/servers/${f.b.id}`, "GET", undefined, f.first)).role,
          "MEMBER",
        );
        await op.getByLabel("允许游客免注册开单", { exact: true }).check();
        await op
          .getByLabel(dictionary["zh-CN"].adminClaimSetting, { exact: true })
          .check();
        const ownTicket = await call(
          `/servers/${f.a.id}/tickets`,
          "POST",
          {
            clientId: randomUUID(),
            ownerOnly: true,
            subject: "Administrator as participant",
            category: "Support",
            content: "My own ticket remains accessible from All",
          },
          f.first,
        );
        await visit(ap, `/servers/${f.a.id}/tickets?assigned=0`);
        await ap.locator(".claimable-tickets").waitFor();
        await checkQueue(
          ap,
          "zh-CN",
          ownTicket.id,
          `${engine}-${width}-queue-zh`,
        );
        await visit(gp, `/guest/${f.a.id}`);
        await gp.getByRole("button", { name: "新建工单", exact: true }).click();
        await gp.locator("[name=displayName]").fill("临时朋友");
        await gp
          .locator("[name=subject]")
          .fill(`Guest private conversation ${engine} ${width}`);
        await gp.locator("[name=content]").fill("只在这张工单里交流。");
        await gp.locator("[name=ownerOnly][value=true]").check();
        await gp.locator("form>button").last().click();
        await gp.locator(".guest-composer textarea").waitFor();
        await gp
          .getByRole("button", { name: "已保存，收起", exact: true })
          .click();
        const ticketId = new URL(gp.url()).pathname.split("/").at(-1);
        assert.equal(
          await ap
            .locator(".claimable-row")
            .filter({ hasText: ticketId })
            .count(),
          0,
        );
        await visit(op, `/servers/${f.a.id}/tickets`);
        await op.locator(".ticket-queue header > .btn-primary").waitFor();
        assert.equal(
          await op.locator(".ticket-queue header > .btn-primary").count(),
          1,
        );
        await op.locator(`.ticket-row[href*="/tickets/${ticketId}/"]`).click();
        await op.locator(".ticket-toolbar").waitFor();
        await op.locator(".ticket-toolbar-actions .icon-btn").click();
        await op
          .getByRole("button", {
            name: dictionary["zh-CN"].adminReassign,
            exact: true,
          })
          .click();
        await op
          .getByRole("dialog")
          .locator("select")
          .selectOption(f.first.user.id);
        await op
          .getByRole("dialog")
          .getByRole("button", {
            name: dictionary["zh-CN"].adminRequestConsent,
            exact: true,
          })
          .click();
        await gp
          .getByRole("button", {
            name: dictionary["zh-CN"].adminConsentApprove,
            exact: true,
          })
          .click();
        await ap.locator(`.ticket-row[href*="/tickets/${ticketId}/"]`).click();
        await ap.locator(".ticket-toolbar").waitFor();
        const input = ap.locator(".composer textarea");
        await input.waitFor();
        for (let n = 0; n < 3; n++) {
          await input.fill(`管理员连续回复 ${n}`);
          await input.press("Enter");
        }
        await gp
          .locator(".guest-message")
          .filter({ hasText: "管理员连续回复 2" })
          .waitFor();
        assert(await input.evaluate((e) => document.activeElement === e));
        await input.fill("中文输入法");
        await input.evaluate((e) =>
          e.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              keyCode: 229,
              isComposing: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        assert.equal(await input.inputValue(), "中文输入法");
        await input.fill("");
        if (width < 640) {
          await input.focus();
          await ap.evaluate(() => window.reviewKeyboard(420));
          await ap.waitForFunction(
            () => document.documentElement.dataset.keyboard === "open",
          );
          const box = await input.boundingBox(),
            send = await ap.locator(".send-button").boundingBox();
          assert(box.y + box.height <= 420 && send.y + send.height <= 420);
          await snapshot(ap, `${engine}-${width}-keyboard-simulated`);
          await input.blur();
          await ap.evaluate(() => window.reviewKeyboard(800));
          await ap.waitForFunction(
            () => document.documentElement.dataset.keyboard === "closed",
          );
        }
        await snapshot(ap, `${engine}-${width}-ticket-zh`);
        await gp.reload();
        await gp
          .locator(".guest-message")
          .filter({ hasText: "管理员连续回复 2" })
          .waitFor();
        assert.equal(new URL(gp.url()).pathname.split("/").at(-1), ticketId);
        const adminPath = new URL(ap.url()).pathname;
        for (const p of [op, ap]) await language(p, "en");
        await visit(ap, adminPath);
        await ap.locator(".ticket-toolbar").waitFor();
        await snapshot(ap, `${engine}-${width}-ticket-en`);
        await ap.locator(".ticket-toolbar-actions .icon-btn").click();
        await ap
          .getByRole("button", { name: "Close ticket", exact: true })
          .click();
        await ap
          .locator(".ticket-toolbar-actions")
          .getByRole("button", { name: "Reopen ticket", exact: true })
          .click();
        const claimable = await call(
          `/servers/${f.a.id}/tickets`,
          "POST",
          {
            clientId: randomUUID(),
            ownerOnly: false,
            subject: "Hidden until claimed",
            category: "Support",
            content: "No queue content leakage",
          },
          f.member,
        );
        await visit(ap, `/servers/${f.a.id}/tickets?assigned=0`);
        await ap.locator(".claimable-tickets").waitFor();
        await checkQueue(
          ap,
          "en",
          ownTicket.id,
          `${engine}-${width}-queue-en`,
          ticketId,
        );
        await ap
          .locator(".claimable-row")
          .filter({ hasText: `#${claimable.number}` })
          .getByRole("button", { name: dictionary.en.adminClaim, exact: true })
          .click();
        await ap.waitForURL(`**/tickets/${claimable.id}/chat/**`);
        await ap
          .locator(".message-content")
          .filter({ hasText: "No queue content leakage" })
          .waitFor();
        await visit(op, `/servers/${f.a.id}/settings`);
        await gp.locator(".guest-current-handler").filter({hasText:f.first.user.displayName}).waitFor();
        const menu = await memberMenu(op, f.first);
        await snapshot(op, `${engine}-${width}-member-menu-en`);
        await menu
          .getByRole("button", { name: dictionary.en.adminRevoke, exact: true })
          .click();
        await menu
          .getByRole("button", {
            name: dictionary.en.adminConfirm,
            exact: true,
          })
          .click();
        await gp.locator(".guest-current-handler").waitFor({ state: "detached" });
        await ap.locator(".composer textarea").waitFor({ state: "detached" });
        await ap.locator(".error-box").waitFor();
        const stored = await call(
          `/tickets/${claimable.id}`,
          "GET",
          undefined,
          f.owner,
        );
        assert.equal(stored.assigneeId, null);
        assert.equal(stored.status, "OPEN");
        assert(
          (
            await call(`/servers/${f.a.id}/tickets`, "GET", undefined, f.owner)
          ).tickets.some((t) => t.id === ticketId),
        );
        for (const c of contexts) {
          assert.deepEqual(c.errors, []);
          assert.deepEqual(
            await c.page.evaluate(() => window.reviewErrors),
            [],
          );
        }
        results.push({
          engine,
          width,
          languages: ["zh-CN", "en"],
          passed: true,
          keyboard:
            width < 640
              ? "visualViewport simulation; no physical device"
              : "desktop",
        });
      } catch (e) {
        await op.screenshot({
          path: new URL(`${engine}-${width}-owner-failure.png`, output)
            .pathname,
        });
        await ap.screenshot({
          path: new URL(`${engine}-${width}-admin-failure.png`, output)
            .pathname,
        });
        throw e;
      } finally {
        for (const c of contexts) await c.context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  new URL("results.json", output),
  JSON.stringify(results, null, 2),
);
console.log(
  "Admin ticket browser acceptance passed: appointment, consent, guest refresh, claim, revocation, continuous input, zh/en, desktop/360px.",
);
