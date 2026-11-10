import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {api,ApiError,setCsrf} from '../../frontend/src/api';
vi.mock('../../frontend/src/i18n',()=>({translate:(key:string)=>key,localizeApiError:(message:string)=>message}));
const fetchMock=vi.fn();
beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);setCsrf('');});
afterEach(()=>vi.unstubAllGlobals());
it('rejects a truncated successful JSON body instead of returning successful null',async()=>{
 fetchMock.mockResolvedValue(new Response('{"users":[',{status:200,headers:{'Content-Type':'application/json'}}));
 await expect(api('/blocks')).rejects.toMatchObject({name:'Error',status:200,code:'INVALID_RESPONSE',message:'apiUnreadableResponse'});
});
it('rejects a body read interrupted after successful response headers',async()=>{
 fetchMock.mockResolvedValue({ok:true,status:200,json:()=>Promise.reject(new DOMException('Interrupted body read','AbortError'))});
 await expect(api('/blocks')).rejects.toBeInstanceOf(ApiError);
});
it('rejects unexpected null data while preserving valid object and array payloads',async()=>{
 fetchMock.mockResolvedValueOnce(new Response('null',{status:200})).mockResolvedValueOnce(new Response('[]',{status:200})).mockResolvedValueOnce(new Response('{"ok":true}',{status:200}));
 await expect(api('/blocks')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
 await expect(api('/blocks')).resolves.toEqual([]);
 await expect(api('/action')).resolves.toEqual({ok:true});
});
it('allows an explicit 204 response without trying to parse an absent body',async()=>{
 const json=vi.fn();fetchMock.mockResolvedValue({ok:true,status:204,json});
 await expect(api('/action',{method:'DELETE'})).resolves.toBeNull();expect(json).not.toHaveBeenCalled();
});
it('keeps HTTP error classification when the server error response has no readable JSON',async()=>{
 fetchMock.mockResolvedValue(new Response('upstream unavailable',{status:503}));
 await expect(api('/blocks')).rejects.toMatchObject({status:503,code:'REQUEST_ERROR',message:'screen409'});
});
