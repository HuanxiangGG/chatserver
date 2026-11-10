import { createTestPng } from "./browser-fixtures.mjs";
// Isolated real-service acceptance; never targets a production host.
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
  process.env.CONTROLS_OUTPUT || "../test-results/browser/community-controls/",
  import.meta.url,
);
await mkdir(output, { recursive: true, mode: 0o700 });
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
  const data = await r.json();
  assert(r.ok, `${method} ${path}: HTTP ${r.status}`);
  return {
    body: data,
    cookie: r.headers.get("set-cookie")?.split(";")[0] || person?.cookie,
  };
}
let f;
if (process.env.CONTROLS_FIXTURE)
  f = JSON.parse(await readFile(process.env.CONTROLS_FIXTURE, "utf8"));
else {
  let identities;
  if (process.env.CONTROLS_IDENTITIES)
    identities = JSON.parse(
      await readFile(process.env.CONTROLS_IDENTITIES, "utf8"),
    );
  else {
    const prefix = randomUUID().replaceAll("-", "").slice(0, 10),
      password = `Controls-${randomUUID()}-A7!`;
    const actor = async (name) => {
      const r = await call("/auth/register", "POST", {
        username: `cc_${name}_${prefix}`,
        // Display names are not identities. Deliberately duplicate members'
        // names so moderation acceptance must target the stable profile ID.
        displayName: name === "b" ? "a" : name,
        email: `cc_${name}_${prefix}@example.test`,
        password,
      });
      return { ...r.body, cookie: r.cookie };
    };
    identities = {
      owner: await actor("owner"),
      a: await actor("a"),
      b: await actor("b"),
    };
  }
  const { owner, a, b } = identities,
    server = (await call("/servers", "POST", { name: "测试社区 A" }, owner))
      .body,
    other = (await call("/servers", "POST", { name: "测试社区 B" }, owner))
      .body;
  const hall = (await call(`/servers/${server.id}`, "GET", undefined, owner))
    .body.channels[0];
  await call(
    `/servers/${server.id}/channels/${hall.id}`,
    "PATCH",
    { name: "大厅" },
    owner,
  );
  const trade = (
      await call(
        `/servers/${server.id}/channels`,
        "POST",
        { name: "交易" },
        owner,
      )
    ).body,
    guide = (
      await call(
        `/servers/${server.id}/channels`,
        "POST",
        { name: "攻略" },
        owner,
      )
    ).body;
  await call(
    `/servers/${server.id}/channels`,
    "POST",
    { name: "管理室", isPrivate: true },
    owner,
  );
  const category = (
    await call(
      `/servers/${server.id}/categories`,
      "POST",
      { name: "公共区" },
      owner,
    )
  ).body;
  await call(
    `/servers/${server.id}/channels/${hall.id}`,
    "PATCH",
    { categoryId: category.id },
    owner,
  );
  const invite = (
    await call(
      `/servers/${server.id}/invites`,
      "POST",
      { hours: 24, maxUses: 20 },
      owner,
    )
  ).body;
  f = { owner, a, b, server, other, hall, trade, guide, invite };
  if (process.env.CONTROLS_SAVE_FIXTURE)
    await writeFile(process.env.CONTROLS_SAVE_FIXTURE, JSON.stringify(f), {
      mode: 0o600,
    });
}
async function ctx(browser, person, width) {
  const c = await browser.newContext({
    viewport: { width, height: width < 640 ? 844 : 960 },
    isMobile: width < 640,
    hasTouch: width < 640,
  });
  if (person) {
    const n = person.cookie.indexOf("=");
    await c.addCookies([
      {
        name: person.cookie.slice(0, n),
        value: person.cookie.slice(n + 1),
        url: base.origin,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  if (width < 640)
    await c.addInitScript(() => {
      const v = new EventTarget();
      Object.assign(v, { height: 844, width: 390, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", {
        value: v,
        configurable: true,
      });
      window.controlsKeyboard = (h) => {
        v.height = h;
        v.dispatchEvent(new Event("resize"));
      };
    });
  const p = await c.newPage(),
    errors = [],
    state = { reloading: false },
    navigationDiagnostics = [];
  p.on("pageerror", (e) => {
    // Linux WebKit reports cancelled old-document fetches through pageerror.
    // Classify only its exact native diagnostic during our explicit reload;
    // keep a record, and still fail real JS errors and rejected Promises.
    if (state.reloading && /^Fetch API cannot load http/.test(e.name) && /due to access control checks\.$/.test(e.message))
      navigationDiagnostics.push({ name: e.name, message: e.message });
    else errors.push({ name: e.name, message: e.message });
  });
  await p.addInitScript(() => {
    window.controlsUnhandled = 0;
    addEventListener("unhandledrejection", () => window.controlsUnhandled++);
  });
  return { c, p, errors, state, navigationDiagnostics };
}
async function visit(p, path) {
  await p.waitForLoadState("networkidle");
  assert.equal(await p.evaluate(() => window.controlsUnhandled || 0), 0);
  await navigate(p, `${base.origin}${path}`);
}
async function noOverflow(p) {
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "horizontal overflow",
  );
}
const results = [];
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch(),
    otherBrowser = await (engine === "chromium" ? webkit : chromium).launch();
  try {
    for (const width of [1440, 390]) {
      const owner = await ctx(browser, f.owner, width),
        guest = await ctx(browser, null, width),
        recover = await ctx(otherBrowser, null, width),
        outsider = await ctx(browser, null, width);
      const { p: op } = owner,
        { p: gp } = guest;
      try {
        await visit(op, `/servers/${f.server.id}/settings`);
        await op.locator("#ticket-settings").waitFor();
        const privateSwitch = op
            .locator("#ticket-settings input[type=checkbox]")
            .nth(0),
          guestSwitch = op
            .locator("#ticket-settings input[type=checkbox]")
            .nth(1);
        if (!(await privateSwitch.isChecked())) {
          await privateSwitch.check();
          await guestSwitch.waitFor({ state: "visible" });
        }
        if (!(await guestSwitch.isChecked())) await guestSwitch.check();
        await op.locator("#ticket-settings input[readonly]").waitFor();
        // The link is optimistic UI. Wait for the actual save + refresh before
        // replacing the document, rather than cancelling its pending reads.
        await op.waitForFunction(() => {
          const inputs = [...document.querySelectorAll('#ticket-settings input[type=checkbox]')];
          return inputs.length === 2 && inputs.every(input => input.checked && !input.disabled);
        });
        await op.waitForLoadState("networkidle");
        assert.equal(await op.evaluate(() => window.controlsUnhandled || 0), 0);
        owner.state.reloading = true;
        await op.reload();
        await op.locator("#ticket-settings").waitFor();
        await op.waitForLoadState("networkidle");
        owner.state.reloading = false;
        assert(await guestSwitch.isChecked());
        if (engine === "chromium" && width === 1440) {
          // Exercise the actual UI installation, including the actionable empty-channel error.
          const form = op.locator("#community-bots form");
          await form
            .locator("select[name=catalog]")
            .selectOption({ label: "欢迎机器人" });
          await form
            .getByRole("button", { name: "安装机器人", exact: true })
            .click();
          await op.getByRole("alert").filter({ hasText: "请先选择" }).waitFor();
          await form
            .locator("fieldset")
            .first()
            .getByText("大厅", { exact: true })
            .locator("input")
            .check();
          await form.locator("textarea[name=welcome]").fill("欢迎 {name}");
          await form
            .getByRole("button", { name: "安装机器人", exact: true })
            .dblclick();
          await op
            .locator(".community-bot-row")
            .filter({ hasText: "欢迎机器人" })
            .waitFor();
          await op.reload();
          await op
            .locator(".community-bot-row")
            .filter({ hasText: "欢迎机器人" })
            .waitFor();
          await op.locator("#community-bots").screenshot({
            path: new URL("bot-installed.png", output).pathname,
          });
          await call(`/invites/${f.invite.token}/join`, "POST", {}, f.a);
          await call(`/invites/${f.invite.token}/join`, "POST", {}, f.a);
          const history = (
            await call(
              `/conversations/${f.hall.conversationId}/messages`,
              "GET",
              undefined,
              f.owner,
            )
          ).body;
          assert.equal(
            history.messages.filter((m) => m.sender.role === "BOT").length,
            1,
          );
          const guideHistory = (
            await call(
              `/conversations/${f.guide.conversationId}/messages`,
              "GET",
              undefined,
              f.owner,
            )
          ).body;
          assert.equal(
            guideHistory.messages.filter((m) => m.sender.role === "BOT").length,
            0,
          );
          await op
            .locator(".community-bot-row")
            .getByRole("button", { name: "移除", exact: true })
            .click();
          await op.locator(".community-bot-row").waitFor({ state: "detached" });
          await call(`/invites/${f.invite.token}/join`, "POST", {}, f.b);
          assert.equal(
            (
              await call(
                `/conversations/${f.hall.conversationId}/messages`,
                "GET",
                undefined,
                f.owner,
              )
            ).body.messages.filter((m) => m.sender.role === "BOT").length,
            1,
          );
        }
        await visit(op, `/servers/${f.server.id}/settings`);
        await op
          .getByRole("button", { name: "以普通成员身份预览", exact: true })
          .click();
        await op.locator(".preview-channel").first().waitFor();
        assert.equal(await op.locator(".preview-channel textarea").count(), 0);
        assert.equal(
          await op
            .locator(".preview-channel")
            .filter({ hasText: "管理室" })
            .count(),
          0,
        );
        await op.screenshot({
          path: new URL(`${engine}-${width}-preview-after.png`, output)
            .pathname,
        });
        await op.keyboard.press("Escape");
        await visit(gp, `/guest/${f.server.id}`);
        await gp.getByRole("button", { name: "新建工单", exact: true }).click();
        await gp.locator("[name=displayName]").fill("临时小林");
        await gp.locator("[name=subject]").fill(`游客咨询 ${engine} ${width}`);
        await gp.locator("[name=content]").fill("请问周末什么时候一起玩？");
        await gp
          .locator("form button[type=submit],.guest-entry form>button")
          .last()
          .click();
        await gp.locator(".guest-composer textarea").waitFor();
        const ticketId = new URL(gp.url()).pathname.split("/").at(-1),
          code = await gp.locator(".guest-recovery input").inputValue();
        assert.equal(code.length, 64);
        assert.equal(
          await gp.locator(".guest-recovery input").getAttribute("type"),
          "password",
        );
        await gp
          .getByRole("button", { name: "已保存，收起", exact: true })
          .click();
        await gp
          .getByRole("status")
          .filter({ hasText: "连接已断开" })
          .waitFor({ state: "detached" });
        const input = gp.locator(".guest-composer textarea");
        await input.fill("游客连续一");
        await input.press("Enter");
        await input.fill("游客连续二");
        await input.press("Enter");
        await input.fill("游客连续三");
        await input.press("Enter");
        await gp
          .locator(".guest-message")
          .filter({ hasText: "游客连续三" })
          .waitFor();
        assert(await input.evaluate((el) => el === document.activeElement));
        await visit(op, `/servers/${f.server.id}/tickets`);
        await op.locator(`.ticket-row[href*="/tickets/${ticketId}/"]`).click();
        await op
          .locator(".message-content")
          .filter({ hasText: "游客连续三" })
          .waitFor();
        await op
          .locator(".composer textarea")
          .fill("社区主已收到，可以在这里回复。");
        await op.locator(".composer textarea").press("Enter");
        await gp
          .locator(".guest-message")
          .filter({ hasText: "社区主已收到" })
          .waitFor();
        // Browser engines differ here, so recovery also verifies cross-browser access.
        await visit(recover.p, `/guest/${f.server.id}`);
        await recover.p.locator("[name=ticketId]").fill(ticketId);
        await recover.p.locator("[name=recoveryCode]").fill(code);
        await recover.p.locator(".guest-entry form>button").click();
        await recover.p
          .locator(".guest-message")
          .filter({ hasText: "游客连续三" })
          .waitFor();
        await recover.p
          .locator(".guest-composer textarea")
          .fill("换浏览器后仍是这张工单");
        await recover.p.locator(".guest-composer textarea").press("Enter");
        await op
          .locator(".message-content")
          .filter({ hasText: "换浏览器后仍是这张工单" })
          .waitFor();
        const third = outsider.p;
        await visit(third, `/guest/${f.server.id}/tickets/${ticketId}`);
        await third.getByRole("alert").waitFor();
        assert.equal(await third.locator(".guest-composer").count(), 0);
        assert.equal(
          await third.getByText("游客连续三", { exact: true }).count(),
          0,
        );
        const denied = await gp.evaluate(
          async ({ serverId, ticketId, other, conv }) => {
            const paths = [
              `/api/guest/${other}/tickets/${ticketId}`,
              `/api/conversations/${conv}/messages`,
              `/api/servers/${serverId}`,
            ];
            return Promise.all(
              paths.map(async (path) => {
                const r = await fetch(path);
                return r.status;
              }),
            );
          },
          {
            serverId: f.server.id,
            ticketId,
            other: f.other.id,
            conv: f.hall.conversationId,
          },
        );
        assert.deepEqual(denied, [404, 401, 401]);
        // Attachments use real MIME detection and the ticket-specific download policy.
        const png = createTestPng();
        await gp.locator(".guest-composer input[type=file]").setInputFiles({
          name: "guest.png",
          mimeType: "image/png",
          buffer: png,
        });
        await gp.locator(".guest-attachments").waitFor();
        await input.fill("发张图片");
        await input.press("Enter");
        await gp.locator(".guest-file img").first().waitFor();
        assert(
          await gp
            .locator(".guest-file img")
            .first()
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        );
        await gp.locator(".guest-file>button").first().click();
        await gp.getByRole("dialog").waitFor();
        await gp.keyboard.press("Escape");
        if (width < 640) {
          await input.focus();
          await gp.evaluate(() => window.controlsKeyboard(410));
          await gp.waitForFunction(
            () => document.documentElement.dataset.keyboard === "open",
          );
          const r = await input.boundingBox();
          assert(r.y + r.height <= 411);
          await gp.screenshot({
            path: new URL(
              `${engine}-${width}-guest-keyboard-simulated.png`,
              output,
            ).pathname,
          });
          await gp.evaluate(() => window.controlsKeyboard(844));
          await gp.waitForFunction(
            () => document.documentElement.dataset.keyboard === "closed",
          );
        }
        for (const lang of ["en", "zh-CN"]) {
          await gp.locator(".guest-header select").selectOption(lang);
          await noOverflow(gp);
        }
        if (width === 390) {
          for (const width of [320, 360, 375, 414, 768]) {
            await gp.setViewportSize({ width, height: 844 });
            await noOverflow(gp);
            const box = await input.boundingBox();
            assert(
              box.width >= 120 && box.x >= 0 && box.x + box.width <= width,
            );
            for (const theme of ["light", "dark"]) {
              await gp.evaluate(
                (t) => (document.documentElement.dataset.theme = t),
                theme,
              );
              await noOverflow(gp);
            }
          }
          await gp.setViewportSize({ width: 390, height: 844 });
        }
        await gp.screenshot({
          path: new URL(`${engine}-${width}-guest-ticket.png`, output).pathname,
        });
        await op.screenshot({
          path: new URL(`${engine}-${width}-owner-ticket.png`, output).pathname,
        });
        await op.locator(".ticket-context>a").click();
        await op.locator(".ticket-queue h1").waitFor();
        await op.locator(".ticket-row").first().waitFor();
        await op.locator(".ticket-queue header button").waitFor();
        await op.screenshot({
          path: new URL(`${engine}-${width}-tickets-after.png`, output)
            .pathname,
        });
        if (engine === "chromium" && width === 1440) {
          await guest.c.setOffline(true);
          await gp
            .getByRole("status")
            .filter({ hasText: "连接已断开" })
            .waitFor();
          const detail = (
            await call(`/tickets/${ticketId}`, "GET", undefined, f.owner)
          ).body;
          for (let n = 0; n < 55; n++)
            await call(
              `/conversations/${detail.conversationId}/messages`,
              "POST",
              { content: `离线补同步 ${n}`, clientId: randomUUID() },
              f.owner,
            );
          await guest.c.setOffline(false);
          await gp
            .locator(".guest-message")
            .filter({ hasText: "离线补同步 54" })
            .waitFor();
          assert.equal(
            await gp
              .locator(".guest-message")
              .filter({ hasText: "离线补同步" })
              .count(),
            55,
          );
        }
        // Only the selected channel is released, leaving the second restriction intact.
        await visit(op, `/servers/${f.server.id}/settings`);
        await op
          .locator(".community-member")
          .filter({ has: op.locator(`a[href="/profile/${f.a.user.id}"]`) })
          .getByRole("button")
          .last()
          .click();
        await op
          .getByRole("button", {
            name: "限制此成员在指定频道发言",
            exact: true,
          })
          .click();
        let dialog = op.getByRole("dialog");
        await dialog.locator(`input[value="${f.hall.id}"]`).check();
        await dialog.locator(`input[value="${f.trade.id}"]`).check();
        await dialog.locator("[name=reason]").fill("请先阅读频道规则");
        const restrictionSaved = op.waitForResponse(response =>
          response.url().endsWith(`/api/servers/${f.server.id}/members/${f.a.user.id}/channel-restrictions`) &&
          response.request().method() === "PUT",
        );
        await dialog.getByRole("button", { name: "保存", exact: true }).click();
        assert.equal((await restrictionSaved).status(), 200);
        await dialog.waitFor({ state: "detached" });
        const blocked = await fetch(
          `${base.origin}/api/conversations/${f.hall.conversationId}/messages`,
          {
            method: "POST",
            headers: {
              Origin: base.origin,
              Cookie: f.a.cookie,
              "Content-Type": "application/json",
              "X-CSRF-Token": f.a.csrfToken,
            },
            body: JSON.stringify({
              content: "blocked",
              clientId: randomUUID(),
            }),
          },
        );
        assert.equal(blocked.status, 403);
        await op
          .locator(".community-member")
          .filter({ has: op.locator(`a[href="/profile/${f.a.user.id}"]`) })
          .getByRole("button")
          .last()
          .click();
        await op
          .getByRole("button", {
            name: "限制此成员在指定频道发言",
            exact: true,
          })
          .click();
        dialog = op.getByRole("dialog");
        await dialog.locator(`input[value="${f.hall.id}"]`).check();
        await dialog.locator("[name=minutes]").selectOption("0");
        await dialog.getByRole("button", { name: "保存", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        const restrictions = (
          await call(
            `/servers/${f.server.id}/members/${f.a.user.id}/channel-restrictions`,
            "GET",
            undefined,
            f.owner,
          )
        ).body;
        assert(!restrictions.some((r) => r.channelId === f.hall.id));
        assert(restrictions.some((r) => r.channelId === f.trade.id));
        await noOverflow(op);
        for (const state of [owner, guest, recover, outsider]) {
          assert.deepEqual(state.errors, []);
          assert.equal(
            await state.p.evaluate(() => window.controlsUnhandled || 0),
            0,
          );
        }
        console.log(`Community controls passed: ${engine}, ${width}px`);
        results.push({
          engine,
          width,
          passed: true,
          keyboard: width < 640 ? "simulated" : "not applicable",
          navigationDiagnostics: [owner, guest, recover, outsider].flatMap(s => s.navigationDiagnostics),
        });
      } catch (error) {
        await gp.screenshot({
          path: new URL(`${engine}-${width}-failure.png`, output).pathname,
        });
        throw error;
      } finally {
        for (const state of [owner, guest, recover, outsider])
          await state.c.close();
      }
    }
  } finally {
    await browser.close();
    await otherBrowser.close();
  }
}
await writeFile(
  new URL("results.json", output),
  JSON.stringify(results, null, 2),
);
console.log(
  "Community controls browser acceptance passed: real install/uninstall, guest private realtime/recovery across browsers, ID-only denial, channel restrictions, bilingual desktop/mobile and simulated keyboard.",
);
