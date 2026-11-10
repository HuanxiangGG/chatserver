import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mocks=vi.hoisted(()=>({sendMail:vi.fn(),close:vi.fn(),createTransport:vi.fn(),findUnique:vi.fn(),create:vi.fn(),updateMany:vi.fn()}));
vi.mock('nodemailer',()=>({default:{createTransport:mocks.createTransport}}));
vi.mock('../src/context.js',()=>({config:{origins:['https://chat.6hx9.com']},prisma:{user:{findUnique:mocks.findUnique},passwordReset:{create:mocks.create,updateMany:mocks.updateMany}}}));
import { mailConfiguration, requestRecovery } from '../src/recovery-mail.js';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SMTP_HOST','mail.example.test');vi.stubEnv('SMTP_PORT','587');vi.stubEnv('SMTP_SECURE','false');vi.stubEnv('SMTP_USER','test-account');vi.stubEnv('SMTP_PASSWORD','test-only');vi.stubEnv('SMTP_FROM','harbor@example.test');mocks.createTransport.mockReturnValue({sendMail:mocks.sendMail,close:mocks.close});mocks.findUnique.mockResolvedValue({id:'user1',email:'user@example.test',banned:false});mocks.create.mockResolvedValue({id:'reset1'});mocks.sendMail.mockResolvedValue({accepted:['user@example.test']});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('real SMTP adapter boundary',()=>{
 it('stores only a hash and sends a TLS-protected single-use 15-minute link without protocol logging',async()=>{
  const now=Date.now();expect(await requestRecovery('user@example.test')).toBe('accepted');
  const options=mocks.createTransport.mock.calls[0]![0];expect(options).toMatchObject({requireTLS:true,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  const mail=mocks.sendMail.mock.calls[0]![0];const link=mail.text.match(/https:\/\/\S+/)[0];const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token')!;expect(token).toMatch(/^[a-f0-9]{64}$/);
  const saved=mocks.create.mock.calls[0]![0].data;expect(saved.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));expect(JSON.stringify(saved)).not.toContain(token);expect(saved.expiresAt.getTime()-now).toBeGreaterThanOrEqual(899000);expect(saved.expiresAt.getTime()-now).toBeLessThanOrEqual(901000);expect(mocks.close).toHaveBeenCalledOnce();
 });
 it('does not claim to send when no SMTP service exists',async()=>{vi.stubEnv('SMTP_HOST','');expect(mailConfiguration()).toBeNull();expect(await requestRecovery('user@example.test')).toBe('unconfigured');expect(mocks.sendMail).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();});
 it('uses the same accepted result for an unknown or banned account',async()=>{mocks.findUnique.mockResolvedValueOnce(null);expect(await requestRecovery('absent@example.test')).toBe('accepted');mocks.findUnique.mockResolvedValueOnce({id:'user1',banned:true});expect(await requestRecovery('user@example.test')).toBe('accepted');expect(mocks.sendMail).not.toHaveBeenCalled();});
 it('invalidates an undeliverable token and reports a sanitized operator error',async()=>{const error=vi.spyOn(console,'error').mockImplementation(()=>{});mocks.sendMail.mockRejectedValue(new Error('secret-token-password'));expect(await requestRecovery('user@example.test')).toBe('accepted');expect(mocks.updateMany).toHaveBeenCalledWith({where:{id:'reset1',usedAt:null},data:{usedAt:expect.any(Date)}});expect(error).toHaveBeenCalledOnce();expect(error.mock.calls.flat().join(' ')).not.toContain('secret-token-password');expect(mocks.close).toHaveBeenCalledOnce();});
 it('rejects incomplete configuration without disclosing credentials',()=>{vi.stubEnv('SMTP_PASSWORD','');expect(()=>mailConfiguration()).toThrow('SMTP configuration is incomplete');});
});
it('uses the selected English email copy without changing the reset-token contract', async()=>{
 await requestRecovery('user@example.test','en');const mail=mocks.sendMail.mock.calls[0]![0];expect(mail.subject).toBe('Harbor — Reset password');expect(mail.text).toContain('within 15 minutes');expect(mail.text).not.toMatch(/[\u3400-\u9fff]/);
});
