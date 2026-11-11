# 社区管理员与私密工单

## 身份与操作

社区主在「社区设置 → 成员」的 `⋯` 中任免管理员。确认页同时显示成员名、社区名和权限范围。`ServerMember.role` 仅作用于一个社区，不修改 `User.role`，不会授予全站后台权限。只有当前社区主可以修改管理身份；服务器拒绝管理员自提权、任命同级及修改社区主。任免写入 `AdminAction`，通过现有 `server:updated` 同步在线页面。

成员行保留头像、昵称、身份和一个菜单；手机菜单使用底部面板。资料页从社区成员链接进入时显示该社区身份。工单侧栏统一为「工单」，主区保留一个新建按钮，返回、标题、筛选各有独立位置。管理员可在「全部 / 分配给我」间切换：全部保留本人作为当事人的工单入口，分配给我只显示已指派单，不混入待认领列表。搜索和状态筛选在待认领区域上方。详情右上角保留复制 ID；指派、改派、关闭放入操作菜单，回复位于共享输入区，关闭后提供重开。

## 实际发现的边界

旧版普通撤权回归中，API 返回 403 且正文从页面消失，没有复现普遍的撤权泄漏。另行用旧版本复现了自定义角色叠加问题：ADMIN 同时持有 `handleTickets=true` 自定义角色，撤回 ADMIN 后旧指派仍然存在，工单 GET 仍返回 200。任免语义和剩余能力判断是两件事，因此本轮明确撤回管理身份所持的旧指派，再同步读者。

在线游客还存在状态失步：撤权后 GET 已返回空处理人，但空闲游客 Socket 没有收到更新事件，处理人标签直到下一条消息/刷新才更新。权限变更现在在社区锁内比较处理人/转交请求的变化，事务提交后只通知受影响工单的有效游客会话；不通知无关工单，不靠轮询。

## 阅读范围与同意

开单时明确选择「社区主或指定的管理员」或「仅联系社区主」。API 省略选择时默认 `ownerOnly=true`；全部旧工单迁移后也是 true。社区主主动为成员开单时始终使用 owner-only，不能替成员同意转交。

- Owner-only 工单不进入认领列表。社区主先选择拟接手人，成员或该工单的有效游客会话同意后，才增加处理人的读取权限。
- 同意请求绑定具体接手人的 ID。请求被改为另一人后，旧确认会返回冲突，不能把对甲的同意用于乙。每次同意/拒绝存入 `TicketHandoffConsent`，只存参与者标识，不含恢复码。
- 原自定义处理身份组和版主指派能力继续保留；新管理员可直接成为处理人。普通管理员不会自动看到其他工单。
- 撤销管理员/版主身份时，即使仍有额外自定义处理能力，也撤回原指派。未结工单恢复 OPEN 并回到社区主待分配队列；已关闭单保留 CLOSED 和历史，撤回旧处理人。移除成员、失去处理能力、改派也同步撤销读者。
- 消息、搜索、附件、未读和列表均复用工单权限。实时工单投递在社区事务锁中再次检查当前读者，防止变更前捕获的收件人列表在撤权后继续投递正文。

成员和游客不因管理员认领功能获得新列表权限。游客仍只使用原社区、原工单绑定的 Cookie、CSRF 和恢复凭证。

## 待认领队列

社区主在「社区设置 → 工单」启用 `adminTicketClaimEnabled`，默认关闭。仅本社区 ADMIN 且拥有有效工单处理权限的用户能查看/认领。认领前接口只返回 `id, number, category, createdAt`，不返回标题、成员、举报对象、正文或附件。本人作为当事成员的工单不会成为自己的认领项。

认领和开关/角色/指派变更使用同一社区锁。只有 OPEN、未指派、允许 staff 的单可认领；两个请求竞争时只有一个成功，另一个收到 409 并刷新队列。关闭、重开始终保留 Ticket 和 Conversation ID；已分配单重开恢复 IN_PROGRESS。

## 接口与事件

- `PATCH /api/servers/:id/members/:userId`：现有接口，`role` 的 owner 校验及审计。
- `PATCH /api/servers/:id/ticket-settings`：增加可选 `adminTicketClaimEnabled`。
- `POST /api/servers/:id/tickets`、`POST /api/guest/:serverId/tickets`：增加 `ownerOnly`。
- `GET /api/servers/:id/tickets/claimable?limit=30&cursor=...`：脱敏分页队列。
- `POST /api/tickets/:id/claim`：原子认领。
- `PATCH /api/tickets/:id`：一次只接受一个状态变更、指派或转交动作；`requestAssigneeId` 请求/取消转交；`handoffConsent` + `expectedAssigneeId` 同意/拒绝；原 `assigneeId` 保留，owner-only 新接手人需先同意。
- `POST /api/guest/:serverId/tickets/:ticketId/handoff`：`decision` + `expectedAssigneeId`，校验该工单的游客会话与 CSRF。
- `ticket:queue-changed`：仅含社区 ID 的队列失效通知；owner-only 单仅通知已有的管理员读者。
- `ticket:access-revoked`：指派变更后通知旧读者清除页面，仅含 ID，不含正文。角色变更仍使用 `server:updated`，无需重新登录或轮询。

## 迁移和更新

第 **11** 个增量迁移 `20261110150000_ticket_admin_claim_consent`：增加社区认领开关、Ticket owner-only/待确认字段及认领索引、新建同意审计表。没有 DELETE、TRUNCATE、重建原表或清空数据；默认保留旧单的私密范围，不自动启用认领。无新增环境变量。不更换 Compose/Caddy、数据库、Redis 或上传卷。

在原服务器目录、原 Compose 项目名与原 `COMPOSE_FILE` 下执行；先完成备份并验证其可恢复到新数据库及隔离文件目录：

```bash
private_backup_dir="$HOME/harbor-backups"
install -d -m 700 "$private_backup_dir"
umask 077
./scripts/data-inventory.sh > "$private_backup_dir/before-ticket-admin.txt"
BACKUP_DIR="$private_backup_dir" ./scripts/backup.sh
git pull --ff-only
docker compose build backend nginx
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose up -d --no-deps backend nginx
docker compose exec -T backend npx prisma migrate status
docker compose ps
curl --fail http://127.0.0.1:8080/api/health
./scripts/data-inventory.sh > "$private_backup_dir/after-ticket-admin.txt"
```

8080 使用你原来的 HTTP_PORT。前后核对原用户、消息、工单、附件 ID/数量、挂载卷名及旧文件 SHA-256；正常业务会增加记录，不应缺失旧记录或文件。不要覆盖 `.env`、修改项目/卷名、清空 Redis，或执行数据库重置。容器更新有短暂断线，客户端重连同步。新隐私流程启用后不要回退到绕过同意校验的旧服务，应向前修复。

## 验证

```bash
npm run i18n:check
npm run typecheck
npm run build
npm run test
# 使用隔离 *_test DB 和测试 Redis，脚本拒绝生产地址
BROWSER_TEST_SCRIPT=scripts/test-ticket-admin-browser.mjs npm run test:browser:ci
```

`backend/test/ticket-admin.test.ts` 覆盖身份隔离、原子认领、脱敏、owner-only 转交/过期确认、游客持久历史、撤权后 API/Socket/搜索/附件和自定义角色叠加。浏览器脚本操作真实服务，覆盖 Chromium/WebKit、1440/360px、简体中文/English、任免确认、同意、连续回复、游客刷新、认领与撤权。手机软键盘和 IME 使用模拟事件，不代表实体 iPhone/Android 验收。

CI 还会运行原聊天、社区、游客/频道/机器人浏览器回归；Compose 备份恢复将同意记录加入行数和行内容摘要比较。截图只保存测试身份，恢复码默认遮蔽，机器人令牌不进入截图。
