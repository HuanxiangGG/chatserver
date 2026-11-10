# Harbor · 泊岸聊天

原创、响应式实时聊天网站，支持中文界面、亮/暗主题，适用于电脑和手机浏览器。采用 React 19 / TypeScript / Vite / Tailwind CSS / React Router，以及 Node.js / Express / Socket.IO / Prisma / PostgreSQL / Redis。代码与部署文件完整保存在本仓库，无内置账户或默认管理员密码。

社区、频道权限、双向私密工单、可安装机器人及新版认证页面的接口、权限和更新说明见 [社区文档](docs/communities.md)、[机器人示例](docs/bots.md) 与 [港景登录/注册](docs/auth-harbor.md)。局部测试与完整验收结果分别记录，代码更新不会自动部署生产。

## 社区控制与免注册私密工单（2026-11-10）

社区主可独立关闭新建私密工单、默认关闭的游客入口；已有历史、附件及参与者权限保留。游客不创建账号，使用单工单 Cookie + CSRF 与私密恢复码；频道支持批量只读和指定成员的多频道限制。机器人安装目录与提交状态已统一，重复安装幂等。侧栏、队列、权限预览和手机交互同步调整。

本轮有第 **10** 个增量迁移，无新增环境变量。沿用原 Compose + Caddy 和持久卷，需重新构建 backend/nginx。权限、API、恢复码说明及备份后更新命令见 [社区控制文档](docs/community-controls.md)。历史章节中的第 9 次迁移说明不替代本轮迁移；不要直接回滚到不支持游客消息的旧后端。

## 聊天频率修复（2026-11-09）

取消发送消息每分钟 60 次、输入提示每分钟 120 次的拦截。持有有效会话的请求不再共享每 IP 每分钟 600 次的匿名额度，避免同一网络中的聊天用户相互影响；伪造、失效或已撤销的 Cookie 不会获得豁免。会话仍按每次 HTTP 请求重新验证，保留 Origin、CSRF、聊天成员/频道权限及登录防爆破、上传、好友申请等独立限制。

前端输入提示改为开始输入立即发送、持续输入最多每两秒续报、停顿或离开时发送一次停止；消息、会话和回执触发的列表刷新合并并串行执行，加载期间的新事件会触发后续同步。

本次修复不新增环境变量、迁移或数据清理操作；无需清空 Redis。沿用原 Compose 项目、Caddy 配置及持久卷，更新代码后重建 `backend` 和 `nginx`，浏览器刷新页面以加载新前端。生产更新流程见下文；如果尚未部署社区升级，main 中仍包含该升级的增量迁移。线上效果须在服务器更新后验证。

## 社区、频道、工单与机器人

社区与私聊保留独立入口，复用现有消息、附件、回复、搜索、未读和实时通信。支持分类、文字/公告/私密频道、身份组和频道权限覆盖、普通成员预览、可过期/限次/撤销的邀请、成员管理与社区主转让。归档保留历史，改为只读。

成员可联系社区主，社区主也可主动为成员开私密工单；同一工单共享聊天、历史和附件。默认仅当事成员与当前社区主可读，显式指派后处理人才能加入。管理员和机器人不会自动获得工单权限。关闭/重开保留原记录，角色撤销与所有权转让同步更新读者。

社区设置支持欢迎机器人与自定义 Bot 的安装、频道授权、配置、停用和移除。欢迎仅发送一次；`/help` 与 `/ticket` 私密处理。仓库提供运行在开发者服务中的 Node.js Bot 示例，凭证单独保存并可轮换，泊岸不执行上传代码。

完整权限、API、事件、限制、实际测试及安全更新步骤见 [docs/communities.md](docs/communities.md)。语音、屏幕共享、论坛、讨论串、投票、活动和自定义表情属于后续扩展，没有占位入口。

### 第 9 个增量迁移与更新门槛

`20261110080000_community_roles_tickets_bots` 只增加规则/图标、权限覆盖、身份组、工单和 Bot 关系表；原 8 个迁移不变，旧用户、私聊、群聊、历史和上传文件不被重建或清空。无新增生产环境变量，保留原 Docker Compose + Caddy、PostgreSQL / Redis / 上传卷和 `.env`。需要重新构建后端与前端镜像。

先在原项目、原 Compose 项目名下执行 `scripts/data-inventory.sh` 保存私有清单，运行 `scripts/backup.sh` 备份数据库和上传文件，并在新的隔离目标恢复验证。备份路径和清单不提交 Git。然后沿用原配置更新；下面适用于宿主机 Caddy，实际文件组合与端口以服务器现状为准：

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
git pull --ff-only
docker compose build backend nginx
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose up -d --no-deps backend nginx
docker compose exec -T backend npx prisma migrate deploy
docker compose ps
curl --fail http://127.0.0.1:8080/api/health
```

再次保存清单，核对旧用户/消息数量、原卷挂载及上传文件哈希；正常新消息和内置 Bot 可能增加计数。完整备份、隔离恢复、前后清单命令见 [社区更新步骤](docs/communities.md#增量迁移与生产更新)。不要重置数据库或删除数据卷；不自动部署到公网。新 CHANNEL/TICKET 数据产生后，旧后端可能不理解其权限，回滚需使用兼容版本或向前修复，不能通过删除新表或覆盖生产库回滚。

## 功能

- 注册、用户名或邮箱登录、注销、资料/头像/简介、修改密码；bcrypt 密码哈希；随机 HttpOnly Cookie 会话，数据库只保存令牌哈希；改密/封禁撤销会话。
- 用户搜索、好友申请/接受/拒绝、好友删除、屏蔽/解除屏蔽。
- 实时私聊和群聊；文本/Emoji/图片/PDF；回复、编辑、撤回、仅自己删除；时间、未读数、送达/已读回执、输入提示、历史分页和断线重连后同步。客户端消息 ID 防止重试重复。
- 创建/修改群、头像/简介、好友邀请、移除、群主/管理员/成员、群主转让、退出/解散；每个 API 和 Socket 事件均检查当前权限。
- 多设备在线状态、忙碌/离线、最后在线时间；Redis 共享在线租约与 Socket.IO 广播。
- 管理后台：用户搜索、封禁/解封、违规消息撤回、统计、审计日志。管理员从相同登录页进入，普通用户没有后台权限。
- Cookie CSRF 令牌与 Origin 校验、Helmet、CORS、Redis 限流、Zod 校验、Prisma 参数化访问、安全文件名和真实 MIME 检查。

## 目录

```text
.
├── frontend/                React 页面、状态与 API/Socket 客户端
├── backend/
│   ├── src/                 身份、好友、聊天、上传、实时和管理模块
│   ├── test/                真实 PostgreSQL/Redis 集成测试
│   └── Dockerfile
├── prisma/
│   ├── schema.prisma        账号、聊天、社区、身份组、工单与机器人模型
│   └── migrations/          初始迁移及保留数据的增量迁移
├── nginx/                   前端构建、反向代理与 HTTPS 配置
├── scripts/                 生成环境配置、备份、非覆盖恢复、更新
├── docs/                    计划、接口约定和验收记录
├── .github/workflows/ci.yml  Linux 集成测试与容器构建
├── docker-compose.yml
├── docker-compose.https.yml
├── .env.example
└── LICENSE                  MIT（保留原仓库许可证）
```

模型包含 User、Session、Friendship、FriendRequest、Conversation、ConversationMember、Message、MessageAttachment、MessageRead、BlockedUser、AdminAction，以及 PasswordReset、MessageHidden。数据库迁移保留在 Git；不依赖 `db push`。

## Ubuntu / Debian 部署

预先安装 Git、Docker Engine 和 Docker Compose 插件；建议至少 2 CPU / 2GB RAM、足够的消息和上传存储空间。数据库和 Redis 无公网端口；仅 Nginx 提供访问入口。

```bash
git clone https://github.com/HuanxiangGG/chatserver.git
cd chatserver
cp .env.example .env
nano .env
# 已有宿主机 Caddy 使用这一组合；保留现有 Compose 项目名
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
docker compose up -d --build
docker compose ps
```

**启动前必须修改 `.env` 中两处 `CHANGE_ME...`，数据库连接 URL 内的密码也要一致。** 用 `openssl rand -hex 32` 分别生成数据库、Redis 密码，使用十六进制可免除 URL/Compose 特殊字符转义。`.env` 不会进入 Git 或 Docker 构建上下文。也可在复制前用 `node scripts/configure-env.mjs` 直接创建随机配置（需要 Node；拒绝覆盖已有 `.env`）。

默认仅绑定服务器 `127.0.0.1:8080`，供已有 Caddy 反向代理访问；浏览器应访问公网 HTTPS 域名。生产拒绝 localhost 来源与非 HTTPS 来源。后端启动只执行增量 `prisma migrate deploy`，不会重置数据。

### 现有 Caddy 生产部署（chat.6hx9.com）

保留 Ubuntu + Docker Compose + Caddy 架构。Caddy 继续终止 HTTPS，不要为此站点启用下方历史 Nginx/Certbot HTTPS 方案。已有 PostgreSQL、Redis、上传卷的名称和挂载路径均未改变，来源校验修复本身不需要数据库迁移；社区升级包含上文说明的新增表迁移。

只修改已有 `.env` 中下列配置，不覆盖密码和数据库名称：

```dotenv
APP_ORIGIN=https://chat.6hx9.com
COOKIE_SECURE=true
TRUST_PROXY=2
HTTP_BIND=127.0.0.1
HTTP_PORT=8080
```

两跳链路为浏览器 → Caddy → Nginx → Express。若已有 Caddy 直接代理 Express，实际是一跳，应使用 `TRUST_PROXY=1` 并保留已有前端服务配置。不能将代理信任设为无限制 true；不能把后端或 Caddy 专用 Nginx 监听端口暴露给公网。Nginx 的 Caddy 配置仅适用于可信代理入口，保留 Caddy 提供的 HTTPS 协议和转发链；直接访问的旧 Nginx 配置仍使用自己的 `$scheme`，防止信任外部伪造请求头。

提供 `caddy/Caddyfile.example` 作为现有 Caddyfile 的单站点参考：保留 Host 和原始 Origin，Caddy 重建 X-Forwarded-For/X-Forwarded-Proto，自动代理 WebSocket。**不要覆盖其他站点**。按实际 Caddyfile 路径执行 `caddy validate --config /etc/caddy/Caddyfile`，必要时 `sudo systemctl reload caddy`。Caddy 运行在容器时，上游需使用现有网络中的 nginx 服务地址，不是容器自己的 127.0.0.1；保留原有网络。

新提供的 override 需要 Docker Compose 2.24.4+（使用 `!override` 固定 loopback 端口）；不会创建新数据卷。保留原项目目录和 Compose 项目名，若现有部署已有自定义 override，先核对合并后的配置，保留原网络与卷绑定。不要将 `.env.example` 覆盖到现有 `.env`。

```bash
# 在原生产目录执行；COMPOSE_PROJECT_NAME 不要改变
# 首先使用当前部署的 Compose 配置备份
./scripts/backup.sh
git pull --ff-only
# 拉取只更新代码，此时尚未重建容器；保存数据清单
./scripts/data-inventory.sh > /安全的备份目录/before.txt
# 编辑现有 .env 设置上方变量，不变更已有数据库密码
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
# 只重建应用和前端，保持数据库、Redis、Caddy 运行
docker compose up -d --build --no-deps backend nginx
docker compose exec backend npx prisma migrate deploy
docker compose ps
curl --fail https://chat.6hx9.com/api/health
./scripts/data-inventory.sh > /安全的备份目录/after.txt
```

如果更新前尚无新增 override/脚本，先用原有 Compose 配置执行备份并记录 `docker compose config --volumes`、数据库行数和上传 SHA256，再拉取代码并启用 override。不要执行 down、删除卷、重置迁移。首次可先用浏览器提交空注册表单验证返回中文字段错误而非 Origin 错误；随后用专门的验收账号测试注册/登录与 Socket.IO（不要用 smoke 脚本对生产自动创建账户）。

`APP_ORIGIN` 支持逗号分隔多个明确来源，自动规范化大小写、默认端口、末尾斜杠。禁止 `*`、带路径/查询/凭据的 URL；生产不接受 HTTP、localhost 或回环地址。不根据 Host/X-Forwarded-Host 自动扩大白名单。

错误代码：`ORIGIN_UNTRUSTED`/`ORIGIN_MISSING` 为来源配置或请求头错误；`CSRF_INVALID` 为令牌错误；`COOKIE_MISSING` 为未登录或浏览器未携带 Cookie；`PROXY_HTTPS_REQUIRED` 为代理未正确传递 HTTPS。日志不输出 Cookie、CSRF、会话令牌。正常未登录的 `/auth/me` 返回 401；登录/注册成功后前端会复查 Cookie 会话。Cookie 保持 HttpOnly、SameSite=Lax、Secure。

更新前后，数据库 User/Message/MessageAttachment 等行数不应下降；实时使用会使计数增加。上传清单中原有路径的 SHA256 应一致，新上传可增加文件。卷名和挂载必须保持一致。清单写到受限备份目录，勿提交 Git。脚本不写数据库、不修改附件；需进一步审计可在隔离备份库中核对 ID。恢复流程仍仅写新数据库。

### 迁移、初始化和管理员

```bash
# 幂等迁移；不会重置已有数据库
docker compose exec backend npx prisma migrate deploy
# 幂等初始化（无演示账号或默认密码）
docker compose exec backend npm run db:seed
# 交互创建管理员；密码不回显，不通过参数或环境变量传入
docker compose exec -it backend npm run admin:create
```

管理员 CLI 提示输入用户名、邮箱、显示名称和两次密码；至少 10 字符，bcrypt 上限 72 个 UTF-8 字节。已存在用户名/邮箱不会被覆盖。创建后从正常登录页进入，在导航打开管理后台。没有默认管理员。

### 历史独立 HTTPS / Nginx / WebSocket（已有 Caddy 请跳过）

Nginx 已配置 `/api/` 反向代理、`/socket.io/` 的 Upgrade/Connection 和 75 秒超时，以及 SPA 路由和安全响应头。Socket.IO 使用纯 WebSocket 传输；不使用 HTTP polling。[多实例说明](https://socket.io/docs/v4/redis-adapter/)

将域名 A/AAAA 指向服务器，仅开放 80/443；先在 `.env` 设置 `HTTP_BIND=0.0.0.0`、`HTTP_PORT=80`、`DOMAIN=你的域名`。此阶段仅用于获取证书，勿通过明文连接注册或登录。

```bash
docker compose up -d nginx
# 仅启动证书工具，不会提前启用缺证书的 HTTPS 配置
docker compose -f docker-compose.yml -f docker-compose.https.yml run --rm --no-deps certbot certonly --webroot -w /var/www/certbot -d chat.example.com --email you@example.com --agree-tos --no-eff-email
```

替换示例域名/邮箱，接着 `.env` 设置 `APP_ORIGIN=https://你的域名`、`COOKIE_SECURE=true`，启用 HTTPS：

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

证书存于被 Git 忽略的 `certificates/`。续期由运维定时执行以下命令并确认成功：

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml run --rm --no-deps certbot renew
docker compose -f docker-compose.yml -f docker-compose.https.yml exec nginx nginx -s reload
```

HTTPS 部署之后所有 Compose 生命周期操作都需保留 `-f docker-compose.yml -f docker-compose.https.yml` 参数；请运行 `export COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml`，此后 README 中基础命令和脚本自动使用两份配置。不要公开 PostgreSQL/Redis 端口。

### 更新、备份与恢复

更新前确认 Git 工作区干净，并备份数据库和上传文件：

```bash
./scripts/backup.sh
git pull --ff-only
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy
docker compose ps
```

或使用 `./scripts/update.sh`。生产修改采用兼容旧版的增量迁移；重大 schema 变化先在备份副本演练。不要对生产执行 `migrate reset`、`db push --force-reset`、`docker compose down -v` 或删除卷。回滚应用前确认数据库兼容性，脚本不自动回滚 schema。

备份产生 `backups/database-时间.dump` 和 `backups/uploads-时间.tar.gz`，权限受 `umask 077` 约束。定期将备份加密复制到另一台机器并演练恢复；在线备份期间上传文件和数据库可能有轻微时间差，需要严格一致性时先暂停写入。

```bash
# 必须是全新名称，原数据库保留；如果已存在会失败
./scripts/restore.sh backups/database-时间.dump harbor_restore_20261109
```

核对新库后，再将 `.env` 的 `POSTGRES_DB` 指向恢复库后执行 `docker compose up -d backend` 重新创建后端容器（`restart` 不会重新读取环境变量）。该脚本不会清理或覆盖已有数据库。上传恢复请先创建隔离部署/新上传卷，在隔离卷中解压相应 tar，再核对数据库附件记录和权限；不要直接覆盖正在写入的生产上传目录。备份文件含私人聊天内容，应限制访问并设置保留策略。

## 本地开发

Node.js 22.12+、PostgreSQL 17+、Redis 7.4+。在仓库根目录操作：

```bash
cp .env.example .env
# 配置本机 DATABASE_URL / REDIS_URL；前端开发来源设为 http://localhost:5173
# COOKIE_SECURE=false，TRUST_PROXY=0；本地后端监听 3000
npm ci
npm run db:generate
npm run db:migrate
npm run build
npm run db:seed
npm run admin:create
npm run dev:backend
# 另开终端
npm run dev:frontend
```

访问 `http://localhost:5173`。Vite 将 `/api` 和 `/socket.io` 转发到本机 3000，前后端共享同一个浏览器来源。`UPLOAD_DIR` 为相对于启动进程工作目录的目录，本地建议设绝对路径。开发只启动依赖容器时，可自行添加 **仅绑定 127.0.0.1** 的 PostgreSQL/Redis 端口映射；默认生产 Compose 不暴露数据库。

## 环境变量

| 变量 | 作用 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | Compose 数据库用户/库名，默认 harbor |
| `POSTGRES_PASSWORD` | 数据库随机强密码；仅修改该变量不会更改已有卷内用户密码 |
| `REDIS_PASSWORD` | Redis 随机密码 |
| `DATABASE_URL` | 本地 Prisma/PostgreSQL 连接；Compose 内自动生成 |
| `REDIS_URL` | 本地 Redis 连接；Compose 内自动生成 |
| `APP_ORIGIN` | 允许的浏览器来源，生产 HTTPS 域名；可逗号分隔 |
| `COOKIE_SECURE` | HTTPS 必须 true；本地 HTTP false |
| `TRUST_PROXY` | 本地直连 0；Nginx 后 1；Caddy → Nginx 后 2 |
| `PORT` | 本地后端端口，默认 3000 |
| `UPLOAD_DIR` | 上传路径；Compose 固定 `/app/uploads` 并挂持久卷 |
| `HTTP_BIND` / `HTTP_PORT` | Nginx 绑定地址/HTTP 端口 |
| `DOMAIN` | HTTPS 配置中的单个域名 |
| `SESSION_TTL_DAYS` | 本地会话有效期 1–30 天，默认 14；Compose 可自行加入 |
| `TEST_DATABASE_URL` | 测试专用库，名称必须以 `_test` 结尾 |
| `TEST_REDIS_URL` | 测试专用 Redis `/9` 数据库 |

不使用 JWT，不需要 JWT 密钥；会话凭证为 256 位随机不透明令牌，哈希入库，可服务端撤销。生产 Cookie 同源 HttpOnly/SameSite=Lax/Secure，每个写请求还需 CSRF 令牌与可信 Origin。日志只输出通用故障类型，不记录密码、令牌、请求体或连接串。

## 测试与构建

集成测试需要独立的 PostgreSQL `_test` 库和 Redis `/9`，会清除该测试 Redis 中的 Harbor 限流键，并写入带唯一前缀的测试记录；切勿使用生产实例。测试不会重置数据库或删除上传卷。

```bash
# 另建被 .gitignore 忽略的 .env.test，包含以下变量：
# DATABASE_URL=测试库连接
# TEST_DATABASE_URL=同一个测试库连接
# TEST_REDIS_URL=redis://localhost:6379/9
# REDIS_URL=同一个测试 Redis
# APP_ORIGIN=http://localhost:5173
# UPLOAD_DIR=测试用的独立绝对路径
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
node --env-file=.env.test node_modules/vitest/vitest.mjs run --config backend/vitest.config.ts --root backend
npm run typecheck
npm run build
```

覆盖注册/登录、CSRF、好友流程、私聊、消息重试去重、群权限、Socket 鉴权、封禁与注销、越权读取、上传真实 MIME/扩展名/大小、回执、管理员审计、改密撤销会话与暴力破解限流。详细的实际执行结果见 [验收记录](docs/VERIFICATION.md)。GitHub Actions 在 Ubuntu 使用真实 PostgreSQL/Redis 执行检查，构建并启动完整 Compose，再通过 Nginx 验证 Cookie/CSRF、消息持久化与 WebSocket 收发。生产后端镜像会移除开发依赖。

## GitHub 提交与推送

仓库地址：<https://github.com/HuanxiangGG/chatserver>。本地开发按模块提交，推送前运行上述测试、类型检查与生产构建：

```bash
git status
git add <本模块文件>
git commit -m "feat: describe completed module"
git pull --ff-only
git push origin main
```

使用 GitHub CLI/SSH 或系统凭证管理器认证，不把个人访问令牌写入远端 URL、源码、README 或脚本。不提交 node_modules、真实 `.env`、日志、缓存、证书、备份或上传文件。

## 账户恢复、安全边界与限制

`POST /api/auth/forgot-password` 返回统一响应，避免探测邮箱；支持通过环境变量配置真实 SMTP；未配置 SMTP_HOST 时明确提示联系管理员，不会声称已发送邮件。可信服务器管理员在其他渠道核验身份后执行：

```bash
docker compose exec -it backend npm run recovery:create
```

此命令需要服务器数据库访问权、有效管理员账户名及其密码（不回显），记录操作者、原因和审计日志，只在交互终端显示一次 15 分钟有效链接。不是公共 API 返回令牌；一次使用后失效，重置密码撤销全部会话。不要在共享终端/会话录制中操作，不应把恢复链接写进常规日志。恢复页面通过正常前端路由接受链接。

- 附件仅支持真实 PNG/JPEG/GIF/WebP/PDF，单文件最多 10MiB；SVG、HTML、脚本、可执行文件、压缩包等被拒绝。图片头像也通过认证 API 读取；未关联附件只限上传者，聊天附件需当前成员权限。
- 当前为基础可运营版本，未集成端到端加密、语音/视频、推送通知、邮件投递、全文搜索、杀毒/内容审核服务和对象存储。
- 群人数上限 100；默认会话列表最多 200 条，历史每页 50。适合小中型团队，尚未进行容量压测。新增群成员能读取群内既有历史。
- Redis adapter 可广播到多个后端实例；生产默认单后端。横向扩容须自行配置多后端负载均衡和共享上传存储。WebSocket-only 不要求 polling 粘性会话；当前不提供长轮询回退。[官方说明](https://socket.io/docs/v4/redis-adapter/)
- 在线状态通过 20 秒心跳与 75 秒租约确认，异常退出后的离线显示可能有约 105 秒延迟；不应当作精确考勤记录。
- 尚无自动附件过期清理/用户配额，未发送附件可能占用磁盘；需监控磁盘并后续增加有权限和保留策略的清理任务。
- PostgreSQL 是持久数据源；Redis 用于在线、限流和跨实例广播。Redis 不可用时涉及限流/实时的操作失败关闭，健康检查显示异常。
- 默认部署不自动发布公网；证书签发、域名、防火墙、备份外存、监控和实际服务器验收需在目标环境完成。

## 开发分支：声音、搜索、预览与备份扩展

当前开发分支增加以下实现，**整体升级仍未完成，请勿视为正式发布**：

- 声音设置支持本地访客保存、登录后同步到独立 `UserPreference` 表；`GET/PUT /api/users/me/sound` 需要当前会话，PUT 保留 CSRF 与 Origin 检查。主开关、私聊/群聊/@与回复分类、音量、两种普通提示音、测试音、免打扰及跨午夜时段均可配置。
- 三段原创合成 WAV 位于 `frontend/public/sounds/`，不请求外部音频。需用户点击启用解锁 HTMLAudio 播放；浏览器没有单独可申请的“音频权限”，拒绝播放时显示页面内提示。普通通知与特别提醒共用一秒节流，避免连续播放。
- 只监听 Socket `message:new` 播放声音；自己的消息、重复 ID、前台正在查看会话的普通消息、静音与免打扰均不播放。新增只下发给已认证 Socket 的 `session:ready { serverTime }`，用服务器连接时间过滤重连旧消息，避免客户端时钟偏差。HTTP 历史同步不触发声音。
- `GET /api/conversations/:id/search` 支持 q/sender/from/to/type/cursor/limit；只搜索当前有权限会话，排除自己隐藏与撤回消息；日期按 UTC，limit 1–50。`GET /api/conversations/:id/messages/:messageId/context` 获取原消息周围上下文。搜索结果和回复引用可定位原消息。
- 图片可在页面内放大、关闭及下载；PDF 保持安全下载。附件地址始终由 ID 构造并经过已有下载权限/MIME/文件名检查，不开放上传目录。
- 新增 `20261109110000_user_preferences` 和 `20261109120000_message_search`，只新增表、扩展和索引，不清空旧记录。搜索迁移使用 PostgreSQL `pg_trgm`（可信扩展）；数据库迁移账号需要相应 CREATE 权限。大表创建 GIN 索引可能影响写入，应在维护窗口完成，先在隔离备份库演练。不能通过删除迁移或重置数据库绕过。

所有现有页面已接入共享简体中文 / English 词典，包括登录注册、社区、好友、设置和管理后台。未登录时可切换语言，设置保留在浏览器。`npm run i18n:check` 检查双语 key、插值、重复 key、无效与未使用 key，以及组件可见硬编码文字；CI 检查失败会阻止合并。API 和 Socket 的已知错误通过统一词典展示，用户原文不翻译。

### 每日私密备份和隔离恢复

`./scripts/backup.sh` 使用当前 Compose 项目生成数据库 dump、上传 tar.gz 和 SHA256 清单。默认 `backups/`（已忽略 Git），目录必须为 700、文件为 600；不得选网站静态目录。脚本加锁、检查磁盘空间、验证输出格式并失败返回非零。上传文件仍可能在备份时发生变化，严格一致性快照需要运维暂停写入或使用卷快照；该脚本不自动中断用户聊天。

环境变量：`BACKUP_DIR`（默认 backups）、`BACKUP_RETENTION_DAYS`（默认14，0不清理）、`BACKUP_MIN_FREE_MB`（默认512，另预留估计数据量两倍空间）。只清理本目录中到期的已完成备份文件，绝不清理数据库、Redis 或上传卷。备份含私人内容，应保存到网站根目录之外，另行加密和异地复制。

Ubuntu/Debian 可使用提供的 systemd 模板。先编辑服务中的项目路径、原 `COMPOSE_FILE` 与备份目录，再安装；不要直接覆盖现有其他服务：

```bash
sudo install -d -m 700 /var/backups/harbor
sudo install -m 644 scripts/systemd/harbor-backup.service.example /etc/systemd/system/harbor-backup.service
sudo install -m 644 scripts/systemd/harbor-backup.timer.example /etc/systemd/system/harbor-backup.timer
sudo nano /etc/systemd/system/harbor-backup.service
sudo systemctl daemon-reload
sudo systemctl start harbor-backup.service
sudo systemctl status harbor-backup.service
# 先完成手动备份和隔离恢复核对，再开启每日任务
sudo systemctl enable --now harbor-backup.timer
systemctl list-timers harbor-backup.timer
```

失败可通过 `systemctl --failed` 和 `journalctl -u harbor-backup.service` 查看，尚未配置外部告警接收渠道。本次未在生产安装或启用定时器。

```bash
# 先校验 SHA256；替换为同一次备份清单
(cd /var/backups/harbor && sha256sum -c manifest-TIMESTAMP.sha256)
# 仅恢复到全新库，现有库重名会失败
./scripts/restore.sh /var/backups/harbor/database-TIMESTAMP.dump harbor_restore_verification
# 仅写新建隔离目录，拒绝链接、设备条目和路径穿越
python3 scripts/restore-uploads.py /var/backups/harbor/uploads-TIMESTAMP.tar.gz /var/backups/harbor/harbor_restore_uploads
```

脚本和设置的自动化测试不代表真实生产恢复已经演练。恢复后核对记录和文件，再决定应用切换；恢复脚本不自动覆盖生产库或上传目录。


## 开发分支：转发、群管理、举报与恢复邮件

本分支新增三项**增量迁移**，保留原表记录和上传卷：

- `20261109130000_forward_batches`：消息转发来源元数据及幂等批次。
- `20261109140000_group_moderation`：群公告、公告版本已读和群成员禁言。
- `20261109150000_reports_temporary_bans`：举报记录、账号封禁到期和原因。

新增 HTTP 接口（统一 `/api` 前缀；写操作保留 Cookie、Origin 和 CSRF 验证）：

| 接口 | 用途 |
| --- | --- |
| `POST /conversations/:id/forward` | 1–20 条消息按顺序转发，quote/copy 两种模式；clientId 幂等；来源可读且目标可写；附件复制为目标受权对象 |
| `GET/POST /conversations/:id/announcements` | 查看或管理公告；仅群主和管理员发布 |
| `PATCH/DELETE /conversations/:id/announcements/:announcementId` | 带版本编辑/置顶或软删除，危险操作写审计日志 |
| `POST /conversations/:id/announcements/:announcementId/read` | 标记当前版本已读；更新版本后重新未读 |
| `GET /conversations/:id/mutes` | 管理员查看全部禁言，成员只查看自己 |
| `PUT /conversations/:id/mutes/:userId` | 10m、1h、1d、forever、off，服务端权限和到期判断 |
| `POST /reports`、`GET /reports/mine` | 举报用户、消息、图片、文件或群聊，查看自己的处理状态 |
| `GET /admin/reports`、`PATCH /admin/reports/:id` | 按状态/原因筛选、分页、处理与驳回，并记录审计 |
| `POST /admin/users/:id/ban` | 新增可选 until，空值永久；封禁撤销全部会话；到期只允许重新登录，不恢复旧会话 |

公告和禁言复用 `conversation:updated` 刷新，转发复用 `message:new`。系统通知与声音只监听 Socket 新消息，不从历史请求播放；连接使用 `session:ready.serverTime` 区分重连历史。浏览器系统通知独立开关、静音投递、分类和免打扰；需要用户手动允许。没有 service worker，页面关闭后不投递系统通知或声音。

发送模块将可编辑新草稿与已提交消息分开，最多依次排队20条；请求失败暂停队列，保留原文/附件和 clientId，重试先确认原消息，避免重复。队列只保存在当前页面内存；关闭或刷新页面之前应完成发送确认。用户查看历史记录时不会强制改变消息滚动位置。

### SMTP 配置

在原 `.env` 中配置 `SMTP_HOST`、`SMTP_PORT`（默认587）、`SMTP_SECURE`（465端口使用true）、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`。后端使用 TLS/STARTTLS 并验证证书，不记录协议、邮箱、令牌或重设链接。密码通过原 Compose 环境变量传入，切勿提交真实 `.env`。配置不完整时后端启动失败，避免假成功。

找回密码对存在与不存在的邮箱返回统一受理提示，邮件使用所选中英文文案。令牌为32字节随机值、仅保存SHA256哈希、15分钟有效且一次性；重设撤销旧会话。链接令牌放在URL fragment中，页面读取后清理地址。SMTP失败会立即失效该令牌，并只输出 `PASSWORD_RECOVERY_DELIVERY_FAILED` 运维错误；普通页面不揭示具体邮箱是否存在，未收到邮件时可联系管理员使用可信CLI核验恢复。

### 安全更新本分支

先在隔离环境验证备份/恢复及所有 CI。确认当前目录和 Compose 项目名未改变，沿用原 `COMPOSE_FILE`，不要切换卷名或 Caddy 架构。正式合入 main 后在原服务器目录执行：

```bash
./scripts/backup.sh
./scripts/data-inventory.sh > /私密备份目录/before.txt
git pull --ff-only
docker compose up -d --build
docker compose exec -T backend npx prisma migrate deploy
docker compose ps
./scripts/data-inventory.sh > /私密备份目录/after.txt
```

前后端均需重新构建；启动脚本已在API启动前执行增量迁移。核对前后原用户、消息和群组ID、计数，以及原上传文件SHA256和卷挂载。新记录可以增加，既有ID和文件不应消失。备份与清单限制为管理员可读，不放网站目录或 Git。应用回滚保留增量表，不反向执行破坏性 schema 回滚。

`./scripts/verify-backup-ci.sh` 只允许 GitHub 的临时 Runner 上运行，会对真实 Compose 实例备份、恢复到新数据库和新目录、比较数据行数及文件内容，并验证再次恢复拒绝覆盖。它不用于生产。

## Tide UI 与移动端键盘布局

界面现在使用共享设计令牌，样式职责拆分为 `design-system.css`（颜色、控件、焦点、动效）、`components.css`（现有功能表单/卡片）、`shell.css`（导航/会话列表）、`chat-layout.css`（消息/输入区）及 `responsive.css`（主要布局断点）。手机 <640px，平板 640–1023px，桌面 >=1024px；触摸横屏的短视口沿用手机布局。没有更换后端、Socket 或部署架构。

移动端使用单一应用视口，消息区独立滚动、输入区和底部导航处于正常布局流中。`visualViewport` 模块统一更新可视高度和偏移，兼容 `dvh/svh/lvh` 与安全区域；键盘打开时隐藏底栏，关闭后恢复。Pinch zoom 不触发应用重排。组合输入同时检查 `isComposing` 与 Safari 兼容的 keyCode 229。聊天仍使用现有分页与有序发送队列，失败保留内容，不强制改变历史阅读位置。

新增增量迁移 `20261109160000_appearance_preferences` 仅给 UserPreference 添加可空 JSONB 外观字段。新增受认证、Origin 和 CSRF 保护的 `GET/PUT /api/users/me/appearance`：深色/亮色/跟随系统、靛青/紫色/青绿色、紧凑/舒适间距、14/16/18px 字号和动画开关。未登录保存在浏览器，登录后同步账户；保存请求串行执行以避免竞态。声音、浏览器通知和语言沿用独立设置。

会话置顶、静音和隐藏明确标注为当前浏览器、当前账户偏好；隐藏不会删除聊天记录，收到新 Socket 消息会重新显示。静音实际影响声音与系统通知。右侧信息在窄屏改为可键盘操作的模态抽屉；共享文件取自已加载的真实消息，不冒充全部文件搜索。

### 浏览器回归

```bash
npm run i18n:check
npm run typecheck
npm run build
npm run test
npx playwright install chromium webkit
# 只允许隔离 _test 库；沿用测试 DATABASE_URL、REDIS_URL 等配置
npm run test:browser:ci
```

浏览器包装器使用本地 3000/5173 端口，运行前确保没有其他服务占用。它只停止自己启动的进程，不清理数据库或卷；浏览器脚本拒绝公网地址与非 `_test` 库。CI 会执行 Chromium/WebKit 的 320、360、375、390、414、768、1024、1440px 截图、溢出/输入区断言和真实 Socket 连续三条消息的顺序、唯一性、焦点及草稿验证。额外断言模拟键盘缩小和多行输入后最新消息仍可见，查看历史时不抢滚动。截图保存在忽略 Git/Docker 的 `test-results/browser/` 并作为短期 CI Artifact 上传。所有账号和消息都是隔离测试库内新建的测试记录。

WebKit 模拟不是实体 iPhone Safari，Chromium 模拟不是实体 Android Chrome。当前未接入实体设备；真实软键盘、中文/英文输入法、刘海屏与浏览器地址栏行为必须在目标手机继续验收，不能根据模拟测试报告真机通过。

生产更新仍在原目录、原 Compose 项目和原 Caddy 配置下进行：先备份及记录 `scripts/data-inventory.sh` 清单，正式合并后 `git pull --ff-only`、`docker compose up -d --build`、`docker compose exec -T backend npx prisma migrate deploy`，再检查健康和前后数据/文件清单。需重建前后端镜像；不要覆盖现有 `.env` 或改变卷名。

### 连续发送消息

聊天输入不再限制20条待发送消息，也不再显示正常发送时的队列计数横条。发送仍保留有序投递、幂等去重及失败内容/重试提示；网络或服务器变慢时消息实际送达仍取决于连接速度。注册、登录、上传等独立安全限制保持原配置。

### 认证页面滚动布局

注册、登录和找回/重置密码使用独立的 `.auth-screen` 滚动容器与 `auth-layout.css`。原先散落在其他样式文件中的认证布局已移除；不再把滚动规则写到未使用的 `.auth-page`，也不再绝对定位语言/外观入口及页脚。长表单按内容自然扩展，短表单可居中；手机安全区和键盘可视高度继续适用。页面不自动聚焦输入框，以免手机一打开就弹出键盘。

`npm run test:browser:ci` 同时执行认证页面回归：Chromium/WebKit 在320×568、390×430、768×600、1280×480及640×350（放大后的等效可视空间）检查四种表单能滚到提交按钮，并在320px宽度通过真实界面注册账号。截图和结果与聊天测试一同上传CI。等效小视口不代替真机键盘或浏览器实际缩放验收。

### 界面与文案整理

认证页与未选会话页使用简洁说明和实际操作入口，移除漂浮标签、营销插画及装饰性在线/送达文字。消息、个人资料、群管理与设置中的中英文提示改为直接说明用途或下一步；没有简介时明确显示未填写，不生成个人介绍。共享样式采用低饱和配色、按控件用途区分圆角，取消背景渐变、毛玻璃、按钮阴影和消息/弹窗入场动画；保留焦点、加载、输入中和错误反馈。主题预览中的双色分区、下拉箭头及真实加载动效保留其功能用途。

此次没有修改数据库、接口、权限或部署架构。浏览器回归同时检查双语认证页、真实注册后的空会话状态，以及好友/创建群组入口可用。通知与操作提示保留已有独立设置；不会为切换主题、置顶或静音等常规点击新增Toast。

### 日常聊天设计返工

会话列表缩短标题区，保留搜索会话与未读筛选。消息按同一发件人、同一天、五分钟以内分组；未读分界、换人、撤回或较长间隔会重新显示头像和发件人。每组末尾显示回执；每条消息的操作菜单保留精确到秒的时间和自身送达/已读状态。

输入区使用附件、可增长文本框、更多/表情和发送的一行布局。失败消息留在消息流中显示“发送失败 · 重试”；失败快照与可编辑草稿分离，重试复用客户端消息 ID，Socket 已确认而 HTTP 确认丢失时继续处理队列。键盘引起的滚动事件不当作查看历史的意图，用户主动查看历史时仍不强制滚动。手机不显示桌面快捷键提示。注册页使用保留锚形标志的单列表单；没有桌面宣传区。

`npm run test:browser:ci` 包含 `scripts/test-product-design.mjs`：仅接受本地 HTTP 和 `_test` 数据库环境，真实创建对话、连续短消息、长中英文文字，经过真实上传 API 的 PNG，以及网络失败、原消息重试和继续输入；检查 Chromium/WebKit、双语、浅/深主题和模拟键盘。测试图片由脚本生成，不依赖远程素材。截图写入忽略的 `test-results/browser/design/`，不会写生产数据。模拟器不代表 iPhone/Android 真机软键盘已验收。本轮无数据库、接口协议或部署配置变更。
