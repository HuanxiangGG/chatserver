import { translate as tr, useLanguage } from './i18n';
import { CommunityDialog, CommunitySidebar } from './communities';
import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  MessageCircle,
  Users,
  Settings,
  Shield,
  Plus,
  Search,
  ChevronDown,
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
import type { Conversation } from "./types";
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
  const { user, logout, requests, connected, theme, setTheme, conversations, communities } =
      useApp(),
    [communityDialog, setCommunityDialog] = useState<'create' | 'join' | null>(null),
    [group, setGroup] = useState(false),
    [menu, setMenu] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    task = useTask(),
    location = useLocation();
  const isCommunity = location.pathname.startsWith('/servers/'), serverId = isCommunity ? location.pathname.split('/')[2]! : '';
  const onChat = location.pathname.startsWith("/chat") || isCommunity,
    active = isCommunity ? (location.pathname.endsWith('/settings') ? 'settings' : location.pathname.split('/')[4]) : location.pathname.split("/")[2];
  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-is-open' : ''}`} onKeyDown={e => { if (e.key === 'Escape') setSidebarOpen(false); }}>
      {onChat && active && <button className="mobile-sidebar-toggle btn btn-secondary" aria-label={sidebarOpen ? tr('screen334') : tr('screen335')} aria-expanded={sidebarOpen} aria-controls="conversation-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? tr('screen336') : tr('screen337')}</button>}
      {sidebarOpen && <button className="sidebar-scrim" aria-label={tr('screen334')} onClick={() => setSidebarOpen(false)} />}
      <aside className="nav-rail">
        <Link to="/chat" aria-label={tr('screen338')} className="rail-brand">
          <Brand compact />
        </Link>
        <div className="rail-divider" />
        <nav aria-label={tr('screen339')}>
          <NavLink
            to="/chat"
            title={tr('screen340')}
            className={({ isActive }) =>
              `rail-link ${isActive ? "active" : ""}`
            }
          >
            <MessageCircle size={22} />
            <span>{tr('screen340')}</span>
            {conversations.some((c) => c.unreadCount > 0) && (
              <i className="rail-dot" />
            )}
          </NavLink>
          <NavLink
            to="/friends"
            title={tr('screen341')}
            className={({ isActive }) =>
              `rail-link ${isActive ? "active" : ""}`
            }
          >
            <Users size={22} />
            <span>{tr('screen341')}</span>
            {requests.incoming.length > 0 && (
              <i className="rail-count">{requests.incoming.length}</i>
            )}
          </NavLink>
          {user?.role === "ADMIN" && (
            <NavLink
              to="/admin"
              title={tr('screen264')}
              className={({ isActive }) =>
                `rail-link ${isActive ? "active" : ""}`
              }
            >
              <Shield size={22} />
              <span>{tr('screen342')}</span>
            </NavLink>
          )}
          <div className="rail-divider" />
          {communities.map(s => <NavLink key={s.id} to={`/servers/${s.id}`} title={s.name} aria-label={tr('screen343', {v0: s.name})} className={`rail-server ${serverId === s.id ? 'active' : ''}`}><span>{s.name.slice(0, 2)}</span>{conversations.some(c => c.channel?.serverId === s.id && c.unreadCount > 0) && <i className="rail-dot" />}</NavLink>)}
          <button className="rail-server rail-create" title={tr('screen344')} aria-label={tr('screen344')} onClick={() => setCommunityDialog('create')}><Plus size={23} /></button>
          <button className="rail-server rail-join" title={tr('screen345')} aria-label={tr('screen345')} onClick={() => setCommunityDialog('join')}><Users size={22} /></button>
        </nav>
        <div className="rail-bottom">
          <button
            className="rail-link"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={tr('screen346')}
            aria-label={tr('screen347')}
          >
            {theme === "dark" ? <Sun size={21} /> : <Moon size={21} />}
            <span>{tr('screen348')}</span>
          </button>
          <NavLink to="/settings" className="rail-link" title={tr('screen349')}>
            <Settings size={22} />
            <span>{tr('screen349')}</span>
          </NavLink>
          <div className="rail-user">
            <button
              onClick={() => setMenu(!menu)}
              aria-label={tr('screen350')}
              aria-expanded={menu}
            >
              <Avatar user={user} size="sm" showStatus />
            </button>
            {menu && (
              <div className="account-menu">
                <strong>{user?.displayName}</strong>
                <Link to="/profile" onClick={() => setMenu(false)}>
                  {tr('screen351')}<ArrowUpRight size={15} />
                </Link>
                <button onClick={() => void task(logout)}>
                  <LogOut size={15} /> {tr('screen352')}</button>
              </div>
            )}
          </div>
        </div>
      </aside>
      {onChat && (
        <div className="sidebar-wrapper" onClick={e => { if ((e.target as HTMLElement).closest("a")) setSidebarOpen(false); }}>{isCommunity ? <CommunitySidebar serverId={serverId} active={active} /> : <ConversationList active={active} onCreate={() => setGroup(true)} />}</div>
      )}
      <div
        className={`workspace ${onChat ? "workspace-chat" : ""} ${active ? "has-conversation" : ""}`}
      >
        <div
          className={`connection-banner ${connected ? "connection-hidden" : ""}`}
          role="status"
        >
          <WifiOff size={14} /> {tr('screen353')}</div>
        <Outlet />
      </div>
      {communityDialog && <CommunityDialog join={communityDialog === 'join'} onClose={() => setCommunityDialog(null)} />}
      {group && <CreateGroup onClose={() => setGroup(false)} />}
    </div>
  );
}
function ConversationList({
  active,
  onCreate,
}: {
  active?: string;
  onCreate: () => void;
}) {
  useLanguage();
  const { user, conversations } = useApp(),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const visible = conversations.filter(
    (c) =>
      c.type !== "CHANNEL" &&
      (filter !== "unread" || c.unreadCount > 0) &&
      conversationTitle(c, user!.id)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <aside id="conversation-sidebar" className={`conversation-sidebar ${active ? "mobile-hide" : ""}`}>
      <header className="sidebar-heading">
        <div>
          <h1>
            {tr('screen354')}<span className="dot-accent">.</span>
          </h1>
          <span className="sidebar-subtitle">{tr('screen355')}</span>
        </div>
        <button
          className="icon-btn new-chat"
          title={tr('screen333')}
          aria-label={tr('screen333')}
          onClick={onCreate}
        >
          <Plus size={20} />
        </button>
      </header>
      <div className="sidebar-search">
        <Search size={17} />
        <input
          placeholder={tr('screen356')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={tr('screen356')}
        />
        {search && (
          <button aria-label={tr('screen357')} onClick={() => setSearch("")}>
            <X size={14} />
          </button>
        )}
        <kbd>⌕</kbd>
      </div>
      <div className="sidebar-tabs">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          {tr('screen358')}<span>{conversations.filter(c => c.type !== "CHANNEL").length}</span>
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          onClick={() => setFilter("unread")}
        >
          {tr('unread')}{conversations.some((c) => c.unreadCount > 0) && <i />}
        </button>
        <ChevronDown size={14} />
      </div>
      <div className="conversation-list">
        {visible.map((c) => (
          <NavLink
            key={c.id}
            to={`/chat/${c.id}`}
            className={`conversation-row ${active === c.id ? "active" : ""}`}
          >
            <Avatar
              user={conversationUser(c, user!.id)}
              group={c.type === "GROUP"}
              showStatus={c.type === "DIRECT"}
            />
            <div className="conversation-copy">
              <div>
                <strong>{conversationTitle(c, user!.id)}</strong>
                <time>
                  {c.lastMessage ? formatTime(c.lastMessage.createdAt) : ""}
                </time>
              </div>
              <div>
                <p>
                  {c.lastMessage?.retractedAt
                    ? tr('screen359')
                    : c.lastMessage?.content ||
                      ((c.lastMessage?.attachments?.length || 0) > 0
                        ? tr('screen360')
                        : tr('screen361'))}
                </p>
                {c.unreadCount > 0 && (
                  <span className="unread-count">
                    {c.unreadCount > 99 ? "99+" : c.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </NavLink>
        ))}
        {visible.length === 0 && (
          <div className="sidebar-empty">
            <MessageCircle size={25} />
            <p>
              {search
                ? tr('screen362')
                : filter === "unread"
                  ? tr('screen363')
                  : tr('screen364')}
            </p>
            {!search && filter === "all" && (
              <Link to="/friends">
                {tr('screen365')}<ArrowUpRight size={13} />
              </Link>
            )}
          </div>
        )}
      </div>
      <footer className="sidebar-footer">
        <span className="tiny-online" /> {tr('screen366')}<span>{tr('screen313')}</span>
      </footer>
    </aside>
  );
}
