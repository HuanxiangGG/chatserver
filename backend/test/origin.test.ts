import { describe, expect, it } from 'vitest';
import { normalizeOrigin, parseOrigins } from '../src/origin.js';
describe('strict shared origin policy', () => {
  it('normalizes case, trailing slash, whitespace, default port and multiple origins', () => {
    expect(parseOrigins(' HTTPS://CHAT.6HX9.COM:443/, https://second.example/ ', true)).toEqual(['https://chat.6hx9.com', 'https://second.example']);
    expect(normalizeOrigin('HTTPS://CHAT.6HX9.COM/')).toBe('https://chat.6hx9.com');
  });
  it.each(['*', 'null', 'https://chat.6hx9.com.evil/path', 'https://user:pw@chat.6hx9.com', 'https://chat.6hx9.com?x=1', 'https://chat.6hx9.com#x', 'file:///x', 'https://chat.6hx9.com,'])('rejects malformed configuration %s', input => {
    expect(() => parseOrigins(input, true)).toThrow();
  });
  it.each(['http://localhost:8080', 'https://localhost', 'https://app.localhost', 'https://127.0.0.1', 'https://[::1]', 'http://chat.6hx9.com'])('never trusts development origins in production: %s', input => {
    expect(() => parseOrigins(input, true)).toThrow();
  });
  it('fails closed on missing production configuration', () => { expect(() => parseOrigins(undefined, true)).toThrow('APP_ORIGIN'); });
});
