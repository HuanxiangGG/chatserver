# Harbor · 泊岸聊天

原创、响应式实时聊天网站，支持中文界面、亮/暗主题，适用于电脑和手机浏览器。采用 React 19 / TypeScript / Vite / Tailwind CSS / React Router，以及 Node.js / Express / Socket.IO / Prisma / PostgreSQL / Redis。代码与部署文件完整保存在本仓库，无内置账户或默认管理员密码。

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
│   ├── schema.prisma        13 个模型
│   └── migrations/          可重复部署的初始迁移
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
docker compose up -d --build
docker compose ps
```

**启动前必须修改 `.env` 中两处 `CHANGE_ME...`，数据库连接 URL 内的密码也要一致。** 用 `openssl rand -hex 32` 分别生成数据库、Redis 密码，使用十六进制可免除 URL/Compose 特殊字符转义。`.env` 不会进入 Git 或 Docker 构建上下文。也可在复制前用 `node scripts/configure-env.mjs` 直接创建随机配置（需要 Node；拒绝覆盖已有 `.env`）。

默认仅绑定服务器 `127.0.0.1:8080`，用于本地验收；通过 SSH 隧道访问：

```bash
ssh -L 8080:127.0.0.1:8080 your-user@your-server
```

然后打开 `http://localhost:8080`。需要正式域名时按下方 HTTPS 配置；浏览器来源必须与 `APP_ORIGIN` 完全匹配。首次后端启动会执行 `prisma migrate deploy`，成功后才启动服务。

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

### HTTPS / Nginx / WebSocket

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
| `TRUST_PROXY` | 本地直连 0；Nginx 后 1（Compose 固定 1） |
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

覆盖注册/登录、CSRF、好友流程、私聊、消息重试去重、群权限、Socket 鉴权、封禁与注销、越权读取、上传真实 MIME/扩展名/大小、回执、管理员审计、改密撤销会话与暴力破解限流。详细的实际执行结果见 [验收记录](docs/VERIFICATION.md)。GitHub Actions 在 Ubuntu 使用真实 PostgreSQL/Redis 执行检查，并构建两种 Docker 镜像。

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

`POST /api/auth/forgot-password` 返回统一响应，避免探测邮箱；尚未集成 SMTP，因此不会发送邮件。可信服务器管理员在其他渠道核验身份后执行：

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
