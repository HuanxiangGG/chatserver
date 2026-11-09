// End-to-end acceptance through Nginx. Creates two disposable users; run on a test deployment.
import { randomBytes, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
const base = process.env.SMOKE_URL || 'http://localhost:8080';
const origin = process.env.SMOKE_ORIGIN || new URL(base).origin;
const prefix = `smoke_${randomBytes(5).toString('hex')}`;
const password = randomBytes(24).toString('hex');
async function call(path, method = 'GET', body, account) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { Origin: origin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', ...(account ? { Cookie: account.cookie, 'X-CSRF-Token': account.csrfToken } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Acceptance request ${method} ${path} returned ${response.status}`);
  const data = await response.json();
  return { ...data, cookie: response.headers.get('set-cookie')?.split(';')[0] || account?.cookie };
}
async function register(suffix) {
  return call('/auth/register', 'POST', { username: `${prefix}_${suffix}`, email: `${prefix}_${suffix}@example.test`, displayName: `CI ${suffix}`, password });
}
let socket;
try {
  if (!(await fetch(base)).ok) throw Error('Frontend is unavailable');
  await call('/health');
  const a = await register('a'), b = await register('b');
  const request = await call('/friend-requests', 'POST', { userId: b.user.id }, a);
  await call(`/friend-requests/${request.id}/respond`, 'POST', { accept: true }, b);
  const conversation = await call('/conversations/direct', 'POST', { userId: b.user.id }, a);
  socket = io(base, { transports: ['websocket'], reconnection: false, auth: { csrfToken: b.csrfToken }, extraHeaders: { Origin: origin, Cookie: b.cookie }, autoConnect: false });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Nginx WebSocket connect timeout')), 10000);
    socket.once('connect', () => { clearTimeout(timeout); resolve(); });
    socket.once('connect_error', () => { clearTimeout(timeout); reject(Error('Nginx WebSocket authentication failed')); });
    socket.connect();
  });
  const delivered = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Nginx WebSocket message timeout')), 10000);
    socket.once('message:new', data => { clearTimeout(timeout); resolve(data); });
  });
  const sent = await call(`/conversations/${conversation.id}/messages`, 'POST', { content: 'Nginx + database + WebSocket acceptance', clientId: randomUUID() }, a);
  if ((await delivered).id !== sent.id) throw Error('Message persistence/broadcast mismatch');
  await call(`/conversations/${conversation.id}/read`, 'POST', { messageId: sent.id }, b);
  await call('/auth/logout', 'POST', {}, a);
  await call('/auth/logout', 'POST', {}, b);
  console.log('HTTP + WebSocket acceptance passed: frontend, API/cookie/CSRF, PostgreSQL persistence and message delivery.');
} finally { socket?.disconnect(); }
