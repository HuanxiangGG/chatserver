# 社区、频道、私密工单和机器人

本次扩展沿用现有账号、Conversation / Message、附件、回复、搜索、回执、未读、Socket.IO 和通知流程。私聊、群聊和社区分别保留入口；同名频道属于不同 Conversation，不会共享历史。没有语音、屏幕共享、论坛、讨论串、投票、活动或自定义表情的占位入口。

相关文档：[自定义机器人与凭证](bots.md)、[夜航登录与清晨注册](auth-harbor.md)、[数据备份与恢复](../README.md)。

## 界面与实际流程

桌面社区页面采用社区切换、分类/频道列表、聊天区域的相邻布局，成员按需展开；手机在社区、频道、聊天之间逐层返回。浏览器保存上次访问位置。频道和工单共用现有输入框，支持连续输入、中文组合输入、附件、回复、搜索和失败重试。

社区主可修改名称、图标、简介和规则，管理分类与频道、创建邀请、移除成员及转让所有权。邀请支持过期、次数限制和撤销，只在创建时返回原令牌，数据库仅存哈希。退出或移除成员会删除频道直接授权和身份组分配；重新加入不能恢复旧的私密权限。

文字频道、公告频道和私密频道均有真实历史及独立未读。频道可复制链接、设置通知偏好；链接本身不赋予访问权。归档保留消息和文件，对原本有权读取的人保留历史，禁止发送、修改和上传。

## 权限规则

全站管理员与社区角色相互独立。一个社区的授权不适用于另一个社区。

| 内置角色 | 默认权限 |
| --- | --- |
| OWNER 社区主 | 所有社区权限；唯一能转让所有权、分配内置/自定义身份组、指派工单给其他人的角色 |
| ADMIN 管理员 | 查看、发言、上传、管理消息、管理频道、安装机器人、作为可指派工单处理人；不因此获得所有工单内容 |
| MODERATOR 版主 | 查看、发言、上传、管理消息、作为可指派工单处理人；可邀请、禁言/移除普通成员 |
| MEMBER 普通成员 | 查看公开频道、发言和上传；公告默认只读，私密频道默认不可见 |

自定义身份组由社区主创建和分配，位置为 1–49，低于版主 50、管理员 90、社区主 100。管理员、版主和普通成员不能给自己提权或修改同级/更高角色。身份组权限为 `view`、`send`、`upload`、`manageMessages`、`manageChannels`、`installBots`、`handleTickets`；没有设置的字段继承基础权限。多个自定义身份组按位置、ID 排序，后应用的显式布尔值生效，`false` 同样执行。

频道先继承社区权限，再应用频道默认覆盖及该成员身份组的频道覆盖。私密频道默认仅 OWNER / ADMIN、指定成员或具有显式频道查看授权的身份组可见。OWNER / ADMIN 保留频道管理访问；归档和禁言仍禁止写入。公告对普通成员默认禁止发言/上传，可通过显式频道身份组覆盖授权指定发布者。管理消息独立于发言权限，因此有消息管理权但不能发言的人仍可处理违规消息。

频道级查看、发言、上传、消息管理和频道管理均在服务端执行。安装机器人还需社区级安装权，并检查被授权频道中的查看、安装和发言范围。工单处理能力是社区级资格；工单不是普通频道，频道覆盖不会使人获得私密工单正文。社区详情（含预览）返回成员的 `ticketEligible`，候选处理人列表与指派、读取和读者同步共用同一权限解析器，不按角色名称在前端推断资格。

“以普通成员身份预览”使用 MEMBER 默认权限，不继承社区主的身份组或私密成员授权，返回过滤后的频道及有效只读状态。预览只是查看工具，不能更换真实 API 身份；写请求仍验证当前真实权限。

## 双向私密工单

成员从社区或侧栏的“联系社区主”选择类别、主题和首条消息。社区主可以从成员菜单主动发起工单，无需双方先成为好友。双方进入同一张编号工单、同一 Conversation；离线成员再次登录可在“我的工单”找到历史和未读。

默认读者只有当事成员与当前社区主。社区主显式指派具备 `handleTickets` 能力的客服/版主后，该处理人才能读取正文、附件、搜索结果及未读。普通管理员、其他成员及机器人不会自动成为读者。取消指派、失去处理权限、离开社区或社区主转让时，同步撤销旧读者；原用户只有仍属于当事成员或有效处理人时才保留访问。

状态为 OPEN（待处理）、IN_PROGRESS（处理中）、CLOSED（已关闭）。授权参与方可关闭或重新打开同一张工单；关闭后保留历史但禁止消息、编辑和上传。只有社区主能指派处理人。队列在授权范围内支持编号、主题、成员、处理人、状态查询和游标分页。客户端提交 ID 在事务内幂等，双击或重试不会生成第二张工单。

标题、内容、附件、搜索、会话列表、未读、通知及 Socket 投递共享权限边界。即使上传者本人已失去工单权限，或附件被引用为头像，也不能绕过工单检查。公开频道不发布工单主题或活动。审计只记录操作者、目标、动作与状态，不写入完整工单内容。

## API 与实时事件

以下路径统一位于 `/api` 下。人类写请求要求有效 Cookie、受信任 Origin 和 CSRF。Bot API 使用独立 Bearer 凭证，仍检查当前安装及频道范围。

| 范围 | 接口 |
| --- | --- |
| 社区 | `GET/POST /servers`；`GET/PATCH /servers/:id`；`POST /servers/:id/transfer` `{userId}`；`GET /servers/:id/preview` |
| 分类 | `POST /servers/:id/categories`；`PATCH/DELETE /servers/:id/categories/:categoryId` |
| 频道 | `POST /servers/:id/channels`；`PATCH/DELETE /servers/:id/channels/:channelId`（DELETE 表示归档） |
| 成员 | `PATCH/DELETE /servers/:id/members/:userId`；删除自身表示退出，社区主需先转让；`DELETE /servers/:id/bans/:userId` |
| 身份组 | `GET/POST /servers/:id/roles`；`PATCH/DELETE /servers/:id/roles/:roleId`；`PUT /servers/:id/roles/:roleId/members` `{userIds}` |
| 邀请 | `GET/POST /servers/:id/invites`；`DELETE /servers/:id/invites/:inviteId`；公开 `GET /invites/:token` 仅返回预览；`POST /invites/:token/join` |
| 工单 | `GET/POST /servers/:id/tickets`；`GET/PATCH /tickets/:id`；创建字段为 `clientId, subject, category, content, attachmentIds?`，仅社区主可指定 `memberId`；PATCH 为 `status` / `assigneeId` |
| 机器人目录/开发者 | `GET /bots/catalog`；`POST /bots`；`POST /bots/:id/rotate`，凭证只返回一次，网页设置不接收凭证 |
| 安装/命令 | `GET/POST /servers/:id/bots`；`PATCH/DELETE /servers/:id/bots/:installationId`；`GET/POST /servers/:id/commands`，需提供 `conversationId` |
| Bot 进程 | `GET /bot/events?after=cursor`；`POST /bot/messages` `{installationId, conversationId, content, clientId}` |
| 消息/文件 | 沿用 `/conversations/:id/messages`、`/search`、回复上下文、回执、`/uploads?conversationId=...` 和受认证文件下载 |

频道创建/编辑新增 `permissionOverrides`、`roleOverrides: [{roleId, permissions}]`，以及原有 `userIds` 指定查看者。不能引用别的社区的身份组、分类或成员。

`server:updated` 向当前成员及需要撤销本地社区状态的被移除成员通知 `{serverId}`，以重新加载可见数据。`ticket:updated` 仅向授权当事人及需要撤销本地状态的原读者发送 `{id, serverId, conversationId}`，不带正文。消息继续使用 `message:new`、`message:updated`、`conversation:updated`、回执和输入提示等已有事件，受 ConversationMember 与实时权限检查约束。断线恢复通过重新请求授权列表、消息和未读同步，不把历史补发当成新提示音。

## 范围与限制

- 每个账号最多 50 个社区；每社区最多 200 名成员、50 个活动频道、30 个分类和 50 个自定义身份组。排序通过位置数字调整。
- 邀请有效期 1–168 小时、1–200 次使用；加入/邀请操作保留独立限流。
- 每用户每小时最多创建 15 张工单；队列每页 1–50 条，默认 30；编号只解析安全的 Int32 正整数，超范围数字仍按文本查询。主题最多 120 字符、类别 40、消息正文 4000；单条消息最多 5 个附件，单文件 10 MiB。
- 文件仅支持经真实 MIME 检查的 PNG/JPEG/GIF/WebP/PDF。机器人不获得附件、工单或私聊 API。
- 每社区最多安装 20 个机器人；Bot API 120 次/分钟/机器人，发言 20 次/分钟/安装，命令调用 30 次/分钟/用户。Bot 消息不触发其他 Bot 事件。
- 欢迎机器人提供一次欢迎、私密 `/help` 和 `/ticket`。自定义 Bot 在开发者自己的 Node.js 进程运行；示例、授权、轮换和撤销步骤见 [机器人文档](bots.md)。服务器不执行用户上传代码。
- 语音、屏幕共享、论坛、讨论串、投票、活动、自定义表情及可视拖动排序属于后续扩展；当前没有假入口。

## 增量迁移与生产更新

新增第 9 个迁移 `20261110080000_community_roles_tickets_bots`：Server 增加规则/图标、Channel 增加权限覆盖，新增身份组、工单和机器人关系表。原用户、私聊、群聊、历史与附件表不被重建或清空；旧 8 个迁移保持不变。没有新生产环境变量，Compose、PostgreSQL、Redis、上传卷和宿主机 Caddy 继续沿用。

请在服务器原项目目录、原 Compose 项目名下执行，沿用服务器实际 Compose 文件组合、端口和 `.env`；以下示例适用于已有宿主机 Caddy：

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
private_backup_dir="$HOME/harbor-backups"
install -d -m 700 "$private_backup_dir"
./scripts/data-inventory.sh > "$private_backup_dir/before-community.txt"
BACKUP_DIR="$private_backup_dir" ./scripts/backup.sh
# 按 scripts/restore.sh 文档，将备份先恢复到新的 harbor_restore_* 库并验证；不得覆盖生产库。
git pull --ff-only
docker compose build backend nginx
# 后端启动也会执行 migrate deploy；此处先明确完成增量迁移，再重建服务。
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose up -d --no-deps backend nginx
docker compose exec -T backend npx prisma migrate deploy
docker compose ps
curl --fail http://127.0.0.1:8080/api/health
./scripts/data-inventory.sh > "$private_backup_dir/after-community.txt"
diff -u "$private_backup_dir/before-community.txt" "$private_backup_dir/after-community.txt"
```

迁移后的第二次 `migrate deploy` 应没有待执行迁移。新用户/消息或内置 Bot 会使计数合理增加；不要为了让清单相同而删除记录。核对原用户、旧消息、文件哈希和原挂载仍存在；若更新期间仍允许聊天，计数本来就会增长。备份、清单和凭证必须在网站目录之外、限制访问，不提交 Git。

此过程需要重建前后端镜像，不更换 Caddy，也不重启/替换 PostgreSQL、Redis 或其数据卷。禁止重置数据库、删除卷或用旧备份覆盖生产库。新版本产生 CHANNEL/TICKET 数据后，不要直接回滚到不理解这些权限的旧后端；保留迁移与数据，使用兼容版本或向前修复。

## 已实际执行的隔离测试

以 `_test` PostgreSQL 和专用 Redis `/9` 运行，测试创建自己的账号/消息，不连接生产：

```bash
# TEST_DATABASE_URL：库名以 _test 结尾；TEST_REDIS_URL：专用 Redis /9。
node -e 'if (!new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test") || new URL(process.env.TEST_REDIS_URL).pathname !== "/9") process.exit(1)'
# 迁移读取 DATABASE_URL，明确指向刚验证的隔离测试库。
export DATABASE_URL="$TEST_DATABASE_URL"
export REDIS_URL="$TEST_REDIS_URL"
npm run db:generate
npm run db:migrate
npm run test -w backend -- test/communities.test.ts
npm run test -w backend -- test/tickets-bots.test.ts
npm run i18n:check
npm run typecheck
npm run build
npm run test
```

两个集成测试共享隔离 Redis 的限流键，必须顺序执行。已执行的社区权限用例 **18/18 通过**，工单/Bot 用例 **11/11 通过**，包括双社区隔离、角色覆盖、预览、归档历史、权限撤销（包含保留自定义身份组后晋升版主的显式拒绝、指派和实时读者同步）、双向工单、离线重登、附件/搜索/事件隐私、关闭重开、仅新加入触发欢迎与并发欢迎去重、自定义 Bot 独立进程、凭证轮换和卸载撤权。数据库第 9 个迁移已在本地测试库成功执行，迁移后 `prisma migrate diff` 为空。完整构建/测试与浏览器验收结果以本次最终交付及 CI 为准，不把局部通过当作整站验收。

社区浏览器脚本 `scripts/test-community-browser.mjs`、认证脚本 `scripts/test-auth-harbor.mjs` 仅允许本地 HTTP 和 `_test` 配置。键盘开合与中文组合输入通过浏览器模拟；当前没有连接实体 iPhone / Android，不能称为真机通过。没有自动部署生产。

CI 还会通过真实 HTTP API 准备社区、角色、私密归档频道、双向工单、回复和私密图片，以及机器人授权/事件；备份后恢复到新库和隔离上传目录，比较 24 张表、12 组测试对象的摘要及图片 SHA256，并验证拒绝覆盖现有库或目录。该测试仅允许 GitHub 托管 runner 的本地 Compose，不接受公网或远程 Docker。生产备份与恢复脚本保持原有保护。
