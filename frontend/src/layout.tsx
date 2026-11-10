import { SoundEntry } from './sound-ui';
import { translate as tr, useLanguage } from './i18n';
import { CommunityDialog, CommunitySidebar } from './communities';
import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  MessageCircle, Hash,
  Users,
  Settings,
  Shield,
  Plus,
  Search,
  PanelLeftClose, PanelLeftOpen, Bell, BellOff, Pin, Archive, MoreHorizontal, Menu,
  LogOut,
  Moon,
  Sun,
  WifiOff,
  ArrowUpRight,
  X,
  Check,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import {
  Avatar,
  Brand,
  Dialog,
  conversationTitle,
  conversationUser,
  formatTime,
  useTask,
} from "./ui";
import type { Conversation, Message } from "./types";
import { orderConversations, restoreConversation, updateConversationPreference, useConversationPreferences } from "./conversation-preferences";
export function CreateGroup({ onClose }: { onClose: () => void }) {
  useLanguage();
  const { friends, refresh } = useApp(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    navigate = useNavigate(),
    task = useTask();
  return (
    <Dialog title={tr('screen324')} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const values = new FormData(e.currentTarget);
          const c = await task(() =>
            api<Conversation>(
              "/conversations/group",
              json("POST", {
                name: values.get("name"),
                description: values.get("description"),
                userIds: selected,
              }),
            ),
          );
          setBusy(false);
          if (c) {
            await refresh();
            navigate(`/chat/${c.id}`);
            onClose();
          }
        }}
      >
        <p className="muted">{tr('screen325')}</p>
        <label>
          {tr('screen228')}<input
            name="name"
            required
            maxLength={80}
            placeholder={tr('screen326')}
          />
        </label>
        <label>
          {tr('screen229')}<textarea
            name="description"
            maxLength={500}
            placeholder={tr('screen327')}
            rows={2}
          />
        </label>
        <label>
          {tr('screen328')}<small>{tr('screen329')}{selected.length} {tr('screen330')}</small>
        </label>
        <div className="pick-list">
          {friends.length ? (
            friends.map((f) => (
              <button
                type="button"
                className={`pick-row ${selected.includes(f.id) ? "selected" : ""}`}
                key={f.id}
                onClick={() =>
                  setSelected((v) =>
                    v.includes(f.id)
                      ? v.filter((id) => id !== f.id)
                      : [...v, f.id],
                  )
                }
              >
                <Avatar user={f} size="sm" />
                <span>
                  {f.displayName}
                  <small>@{f.username}</small>
                </span>
                <span className="checkbox">
                  {selected.includes(f.id) && <Check size={14} />}
                </span>
              </button>
            ))
          ) : (
            <p className="muted">
              {tr('screen331')}</p>
          )}
        </div>
        <button className="btn btn-primary" disabled={busy || !selected.length}>
          {busy ? tr('screen332') : tr('screen333')}
          <ArrowUpRight size={16} />
        </button>
      </form>
    </Dialog>
  );
}
export function Layout() {
  useLanguage();
  const { user, logout, requests, connected, theme, setTheme, conversations, communities, socket, toast } = useApp();
  const [communityDialog, setCommunityDialog] = useState<'create' | 'join' | null>(null), [group, setGroup] = useState(false), [startChat, setStartChat] = useState(false), [menu, setMenu] = useState(false), [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('harbor.nav.collapsed') === 'true'; } catch { return false; } });
  const task = useTask(), location = useLocation(), navigate = useNavigate(), drawer = useRef<HTMLDivElement>(null), accountButton = useRef<HTMLButtonElement>(null);
  const isCommunity = location.pathname.startsWith('/servers/'), serverId = isCommunity ? location.pathname.split('/')[2]! : '';
  const onChat = location.pathname.startsWith('/chat') || isCommunity;
  const active = isCommunity ? (location.pathname.endsWith('/settings') ? 'settings' : location.pathname.split('/')[3] === 'tickets' ? 'tickets' : location.pathname.split('/')[4]) : location.pathname.split('/')[2];
  const view = new URLSearchParams(location.search).get('view') || 'all';
  useEffect(() => { setSidebarOpen(false); setMenu(false); }, [location.pathname, location.search]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 640px)');
    const resize = () => { if (desktop.matches) setSidebarOpen(false); };
    desktop.addEventListener('change', resize); resize();
    return () => desktop.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!user || !socket) return;
    const receive = (message: Message) => { try { restoreConversation(user.id, message.conversationId); } catch { toast(tr('navPreferencesFailed'), true); } };
    socket.on('message:new', receive); return () => { socket.off('message:new', receive); };
  }, [user?.id, socket, toast]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = [...drawer.current!.querySelectorAll<HTMLElement>('button,input,a')].find(element => element.getClientRects().length > 0);
    (first || drawer.current)?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [sidebarOpen]);
  function collapse() { const next = !collapsed; setCollapsed(next); try { localStorage.setItem('harbor.nav.collapsed', String(next)); } catch { toast(tr('navPreferencesFailed'), true); } }
  function trapDrawer(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { setSidebarOpen(false); return; }
    if (!sidebarOpen || event.key !== 'Tab') return;
    const items = [...drawer.current!.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')].filter(e => e.getClientRects().length > 0);
    if (!items.length) { event.preventDefault(); drawer.current?.focus({ preventScroll: true }); return; }
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
  function navClass(selected: boolean) { return `rail-link ${selected ? 'active' : ''}`; }
  const unread = conversations.filter(c=>c.type==='DIRECT'||c.type==='GROUP').reduce((sum, c) => sum + c.unreadCount, 0);
  return <div className={`app-layout ${collapsed ? 'nav-is-collapsed' : 'nav-is-expanded'} ${sidebarOpen ? 'sidebar-is-open' : ''} ${onChat && active ? 'layout-has-conversation' : ''}`}>
    {onChat && <button className="mobile-sidebar-toggle icon-btn" aria-label={tr('navDrawerTitle')} title={tr('navDrawerTitle')} aria-expanded={sidebarOpen} aria-controls="conversation-drawer" onClick={() => setSidebarOpen(v => !v)}><Menu size={22} /></button>}
    <aside className="nav-rail" aria-label={tr('screen339')}>
      <div className="rail-brand-row"><Link to="/chat" aria-label={tr('screen338')} className="rail-brand"><Brand compact={collapsed} /></Link><button className="icon-btn rail-collapse" onClick={collapse} title={tr(collapsed ? 'navExpand' : 'navCollapse')} aria-label={tr(collapsed ? 'navExpand' : 'navCollapse')}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
      <nav aria-label={tr('screen339')}>
        <span className="rail-section-label">{tr('navWorkspace')}</span>
        <Link to="/chat" title={tr('navChat')} className={navClass(location.pathname.startsWith('/chat') && view === 'all')}><MessageCircle size={21} /><span className="rail-label">{tr('navChat')}</span>{unread > 0 && <span className="rail-count" aria-label={tr('navUnreadCount', {count: unread})}>{Math.min(unread, 99)}</span>}</Link>
        <NavLink to="/communities" title={tr('communityCommunities')} className={({isActive}) => navClass(isActive)}><Hash size={21}/><span className="rail-label">{tr('communityCommunities')}</span></NavLink>
        <NavLink to="/friends" title={tr('screen341')} className={({isActive}) => navClass(isActive)}><Users size={21} /><span className="rail-label">{tr('screen341')}</span>{requests.incoming.length > 0 && <span className="rail-count">{requests.incoming.length}</span>}</NavLink>
        <Link to="/chat?view=groups" title={tr('navGroups')} className={navClass(location.pathname.startsWith('/chat') && view === 'groups')}><Users size={21} /><span className="rail-label">{tr('navGroups')}</span></Link>
        <Link to="/chat?view=unread" title={tr('navNotifications')} className={navClass(location.pathname.startsWith('/chat') && view === 'unread')}><Bell size={21} /><span className="rail-label">{tr('navNotifications')}</span></Link>
        {user?.role === 'ADMIN' && <NavLink to="/admin" title={tr('screen264')} className={({isActive}) => navClass(isActive)}><Shield size={21} /><span className="rail-label">{tr('screen342')}</span></NavLink>}
        <div className="rail-section-heading"><span className="rail-section-label">{tr('navCommunities')}</span><button className="icon-btn" title={tr('screen344')} aria-label={tr('screen344')} onClick={() => setCommunityDialog('create')}><Plus size={18} /></button></div>
        <div className="rail-community-list">{communities.map(s => <NavLink key={s.id} to={`/servers/${s.id}`} title={s.name} aria-label={tr('screen343', {v0:s.name})} className={`rail-community ${serverId === s.id ? 'active' : ''}`}><span className="community-monogram">{s.iconUrl?<img src={s.iconUrl} alt=""/>:s.name.slice(0, 2)}</span><span className="rail-label">{s.name}</span>{conversations.some(c => c.channel?.serverId === s.id && c.unreadCount > 0) && <i className="rail-dot" />}</NavLink>)}</div>
        <button className="rail-link" title={tr('screen345')} onClick={() => setCommunityDialog('join')}><Plus size={20} /><span className="rail-label">{tr('screen345')}</span></button>
      </nav>
      <div className="rail-bottom">
        <button className="rail-link" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={tr('screen346')} aria-label={tr('screen347')}>{theme === 'dark' ? <Sun size={21} /> : <Moon size={21} />}<span className="rail-label">{tr('screen348')}</span></button>
        <NavLink to="/settings" title={tr('navSettings')} className={({isActive}) => navClass(isActive)}><Settings size={21} /><span className="rail-label">{tr('navSettings')}</span></NavLink>
        <div className="rail-user"><button ref={accountButton} className="rail-account-button" onClick={() => setMenu(v => !v)} aria-label={tr('screen350')} aria-expanded={menu}><Avatar user={user} size="sm" showStatus /><span className="rail-label"><strong>{user?.displayName}</strong><small>@{user?.username}</small></span></button>{menu && <div className="account-menu" onKeyDown={e => { if (e.key === 'Escape') { setMenu(false); accountButton.current?.focus({ preventScroll: true }); } }}><Link to="/profile" onClick={() => setMenu(false)}>{tr('navProfile')}<ArrowUpRight size={15} /></Link><button onClick={() => void task(logout)}><LogOut size={15} />{tr('screen352')}</button></div>}</div>
      </div>
    </aside>
    {onChat && <>{sidebarOpen && <button className="sidebar-scrim" tabIndex={-1} aria-label={tr('navCloseDrawer')} onClick={() => setSidebarOpen(false)} />}<div ref={drawer} id="conversation-drawer" tabIndex={sidebarOpen ? -1 : undefined} className="sidebar-wrapper" role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen || undefined} aria-label={sidebarOpen ? tr('navDrawerTitle') : undefined} onKeyDown={trapDrawer} onClick={e => { if ((e.target as HTMLElement).closest('a')) setSidebarOpen(false); }}>{sidebarOpen && <button className="drawer-close icon-btn" aria-label={tr('navCloseDrawer')} onClick={() => setSidebarOpen(false)}><X size={21} /></button>}<div className="mobile-workspaces"><Link to="/profile" aria-label={tr('navProfile')}><Avatar user={user} size="sm" showStatus /><span>{user?.displayName}</span></Link><Link to="/chat?view=unread"><Bell size={18} />{tr('navNotifications')}</Link><Link to="/chat"><MessageCircle size={18} />{tr('navPrivate')}</Link>{communities.map(s => <Link key={s.id} to={`/servers/${s.id}`}><span className="community-monogram">{s.name.slice(0,2)}</span>{s.name}</Link>)}<div><button className="icon-btn" title={tr('screen344')} aria-label={tr('screen344')} onClick={() => { setSidebarOpen(false); setCommunityDialog('create'); }}><Plus size={19} /></button><button className="icon-btn" title={tr('screen345')} aria-label={tr('screen345')} onClick={() => { setSidebarOpen(false); setCommunityDialog('join'); }}><Users size={19} /></button>{user?.role === 'ADMIN' && <Link to="/admin"><Shield size={18} />{tr('screen342')}</Link>}</div></div>{isCommunity ? <CommunitySidebar serverId={serverId} active={active} /> : <ConversationList active={active} view={view} onCreate={() => setStartChat(true)} />}</div></>}
    <main className={`workspace ${onChat ? 'workspace-chat' : ''} ${active ? 'has-conversation' : ''}`}><div className={`connection-banner ${connected ? 'connection-hidden' : ''}`} role="status"><WifiOff size={14} />{tr('screen353')}</div><Outlet /><SoundEntry /></main>
    <nav className="mobile-bottom-nav" aria-label={tr('screen339')}><Link to="/chat" className={location.pathname.startsWith('/chat') && view !== 'groups' ? 'active' : ''} aria-label={tr('navChat')}><MessageCircle size={21} /><span>{tr('navChat')}</span>{unread > 0 && <i className="mobile-unread-dot" />}</Link><NavLink to="/friends"><Users size={21} /><span>{tr('screen341')}</span></NavLink><NavLink to="/communities"><Hash size={21}/><span>{tr('communityCommunities')}</span></NavLink><NavLink to="/settings"><Settings size={21} /><span>{tr('navSettings')}</span></NavLink></nav>
    {communityDialog && <CommunityDialog join={communityDialog === 'join'} onClose={() => setCommunityDialog(null)} />}
    {startChat && <Dialog title={tr('navCreateChat')} onClose={() => setStartChat(false)}><p className="muted">{tr('navCreateDescription')}</p><div className="start-chat-actions"><button className="btn btn-primary" onClick={() => { setStartChat(false); navigate('/friends'); }}><MessageCircle size={18} />{tr('navFindFriend')}</button><button className="btn btn-secondary" onClick={() => { setStartChat(false); setGroup(true); }}><Users size={18} />{tr('navNewGroup')}</button></div></Dialog>}
    {group && <CreateGroup onClose={() => setGroup(false)} />}
  </div>;
}
function ConversationList({active, view, onCreate}: {active?: string; view: string; onCreate: () => void}) {
  useLanguage();
  const { user, conversations, toast, connected } = useApp(), location = useLocation(), navigate = useNavigate();
  const [search, setSearch] = useState(''), [action, setAction] = useState<string | null>(null), [hide, setHide] = useState<Conversation | null>(null);
  const preferences = useConversationPreferences(user!.id), actionTrigger = useRef<HTMLButtonElement | null>(null);
  function change(id: string, patch: Parameters<typeof updateConversationPreference>[2]) { try { updateConversationPreference(user!.id, id, patch); actionTrigger.current?.focus({ preventScroll: true }); setAction(null); } catch { toast(tr('navPreferencesFailed'), true); } }
  const visible = orderConversations(conversations.filter(c=>c.type==='DIRECT'||c.type==='GROUP'), preferences, view === 'archived').filter(c => (view !== 'unread' || c.unreadCount > 0) && (view !== 'groups' || c.type === 'GROUP') && conversationTitle(c,user!.id).toLowerCase().includes(search.toLowerCase()));
  const title = view === 'groups' ? tr('navGroups') : view === 'unread' ? tr('navNotifications') : view === 'archived' ? tr('navArchived') : tr('screen354');
  return <aside id="conversation-sidebar" className={`conversation-sidebar ${active ? 'mobile-hide' : ''}`}><header className="sidebar-heading"><div><h1>{title}</h1></div><button className="icon-btn new-chat" title={tr('navCreateChat')} aria-label={tr('navCreateChat')} onClick={onCreate}><Plus size={21} /></button></header>
    <div className="sidebar-search"><Search size={17} /><input placeholder={tr('screen356')} value={search} onChange={e => setSearch(e.target.value)} aria-label={tr('screen356')} />{search && <button className="icon-btn" aria-label={tr('screen357')} onClick={() => setSearch('')}><X size={14} /></button>}</div>
    <div className="sidebar-tabs" aria-label={tr('navChat')}>{(['all','unread','archived'] as const).map(filter => <Link key={filter} to={`${location.pathname}?view=${filter}`} className={view === filter ? 'active' : ''}>{tr(filter === 'all' ? 'navAll' : filter === 'unread' ? 'navUnread' : 'navArchived')}</Link>)}</div>
    <div className="conversation-list">{visible.map(c => { const preference = preferences[c.id] || {}; return <div key={c.id} className={`conversation-entry ${active === c.id ? 'active' : ''}`}><NavLink to={`/chat/${c.id}${view !== 'all' ? `?view=${view}` : ''}`} className={`conversation-row ${active === c.id ? 'active' : ''}`}><Avatar user={conversationUser(c,user!.id)} group={c.type === 'GROUP'} showStatus={c.type === 'DIRECT'} /><div className="conversation-copy"><div><strong>{conversationTitle(c,user!.id)}</strong><time>{c.lastMessage ? formatTime(c.lastMessage.createdAt) : ''}</time></div><div><p>{c.lastMessage?.retractedAt ? tr('screen359') : c.lastMessage?.content || (c.lastMessage?.attachments?.length ? tr('screen360') : tr('screen361'))}</p>{c.unreadCount > 0 && <span className="unread-count" aria-label={tr('navUnreadCount',{count:c.unreadCount})}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>}</div><div className="conversation-markers">{preference.pinned && <Pin size={12} aria-label={tr('navPinned')} />}{preference.muted && <BellOff size={12} aria-label={tr('navMuted')} />}</div></div></NavLink><button className="conversation-action-toggle icon-btn" title={tr('navActions')} aria-label={tr('navActions')} aria-expanded={action === c.id} onClick={event => { actionTrigger.current = event.currentTarget; setAction(action === c.id ? null : c.id); }}><MoreHorizontal size={18} /></button>{action === c.id && <div className="conversation-actions" role="group" aria-label={tr('navActions')} onKeyDown={e => { if (e.key === 'Escape') { setAction(null); actionTrigger.current?.focus({ preventScroll: true }); } }}><small>{tr('navConversationScope')}</small><button onClick={() => change(c.id,{pinned:!preference.pinned})}><Pin size={15} />{tr(preference.pinned ? 'navUnpin' : 'navPin')}</button><button onClick={() => change(c.id,{muted:!preference.muted})}>{preference.muted ? <Bell size={15} /> : <BellOff size={15} />}{tr(preference.muted ? 'navUnmute' : 'navMute')}</button><button onClick={() => { if (preference.archivedAt) change(c.id,{archivedAt:undefined}); else { setHide(c); setAction(null); } }}><Archive size={15} />{tr(preference.archivedAt ? 'navRestore' : 'navHide')}</button></div>}</div>; })}
    {!visible.length && <div className="sidebar-empty"><MessageCircle size={28} /><p>{search ? tr('screen362') : view === 'archived' ? tr('navHiddenEmpty') : view === 'groups' ? tr('navGroupEmpty') : view === 'unread' ? tr('screen363') : tr('screen364')}</p>{view === 'groups' ? <button className="btn btn-secondary" onClick={onCreate}>{tr('navNewGroup')}</button> : view === 'all' && !search && <Link to="/friends">{tr('screen365')}<ArrowUpRight size={14} /></Link>}</div>}</div>
    <footer className="sidebar-footer"><span className={`tiny-online ${connected ? '' : 'reconnecting'}`} />{tr(connected ? 'navOnline' : 'navReconnect')}<Link to="/settings">{tr('navSoundSettings')}</Link></footer>
    {hide && <Dialog title={tr('navHideTitle')} onClose={() => setHide(null)}><p className="muted">{tr('navHideDescription')}</p><div className="dialog-actions"><button className="btn btn-secondary" onClick={() => setHide(null)}>{tr('navCancel')}</button><button className="btn btn-primary" onClick={() => { change(hide.id,{archivedAt:new Date().toISOString()}); if (active === hide.id) navigate('/chat'); setHide(null); }}>{tr('navHide')}</button></div></Dialog>}
  </aside>;
}
