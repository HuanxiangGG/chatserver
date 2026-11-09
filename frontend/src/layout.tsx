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
  const { friends, refresh } = useApp(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    navigate = useNavigate(),
    task = useTask();
  return (
    <Dialog title="创建一个新的群聊" onClose={onClose}>
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
        <p className="muted">把合拍的人聚在一起，开始新的对话。</p>
        <label>
          群名称
          <input
            name="name"
            required
            maxLength={80}
            placeholder="给这个空间起个名字"
          />
        </label>
        <label>
          群简介
          <textarea
            name="description"
            maxLength={500}
            placeholder="这个群聊是关于什么的？"
            rows={2}
          />
        </label>
        <label>
          邀请好友 <small>已选择 {selected.length} 人</small>
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
              还没有好友。请先添加好友，再邀请他们一起创建群聊。
            </p>
          )}
        </div>
        <button className="btn btn-primary" disabled={busy || !selected.length}>
          {busy ? "正在创建…" : "创建群聊"}
          <ArrowUpRight size={16} />
        </button>
      </form>
    </Dialog>
  );
}
export function Layout() {
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
      {onChat && active && <button className="mobile-sidebar-toggle btn btn-secondary" aria-label={sidebarOpen ? '关闭消息列表' : '打开消息列表'} aria-expanded={sidebarOpen} aria-controls="conversation-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? '关闭列表' : '消息列表'}</button>}
      {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭消息列表" onClick={() => setSidebarOpen(false)} />}
      <aside className="nav-rail">
        <Link to="/chat" aria-label="泊岸首页" className="rail-brand">
          <Brand compact />
        </Link>
        <div className="rail-divider" />
        <nav aria-label="主导航">
          <NavLink
            to="/chat"
            title="聊天"
            className={({ isActive }) =>
              `rail-link ${isActive ? "active" : ""}`
            }
          >
            <MessageCircle size={22} />
            <span>聊天</span>
            {conversations.some((c) => c.unreadCount > 0) && (
              <i className="rail-dot" />
            )}
          </NavLink>
          <NavLink
            to="/friends"
            title="好友"
            className={({ isActive }) =>
              `rail-link ${isActive ? "active" : ""}`
            }
          >
            <Users size={22} />
            <span>好友</span>
            {requests.incoming.length > 0 && (
              <i className="rail-count">{requests.incoming.length}</i>
            )}
          </NavLink>
          {user?.role === "ADMIN" && (
            <NavLink
              to="/admin"
              title="管理后台"
              className={({ isActive }) =>
                `rail-link ${isActive ? "active" : ""}`
              }
            >
              <Shield size={22} />
              <span>管理</span>
            </NavLink>
          )}
          <div className="rail-divider" />
          {communities.map(s => <NavLink key={s.id} to={`/servers/${s.id}`} title={s.name} aria-label={`社区：${s.name}`} className={`rail-server ${serverId === s.id ? 'active' : ''}`}><span>{s.name.slice(0, 2)}</span>{conversations.some(c => c.channel?.serverId === s.id && c.unreadCount > 0) && <i className="rail-dot" />}</NavLink>)}
          <button className="rail-server rail-create" title="创建社区" aria-label="创建社区" onClick={() => setCommunityDialog('create')}><Plus size={23} /></button>
          <button className="rail-server rail-join" title="加入社区" aria-label="加入社区" onClick={() => setCommunityDialog('join')}><Users size={22} /></button>
        </nav>
        <div className="rail-bottom">
          <button
            className="rail-link"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="切换主题"
            aria-label="切换亮暗主题"
          >
            {theme === "dark" ? <Sun size={21} /> : <Moon size={21} />}
            <span>外观</span>
          </button>
          <NavLink to="/settings" className="rail-link" title="设置">
            <Settings size={22} />
            <span>设置</span>
          </NavLink>
          <div className="rail-user">
            <button
              onClick={() => setMenu(!menu)}
              aria-label="账号菜单"
              aria-expanded={menu}
            >
              <Avatar user={user} size="sm" showStatus />
            </button>
            {menu && (
              <div className="account-menu">
                <strong>{user?.displayName}</strong>
                <Link to="/profile" onClick={() => setMenu(false)}>
                  个人资料 <ArrowUpRight size={15} />
                </Link>
                <button onClick={() => void task(logout)}>
                  <LogOut size={15} /> 退出登录
                </button>
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
          <WifiOff size={14} /> 正在重连，恢复后将自动同步未读消息
        </div>
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
            消息<span className="dot-accent">.</span>
          </h1>
          <span className="sidebar-subtitle">每一段对话，都值得停留</span>
        </div>
        <button
          className="icon-btn new-chat"
          title="创建群聊"
          aria-label="创建群聊"
          onClick={onCreate}
        >
          <Plus size={20} />
        </button>
      </header>
      <div className="sidebar-search">
        <Search size={17} />
        <input
          placeholder="搜索对话"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="搜索对话"
        />
        {search && (
          <button aria-label="清空搜索" onClick={() => setSearch("")}>
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
          全部消息 <span>{conversations.filter(c => c.type !== "CHANNEL").length}</span>
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          onClick={() => setFilter("unread")}
        >
          未读 {conversations.some((c) => c.unreadCount > 0) && <i />}
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
                    ? "一条消息已撤回"
                    : c.lastMessage?.content ||
                      ((c.lastMessage?.attachments?.length || 0) > 0
                        ? "[文件]"
                        : "开始新的对话")}
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
                ? "没有找到相关对话"
                : filter === "unread"
                  ? "所有消息都已读"
                  : "还没有对话"}
            </p>
            {!search && filter === "all" && (
              <Link to="/friends">
                寻找好友 <ArrowUpRight size={13} />
              </Link>
            )}
          </div>
        )}
      </div>
      <footer className="sidebar-footer">
        <span className="tiny-online" /> 给重要的人，留一个位置。
        <span>泊岸</span>
      </footer>
    </aside>
  );
}
