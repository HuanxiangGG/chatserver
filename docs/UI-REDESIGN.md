# Tide UI / 移动端重构验收（2026-11-10）

## 根因与重写边界

旧 styles.css 约4930行：导航、聊天、表单和多轮响应式覆盖混在一起，使用不同760/767/960/1100等断点；移动底栏和会话抽屉的固定定位与聊天容器争用底部空间，输入区高度由多层样式共同控制。旧框架未使用 visualViewport 的高度/偏移，无法可靠区分键盘与浏览器工具栏变化。此次重建应用壳、导航、聊天滚动/输入区和视口模块；保留已有分页、发送队列、API、Socket、数据库关系和权限。

附带定位并修复：Safari IME keyCode229漏防护；Dialog在autoFocus后才捕获原焦点且Escape依赖内部焦点；极小图片按钮只有1px高度；平板发送按钮42px；320px群成员管理行不换行；外观首次账户导入与新保存的竞态。均有对应组件、浏览器或权限回归。

## 统一界面

- Tide令牌：深蓝层次、靛青/紫色/青绿色、克制渐变、柔和边框；完整亮色/深色模式、统一圆角/控件/焦点/卡片/Toast/弹窗；动画尊重用户开关与prefers-reduced-motion。
- 原4930行入口拆分为design-system、shell、chat-layout、responsive、appearance、components，主要布局断点统一为640/1024。原有表单与卡片迁移保留；没有无理由重写后端。
- 桌面可折叠导航、真实会话/群组/未读筛选、置顶/静音/隐藏操作；手机底栏、社区/会话抽屉和底部信息面板。
- 会话静音连接真实声音/系统通知处理；隐藏只影响当前账户当前浏览器视图，保留数据并在新消息到达后恢复。不是删除历史记录功能。
- 独立消息滚动、日期/未读分隔、历史阅读保留与跳转最新；菜单在触屏可访问；共享文件取自已加载的授权消息；搜索关键词高亮。
- 输入区有界自动增高、上传进度、发送队列、失败保留、连续输入、组合输入保护。浮动声音入口改为不覆盖标题栏的正常布局提示。
- 后台消息删除改为共享确认弹窗；保留危险操作校验和审计，失败保留快照可重试。

## 视口与键盘

应用壳在移动端使用`--app-height`/`--app-offset-top`，来自visualViewport resize/scroll、焦点和旋转事件，rAF合并更新；CSS有dvh/svh/lvh回退及safe-area。消息区flex:min-height:0独立滚动，输入区与底栏正常流排列。`data-keyboard=open`隐藏底栏和声音引导，键盘关闭恢复；pinch zoom不重排；不调用window.scrollTo抢焦点/滚动。旋转基线按实际宽度变化重置，避免Safari事件时序造成误判。

## 数据与配置

新增迁移`20261109160000_appearance_preferences`仅添加UserPreference.appearance可空JSONB。新增认证且保留Origin/CSRF的GET/PUT `/api/users/me/appearance`；深/浅/系统、色彩、密度、字号、动画。访客本地保存，登录后账户串行同步；不覆盖声音设置。不新增生产环境变量，不改Compose/Caddy/Redis/PostgreSQL/上传卷。

## 本地实际验证

- `npm run i18n:check`通过，自动扫描全部双语catalog，检测漏翻、硬编码、重复、缺键、未用/无效key与插值。
- `npm run typecheck`、`npm run build`通过。Vite约538KB JS提示为后续分包优化建议，不是构建错误。
- `npm run test`：23文件，175/175通过，使用隔离PostgreSQL `_test`与Redis测试库。新增外观权限、同步竞态、导航/静音、视口、移动输入/嵌套弹窗和管理员确认测试；既有功能回归保持通过。
- 真实Chromium和WebKit：320、360、375、390、414、768、1024、1440px共16组。消息/按钮无溢出、输入区域有界、关键触摸控件至少44px；双引擎真实Socket连续3条按序唯一送达，输入焦点与后续草稿保留。测试与截图已接入CI。
- 双引擎额外交互：模拟键盘430px+24px偏移、关闭恢复、IME兼容事件、多行、真实网络发送失败后保留/重试、历史停留时真实Socket新消息、图片上传和预览、会话/信息抽屉、中文/English和明/暗设置持久化、844x390触摸横屏均通过；未捕获页面JS异常。
- 双引擎320/768/1440下会话列表、好友、资料、群管理、设置、登录、注册、找回密码共48组检查通过。修复的群成员溢出另加入CI回归。
- 浏览器测试重复注册触发过本地测试限流：保留生产安全限制，仅清理隔离localhost:56379/9内的注册测试限流桶后重跑；没有修改生产限流代码或生产Redis。

## 未验证与限制

用户确认暂时没有实体设备。WebKit不等于实体iPhone Safari，Chromium模拟不等于实体Android Chrome：真机中文/英文软键盘、刘海安全区域、Home Indicator及地址栏动态行为尚未验收，不能报告真机通过。操作系统通知中心与外部SMTP投递也不由本轮UI测试证明。

底层既有声音去重按标签页，发送队列不跨刷新持久化；共享文件面板明确只列已加载消息。未合并main，未部署生产，未连接生产库或删除任何生产数据/上传文件/卷。

## 服务器更新

正式合入main并审核CI后，在服务器原目录、原COMPOSE_FILE、原项目名下：

```bash
./scripts/backup.sh
./scripts/data-inventory.sh > /私密备份目录/before-ui.txt
git pull --ff-only
docker compose up -d --build
docker compose exec -T backend npx prisma migrate deploy
docker compose ps
curl --fail https://chat.6hx9.com/api/health
./scripts/data-inventory.sh > /私密备份目录/after-ui.txt
```

需重新构建前后端容器。保持已有.env、Caddy和所有卷名；启动脚本也会在API启动前执行增量迁移。前后核对旧记录ID/计数、原上传文件SHA256与卷挂载，业务新增可增加，原记录和文件不能无故消失。备份先在新库和隔离目录演练，不覆盖生产恢复，不执行删除卷或数据库重置命令。
