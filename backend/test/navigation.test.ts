// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readConversationPreferences, updateConversationPreference, orderConversations, restoreConversation, isConversationMuted } from '../../frontend/src/conversation-preferences';
import { Layout } from '../../frontend/src/layout';
import { translate as tr, setLanguage } from '../../frontend/src/i18n';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), listeners: new Map<string, (...args: any[]) => void>(), admin: false }));
const conversation = (id: string, type: 'DIRECT' | 'GROUP' = 'DIRECT') => ({id,type,name:id,description:'',avatarUrl:null,members:[{userId:'me',user:{id:'me',displayName:'Me'}},{userId:'peer',user:{id:'peer',displayName:'Peer'}}],lastMessage:null,unreadCount:id === 'unread' ? 2 : 0,updatedAt:'2026-01-01T00:00:00Z'} as any);
vi.mock('../../frontend/src/state', () => ({useApp: () => ({user:{id:'me',displayName:'Me',username:'me',role:mocks.admin ? 'ADMIN' : 'USER'},logout:vi.fn(),requests:{incoming:[]},connected:true,theme:'dark',setTheme:vi.fn(),conversations:[conversation('direct'),conversation('group','GROUP'),conversation('unread')],communities:[],friends:[],toast:mocks.toast,socket:{on:(event:string, fn:any) => mocks.listeners.set(event,fn),off:(event:string) => mocks.listeners.delete(event)}})}));
vi.mock('../../frontend/src/communities', () => ({CommunitySidebar:() => null,CommunityDialog:() => null}));
vi.mock('../../frontend/src/api', () => ({api:vi.fn(),json:vi.fn()}));
let root:Root | undefined,host:HTMLDivElement;
beforeEach(() => { localStorage.clear(); setLanguage('en'); mocks.toast.mockClear(); mocks.admin=false; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if(root) await act(async () => root!.unmount()); root=undefined;host?.remove();mocks.listeners.clear();vi.unstubAllGlobals(); });
async function render(path='/chat') {host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async () => root!.render(React.createElement(MemoryRouter,{initialEntries:[path]},React.createElement(Layout))));}
async function click(element:Element) {await act(async () => (element as HTMLElement).click());}
it('isolates browser preferences per account and restores a hidden conversation without deleting data', () => {
 updateConversationPreference('me','direct',{pinned:true,muted:true,archivedAt:'2026-01-01'});
 expect(isConversationMuted('me','direct')).toBe(true);expect(isConversationMuted('other','direct')).toBe(false);
 expect(orderConversations([conversation('direct'),conversation('group')],readConversationPreferences('me')).map(c=>c.id)).toEqual(['group']);
 restoreConversation('me','direct');expect(orderConversations([conversation('group'),conversation('direct')],readConversationPreferences('me')).map(c=>c.id)).toEqual(['direct','group']);
 expect(readConversationPreferences('me').direct.muted).toBe(true);
});
it('discards malformed browser preferences and surfaces failed writes to callers', () => {
 localStorage.setItem('harbor.conversations.me','[1,2]');expect(readConversationPreferences('me')).toEqual({});
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw Error('storage unavailable');});
 expect(() => updateConversationPreference('me','direct',{pinned:true})).toThrow();write.mockRestore();
});
it('shows real group and unread filters and persistent collapsible navigation', async () => {
 await render('/chat?view=groups');
 expect(host.querySelectorAll('.conversation-entry')).toHaveLength(1);expect(host.querySelector('.conversation-entry')!.textContent).toContain('group');
 await click(host.querySelector(`[aria-label="${tr('navCollapse')}"]`)!);
 expect(host.querySelector('.nav-is-collapsed')).not.toBeNull();expect(localStorage.getItem('harbor.nav.collapsed')).toBe('true');
 const unread=[...host.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/chat?view=unread')!;await click(unread);
 expect(host.querySelectorAll('.conversation-entry')).toHaveLength(1);expect(host.querySelector('.unread-count')!.textContent).toBe('2');
});
it('opens and closes the conversation drawer with accessible controls and Escape', async () => {
 await render('/chat/direct');const button=host.querySelector('.mobile-sidebar-toggle')!;await click(button);
 expect(button.getAttribute('aria-expanded')).toBe('true');const drawer=host.querySelector('#conversation-drawer')!;expect(drawer.getAttribute('role')).toBe('dialog');
 await act(async () => drawer.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(button.getAttribute('aria-expanded')).toBe('false');
});
it('updates mute and pin actions and restores archived conversations on a Socket new message', async () => {
 await render();const menu=host.querySelector('.conversation-action-toggle')!;await click(menu);
 const mute=[...host.querySelectorAll('.conversation-actions button')].find(b=>b.textContent===tr('navMute'))!;await click(mute);
 expect(isConversationMuted('me','direct')).toBe(true);
 await act(async () => updateConversationPreference('me','direct',{archivedAt:'2026-01-01'}));
 expect([...host.querySelectorAll('.conversation-row')].some(a=>a.getAttribute('href')==='/chat/direct')).toBe(false);
 await act(async () => mocks.listeners.get('message:new')!({conversationId:'direct'}));
 expect([...host.querySelectorAll('.conversation-row')].some(a=>a.getAttribute('href')==='/chat/direct')).toBe(true);
});

it('keeps mobile profile, unread notifications and administrator access available', async () => {
 mocks.admin=true;await render('/chat/direct');
 const shortcuts=host.querySelector('.mobile-workspaces')!;
 expect(shortcuts.querySelector('a[href="/profile"]')).not.toBeNull();
 expect(shortcuts.querySelector('a[href="/chat?view=unread"]')).not.toBeNull();
 expect(shortcuts.querySelector('a[href="/admin"]')).not.toBeNull();
 expect(host.querySelector('.drawer-close')).toBeNull();
});
it('closes the mobile modal when switching to a wider viewport and removes the resize listener', async () => {
 let change:()=>void=()=>{};
 const media={matches:false,addEventListener:vi.fn((_:string,fn:()=>void)=>{change=fn;}),removeEventListener:vi.fn()};
 vi.stubGlobal('matchMedia',()=>media);await render('/chat/direct');
 await click(host.querySelector('.mobile-sidebar-toggle')!);expect(host.querySelector('#conversation-drawer')!.getAttribute('role')).toBe('dialog');
 await act(async()=>{media.matches=true;change();});
 expect(host.querySelector('#conversation-drawer')!.getAttribute('role')).toBeNull();
 await act(async()=>root!.unmount());root=undefined;expect(media.removeEventListener).toHaveBeenCalledOnce();
});
it('returns keyboard focus to conversation action toggle when Escape closes its actions', async () => {
 await render();const toggle=host.querySelector('.conversation-action-toggle')! as HTMLButtonElement;await click(toggle);
 const menu=host.querySelector('.conversation-actions')!;
 await act(async()=>menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(host.querySelector('.conversation-actions')).toBeNull();expect(document.activeElement).toBe(toggle);
});
