# Changelog

## Unreleased — 媒体草稿模块

- Command/Ctrl+V 图片、拖拽和选择文件复用本地待发送队列，文本剪贴板保持原行为。
- 本地缩略预览、移除、10MiB/5文件限制；点击发送才上传，保留原 CSRF/Cookie 与 MIME 验证。
- 上传与消息失败保留草稿，复用已上传附件；消息信封/clientId 固定后安全重试。
- 会话草稿隔离，旧异步响应不覆盖新会话；释放本地预览 URL。
- 六项自动化回归；完整升级范围及未验证项见 docs/UPGRADE-STATUS.md。
