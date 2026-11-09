import { beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
const db = process.env.TEST_DATABASE_URL, cache = process.env.TEST_REDIS_URL;
if (!db || !new URL(db).pathname.endsWith('_test') || !cache || new URL(cache).pathname !== '/9') throw Error('Dedicated test database required');
Object.assign(process.env, { DATABASE_URL: db, REDIS_URL: cache, NODE_ENV: 'production', APP_ORIGIN: ' HTTPS://CHAT.6HX9.COM/, https://second.example ', COOKIE_SECURE: 'true', TRUST_PROXY: '2' });
const prefix = 'p' + randomBytes(6).toString('hex'), password = randomBytes(20).toString('hex'), origin = 'https://chat.6hx9.com';
let app: any, prisma: any, redis: any;
beforeAll(async () => { ({ default: app } = await import('../src/app.js')); ({ prisma, redis } = await import('../src/context.js')); await redis.connect(); });
afterAll(async () => { await prisma?.$disconnect(); redis?.disconnect(); });
  it('production origin registers and logs in behind HTTPS reverse proxy with Secure cookies', async () => {

      const username = prefix + 'proxy';
      const headers = { Origin: 'HTTPS://CHAT.6HX9.COM/', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.25, 127.0.0.1', Host: 'chat.6hx9.com' };
      const registered = await request(app).post('/api/auth/register').set(headers).send({ username, email: username + '@example.test', displayName: '代理测试', password });
      expect(registered.status).toBe(201);
      expect(registered.headers['access-control-allow-origin']).toBe(headers.Origin);
      expect(registered.headers['set-cookie'][0]).toContain('Secure');
      expect(registered.headers['set-cookie'][0]).toContain('HttpOnly');
      expect(registered.headers['set-cookie'][0]).toContain('SameSite=Lax');
      const logged = await request(app).post('/api/auth/login').set(headers).send({ username, password });
      expect(logged.status).toBe(200);
      const cookie = logged.headers['set-cookie'][0].split(';')[0];
      expect((await request(app).get('/api/auth/me').set(headers).set('Cookie', cookie)).status).toBe(200);
      expect((await request(app).patch('/api/users/me').set(headers).set('Cookie', cookie).send({ bio: '禁止无 CSRF 写入' })).body.code).toBe('CSRF_INVALID');
      const write = await request(app).patch('/api/users/me').set(headers).set('Cookie', cookie).set('X-CSRF-Token', logged.body.csrfToken).send({ bio: '代理下安全写入' });
      expect(write.status).toBe(200);
      expect((await request(app).post('/api/auth/login').set('Origin', origin).send({ username, password })).body.code).toBe('PROXY_HTTPS_REQUIRED');
      expect((await request(app).post('/api/auth/login').set({ ...headers, Origin: 'https://evil.example' }).send({ username, password })).body.code).toBe('ORIGIN_UNTRUSTED');

  });
