import { MemberActions } from './member-management';
import { TicketSettings, ChannelRestrictions } from './community-controls';
import { TicketCreate, CommunityBots } from './community-workspace';
import { CommunityRoles, MemberPreview, PermissionFields } from './community-tools';
import { getLanguage, translate as tr, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import { ChevronDown, Hash, Lock, Megaphone, Plus, Settings, UserPlus, Users, X } from 'lucide-react';
import { api, json, uploadFile } from './api';
import { useApp } from './state';
import { Avatar, Dialog, Empty, ErrorBox, Spinner, useTask } from './ui';
import type { Community, CommunityDetail } from './types';

export const roleNames = { get OWNER() { return tr('adminCommunityOwner'); }, get ADMIN() { return tr('screen236'); }, get MODERATOR() { return tr('screen579'); }, get MEMBER() { return tr('screen237'); } };
export function CommunityDialog({ onClose, join = false }: { onClose: () => void; join?: boolean }) {
  useLanguage();
  const { refresh } = useApp(), navigate = useNavigate(), task = useTask();
  const [busy, setBusy] = useState(false);
  return <Dialog title={join ? tr('screen580') : tr('screen581')} onClose={onClose}>
    <form className="form-stack" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); const values = new FormData(e.currentTarget);
      await task(async () => {
        if (join) {
          const input = String(values.get('invite')).trim();
          const token = input.match(/(?:^|\/invite\/)([a-f0-9]{64})(?:[?#].*)?$/)?.[1];
          if (!token) throw Error(tr('screen582'));
          navigate(`/invite/${token}`); onClose();
        } else {
          const s = await api<Community>('/servers', json('POST', { name: values.get('name'), description: values.get('description') }));
          await refresh(); navigate(`/servers/${s.id}`); onClose();
        }
      }); setBusy(false);
    }}>
      <p className="muted">{join ? tr('screen583') : tr('screen584')}</p>
      {join ? <label>{tr('screen585')}<input name="invite" required autoFocus autoComplete="off" placeholder={tr('screen586')} /></label> : <>
        <label>{tr('screen587')}<input name="name" required maxLength={80} autoFocus placeholder={tr('screen588')} /></label>
        <label>{tr('screen589')}<textarea name="description" maxLength={500} rows={3} placeholder={tr('screen590')} /></label>
        <p className="field-note">{tr('screen591')}</p>
      </>}
      <button className="btn btn-primary" disabled={busy}>{busy ? tr('auth58') : join ? tr('screen592') : tr('screen344')}</button>
    </form>
  </Dialog>;
}
export function CommunitySidebar({ serverId, active }: { serverId: string; active?: string }) {
  useLanguage();
  const app = useApp();
  const [retry,setRetry] = useState(0);
  const [server, setServer] = useState<CommunityDetail | null>(null), [error, setError] = useState(''), [dialog, setDialog] = useState<'channel' | 'category' | 'invite' | null>(null), [collapsed, setCollapsed] = useState<string[]>([]), [search, setSearch] = useState(''), [newCategory,setNewCategory]=useState<string|null>(null);
  useEffect(() => { setServer(null); setError(''); setSearch(''); setCollapsed([]); }, [serverId]);
  useEffect(() => {
    let current = true;
    api<CommunityDetail>(`/servers/${serverId}`).then(s => { if (current) { setServer(s); setError(''); } }).catch(e => { if (current) { setServer(null); setError(e.message); } });
    return () => { current = false; };
  }, [serverId, app.sync, app.communities, retry]);
  const manage = server?.permissions?.manageChannels || (server && ['OWNER', 'ADMIN'].includes(server.role));
  const channelRow = (channel: CommunityDetail['channels'][number]) => {
    const count = app.conversations.find(c => c.id === channel.conversationId)?.unreadCount || 0;
    return <NavLink key={channel.id} to={`/servers/${serverId}/channels/${channel.conversationId}`} className={`channel-row ${active === channel.conversationId ? 'active' : ''}`}>
      {channel.isPrivate ? <Lock size={17} /> : channel.readOnly ? <Megaphone size={18} /> : <Hash size={20} />}
      <span>{channel.conversation.name}{channel.archivedAt && <small> · {tr('communityArchived')}</small>}</span>{count > 0 && <b className="unread-count">{count > 99 ? '99+' : count}</b>}
    </NavLink>;
  };
  return <aside id="conversation-sidebar" className={`conversation-sidebar community-sidebar ${active ? 'mobile-hide' : ''}`}>
    <header className="community-heading"><details className="community-menu"><summary><strong>{server?.name || tr('screen593')}</strong><ChevronDown size={17}/></summary><div className="community-menu-items"><button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');setDialog('invite');}}><UserPlus size={16}/>{tr('screen258')}</button><Link to={`/servers/${serverId}/settings`}><Settings size={16}/>{tr('screen597')}</Link></div></details><p>{server ? tr('screen594', {v0: server.members.length, v1: roleNames[server.role]}) : tr('screen595')}</p></header>
    {error ? <ErrorBox message={error} retry={() => {setError('');setRetry(value=>value+1);}} /> : !server ? <Spinner label={tr('screen596')} /> : <>
      <div className="community-contact"><NavLink to={`/servers/${serverId}/tickets${server.ownerId!==app.user?.id&&app.conversations.some(c=>c.ticket?.serverId===serverId&&c.ticket.assigneeId===app.user?.id)?'?assigned=1':''}`} className={({isActive})=>isActive?'active':''}>{tr('adminTicketsNav')}{app.conversations.filter(c=>c.ticket?.serverId===serverId).reduce((n,c)=>n+c.unreadCount,0)>0&&<b className="unread-count">{app.conversations.filter(c=>c.ticket?.serverId===serverId).reduce((n,c)=>n+c.unreadCount,0)}</b>}</NavLink></div>
      <label className="channel-search"><span className="sr-only">{tr('screen599')}</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('screen600')} /></label>
      <div className="channel-sections">
        {[null, ...server.categories].map(category => {
          const key = category?.id || 'uncategorized', channels = server.channels.filter(c => c.categoryId === (category?.id || null) && c.conversation.name.toLowerCase().includes(search.toLowerCase()));
          if (!channels.length && !category) return null;
          return <section key={key} className="channel-category"><div className="category-header"><button className="category-toggle" aria-expanded={!collapsed.includes(key)} onClick={() => setCollapsed(v => v.includes(key) ? v.filter(k => k !== key) : [...v, key])}><ChevronDown size={13} style={{ transform: collapsed.includes(key) ? 'rotate(-90deg)' : undefined }} />{category?.name || tr('screen443')}<span>{channels.length}</span></button>{manage&&<button className="icon-btn" aria-label={tr('screen598')} onClick={()=>{setNewCategory(category?.id||null);setDialog('channel');}}><Plus size={16}/></button>}</div><div className="category-content" data-collapsed={collapsed.includes(key)} inert={collapsed.includes(key)}><div>{channels.map(channelRow)}</div></div></section>;
        })}
        {!server.channels.length && <p className="sidebar-empty">{tr('screen601')}</p>}
        {manage && <button className="category-add" onClick={() => setDialog('category')}><Plus size={14} /> {tr('screen602')}</button>}
      </div>
      <footer className="community-user"><Avatar user={app.user} size="sm" showStatus /><span><strong>{app.user?.displayName}</strong><small>@{app.user?.username}</small></span><Link to="/settings" className="icon-btn" aria-label={tr('screen603')}><Settings size={18} /></Link></footer>
      {dialog === 'channel' && <ChannelEditor initialCategoryId={newCategory} server={server} onClose={() => setDialog(null)} />}
      {dialog === 'category' && <CategoryEditor server={server} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && <InviteDialog server={server} onClose={() => setDialog(null)} />}
    </>}
  </aside>;
}
export function ChannelEditor({ server, channel, onClose, initialCategoryId }: { initialCategoryId?:string|null; server: CommunityDetail; channel?: CommunityDetail['channels'][number]; onClose: () => void }) {
  useLanguage();
  const app = useApp(), task = useTask(), [busy, setBusy] = useState(false), [isPrivate, setPrivate] = useState(channel?.isPrivate || false), [users, setUsers] = useState(channel?.grants.map(g => g.userId) || []), [overrides,setOverrides]=useState(channel?.permissionOverrides||{}), [roleOverrides,setRoleOverrides]=useState(channel?.roleOverrides||[]);
  return <Dialog title={channel ? tr('screen604') : tr('screen605')} onClose={onClose}><form className="form-stack" onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true); const values = new FormData(e.currentTarget);
    const result = await task(async () => { await api(`/servers/${server.id}/channels${channel ? `/${channel.id}` : ''}`, json(channel ? 'PATCH' : 'POST', { name: values.get('name'), description: values.get('description'), categoryId: values.get('categoryId') || null, position: Number(values.get('position')), readOnly: values.get('readOnly') === 'on', isPrivate, userIds: users, permissionOverrides:overrides, roleOverrides })); await app.refresh(); return true; });
    setBusy(false); if (result) onClose();
  }}>
    <label>{tr('screen606')}<input name="name" required maxLength={80} autoFocus defaultValue={channel?.conversation.name} /></label>
    <label>{tr('screen607')}<textarea name="description" maxLength={500} defaultValue={channel?.conversation.description} /></label>
    <label>{tr('screen608')}<select name="categoryId" defaultValue={channel?.categoryId || initialCategoryId || ''}><option value="">{tr('screen609')}</option>{server.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>{tr('screen610')}<input type="number" name="position" min={0} max={10000} defaultValue={channel?.position || 0} /></label>
    <label className="check-label"><input type="checkbox" name="readOnly" defaultChecked={channel?.readOnly} />{tr('screen611')}</label>
    <label className="check-label"><input type="checkbox" checked={isPrivate} onChange={e => setPrivate(e.target.checked)} />{tr('screen612')}</label>
    {isPrivate && <fieldset className="channel-member-picker"><legend>{tr('screen613')}</legend>{server.members.filter(m => !['OWNER', 'ADMIN'].includes(m.role)).map(m => <label className="check-label" key={m.userId}><input type="checkbox" checked={users.includes(m.userId)} onChange={e => setUsers(v => e.target.checked ? [...v, m.userId] : v.filter(id => id !== m.userId))} />{m.user.displayName} <small>@{m.user.username}</small></label>)}</fieldset>}
    <fieldset><legend>{tr('communityChannelPermissions')}</legend><PermissionFields value={overrides} onChange={setOverrides}/></fieldset>{server.roles?.map(r=><fieldset key={r.id}><legend>{tr('communityRoleOverrides')} · {r.name}</legend><PermissionFields value={roleOverrides.find(o=>o.roleId===r.id)?.permissions||{}} onChange={permissions=>setRoleOverrides(v=>[...v.filter(o=>o.roleId!==r.id),{roleId:r.id,permissions}])}/></fieldset>)}<button className="btn btn-primary" disabled={busy}>{busy ? tr('screen564') : tr('screen614')}</button>
    {channel && <ArchiveChannel serverId={server.id} channelId={channel.id} onClose={onClose} />}
  </form></Dialog>;
}
function ArchiveChannel({ serverId, channelId, onClose }: { serverId: string; channelId: string; onClose: () => void }) {
  useLanguage();
  const task = useTask(), app = useApp(), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  return <div className="form-stack">{confirm ? <><p className="form-error">{tr('screen615')}</p><button type="button" className="btn btn-danger" disabled={busy} onClick={async () => { setBusy(true); const ok = await task(async () => { await api(`/servers/${serverId}/channels/${channelId}`, json('DELETE')); await app.refresh(); return true; }); setBusy(false); if (ok) onClose(); }}>{tr('screen616')}</button></> : <button type="button" className="btn btn-secondary" onClick={() => setConfirm(true)}>{tr('screen617')}</button>}</div>;
}
export function CategoryEditor({ server, category, onClose }: { server: CommunityDetail; category?: CommunityDetail['categories'][number]; onClose: () => void }) {
  useLanguage();
  const app = useApp(), task = useTask(), [busy, setBusy] = useState(false);
  const path = `/servers/${server.id}/categories${category ? `/${category.id}` : ''}`;
  return <Dialog title={category ? tr('screen618') : tr('screen619')} onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); const v = new FormData(e.currentTarget); const ok = await task(async () => { await api(path, json(category ? 'PATCH' : 'POST', { name: v.get('name'), position: Number(v.get('position')) })); await app.refresh(); return true; }); setBusy(false); if (ok) onClose(); }}><label>{tr('screen620')}<input name="name" required maxLength={80} autoFocus defaultValue={category?.name} /></label><label>{tr('screen610')}<input name="position" type="number" min={0} max={10000} defaultValue={category?.position || 0} /></label><button className="btn btn-primary" disabled={busy}>{tr('screen621')}</button>{category && <button type="button" className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); const ok = await task(async () => { await api(path, json('DELETE')); await app.refresh(); return true; }); setBusy(false); if (ok) onClose(); }}>{tr('screen622')}</button>}</form></Dialog>;
}
function InviteDialog({ server, onClose }: { server: CommunityDetail; onClose: () => void }) {
  useLanguage();
  const task = useTask(), [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [invites, setInvites] = useState<{ id: string; uses: number; maxUses: number; expiresAt: string; revokedAt: string | null }[]>([]);
  const canInvite = server.role !== 'MEMBER';
  useEffect(() => { if (canInvite) void task(async () => setInvites(await api(`/servers/${server.id}/invites`))); }, [server.id]);
  return <Dialog title={tr('screen623')} onClose={onClose}>{!canInvite ? <p>{tr('screen624')}</p> : <form className="form-stack" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); const v = new FormData(e.currentTarget); await task(async () => { const invite = await api<{ token: string }>(`/servers/${server.id}/invites`, json('POST', { hours: Number(v.get('hours')), maxUses: Number(v.get('maxUses')) })); setUrl(`${location.origin}/invite/${invite.token}`); setInvites(await api(`/servers/${server.id}/invites`)); }); setBusy(false); }}>
    <label>{tr('screen625')}<input name="hours" type="number" min={1} max={168} defaultValue={24} /></label><label>{tr('screen626')}<input name="maxUses" type="number" min={1} max={200} defaultValue={20} /></label><button className="btn btn-primary" disabled={busy}>{busy ? tr('screen627') : tr('screen628')}</button>
    {url && <label>{tr('screen629')}<input value={url} readOnly onFocus={e => e.target.select()} /></label>}
    <p className="field-note">{tr('screen630')}</p>
    {invites.map(i => <div className="invite-row" key={i.id}><span>{i.uses}/{i.maxUses} {tr('screen631')}{i.revokedAt ? tr('screen632') : new Date(i.expiresAt).toLocaleString(getLanguage())}</span><button type="button" className="icon-btn" disabled={busy || !!i.revokedAt} aria-label={tr('screen633')} onClick={async () => { setBusy(true); await task(async () => { await api(`/servers/${server.id}/invites/${i.id}`, json('DELETE')); setInvites(await api(`/servers/${server.id}/invites`)); }); setBusy(false); }}><X size={16} /></button></div>)}
  </form>}</Dialog>;
}
export function CommunityPage() {
  useLanguage();
  const { serverId } = useParams(), app = useApp(), navigate = useNavigate(), task = useTask();
  const [server, setServer] = useState<CommunityDetail | null>(null), [error, setError] = useState(''), [editing, setEditing] = useState<CommunityDetail['channels'][number] | null>(null), [category, setCategory] = useState<CommunityDetail['categories'][number] | null>(null), [busy, setBusy] = useState(false), [ticketMember,setTicketMember]=useState<string|undefined>(),[ticketOpen,setTicketOpen]=useState(false),[preview,setPreview]=useState(false),[restricting,setRestricting]=useState(false);
  const location=useLocation(), settings=location.pathname.endsWith('/settings');
  const [retry,setRetry]=useState(0);
  useEffect(() => { setServer(null); setError(''); }, [serverId]);
  useEffect(() => { let live = true; api<CommunityDetail>(`/servers/${serverId}`).then(s => { if (live) {setServer(s);setError('');} }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [serverId, app.sync, app.communities, retry]);
  if (error) return <Empty title={tr('screen634')} description={error}><button className="btn btn-secondary" onClick={()=>{setError('');setRetry(value=>value+1);}}>{tr('retry')}</button><Link to="/chat" className="btn btn-secondary">{tr('screen635')}</Link></Empty>;
  if (!server) return <Spinner label={tr('screen595')} />;
  const manage = server.permissions?.manageChannels || ['OWNER', 'ADMIN'].includes(server.role);
  return <section className="community-overview"><Link className="mobile-back back-link" to={`/servers/${server.id}`}>{tr('screen636')}</Link><header className="community-hero"><div className="community-monogram">{server.iconUrl?<img src={server.iconUrl} alt=""/>:server.name.slice(0, 2)}</div><div><span className="eyebrow">{tr('screen637')}</span><h1>{server.name}</h1><p>{server.description || tr('screen638')}</p><small>{server.members.length} {tr('screen639')}{roleNames[server.role]}</small></div></header>
    <div className="community-quick-actions">{server.privateTicketsEnabled&&<button className="btn btn-secondary" onClick={()=>{setTicketMember(undefined);setTicketOpen(true);}}>{tr(server.ownerId===app.user?.id?'communityStartTicket':'communityContactOwner')}</button>}<Link className="btn btn-secondary" to={`/servers/${server.id}/tickets`}>{tr(server.ownerId===app.user?.id?'communityTicketQueue':'communityTickets')}</Link><Link className="btn btn-secondary" to={`/servers/${server.id}${settings?'':'/settings'}`}>{tr(settings?'communityBackChannels':'screen597')}</Link>{manage&&<button className="btn btn-secondary" onClick={()=>setPreview(true)}>{tr('communityPreviewMember')}</button>}</div>{server.rules&&<p>{server.rules}</p>}<div className="community-overview-grid"><div><h2><Hash size={19} /> {tr('screen443')}</h2><div className="community-channel-cards">{server.channels.map(c => <article key={c.id}><Link to={`/servers/${server.id}/channels/${c.conversationId}`}><strong>{c.isPrivate ? <Lock size={18} /> : <Hash size={19} />}{c.conversation.name}</strong><p>{c.conversation.description || tr('screen641')}</p><small>{c.readOnly ? tr('screen642') : tr('screen443')}</small></Link>{!c.archivedAt && c.permissions?.manageChannels && <button className="icon-btn" aria-label={tr('screen643', {v0: c.conversation.name})} onClick={() => setEditing(c)}><Settings size={17} /></button>}</article>)}</div>
      {settings && manage && <><h2>{tr('screen644')}</h2><form className="form-stack community-settings" onSubmit={async e => { e.preventDefault(); setBusy(true); const v = new FormData(e.currentTarget); await task(async () => { await api(`/servers/${server.id}`, json('PATCH', { name: v.get('name'), description: v.get('description'), rules:v.get('rules'), iconUrl:v.get('iconUrl')||null })); await app.refresh(); }); setBusy(false); }}><label>{tr('screen645')}<input name="name" maxLength={80} required defaultValue={server.name} /></label><label>{tr('screen646')}<textarea name="description" maxLength={500} defaultValue={server.description} /></label><label>{tr('communityRules')}<textarea name="rules" maxLength={4000} defaultValue={server.rules}/></label><CommunityIconInput server={server} busy={setBusy}/ ><button className="btn btn-secondary" disabled={busy}>{tr('screen647')}</button></form><h2>{tr('screen648')}</h2>{server.categories.map(c => <button key={c.id} className="btn btn-secondary" onClick={() => setCategory(c)}>{c.name} {tr('screen649')}{c.position}</button>)}</>}
    {settings&&<nav className="community-settings-tabs" aria-label={tr("adminSettingsSections")}><a href="#community-members">{tr("communityMembers")}</a>{server.role==='OWNER'&&<a href="#ticket-settings">{tr("adminTicketsNav")}</a>}{server.permissions?.installBots&&<a href="#community-bots">{tr("communityBots")}</a>}</nav>}{settings&&server.role==='OWNER'&&<><TicketSettings server={server}/><button className="btn btn-secondary" onClick={()=>setRestricting(true)}>{tr('controlsReadonlyChannels')}</button><CommunityRoles server={server}/><TransferOwner server={server}/></>}{settings&&server.permissions?.installBots&&<CommunityBots server={server}/>}</div><aside id="community-members" className="community-members"><h2><Users size={19} /> {tr('screen650')}</h2>{server.members.map(m => <div className="community-member" key={m.userId}><Link to={`/profile/${m.userId}`} state={{communityId:server.id}}><Avatar user={m.user} size="sm" showStatus /><span><strong>{m.user.displayName}</strong><small>{roleNames[m.role]} · @{m.user.username}</small></span></Link>{m.userId !== app.user?.id && m.role !== 'OWNER' && (server.role === 'OWNER' || (['ADMIN', 'MODERATOR'].includes(server.role) && m.role === 'MEMBER')) && <MemberActions server={server} member={m} ticket={()=>{setTicketMember(m.userId);setTicketOpen(true);}} />}</div>)}
      {server.role !== 'OWNER' && <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); const ok = await task(async () => { await api(`/servers/${server.id}/members/${app.user!.id}`, json('DELETE')); await app.refresh(); return true; }); setBusy(false); if (ok) navigate('/chat'); }}>{tr('screen651')}</button>}
    </aside></div>{restricting&&<ChannelRestrictions server={server} onClose={()=>setRestricting(false)}/ >}{ticketOpen&&<TicketCreate serverId={server.id} memberId={ticketMember} onClose={()=>setTicketOpen(false)}/ >}{preview&&<MemberPreview serverId={server.id} onClose={()=>setPreview(false)}/ >}{editing && <ChannelEditor server={server} channel={editing} onClose={() => setEditing(null)} />}{category && <CategoryEditor server={server} category={category} onClose={() => setCategory(null)} />}
  </section>;
}
export function InvitePage() {
  useLanguage();
  const { token } = useParams(), app = useApp(), navigate = useNavigate(), task = useTask();
  const [preview, setPreview] = useState<(Community & { _count: { members: number } }) | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api<Community & { _count: { members: number } }>(`/invites/${token}`).then(s => { if (live) setPreview(s); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [token]);
  return <main className="invite-page"><div className="invite-card"><span className="eyebrow">{tr('screen659')}</span>{error ? <p className="form-error" role="alert">{error}</p> : !preview ? <Spinner label={tr('screen660')} /> : <><div className="community-monogram">{preview.name.slice(0, 2)}</div><h1>{preview.name}</h1><p>{preview.description || tr('screen661')}</p><small>{preview._count.members} {tr('screen222')}</small>{app.loading ? <Spinner /> : !app.user ? <Link to="/login" state={{ from: `/invite/${token}` }} className="btn btn-primary">{tr('screen662')}</Link> : <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await task(async () => { const result = await api<{ serverId: string }>(`/invites/${token}/join`, json('POST')); await app.refresh(); navigate(`/servers/${result.serverId}`); }); setBusy(false); }}>{busy ? tr('screen663') : tr('screen664')}</button>}</>}<Link to="/chat" className="muted">{tr('screen665')}</Link></div></main>;
}

function TransferOwner({server}:{server:CommunityDetail}){useLanguage();const app=useApp(),task=useTask(),[busy,setBusy]=useState(false),[target,setTarget]=useState(''),[confirm,setConfirm]=useState(false);return <section className="community-setting-section"><h2>{tr('communityTransfer')}</h2><select value={target} onChange={e=>{setTarget(e.target.value);setConfirm(false);}} aria-label={tr('communityTransfer')}><option value="">{tr('communityMembers')}</option>{server.members.filter(m=>m.userId!==server.ownerId).map(m=><option value={m.userId} key={m.userId}>{m.user.displayName}</option>)}</select><button className="btn btn-danger" disabled={!target||busy} onClick={async()=>{if(!confirm){setConfirm(true);return;}setBusy(true);await task(async()=>{await api(`/servers/${server.id}/transfer`,json('POST',{userId:target}));await app.refresh();});setBusy(false);}}>{tr(confirm?'communityTransferConfirm':'communityTransfer')}</button></section>;}

function CommunityIconInput({server,busy}:{server:CommunityDetail;busy:(value:boolean)=>void}){useLanguage();const [value,setValue]=useState(server.iconUrl||''),[progress,setProgress]=useState<number|null>(null),[error,setError]=useState('');return <div className="form-stack"><label>{tr('communityIcon')}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={progress!==null} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;busy(true);setProgress(0);setError('');try{const image=await uploadFile<{url:string}>(file,setProgress);setValue(image.url);}catch(e){setError((e as Error).message);}finally{setProgress(null);busy(false);}}}/></label><input type="hidden" name="iconUrl" value={value}/>{value&&<><img src={value} alt={server.name} width={48} height={48}/><button className="btn btn-secondary" type="button" onClick={()=>setValue('')}>{tr('communityRemove')}</button></>}{progress!==null&&<progress value={progress} max={100}/ >}{error&&<p role="alert" className="form-error">{error}</p>}</div>;}
