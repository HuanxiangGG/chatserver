# Caddy 来源校验修复与界面维护

## 线上证据与根因边界

2026-11-09 对 https://chat.6hx9.com 只进行了页面/响应头读取和 Origin=https://chat.6hx9.com 的空 JSON 注册请求；返回“来源不受信任”，字段验证前即被拒绝，没有创建生产账户。响应显示 Caddy + Nginx 两层代理。

后端旧 checkOrigin 仅检查配置列表；此错误意味着线上进程的有效 APP_ORIGIN 未匹配请求来源，和密码/CSRF 无关。仓库旧 Compose 未配置时回退 localhost，易产生此故障。未取得生产 .env、容器环境与 Caddyfile，不能确认线上到底是旧变量、错误域名还是容器未重建；本次没有服务器 SSH 操作。旧代码规范化配置 URL 却不规范化请求来源，HTTP、CORS、Socket.IO 各自比较也存在不一致。

另外，旧 Nginx 在 Caddy 后将 X-Forwarded-Proto 重写为内部 http，这是独立的 HTTPS 识别问题，不是旧来源判断的直接条件。新增隔离的 Caddy 专用配置保留可信上游协议；默认直接入口配置保持自身协议。公网来源仍只取显式环境白名单，绝不根据转发头自动信任域名。

## 修复

- 统一严格来源解析；生产启动拒绝不合法、通配符、localhost、回环和非 HTTPS 来源；环境配置缺失明确失败。
- Origin、CSRF、Cookie、HTTPS 代理错误提供中文消息与机器错误代码；保留安全检查。
- Caddy 专用 Compose override 固定回环监听、两跳 trust proxy、沿用全部持久卷；Caddyfile 仅参考，不覆盖生产文件。
- 注册即时校验/确认密码/强度/重复提交锁、成功后 Cookie 回查；错误保留输入。
- 手机会话列表开关、重连与未读同步提示、真实 XHR 上传进度、长消息约束、统一焦点/禁用/移动布局与中文装饰文案。
- 无 Schema/迁移变化；增加只读数据库计数和上传 SHA256 清单脚本。

## 已执行验收

- npm ci：成功，依赖审计 0 漏洞。
- npm run typecheck：前后端通过。
- npm run build：生产构建通过。
- npm run test：44/44，通过真实隔离 PostgreSQL18.6 + Redis7.4；包含原有 27 项业务测试、16 项来源解析测试和 1 项生产代理注册/登录/Secure Cookie/CSRF/HTTPS 回归。
- 原有好友、消息、上传、群权限等业务测试现在均使用 https://chat.6hx9.com 来源。
- Docker Compose 2.39.4 基础+Caddy配置校验、脚本 bash -n、git diff --check：通过。
- 浏览器 390×844 注册中文即时错误、错误保留字段、实际登录、手机长消息与列表开关；1440×960 三栏及亮暗主题检查通过。手机聊天文档宽度=390，桌面宽度=1440，均无横向溢出。测试账户只在本机隔离数据库。

远端 Linux 容器验收结果以当前提交的 GitHub Actions 为准，旧 VERIFICATION.md 中的成功记录属于上一版。未执行生产更新，没有读取或改动生产数据库/上传卷；真实 Caddy HTTPS Cookie 和公网 WebSocket 仍需更新后用浏览器确认。生产备份恢复演练未执行。

部署、数据核对和回滚注意事项见 README 的“现有 Caddy 生产部署”章节。不要改变 Compose 项目名，不覆盖现有环境文件，不删除或重建数据卷。
