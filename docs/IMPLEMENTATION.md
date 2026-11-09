# Harbor Chat 实施计划

空仓库保留原有 LICENSE；采用 React/TypeScript/Vite/Tailwind 与 Express/Socket.IO/Prisma/PostgreSQL/Redis，npm workspaces。

1. 基础架构和数据模型：User、Session、Friendship、FriendRequest、Conversation、ConversationMember、Message、MessageAttachment、MessageRead、BlockedUser、AdminAction、PasswordReset、MessageHidden。
2. 用户与社交：bcrypt、随机会话令牌哈希入库、HttpOnly SameSite Cookie、CSRF、Redis 限流；资料、改密、密码重设接口、好友、屏蔽、管理员 CLI。
3. 通信：REST 持久化写入并通过 Socket.IO 广播；逐事件鉴权，用户私有房间；分页、回复、编辑、撤回、个人隐藏、上传、回执、群角色、Redis 多设备在线状态。
4. 界面：Harbor 原创视觉，桌面三栏/移动单栏、亮暗主题、所有业务页面、错误与断线恢复。
5. 交付：真实 PostgreSQL/Redis 集成测试、类型检查、构建、安全复核、Docker Compose/Nginx/HTTPS、迁移/备份/恢复/更新文档，按模块 Git commit，再推送现有仓库。

## API contract

所有路径以 `/api` 开头，成功直接返回 JSON 对象/数组，错误 `{error: string}`。Cookie `harbor_session`，`GET /auth/me` 返回 `{user, csrfToken}`，写操作须 `X-CSRF-Token`；注册/登录返回同样数据。User 公开字段 `id,username,displayName,avatarUrl,bio,status,lastSeenAt,role`。状态 `ONLINE | BUSY | OFFLINE`。

Auth: POST `/auth/register` `{username,email,password,displayName}`，POST `/auth/login` `{username,password}`，POST `/auth/logout`，GET `/auth/me`，PATCH `/users/me` `{displayName,bio,avatarUrl,status}`，POST `/auth/password` `{currentPassword,newPassword}`，POST `/auth/forgot-password` `{email}`，POST `/auth/reset-password` `{token,newPassword}`。

Social: GET `/users?q=`，GET `/friends`，GET `/friend-requests` -> `{incoming,outgoing}`，POST `/friend-requests` `{userId}`，POST `/friend-requests/:id/respond` `{accept:boolean}`，DELETE `/friends/:userId`，GET `/blocks`，POST `/blocks/:userId`，DELETE `/blocks/:userId`。

Chat: GET `/conversations` -> conversations including `members` (`user`), `lastMessage`, `unreadCount`。POST `/conversations/direct` `{userId}`。POST `/conversations/group` `{name,description?,userIds}`。GET/PATCH/DELETE `/conversations/:id`。POST `/conversations/:id/members` `{userIds}`，PATCH `/conversations/:id/members/:userId` `{role:'ADMIN'|'MEMBER'}`，DELETE same (self=leave; owner must transfer or dissolve)。GET `/conversations/:id/messages?before=messageId` -> `{messages,hasMore}` messages ascending。POST same `{content,replyToId?,attachmentIds?,clientId}`。PATCH `/messages/:id` `{content}`。POST `/messages/:id/retract`。DELETE `/messages/:id` (hide for self)。POST `/conversations/:id/read` `{messageId}`。POST `/conversations/:id/delivered` `{messageId}`。

Files: POST `/uploads` multipart `file`, return attachment; GET `/uploads/:id` requires authenticated owner or conversation membership. Supported verified PNG/JPEG/GIF/WebP/PDF, 10MB. Attachments linked atomically to message; profile avatar may reference own image attachment through avatarUrl `/api/uploads/:id`.

Admin: GET `/admin/stats`，GET `/admin/users?q=`，POST `/admin/users/:id/ban` `{banned:boolean,reason}`，DELETE `/admin/messages/:id` `{reason}`，GET `/admin/actions`。

Socket uses same cookie + `auth.csrfToken` and Origin allowlist, websocket transport. Server events `message:new` (message object), `message:updated` (message), `conversation:updated` (`{id}`), `receipt:updated` (`{conversationId,userId,messageId,type}`), `presence:updated` (`{userId,status,lastSeenAt}`), `typing` (`{conversationId,userId,typing}`); client events `typing` `{conversationId,typing}` and `presence:set` `{status:'ONLINE'|'BUSY'}`. Each socket authenticated against unexpired nonrevoked session; logout/ban disconnects sockets; periodic checks enforce expiry. REST message write clientId prevents duplicates. Reconnect REST refetch.

## Backend module interfaces

`context.ts` exports `prisma`, `redis`, `config`, `publicUserSelect`, `publicUser`, `requireAuth` middleware (`req.user`, `req.session`), `requireAdmin`, `validate(schema,data)`, `HttpError`, `asyncRoute`, `authenticateToken(token)`, `assertUnblocked(a,b)`. `realtime.ts` exports `initRealtime(httpServer)`, `emitUsers(userIds,event,payload)`, `disconnectUser(userId)`, `disconnectSession(sessionId)`; realtime may import context. `auth.ts` and `social.ts` export default Router; `chat.ts`, `uploads.ts`, `admin.ts` same. `app.ts` imports routers; `index.ts` starts HTTP and initializes realtime.

Session includes `tokenHash`, `csrfToken`, `expiresAt`, `revokedAt`; Membership `lastReadAt`, `lastDeliveredAt`; enums represented by validated strings. Database is source of truth. Redis required, fail closed on limiter errors. No external mail configured: reset tokens never returned by public API; admin-only CLI generates one-time recovery token after out-of-band verification.
