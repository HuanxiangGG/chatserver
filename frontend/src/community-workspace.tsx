import { MoreHorizontal } from "lucide-react";
import { useFormChanges } from "./settings-workspace";
import { TicketPrivacyChoice, ClaimableTickets } from "./ticket-management";
import { CommunityDialog } from "./communities";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, json } from "./api";
import { translate as tr, useLanguage, getLanguage } from "./i18n";
import { useApp } from "./state";
import { Dialog, Empty, ErrorBox, Spinner } from "./ui";
import type { CommunityDetail, User } from "./types";
export interface Ticket {
  id: string;
  number: number;
  serverId: string;
  conversationId: string;
  subject: string;
  category: string;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  memberId: string | null;
  guestName?: string | null;
  assigneeId: string | null;
  ownerOnly: boolean;
  handoffAssigneeId: string | null;
  handoffAssignee?: User | null;
  member?: User;
  assignee?: User | null;
  unreadCount?: number;
  createdAt: string;
  updatedAt?: string;
  lastActivityAt?: string;
  waitingFor?: "MEMBER" | "STAFF" | null;
  lastMessage?: { content: string; senderName: string; kind: "TEXT" | "IMAGE" | "FILE" | "RETRACTED"; filename?: string; createdAt: string } | null;
}
export const ticketPath = (t: Ticket) =>
  `/servers/${t.serverId}/tickets/${t.id}/chat/${t.conversationId}`;
const statusText = (s: Ticket["status"]) =>
  tr(
    s === "OPEN"
      ? "communityTicketOpen"
      : s === "CLOSED"
        ? "communityTicketClosed"
        : "communityTicketProgress",
  );
export function TicketCreate({
  serverId,
  memberId,
  onClose,
}: {
  serverId: string;
  memberId?: string;
  onClose: () => void;
}) {
  useLanguage();
  const app = useApp(),
    navigate = useNavigate(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    nonce = useRef(crypto.randomUUID()),
    [community, setCommunity] = useState<CommunityDetail | null>(null);
  useEffect(() => {
    let live = true;
    api<CommunityDetail>(`/servers/${serverId}`)
      .then((v) => {
        if (live) setCommunity(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [serverId]);
  return (
    <Dialog
      title={tr(
        memberId || community?.ownerId === app.user?.id
          ? "communityStartTicket"
          : "communityContactOwner",
      )}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          const form = new FormData(e.currentTarget);
          try {
            const ticket = await api<Ticket>(
              `/servers/${serverId}/tickets`,
              json("POST", {
                memberId: memberId || form.get("memberId") || undefined,
                clientId: nonce.current,
                ownerOnly: form.get("ownerOnly") !== "false",
                assigneeId: form.get("assigneeId") || undefined,
                category: form.get("category"),
                subject: form.get("subject"),
                content: form.get("content"),
              }),
            );
            await app.refresh();
            navigate(ticketPath(ticket));
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {community?.ownerId === app.user?.id ? (
          <p className="muted">{tr("adminProactivePrivacy")}</p>
        ) : (
          <TicketPrivacyChoice />
        )}
        {community && community.ownerId === app.user?.id && (
          <label>
            {tr("adminInitialAssignment")}
            <select name="assigneeId">
              <option value="">{tr("adminCommunityOwner")}</option>
              {community.members
                .filter(
                  (m) =>
                    m.ticketEligible &&
                    m.userId !== community.ownerId &&
                    m.userId !== memberId,
                )
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.displayName}
                  </option>
                ))}
            </select>
          </label>
        )}
        {community && community.ownerId === app.user?.id && !memberId && (
          <label>
            {tr("communityMembers")}
            <select name="memberId" required>
              <option value="">{tr("communityMembers")}</option>
              {community.members
                .filter((m) => m.userId !== community.ownerId)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.displayName}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          {tr("communityTicketCategory")}
          <select name="category">
            <option value="GENERAL">{tr("communityGeneral")}</option>
            <option value="SUPPORT">{tr("communitySupport")}</option>
            <option value="SAFETY">{tr("communitySafety")}</option>
          </select>
        </label>
        <label>
          {tr("communitySubject")}
          <input name="subject" required maxLength={120} autoFocus />
        </label>
        <label>
          {tr("communityFirstMessage")}
          <textarea name="content" required maxLength={4000} rows={4} />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {tr(busy ? "communitySubmitting" : "communityCreateTicket")}
        </button>
      </form>
    </Dialog>
  );
}
export function TicketsPage() {
  useLanguage();
  const { serverId } = useParams(),
    [params] = useSearchParams(),
    assigned = params.get("assigned") === "1",
    app = useApp(),
    [tickets, setTickets] = useState<Ticket[] | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [creating, setCreating] = useState(false),
    [retry, setRetry] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [paging, setPaging] = useState(false),
    [community, setCommunity] = useState<CommunityDetail | null>(null),
    [communityError, setCommunityError] = useState("");
  useEffect(() => {
    let live = true;
    setCommunityError("");
    api<CommunityDetail>(`/servers/${serverId}`)
      .then((v) => {
        if (live) {
          setCommunity(v);
          setCommunityError("");
        }
      })
      .catch((e) => {
        if (live) setCommunityError(e.message);
      });
    return () => {
      live = false;
    };
  }, [serverId, app.sync, retry]);
  useEffect(() => {
    setTickets(null);
  }, [serverId, query, status, assigned]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api<{ tickets: Ticket[]; cursor: string | null }>(
        `/servers/${serverId}/tickets?assigned=${assigned ? 1 : 0}&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`,
      )
        .then((v) => {
          if (live) {
            setTickets(v.tickets);
            setCursor(v.cursor);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [serverId, app.sync, app.conversations, query, status, retry, assigned]);
  if (!community || community.id !== serverId) {
    return (
      <section className="community-panel ticket-queue">
        <Link className="back-link" to={`/servers/${serverId}`}>
          {tr("communityBackChannels")}
        </Link>
        {communityError ? (
          <ErrorBox
            message={communityError}
            retry={() => setRetry((v) => v + 1)}
          />
        ) : (
          <Spinner />
        )}
      </section>
    );
  }
  return (
    <section className="community-panel ticket-queue">
      <Link className="back-link" to={`/servers/${serverId}`}>
        {tr("communityBackChannels")}
      </Link>
      <header>
        <h1>
          {tr(
            community?.role === "OWNER" || community?.role === "ADMIN"
              ? "communityTicketQueue"
              : "communityTickets",
          )}
        </h1>
        {community?.privateTicketsEnabled && (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            {tr("controlsNewTicket")}
          </button>
        )}
      </header>
      {community && !community.privateTicketsEnabled && (
        <p className="field-note">{tr("controlsExistingKept")}</p>
      )}
      {community &&
        community.role !== "OWNER" &&
        community.permissions.handleTickets && (
          <nav
            className="ticket-scope-filter"
            aria-label={tr("controlsFilterTickets")}
          >
            <Link
              className="btn btn-secondary"
              to={`/servers/${serverId}/tickets?assigned=0`}
              aria-current={!assigned ? "page" : undefined}
            >
              {tr("communityAll")}
            </Link>
            <Link
              className="btn btn-secondary"
              to={`/servers/${serverId}/tickets?assigned=1`}
              aria-current={assigned ? "page" : undefined}
            >
              {tr("controlsAssignedToMe")}
            </Link>
          </nav>
        )}
      <section className="ticket-filters" aria-label={tr("controlsFilterTickets")}>
        <div className="ticket-status-filter" role="group" aria-label={tr("communityStatus")}>
          {(["", "OPEN", "IN_PROGRESS", "CLOSED"] as const).map(value => (
            <button key={value} type="button" className="ticket-status-tab" aria-pressed={status === value} onClick={() => setStatus(value)}>
              {value ? statusText(value) : tr("communityAll")}
            </button>
          ))}
        </div>
        <label className="ticket-search">
          <span className="sr-only">{tr("communityFindTicket")}</span>
          <input type="search" value={query} maxLength={100} placeholder={tr("communityFindTicket")} onChange={e => setQuery(e.target.value)} />
        </label>
      </section>
      {!assigned && (!status || status === "OPEN") &&
        community?.role === "ADMIN" &&
        community.adminTicketClaimEnabled && (
          <ClaimableTickets serverId={serverId!} />
        )}

      {communityError || error ? (
        <ErrorBox
          message={communityError || error}
          retry={() => setRetry((v) => v + 1)}
        />
      ) : !tickets ? (
        <Spinner />
      ) : !tickets.length ? (
        <Empty
          title={tr("communityNoTickets")}
          description={tr("communityTicketEmpty")}
        />
      ) : (
        <div className="ticket-list">
          {tickets.map((t) => {
            const timestamp = t.lastActivityAt || t.updatedAt || t.createdAt;
            const preview = t.lastMessage;
            const summary = !preview ? tr("screen449") : preview.kind === "RETRACTED" ? tr("workbenchRetracted") : preview.content || (preview.kind === "IMAGE" ? tr("workbenchImage") : tr("workbenchFile"));
            return <Link key={t.id} to={ticketPath(t)} className={`ticket-row${t.unreadCount ? " has-unread" : ""}`}>
              <div className="ticket-row-main">
                <div className="ticket-row-heading"><span className="ticket-number">#{t.number}</span><strong>{t.subject}</strong></div>
                <p className="ticket-preview">{preview && preview.kind !== "RETRACTED" && <span>{preview.senderName}: </span>}{summary}</p>
                <div className="ticket-row-context">
                  <span>{t.member?.displayName || t.guestName || tr("controlsGuestBadge")}</span>
                  <span className="ticket-status" data-status={t.status}>{statusText(t.status)}</span>
                  {t.waitingFor && <span className="ticket-waiting" title={tr("workbenchWaitingHint")}>{tr(t.waitingFor === "STAFF" ? "workbenchWaitingStaff" : t.memberId === app.user?.id ? "workbenchWaitingYou" : "workbenchWaitingMember")}</span>}
                </div>
              </div>
              <div className="ticket-row-meta">
                <time dateTime={timestamp} title={tr("workbenchUpdated", { time: new Date(timestamp).toLocaleString(getLanguage()) })}>{new Date(timestamp).toLocaleString(getLanguage(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                <span className="ticket-assignee" title={tr("communityHandler")}>{t.assignee?.displayName || tr("adminCommunityOwner")}</span>
                {!!t.unreadCount && <span className="ticket-unread">{tr("workbenchUnread", { count: t.unreadCount })}</span>}
              </div>
            </Link>;
          })}
        </div>
      )}
      {cursor && tickets && (
        <button
          className="btn btn-secondary"
          disabled={paging}
          onClick={async () => {
            setPaging(true);
            try {
              const next = await api<{
                tickets: Ticket[];
                cursor: string | null;
              }>(
                `/servers/${serverId}/tickets?assigned=${assigned ? 1 : 0}&cursor=${cursor}&q=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`,
              );
              setTickets((v) => [...(v || []), ...next.tickets]);
              setCursor(next.cursor);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setPaging(false);
            }
          }}
        >
          {tr("communityMoreTickets")}
        </button>
      )}
      {creating && (
        <TicketCreate serverId={serverId!} onClose={() => setCreating(false)} />
      )}
    </section>
  );
}
export { TicketChat } from "./ticket-management";
interface BotInstall {
  id: string;
  botId: string;
  enabled: boolean;
  bot: { id: string; name: string; builtin?: boolean };
  channelIds?: string[];
  channels?: { channelId: string }[];
  config?: { welcome?: string; commands?: string[] };
  permissions: string[];
}
export function CommunityBots({ server }: { server: CommunityDetail }) {
  useLanguage();
  const changes = useFormChanges();
  const [installed, setInstalled] = useState<BotInstall[]>([]);
  const [catalog, setCatalog] = useState<{ id: string; name: string; builtin?: boolean }[]>([]);
  const [collection, setCollection] = useState<'installed' | 'available' | null>(null);
  const [botId, setBotId] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), inFlight = useRef(false);
  const [selected, setSelected] = useState<string[]>([]), [granted, setGranted] = useState(['SEND_MESSAGES', 'COMMANDS']);
  const [editing, setEditing] = useState<BotInstall | null>(null), [actions, setActions] = useState<BotInstall | null>(null);
  const [removing, setRemoving] = useState(false), [revision, setRevision] = useState(0), [ready, setReady] = useState(false), [installedNotice, setInstalledNotice] = useState(false);
  const name = (bot: { name: string; builtin?: boolean }) => bot.builtin ? tr('controlsWelcomeBot') : bot.name;
  useEffect(() => {
    let live = true;
    Promise.all([api<BotInstall[]>(`/servers/${server.id}/bots`), api<typeof catalog>('/bots/catalog')])
      .then(([items, available]) => {
        if (!live) return;
        setInstalled(items); setCatalog(available); setReady(true); setError('');
        setCollection(current => current || (items.length ? 'installed' : 'available'));
      }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [server.id, revision]);
  const resetForm = () => { setEditing(null); setSelected([]); setGranted(['SEND_MESSAGES', 'COMMANDS']); setBotId(''); changes.reset(); };
  const mutate = async (path: string, method: string, data?: unknown) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await api(path, json(method, data));
      setRevision(value => value + 1); resetForm(); setActions(null); setRemoving(false); setCollection('installed');
      setInstalledNotice(method === 'POST');
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const showCollection = collection || (installed.length ? 'installed' : 'available');
  const switchCollection = (next: 'installed' | 'available') => changes.request(() => { resetForm(); setCollection(next); setError(''); });
  return <section className="community-setting-section" id="community-bots" aria-busy={busy}>
    <h2>{tr('communityBots')}</h2><p className="muted">{tr('communityBotScopes')}</p>
    {error && !actions && <ErrorBox message={error} retry={!ready ? () => {setError('');setRevision(value => value + 1);} : undefined}/>}
    {!ready ? !error && <Spinner/> : <>
      <div className="bot-collection-tabs" role="group" aria-label={tr('communityBots')}>
        <button type="button" disabled={busy} aria-pressed={showCollection === 'installed'} onClick={() => switchCollection('installed')}>{tr('workspaceInstalledBots')} <span>{installed.length}</span></button>
        <button type="button" disabled={busy} aria-pressed={showCollection === 'available'} onClick={() => switchCollection('available')}>{tr('workspaceAvailableBots')}</button>
      </div>
      {installedNotice && showCollection === 'installed' && <p className="bot-install-result" role="status">{tr('workspaceBotInstalled')}</p>}
      {showCollection === 'installed' && !editing && <>
        {!installed.length && <Empty title={tr('communityNoBots')}><button className="btn btn-secondary" onClick={() => switchCollection('available')}>{tr('communityInstallBot')}</button></Empty>}
        {installed.map(item => <div className="community-bot-row" key={item.id}>
          <div className="bot-summary"><strong>{name(item.bot)}</strong><small>{tr(item.enabled ? 'communityEnabled' : 'communityDisabled')}</small><p>{server.channels.filter(channel => (item.channelIds || item.channels?.map(c => c.channelId) || []).includes(channel.id)).map(channel => `#${channel.conversation.name}`).join(' · ')}</p></div>
          <button className="icon-btn" disabled={busy} aria-label={tr('workspaceBotActions',{name:name(item.bot)})} aria-haspopup="dialog" onClick={() => { setActions(item);setRemoving(false);setError(''); }}><MoreHorizontal size={20}/></button>
        </div>)}
      </>}
      {(showCollection === 'available' || editing) && <form className="form-stack" key={editing?.id || 'install'} onChange={changes.changed} onSubmit={e => {
        e.preventDefault();
        if (!selected.length) {setError(tr('controlsChooseChannels'));return;}
        if (!editing && !botId) {setError(tr('controlsChooseBot'));return;}
        const values = new FormData(e.currentTarget);
        void mutate(`/servers/${server.id}/bots${editing ? `/${editing.id}` : ''}`,editing ? 'PATCH' : 'POST',{
          ...(!editing ? {botId} : {}), channelIds:selected, permissions:granted,
          config:{ welcome:values.get('welcome'), commands:String(values.get('commands') || '').split(',').map(value=>value.trim()).filter(Boolean) },
        });
      }}>
        <h3>{editing ? `${tr('communityConfigure')} · ${name(editing.bot)}` : tr('communityInstallBot')}</h3>
        {!editing && <>
          <label>{tr('communityCatalog')}<select name="catalog" disabled={busy} value={catalog.some(bot => bot.id === botId) ? botId : ''} onChange={e => setBotId(e.target.value)}><option value="">{tr('controlsChooseBot')}</option>{catalog.map(bot => <option key={bot.id} value={bot.id}>{name(bot)}</option>)}</select></label>
          <label>{tr('communityBotIdentity')}<input name="botId" disabled={busy} required value={botId} onChange={e => setBotId(e.target.value.trim())}/></label>
        </>}
        <div className="bot-form-fields">
          <fieldset disabled={busy}><legend>{tr('communityAllowedChannels')}</legend>{server.channels.filter(channel => !channel.archivedAt).map(channel => <label className="check-label" key={channel.id}><input type="checkbox" checked={selected.includes(channel.id)} onChange={e => setSelected(current => e.target.checked ? [...current,channel.id] : current.filter(id=>id!==channel.id))}/>{channel.conversation.name}</label>)}{!selected.length && <p className="field-note">{tr('controlsChooseChannels')}</p>}</fieldset>
          <fieldset disabled={busy}><legend>{tr('communityRequestedBotPermissions')}</legend>{(['SEND_MESSAGES','READ_MESSAGES','COMMANDS'] as const).map(permission => <label className="check-label" key={permission}><input type="checkbox" checked={granted.includes(permission)} onChange={e => setGranted(current => e.target.checked ? [...current,permission] : current.filter(value=>value!==permission))}/>{tr(permission === 'SEND_MESSAGES' ? 'communityBotSend' : permission === 'READ_MESSAGES' ? 'communityBotRead' : 'communityBotCommands')}</label>)}</fieldset>
        </div>
        <label>{tr('communityCustomCommands')}<input name="commands" disabled={busy} pattern="[a-z0-9_, -]*" defaultValue={editing?.config?.commands?.join(',') || 'ping'}/></label>
        <label>{tr('communityWelcomeText')}<textarea name="welcome" disabled={busy} maxLength={1000} rows={3} defaultValue={editing?.config?.welcome || tr('communityDefaultWelcome')}/></label>
        <div className="workspace-save-row"><button className="btn btn-primary" disabled={busy || (!!editing && !changes.dirty)}>{tr(busy ? 'communitySubmitting' : editing ? 'communitySave' : 'communityInstallBot')}</button>{editing && <button className="btn btn-secondary" disabled={busy} type="button" onClick={() => changes.request(resetForm)}>{tr('communityCancel')}</button>}{changes.notice}</div>
      </form>}
    </>}
    {actions && <Dialog className="bot-action-sheet" title={name(actions.bot)} onClose={() => {if(!busy){setActions(null);setRemoving(false);}}}>
      {removing ? <><p>{tr('workspaceRemoveBot',{name:name(actions.bot)})}</p><div className="dialog-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setRemoving(false)}>{tr('communityCancel')}</button><button className="btn btn-danger" disabled={busy} onClick={() => void mutate(`/servers/${server.id}/bots/${actions.id}`,'DELETE')}>{tr(busy ? 'communitySubmitting' : 'communityRemove')}</button></div></> : <div className="member-action-list">
        <button className="btn btn-secondary" disabled={busy} onClick={() => {setEditing(actions);setGranted([...actions.permissions]);setSelected(actions.channelIds || actions.channels?.map(channel => channel.channelId) || []);setActions(null);changes.reset();}}>{tr('communityConfigure')}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => void mutate(`/servers/${server.id}/bots/${actions.id}`,'PATCH',{enabled:!actions.enabled})}>{tr(actions.enabled ? 'communityDisable' : 'communityEnable')}</button>
        <p className="member-danger-label">{tr('workspaceDangerousActions')}</p><button className="btn btn-danger" disabled={busy} onClick={() => setRemoving(true)}>{tr('communityRemove')}</button>
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>}
    {changes.dialog}
  </section>;
}
export function CommunityIndex() {
  useLanguage();
  const app = useApp(),
    navigate = useNavigate(),
    [dialog, setDialog] = useState<"create" | "join" | null>(null);
  return (
    <section className="community-panel">
      <h1>{tr("communityCommunities")}</h1>
      <div className="community-quick-actions">
        <button className="btn btn-primary" onClick={() => setDialog("create")}>
          {tr("screen581")}
        </button>
        <button className="btn btn-secondary" onClick={() => setDialog("join")}>
          {tr("screen580")}
        </button>
      </div>
      {dialog && (
        <CommunityDialog
          join={dialog === "join"}
          onClose={() => setDialog(null)}
        />
      )}
      {!app.communities.length ? (
        <Empty
          title={tr("communityNoCommunities")}
          description={tr("communityChooseCommunity")}
        />
      ) : (
        <div className="ticket-list">
          {app.communities.map((s) => (
            <button
              className="ticket-row"
              key={s.id}
              onClick={() => navigate(`/servers/${s.id}`)}
            >
              <span>{s.name}</span>
              <small>
                {s._count?.members} · {tr("communityMembers")}
              </small>
            </button>
          ))}
        </div>
      )}
      <Link to="/chat">{tr("communityPrivateChats")}</Link>
    </section>
  );
}
