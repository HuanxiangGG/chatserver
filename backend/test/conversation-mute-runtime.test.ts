// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SoundRuntime } from '../../frontend/src/sound-ui';
import { NotificationRuntime } from '../../frontend/src/notification-ui';
import { updateConversationPreference } from '../../frontend/src/conversation-preferences';
import { soundSessionTimes } from '../../frontend/src/sound';
const fixture = vi.hoisted(() => ({sound:vi.fn(),notice:vi.fn(),events:new Map<string,Set<Function>>(),toast:vi.fn()}));
const socket = {connected:true,on(event:string,fn:Function){if(!fixture.events.has(event))fixture.events.set(event,new Set());fixture.events.get(event)!.add(fn);},off(event:string,fn:Function){fixture.events.get(event)?.delete(fn);}};
vi.mock('../../frontend/src/state', () => ({useApp:() => ({user:{id:'me',username:'me'},conversations:[{id:'room',type:'GROUP'}],socket,toast:fixture.toast})}));
vi.mock('../../frontend/src/api', () => ({api:vi.fn(async () => ({sound:{enabled:true}})),json:vi.fn()}));
vi.mock('../../frontend/src/sound', async importOriginal => ({...await importOriginal<any>(),SoundPlayer:class {preload(){}dispose(){}connected(){}async receive(...args:unknown[]){fixture.sound(...args);}}}));
let root:Root,host:HTMLDivElement;
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();fixture.sound.mockClear();fixture.notice.mockClear();fixture.events.clear();
 localStorage.setItem('harbor.notifications.me',JSON.stringify({enabled:true}));soundSessionTimes.set(socket,Date.now()-1000);
 vi.stubGlobal('Notification',class {static permission='granted';onclick=null;close(){}constructor(...args:unknown[]){fixture.notice(...args);}});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async () => root.render(React.createElement(MemoryRouter,null,React.createElement(React.Fragment,null,React.createElement(SoundRuntime),React.createElement(NotificationRuntime)))));
});
afterEach(async () => {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function receive(id:string) {await act(async()=>{await Promise.all([...fixture.events.get('message:new')!].map(fn=>fn({id,conversationId:'room',senderId:'peer',sender:{id:'peer',displayName:'Peer'},content:'hello',createdAt:new Date().toISOString(),attachments:[]})));});}
it('suppresses both sound and desktop notifications for the muted conversation only', async () => {
 updateConversationPreference('me','room',{muted:true});await receive('muted');expect(fixture.sound).not.toHaveBeenCalled();expect(fixture.notice).not.toHaveBeenCalled();
 updateConversationPreference('me','room',{muted:false});await receive('unmuted');expect(fixture.sound).toHaveBeenCalledOnce();expect(fixture.notice).toHaveBeenCalledOnce();
});
it('does not import a different account’s mute preferences', async () => {
 updateConversationPreference('someone-else','room',{muted:true});await receive('other-account');expect(fixture.sound).toHaveBeenCalledOnce();expect(fixture.notice).toHaveBeenCalledOnce();
});
