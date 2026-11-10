// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {SettingsPage} from '../../frontend/src/settings';
const app=vi.hoisted(()=>({toast:vi.fn(),user:{id:'viewer',username:'viewer',displayName:'Viewer',status:'ONLINE'}}));
vi.mock('../../frontend/src/state',()=>({useApp:()=>({...app,reloadUser:vi.fn(),logout:vi.fn(),socket:{emit:vi.fn()}})}));
vi.mock('../../frontend/src/appearance',()=>({AppearanceSettings:()=>null}));
vi.mock('../../frontend/src/notification-ui',()=>({NotificationSettings:()=>null}));
vi.mock('../../frontend/src/sound-ui',()=>({SoundSettingsPanel:()=>null}));
vi.mock('../../frontend/src/send-preference',()=>({useSendShortcut:()=>['enter',vi.fn()]}));
vi.mock('../../frontend/src/ui',()=>({
 Avatar:()=>null,Dialog:({children}:any)=>React.createElement('section',null,children),PageHeading:()=>null,
 Spinner:()=>React.createElement('div',{role:'status'},'loading'),Empty:({title}:any)=>React.createElement('div',{className:'empty'},title),
 ErrorBox:({message,retry}:any)=>React.createElement('div',{className:'error-box'},React.createElement('p',{role:'alert'},message),React.createElement('button',{onClick:retry},'retry')),
 useTask:()=>async(action:()=>unknown)=>action(),
}));
const fetchMock=vi.fn();let host:HTMLDivElement,root:Root;
const person=(id:string)=>({id,username:id,displayName:id,status:'OFFLINE'});
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;fetchMock.mockReset();app.toast.mockReset();vi.stubGlobal('fetch',fetchMock);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(React.createElement(MemoryRouter,null,React.createElement(SettingsPage))));}
async function click(selector:string){await act(async()=>(host.querySelector(selector) as HTMLButtonElement).click());}
it('keeps a previously loaded blocked list when refresh JSON fails, then retries a real readable response',async()=>{
 fetchMock.mockResolvedValueOnce(response([person('previous')])).mockResolvedValueOnce(new Response('[{"id":',{status:200})).mockResolvedValueOnce(response([person('recovered')]));
 await mount();expect(host.querySelector('#blocked .blocked-row')?.textContent).toContain('previous');
 await click('#blocked .blocked-refresh');expect(host.querySelector('#blocked [role=alert]')?.textContent).toContain('响应未完整收到');expect(host.querySelector('#blocked .blocked-row')?.textContent).toContain('previous');expect(host.querySelector('#blocked .empty')).toBeNull();
 await click('#blocked .error-box button');expect(host.querySelector('#blocked [role=alert]')).toBeNull();expect(host.querySelector('#blocked .blocked-row')?.textContent).toContain('recovered');expect(app.toast).not.toHaveBeenCalled();
});
it('shows a local error instead of a false empty state for an initial malformed body',async()=>{
 fetchMock.mockResolvedValue(new Response('[',{status:200}));await mount();expect(host.querySelector('#blocked [role=alert]')).not.toBeNull();expect(host.querySelector('#blocked .empty')).toBeNull();expect(host.querySelector('#blocked')?.getAttribute('aria-busy')).toBe('false');
});
it('rejects a readable but invalid list shape rather than silently replacing it with an empty list',async()=>{
 fetchMock.mockResolvedValue(response({unexpected:true}));await mount();expect(host.querySelector('#blocked [role=alert]')).not.toBeNull();expect(host.querySelector('#blocked .empty')).toBeNull();
});
it('cancels a pending request when unmounted and ignores its later completion',async()=>{
 let finish!:(value:Response)=>void;fetchMock.mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));await mount();const signal=fetchMock.mock.calls[0][1].signal as AbortSignal;expect(host.querySelector('#blocked [role=status]')).not.toBeNull();await act(async()=>root.unmount());expect(signal.aborted).toBe(true);await act(async()=>finish(response([person('late')])));expect(app.toast).not.toHaveBeenCalled();root=createRoot(host);
});
