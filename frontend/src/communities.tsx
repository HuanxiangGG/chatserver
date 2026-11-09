import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Hash, Lock, Megaphone, Plus, Settings, UserPlus, Users, X } from 'lucide-react';
import { api, json } from './api';
import { useApp } from './state';
import { Avatar, Dialog, Empty, ErrorBox, Spinner, useTask } from './ui';
import type { Community, CommunityDetail } from './types';

export const roleNames = { OWNER: '所有者', ADMIN: '管理员', MODERATOR: '版主', MEMBER: '成员' };
export function CommunityDialog({ onClose, join = false }: { onClose: () => void; join?: boolean }) {
  const { refresh } = useApp(), navigate = useNavigate(), task = useTask();
  const [busy, setBusy] = useState(false);
  return <Dialog title={join ? '加入一个社区' : '创建你的社区'} onClose={onClose}>
    <form className="form-stack" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); const values = new FormData(e.currentTarget);
      await task(async () => {
        if (join) {
          const input = String(values.get('invite')).trim();
          const token = input.match(/(?:^|\/invite\/)([a-f0-9]{64})(?:[?#].*)?$/)?.[1];
          if (!token) throw Error('请输入完整邀请链接或 64 位邀请码');
          navigate(`/invite/${token}`); onClose();
        } else {
          const s = await api<Community>('/servers', json('POST', { name: values.get('name'), description: values.get('description') }));
          await refresh(); navigate(`/servers/${s.id}`); onClose();
        }
      }); setBusy(false);
    }}>
      <p className="muted">{join ? '使用朋友分享的邀请，找到属于你的频道。' : '为朋友、兴趣和共同的想法，留一片自己的港湾。'}</p>
      {join ? <label>邀请链接或邀请码<input name="invite" required autoFocus autoComplete="off" placeholder="粘贴社区邀请链接" /></label> : <>
        <label>社区名称<input name="name" required maxLength={80} autoFocus placeholder="例如：周末创作社" /></label>
        <label>社区介绍<textarea name="description" maxLength={500} rows={3} placeholder="告诉新朋友，这里有什么" /></label>
        <p className="field-note">创建后会自动拥有一个 #general 文字频道。</p>
      </>}
      <button className="btn btn-primary" disabled={busy}>{busy ? '正在处理…' : join ? '预览邀请' : '创建社区'}</button>
    </form>
  </Dialog>;
}
export function CommunitySidebar({ serverId, active }: { serverId: string; active?: string }) {
  const app = useApp(), navigate = useNavigate();
  const [server, setServer] = useState<CommunityDetail | null>(null), [error, setError] = useState(''), [dialog, setDialog] = useState<'channel' | 'category' | 'invite' | null>(null), [collapsed, setCollapsed] = useState<string[]>([]), [search, setSearch] = useState('');
  useEffect(() => { setServer(null); setError(''); setSearch(''); setCollapsed([]); }, [serverId]);
  useEffect(() => {
    let current = true;
    api<CommunityDetail>(`/servers/${serverId}`).then(s => { if (current) { setServer(s); setError(''); } }).catch(e => { if (current) { setServer(null); setError(e.message); } });
    return () => { current = false; };
  }, [serverId, app.sync, app.communities]);
  const manage = server && ['OWNER', 'ADMIN'].includes(server.role);
  const channelRow = (channel: CommunityDetail['channels'][number]) => {
    const count = app.conversations.find(c => c.id === channel.conversationId)?.unreadCount || 0;
    return <NavLink key={channel.id} to={`/servers/${serverId}/channels/${channel.conversationId}`} className={`channel-row ${active === channel.conversationId ? 'active' : ''}`}>
      {channel.isPrivate ? <Lock size={17} /> : channel.readOnly ? <Megaphone size={18} /> : <Hash size={20} />}
      <span>{channel.conversation.name}</span>{count > 0 && <b className="unread-count">{count > 99 ? '99+' : count}</b>}
    </NavLink>;
  };
  return <aside id="conversation-sidebar" className={`conversation-sidebar community-sidebar ${active ? 'mobile-hide' : ''}`}>
    <header className="community-heading"><Link to={`/servers/${serverId}/settings`}><strong>{server?.name || '社区频道'}</strong><ChevronDown size={17} /></Link><p>{server ? `${server.members.length} 位成员 · ${roleNames[server.role]}` : '正在打开社区…'}</p></header>
    {error ? <ErrorBox message={error} retry={() => void app.refresh().then(() => navigate('/chat')).catch(() => {})} /> : !server ? <Spinner label="正在读取频道…" /> : <>
      <div className="community-tools"><button className="btn btn-secondary" onClick={() => setDialog('invite')}><UserPlus size={15} /> 邀请</button><Link className="icon-btn" to={`/servers/${serverId}/settings`} aria-label="社区成员和设置"><Settings size={18} /></Link>{manage && <button className="icon-btn" onClick={() => setDialog('channel')} aria-label="创建频道"><Plus size={18} /></button>}</div>
      <label className="channel-search"><span className="sr-only">筛选频道</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索频道名称" /></label>
      <div className="channel-sections">
        {[null, ...server.categories].map(category => {
          const key = category?.id || 'uncategorized', channels = server.channels.filter(c => c.categoryId === (category?.id || null) && c.conversation.name.toLowerCase().includes(search.toLowerCase()));
          if (!channels.length && !category) return null;
          return <section key={key} className="channel-category"><button className="category-toggle" aria-expanded={!collapsed.includes(key)} onClick={() => setCollapsed(v => v.includes(key) ? v.filter(k => k !== key) : [...v, key])}><ChevronDown size={13} style={{ transform: collapsed.includes(key) ? 'rotate(-90deg)' : undefined }} />{category?.name || '文字频道'}<span>{channels.length}</span></button>{!collapsed.includes(key) && channels.map(channelRow)}</section>;
        })}
        {!server.channels.length && <p className="sidebar-empty">还没有你可以访问的频道</p>}
        {manage && <button className="category-add" onClick={() => setDialog('category')}><Plus size={14} /> 创建分类</button>}
      </div>
      <footer className="community-user"><Avatar user={app.user} size="sm" showStatus /><span><strong>{app.user?.displayName}</strong><small>@{app.user?.username}</small></span><Link to="/settings" className="icon-btn" aria-label="账号设置"><Settings size={18} /></Link></footer>
      {dialog === 'channel' && <ChannelEditor server={server} onClose={() => setDialog(null)} />}
      {dialog === 'category' && <CategoryEditor server={server} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && <InviteDialog server={server} onClose={() => setDialog(null)} />}
    </>}
  </aside>;
}
function ChannelEditor({ server, channel, onClose }: { server: CommunityDetail; channel?: CommunityDetail['channels'][number]; onClose: () => void }) {
  const app = useApp(), task = useTask(), [busy, setBusy] = useState(false), [isPrivate, setPrivate] = useState(channel?.isPrivate || false), [users, setUsers] = useState(channel?.grants.map(g => g.userId) || []);
  return <Dialog title={channel ? '频道设置' : '创建文字频道'} onClose={onClose}><form className="form-stack" onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true); const values = new FormData(e.currentTarget);
    const result = await task(async () => { await api(`/servers/${server.id}/channels${channel ? `/${channel.id}` : ''}`, json(channel ? 'PATCH' : 'POST', { name: values.get('name'), description: values.get('description'), categoryId: values.get('categoryId') || null, position: Number(values.get('position')), readOnly: values.get('readOnly') === 'on', isPrivate, userIds: users })); await app.refresh(); return true; });
    setBusy(false); if (result) onClose();
  }}>
    <label>频道名称<input name="name" required maxLength={80} autoFocus defaultValue={channel?.conversation.name} /></label>
    <label>频道说明<textarea name="description" maxLength={500} defaultValue={channel?.conversation.description} /></label>
    <label>分类<select name="categoryId" defaultValue={channel?.categoryId || ''}><option value="">未分类</option>{server.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>排序位置<input type="number" name="position" min={0} max={10000} defaultValue={channel?.position || 0} /></label>
    <label className="check-label"><input type="checkbox" name="readOnly" defaultChecked={channel?.readOnly} />只读公告频道（版主及以上可发送）</label>
    <label className="check-label"><input type="checkbox" checked={isPrivate} onChange={e => setPrivate(e.target.checked)} />私密频道（所有者、管理员及指定成员可见）</label>
    {isPrivate && <fieldset className="channel-member-picker"><legend>允许查看的成员</legend>{server.members.filter(m => !['OWNER', 'ADMIN'].includes(m.role)).map(m => <label className="check-label" key={m.userId}><input type="checkbox" checked={users.includes(m.userId)} onChange={e => setUsers(v => e.target.checked ? [...v, m.userId] : v.filter(id => id !== m.userId))} />{m.user.displayName} <small>@{m.user.username}</small></label>)}</fieldset>}
    <button className="btn btn-primary" disabled={busy}>{busy ? '正在保存…' : '保存频道'}</button>
    {channel && <ArchiveChannel serverId={server.id} channelId={channel.id} onClose={onClose} />}
  </form></Dialog>;
}
function ArchiveChannel({ serverId, channelId, onClose }: { serverId: string; channelId: string; onClose: () => void }) {
  const task = useTask(), app = useApp(), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  return <div className="form-stack">{confirm ? <><p className="form-error">归档后成员不能再访问该频道，已有消息和附件记录会保留。</p><button type="button" className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); const ok = await task(async () => { await api(`/servers/${serverId}/channels/${channelId}`, json('DELETE')); await app.refresh(); return true; }); setBusy(false); if (ok) onClose(); }}>确认归档</button></> : <button type="button" className="btn btn-secondary" onClick={() => setConfirm(true)}>归档频道</button>}</div>;
}
function CategoryEditor({ server, category, onClose }: { server: CommunityDetail; category?: CommunityDetail['categories'][number]; onClose: () => void }) {
  const app = useApp(), task = useTask(), [busy, setBusy] = useState(false);
  const path = `/servers/${server.id}/categories${category ? `/${category.id}` : ''}`;
  return <Dialog title={category ? '分类设置' : '创建频道分类'} onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); const v = new FormData(e.currentTarget); const ok = await task(async () => { await api(path, json(category ? 'PATCH' : 'POST', { name: v.get('name'), position: Number(v.get('position')) })); await app.refresh(); return true; }); setBusy(false); if (ok) onClose(); }}><label>分类名称<input name="name" required maxLength={80} autoFocus defaultValue={category?.name} /></label><label>排序位置<input name="position" type="number" min={0} max={10000} defaultValue={category?.position || 0} /></label><button className="btn btn-primary" disabled={busy}>保存分类</button>{category && <button type="button" className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); const ok = await task(async () => { await api(path, json('DELETE')); await app.refresh(); return true; }); setBusy(false); if (ok) onClose(); }}>删除分类（保留频道）</button>}</form></Dialog>;
}
function InviteDialog({ server, onClose }: { server: CommunityDetail; onClose: () => void }) {
  const task = useTask(), [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [invites, setInvites] = useState<{ id: string; uses: number; maxUses: number; expiresAt: string; revokedAt: string | null }[]>([]);
  const canInvite = server.role !== 'MEMBER';
  useEffect(() => { if (canInvite) void task(async () => setInvites(await api(`/servers/${server.id}/invites`))); }, [server.id]);
  return <Dialog title="邀请朋友加入社区" onClose={onClose}>{!canInvite ? <p>请联系社区所有者、管理员或版主获取邀请。</p> : <form className="form-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); const v = new FormData(e.currentTarget); await task(async () => { const invite = await api<{ token: string }>(`/servers/${server.id}/invites`, json('POST', { hours: Number(v.get('hours')), maxUses: Number(v.get('maxUses')) })); setUrl(`${location.origin}/invite/${invite.token}`); setInvites(await api(`/servers/${server.id}/invites`)); }); setBusy(false); }}>
    <label>有效小时<input name="hours" type="number" min={1} max={168} defaultValue={24} /></label><label>最多加入人数<input name="maxUses" type="number" min={1} max={200} defaultValue={20} /></label><button className="btn btn-primary" disabled={busy}>{busy ? '正在生成…' : '生成邀请链接'}</button>
    {url && <label>邀请链接（请复制保存）<input value={url} readOnly onFocus={e => e.target.select()} /></label>}
    <p className="field-note">邀请码只显示一次。撤销后，已经加入的成员不受影响。</p>
    {invites.map(i => <div className="invite-row" key={i.id}><span>{i.uses}/{i.maxUses} 人 · {i.revokedAt ? '已撤销' : new Date(i.expiresAt).toLocaleString('zh-CN')}</span><button type="button" className="icon-btn" disabled={busy || !!i.revokedAt} aria-label="撤销此邀请" onClick={async () => { setBusy(true); await task(async () => { await api(`/servers/${server.id}/invites/${i.id}`, json('DELETE')); setInvites(await api(`/servers/${server.id}/invites`)); }); setBusy(false); }}><X size={16} /></button></div>)}
  </form>}</Dialog>;
}
export function CommunityPage() {
  const { serverId } = useParams(), app = useApp(), navigate = useNavigate(), task = useTask();
  const [server, setServer] = useState<CommunityDetail | null>(null), [error, setError] = useState(''), [editing, setEditing] = useState<CommunityDetail['channels'][number] | null>(null), [category, setCategory] = useState<CommunityDetail['categories'][number] | null>(null), [invite, setInvite] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { setServer(null); setError(''); }, [serverId]);
  useEffect(() => { let live = true; api<CommunityDetail>(`/servers/${serverId}`).then(s => { if (live) setServer(s); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [serverId, app.sync, app.communities]);
  if (error) return <Empty title="无法打开社区" description={error}><Link to="/chat" className="btn btn-secondary">返回私聊</Link></Empty>;
  if (!server) return <Spinner label="正在打开社区…" />;
  const manage = ['OWNER', 'ADMIN'].includes(server.role);
  return <section className="community-overview"><Link className="mobile-back back-link" to={`/servers/${server.id}`}>返回频道列表</Link><header className="community-hero"><div className="community-monogram">{server.name.slice(0, 2)}</div><div><span className="eyebrow">你的社区空间</span><h1>{server.name}</h1><p>{server.description || '在不同的频道里，遇见同频的人。'}</p><small>{server.members.length} 位成员 · {roleNames[server.role]}</small></div><button className="btn btn-primary" onClick={() => setInvite(true)}><UserPlus size={16} /> 邀请朋友</button></header>
    <div className="community-overview-grid"><div><h2><Hash size={19} /> 文字频道</h2><div className="community-channel-cards">{server.channels.map(c => <article key={c.id}><Link to={`/servers/${server.id}/channels/${c.conversationId}`}><strong>{c.isPrivate ? <Lock size={18} /> : <Hash size={19} />}{c.conversation.name}</strong><p>{c.conversation.description || '进入频道，开始聊天'}</p><small>{c.readOnly ? '只读公告' : '文字频道'}</small></Link>{manage && <button className="icon-btn" aria-label={`管理 ${c.conversation.name}`} onClick={() => setEditing(c)}><Settings size={17} /></button>}</article>)}</div>
      {manage && <><h2>社区设置</h2><form className="form-stack community-settings" onSubmit={async e => { e.preventDefault(); setBusy(true); const v = new FormData(e.currentTarget); await task(async () => { await api(`/servers/${server.id}`, json('PATCH', { name: v.get('name'), description: v.get('description') })); await app.refresh(); }); setBusy(false); }}><label>名称<input name="name" maxLength={80} required defaultValue={server.name} /></label><label>介绍<textarea name="description" maxLength={500} defaultValue={server.description} /></label><button className="btn btn-secondary" disabled={busy}>保存社区信息</button></form><h2>频道分类</h2>{server.categories.map(c => <button key={c.id} className="btn btn-secondary" onClick={() => setCategory(c)}>{c.name} · 位置 {c.position}</button>)}</>}
    </div><aside className="community-members"><h2><Users size={19} /> 社区成员</h2>{server.members.map(m => <div className="community-member" key={m.userId}><Link to={`/profile/${m.userId}`}><Avatar user={m.user} size="sm" showStatus /><span><strong>{m.user.displayName}</strong><small>{roleNames[m.role]} · @{m.user.username}</small></span></Link>{m.userId !== app.user?.id && m.role !== 'OWNER' && (server.role === 'OWNER' || (['ADMIN', 'MODERATOR'].includes(server.role) && m.role === 'MEMBER')) && <MemberActions server={server} member={m} />}</div>)}
      {server.role !== 'OWNER' && <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); const ok = await task(async () => { await api(`/servers/${server.id}/members/${app.user!.id}`, json('DELETE')); await app.refresh(); return true; }); setBusy(false); if (ok) navigate('/chat'); }}>退出社区</button>}
    </aside></div>{editing && <ChannelEditor server={server} channel={editing} onClose={() => setEditing(null)} />}{category && <CategoryEditor server={server} category={category} onClose={() => setCategory(null)} />}{invite && <InviteDialog server={server} onClose={() => setInvite(false)} />}
  </section>;
}
function MemberActions({ server, member }: { server: CommunityDetail; member: CommunityDetail['members'][number] }) {
  const app = useApp(), task = useTask(), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const mutate = async (method: string, data: unknown) => { setBusy(true); const ok = await task(async () => { await api(`/servers/${server.id}/members/${member.userId}`, json(method, data)); await app.refresh(); return true; }); setBusy(false); if (ok) setOpen(false); };
  return <><button className="icon-btn" aria-label={`管理成员 ${member.user.displayName}`} onClick={() => setOpen(true)}><Settings size={16} /></button>{open && <Dialog title={`管理 ${member.user.displayName}`} onClose={() => setOpen(false)}><div className="form-stack"><p>所有操作会记录审计日志。移除或封禁后，成员立即失去频道访问权限。</p>{server.role === 'OWNER' && <label>社区角色<select value={member.role} disabled={busy} onChange={e => void mutate('PATCH', { role: e.target.value })}><option value="MEMBER">成员</option><option value="MODERATOR">版主</option><option value="ADMIN">管理员</option></select></label>}<button className="btn btn-secondary" disabled={busy} onClick={() => void mutate('PATCH', { muteMinutes: member.mutedUntil && new Date(member.mutedUntil) > new Date() ? 0 : 60 })}>{member.mutedUntil && new Date(member.mutedUntil) > new Date() ? '解除禁言' : '禁言 1 小时'}</button><button className="btn btn-secondary" disabled={busy} onClick={() => void mutate('DELETE', {})}>移出社区</button>{['OWNER', 'ADMIN'].includes(server.role) && <button className="btn btn-danger" disabled={busy} onClick={() => void mutate('DELETE', { ban: true, reason: '社区管理操作' })}>封禁并移出</button>}</div></Dialog>}</>;
}
export function InvitePage() {
  const { token } = useParams(), app = useApp(), navigate = useNavigate(), task = useTask();
  const [preview, setPreview] = useState<(Community & { _count: { members: number } }) | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api<Community & { _count: { members: number } }>(`/invites/${token}`).then(s => { if (live) setPreview(s); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [token]);
  return <main className="invite-page"><div className="invite-card"><span className="eyebrow">你收到了一份社区邀请</span>{error ? <p className="form-error" role="alert">{error}</p> : !preview ? <Spinner label="正在验证邀请…" /> : <><div className="community-monogram">{preview.name.slice(0, 2)}</div><h1>{preview.name}</h1><p>{preview.description || '一起聊聊，分享新的想法。'}</p><small>{preview._count.members} 位成员</small>{app.loading ? <Spinner /> : !app.user ? <Link to="/login" state={{ from: `/invite/${token}` }} className="btn btn-primary">登录后加入</Link> : <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await task(async () => { const result = await api<{ serverId: string }>(`/invites/${token}/join`, json('POST')); await app.refresh(); navigate(`/servers/${result.serverId}`); }); setBusy(false); }}>{busy ? '正在加入…' : '加入这个社区'}</button>}</>}<Link to="/chat" className="muted">返回泊岸</Link></div></main>;
}
