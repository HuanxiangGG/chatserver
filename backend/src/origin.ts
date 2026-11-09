// One strict parser for configuration, HTTP, CORS and WebSocket origins.
export function normalizeOrigin(value: string): string | null {
  try {
    if (value.includes('*')) return null;
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}
export function parseOrigins(value: string | undefined, production: boolean): string[] {
  if (!value?.trim()) throw new Error('服务器配置错误：必须设置 APP_ORIGIN');
  const origins = [...new Set(value.split(',').map(part => {
    const origin = normalizeOrigin(part);
    if (!origin) throw new Error('服务器配置错误：APP_ORIGIN 必须是明确的 HTTP/HTTPS 来源，不允许通配符、路径或凭据');
    const url = new URL(origin);
    if (production && (url.protocol !== 'https:' || /^(localhost|.*\.localhost|127\..*|\[::1\]|0\.0\.0\.0)$/.test(url.hostname)))
      throw new Error('服务器配置错误：生产 APP_ORIGIN 必须使用 HTTPS 公网域名，不能包含 localhost 或回环地址');
    return origin;
  }))];
  return origins;
}
