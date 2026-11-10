# 社区工单、游客授权与频道发言限制

本轮沿用原 Compose + Caddy、账号、Conversation/Message、附件存储、搜索和人类用户 Socket 流程。没有部署到生产，没有数据清理命令。

## 工单入口与开关

社区侧栏只保留选中的工单入口：成员「我的工单」、社区主「工单队列」、已指派处理人「分配给我」（只列该人的指派单）。工单页先返回频道，再显示标题/新建按钮，搜索和状态位于下方；手机可折叠筛选。邀请与设置位于社区名菜单，分类旁的 + 创建该分类的频道。

社区主在「社区设置 → 工单」独立保存两项：

- `privateTicketsEnabled`：迁移默认 true，保留现有成员双向开单。关闭只阻止新建；原参与者继续处理、关闭/重开与查看历史。
- `guestTicketsEnabled`：默认 false，仅私密工单开启时可打开。关闭只阻止新游客开单，原凭证仍可读写其未关闭工单。

关闭前有说明与确认。管理员、版主不能修改这两个开关，服务端检查当前社区主权限。

## 游客访问

入口 `/guest/:serverId` 仅公开社区名称与当前是否接受新单。没有工单列表、社区成员、频道或搜索权限。每次开单只建立 Ticket、Conversation、Message 和 GuestTicketSession，不建立 User/ServerMember/Friendship。

恢复码由浏览器 Web Crypto 生成 32 个随机字节（64 位十六进制），只在创建成功后供本人保存一次。创建重试复用相同的随机 `clientId` 和恢复码；数据库保存 SHA-256 哈希。所有者查询、会话列表、消息和通知中不返回哈希或恢复码。恢复码不写 URL、localStorage、日志或通知。恢复码丢失且浏览器会话失效后，无法仅凭名字或工单 ID 恢复。

每个游客 Cookie 的名字包含其工单 ID，值为服务端另行生成的 32 字节随机令牌；DB 只存令牌哈希。Cookie 使用 HttpOnly、SameSite=Lax、生产 Secure，30 天失效；另有独立 CSRF 令牌。凭证绑定单一工单及其社区。换设备用原社区入口 + ID + 恢复码获得新的会话。ID 仅为查询标识，不是授权。

访客 Socket.IO 使用独立 `/guest-tickets` namespace 和独立传输连接，握手检查 Origin、Cookie、社区/工单绑定及 CSRF。它不会进入正式用户房间或接受任意会话订阅。实时失效通知仅发往 DB 中仍有效的该工单会话，浏览器再经同一授权接口读取数据；重连向前补齐超过一页的遗漏消息。到期连接断开。关闭工单后的写操作在事务中再次检查状态。

公开开单每 IP 每小时 10 次，恢复每 IP 每 15 分钟 10 次；查询和 Socket 也有独立配额。匿名总请求额度继续保留。无权限/不存在/错误社区/错误恢复码使用统一失败提示。

附件复用正式用户的真实 MIME、扩展名、大小、存储名和安全响应头检查，仅支持 PNG/JPEG/GIF/WebP/PDF，最大 10 MB。游客下载接口要求该工单会话，正式用户下载仍要求工单参与权限。已关闭工单可读历史/附件，禁止新消息及上传。机器人不会获得工单读者身份或事件。

## 频道只读与成员限制

- 社区主「将所选频道设为只读」：批量修改 Channel.readOnly。普通成员及其自定义角色的发言允许项不能绕过只读；管理人员仍遵循原管理规则。成员预览不显示私密不可见频道，也不显示可发送表单。
- 成员菜单「限制此成员在指定频道发言」：独立记录 `(channelId,userId)`，支持 10 分钟、1 小时、1 天、永久及仅解除所选频道。到期通过当前时间判断自动失效，输入区定时重新加载权限。原因与到期时间显示在对应输入区。
- 社区主/管理员/版主只能限制较低等级的成员；频道必须属于当前社区。频道限制不影响其他频道或当事人的工单。
- 文字、上传、回复、转发和 Socket typing 共用 channelPermission；写操作与设置变更使用同一 Conversation 锁，避免检查后竞态。只读及禁言变更、开关操作都有审计日志。

## 机器人安装修复

隔离环境复现：已存在的欢迎机器人再次安装返回 HTTP 409，通用数据库唯一键错误被显示为「用户名、邮箱或记录已存在」。同时下拉框为空而提交 ID 已有默认值、无频道时按钮不可点且没有说明。

修复：目录选择和 ID 统一受控；安装前显示请求权限和频道选择；无频道时显示具体提示。提交期间同步锁防重复，服务端在社区锁内按 `(botId,serverId)` 幂等返回已有安装，不覆盖现有授权；配置变更走配置接口。刷新读取真实安装记录，卸载即删除授权/事件订阅。

## 新 API / 实时接口

- PATCH `/api/servers/:id/ticket-settings`
- PATCH `/api/servers/:id/channels-readonly`
- GET/PUT `/api/servers/:id/members/:userId/channel-restrictions`
- GET `/api/guest/:serverId`
- POST `/api/guest/:serverId/tickets`、POST `/api/guest/:serverId/recover`
- GET `/api/guest/:serverId/tickets/:ticketId`
- GET/POST `/api/guest/:serverId/tickets/:ticketId/messages`（before 游标）
- POST `.../uploads`、GET `.../files/:fileId`
- Socket.IO namespace `/guest-tickets`：认证后接收 `ticket:changed` / `session:ready`。不新增可绕过 HTTP 权限的发送事件。

成员/所有者仍使用已有 tickets/conversations/messages/search/uploads 接口。按 ID 查询始终先限制当前读者范围。

## 迁移与安全更新

第 10 个增量迁移：`20261110120000_guest_tickets_channel_restrictions`。增加社区开关、游客身份/会话及频道限制表；允许 Message.senderId 与附件 ownerId 对游客为空，添加「正式用户或游客工单二选一」CHECK 约束和外键。原行仍保留正式作者；不修改已有用户、工单或消息。无新增环境变量。

请先在隔离副本应用迁移及恢复备份验证。更新必须继续使用原 Compose 项目名、环境、卷和文件组合。宿主机 Caddy 的既有配置若为下述组合才沿用此变量：

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
private_backup_dir="$HOME/harbor-backups"
install -d -m 700 "$private_backup_dir"
./scripts/data-inventory.sh > "$private_backup_dir/before-community-controls.txt"
BACKUP_DIR="$private_backup_dir" ./scripts/backup.sh
git pull --ff-only
docker compose build backend nginx
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose up -d --no-deps backend nginx
docker compose exec -T backend npx prisma migrate status
./scripts/data-inventory.sh > "$private_backup_dir/after-community-controls.txt"
docker compose ps
```

需要重建 backend 和 nginx（包含 Vite 前端）。保持 Caddy、PostgreSQL、Redis、上传卷不变。应用容器重启可能短暂断线，客户端自动重连。迁移后有游客消息时，旧后端不理解空 senderId，不能直接降级；使用兼容版本或向前修复。

比较前后私有清单中的数据库记录数量、卷名和原上传文件 SHA-256；测试/业务新消息会增加数量，不应减少。备份/清单和所有令牌不提交 Git。恢复只到新数据库名及隔离目录，不覆盖生产。

## 验证命令

```bash
npm run i18n:check
npm run typecheck
npm run build
npm test
# 指向专用 *_test 数据库 / Redis 后运行，脚本拒绝公网地址：
BROWSER_TEST_SCRIPT=scripts/test-community-controls-browser.mjs npm run test:browser:ci
```

CI 新增同一浏览器流程，备份验收包含 GuestTicketSession、ChannelRestriction 与游客消息的恢复对比。实际运行结果另见交付报告；没有连接实体手机，软键盘/IME 只能标为模拟验收。
