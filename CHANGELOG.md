# Changelog

## Unreleased — 社区与文字频道核心（2026-11-09）

- 新增 Server/ServerMember/ServerBan、Channel/ChannelGrant/ChannelCategory、ServerInvite；频道关联现有 Conversation，不复制消息存储。
- 社区创建/default general、分类与位置排序、私密频道、公告、四级角色、邀请预览/限次/有效期/撤销、禁言、踢出、封禁/解除封禁 API。
- 集中 HTTP/Socket.IO/附件权限，成员变化事务内同步 ConversationMember；踢出清除私密授权，邀请使用并发串行化。只读操作拒绝不再误断开合法 Socket 会话。
- 原创社区导航、频道列表、折叠分类、社区设置和成员管理；手机从频道列表进入聊天/设置，保留深浅主题与私聊群聊入口。
- 回归测试捕获并修复频道 PATCH 默认值重置私密标志问题；创建与修改使用明确分离的校验规则。
- 增加 14 项真实 PG/Redis/Socket.IO 集成测试，现有 51 项保留，合计 65 项。已通过 PR #1 合入 main，生产未部署；整体升级未完成项见状态文档。

## Unreleased — 媒体草稿模块

- Command/Ctrl+V 图片、拖拽和选择文件复用本地待发送队列，文本剪贴板保持原行为。
- 本地缩略预览、移除、10MiB/5文件限制；点击发送才上传，保留原 CSRF/Cookie 与 MIME 验证。
- 上传与消息失败保留草稿，复用已上传附件；消息信封/clientId 固定后安全重试。
- 会话草稿隔离，旧异步响应不覆盖新会话；释放本地预览 URL。
- 七项自动化回归；完整升级范围及未验证项见 docs/UPGRADE-STATUS.md。
