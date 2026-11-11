import { CommunityIdentity } from './member-management';
import { translate as tr, useLanguage } from './i18n';
import { ReportButton } from './reports';
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  Clock,
  MessageCircle,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import type { Attachment, Conversation, User } from "./types";
import {
  Avatar,
  Dialog,
  Empty,
  PageHeading,
  Spinner,
  statusText,
  useTask,
} from "./ui";
export function FriendsPage() {
  useLanguage();
  const { friends, requests, refresh, user, toast } = useApp(),
    [tab, setTab] = useState<"friends" | "requests" | "find">("friends"),
    [query, setQuery] = useState(""),
    [found, setFound] = useState<User[]>([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(false),
    [confirm, setConfirm] = useState<User | null>(null),
    navigate = useNavigate(),
    task = useTask();
  const friendIds = new Set(friends.map((f) => f.id));
  async function start(u: User) {
    const c = await task(() =>
      api<Conversation>(
        "/conversations/direct",
        json("POST", { userId: u.id }),
      ),
    );
    if (c) {
      await refresh();
      navigate(`/chat/${c.id}`);
    }
  }
  async function respond(id: string, accept: boolean) {
    await task(
      async () => {
        await api(`/friend-requests/${id}/respond`, json("POST", { accept }));
        await refresh();
      },
      accept ? tr('screen515') : tr('screen516'),
    );
  }
  const visible = friends.filter((f) =>
    `${f.displayName} ${f.username}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="page-scroll">
      <div className="page-content">
        <PageHeading
          title={tr('screen341')}
          description={tr('screen517')}
          action={
            <button
              className="btn btn-primary"
              onClick={() => {
                setTab("find");
                setQuery("");
                setSearched(false);
              }}
            >
              <UserPlus size={17} />
              {tr('screen518')}</button>
          }
        />
        <div className="page-tabs">
          <button
            className={tab === "friends" ? "active" : ""}
            onClick={() => {
              setTab("friends");
              setQuery("");
            }}
          >
            {tr('screen519')}<span>{friends.length}</span>
          </button>
          <button
            className={tab === "requests" ? "active" : ""}
            onClick={() => setTab("requests")}
          >
            {tr('screen520')}{requests.incoming.length > 0 && (
              <span className="request-badge">{requests.incoming.length}</span>
            )}
          </button>
          <button
            className={tab === "find" ? "active" : ""}
            onClick={() => {
              setTab("find");
              setQuery("");
            }}
          >
            {tr('screen521')}</button>
        </div>
        {tab === "friends" && (
          <>
            <div className="section-toolbar">
              <div className="search-input">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr('screen522')}
                  aria-label={tr('screen523')}
                />
              </div>
              <span className="muted">
                {friends.filter((f) => f.status !== "OFFLINE").length} {tr('screen524')}</span>
            </div>
            {visible.length ? (
              <div className="people-grid">
                {visible.map((f) => (
                  <article className="person-card" key={f.id}>
                    <Link to={`/profile/${f.id}`} className="person-top">
                      <Avatar user={f} size="lg" showStatus />
                      <div>
                        <h3>{f.displayName}</h3>
                        <p>@{f.username}</p>
                      </div>
                    </Link>
                    <p className="person-bio">
                      {f.bio || tr('screen525')}
                    </p>
                    <div className="person-status">
                      <span
                        className={`status-inline ${f.status.toLowerCase()}`}
                      >
                        <i />
                        {statusText(f)}
                      </span>
                      <button
                        className="icon-btn danger-subtle"
                        onClick={() => setConfirm(f)}
                        aria-label={tr('screen526', {v0: f.displayName})}
                        title={tr('screen527')}
                      >
                        <UserMinus size={17} />
                      </button>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => void start(f)}
                    >
                      <MessageCircle size={16} />
                      {tr('screen479')}<ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                icon={<Users size={30} />}
                title={query ? tr('screen528') : tr('screen529')}
                description={
                  query
                    ? tr('screen530')
                    : tr('screen531')
                }
              >
                {!query && (
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setTab("find");
                      setSearched(false);
                    }}
                  >
                    {tr('screen521')}<ArrowUpRight size={16} />
                  </button>
                )}
              </Empty>
            )}
          </>
        )}
        {tab === "requests" && (
          <div className="request-sections">
            <section>
              <div className="section-label">
                {tr('screen532')}<span>{requests.incoming.length}</span>
              </div>
              {requests.incoming.length ? (
                requests.incoming.map((r) => {
                  const person = r.from || r.sender;
                  return (
                    <div className="request-row" key={r.id}>
                      <Avatar user={person} />
                      <div>
                        <Link to={`/profile/${person?.id}`}>
                          <strong>{person?.displayName}</strong>
                        </Link>
                        <p>@{person?.username} {tr('screen533')}</p>
                      </div>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => void respond(r.id, false)}
                      >
                        <X size={15} />
                        {tr('screen534')}</button>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => void respond(r.id, true)}
                      >
                        <Check size={15} />
                        {tr('screen535')}</button>
                    </div>
                  );
                })
              ) : (
                <div className="inline-empty">
                  <Check size={20} /> {tr('screen536')}</div>
              )}
            </section>
            <section>
              <div className="section-label">
                {tr('screen537')}<span>{requests.outgoing.length}</span>
              </div>
              {requests.outgoing.length ? (
                requests.outgoing.map((r) => {
                  const person = r.to || r.receiver;
                  return (
                    <div className="request-row" key={r.id}>
                      <Avatar user={person} />
                      <div>
                        <strong>{person?.displayName}</strong>
                        <p>@{person?.username}</p>
                      </div>
                      <span className="pending-pill">
                        <Clock size={13} />
                        {tr('screen538')}</span>
                    </div>
                  );
                })
              ) : (
                <div className="inline-empty">{tr('screen539')}</div>
              )}
            </section>
          </div>
        )}
        {tab === "find" && (
          <>
            <form
              className="find-panel"
              onSubmit={async (e) => {
                e.preventDefault();
                setSearching(true);
                try {
                  setFound(
                    await api<User[]>(`/users?q=${encodeURIComponent(query)}`),
                  );
                  setSearched(true);
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setSearching(false);
                }
              }}
            >
              <div>
                <h2>{tr('screen540')}</h2>
                <p>{tr('screen541')}</p>
              </div>
              <div className="find-search">
                <Search size={20} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  required
                  minLength={2}
                  maxLength={64}
                  placeholder={tr('screen542')}
                  aria-label={tr('screen278')}
                />
                <button className="btn btn-primary" disabled={searching}>
                  {searching ? tr('screen543') : tr('searchButton')}
                </button>
              </div>
            </form>
            {searching ? (
              <Spinner label={tr('screen544')} />
            ) : searched ? (
              found.filter((u) => u.id !== user!.id).length ? (
                <div className="search-results">
                  {found
                    .filter((u) => u.id !== user!.id)
                    .map((u) => (
                      <div className="request-row" key={u.id}>
                        <Link to={`/profile/${u.id}`}>
                          <Avatar user={u} />
                        </Link>
                        <div>
                          <Link to={`/profile/${u.id}`}>
                            <strong>{u.displayName}</strong>
                          </Link>
                          <p>
                            @{u.username} · {u.bio || tr('screen545')}
                          </p>
                        </div>
                        {friendIds.has(u.id) ? (
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => void start(u)}
                          >
                            {tr('screen546')}</button>
                        ) : (
                          <button
                            className="btn btn-primary btn-small"
                            onClick={() =>
                              void task(async () => {
                                await api(
                                  "/friend-requests",
                                  json("POST", { userId: u.id }),
                                );
                                await refresh();
                              }, tr('screen547'))
                            }
                            disabled={requests.outgoing.some(
                              (r) => (r.to || r.receiver)?.id === u.id,
                            )}
                          >
                            <UserPlus size={15} />
                            {requests.outgoing.some(
                              (r) => (r.to || r.receiver)?.id === u.id,
                            )
                              ? tr('screen548')
                              : tr('screen518')}
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              ) : (
                <Empty
                  icon={<Search size={28} />}
                  title={tr('screen290')}
                  description={tr('screen549')}
                />
              )
            ) : (
              <div className="find-note">
                <ShieldCheck size={18} />
                <span>
                  {tr('screen550')}</span>
              </div>
            )}
          </>
        )}
        {confirm && (
          <Dialog
            title={tr('screen551', {v0: confirm.displayName})}
            onClose={() => setConfirm(null)}
          >
            <p className="muted">
              {tr('screen552')}</p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setConfirm(null)}
              >
                {tr('cancel')}</button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const target = confirm;
                  setConfirm(null);
                  await task(async () => {
                    await api(`/friends/${target.id}`, json("DELETE"));
                    await refresh();
                  }, tr('screen553'));
                }}
              >
                {tr('screen527')}</button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
export function ProfilePage() {
  useLanguage();
  const { id } = useParams(),
    { user, reloadUser, refresh, friends, toast } = useApp(),
    [profile, setProfile] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState(false),
    [avatar, setAvatar] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [blocking, setBlocking] = useState(false),
    file = useRef<HTMLInputElement>(null),
    navigate = useNavigate(),
    task = useTask(),
    own = !id || id === user!.id;
  useEffect(() => {
    setLoading(true);
    setEditing(false);
    if (own) {
      setProfile(user);
      setLoading(false);
    } else
      api<User>(`/users/${id}`)
        .then(setProfile)
        .catch((e) => toast(e.message, true))
        .finally(() => setLoading(false));
  }, [id, user, own, toast]);
  if (loading) return <Spinner />;
  if (!profile)
    return (
      <Empty title={tr('screen554')}>
        <Link to="/friends" className="btn btn-secondary">
          {tr('screen555')}</Link>
      </Empty>
    );
  const person = profile;
  return (
    <div className="page-scroll">
      <div className="page-content profile-page"><CommunityIdentity userId={person.id}/>{!own && <ReportButton targetType="USER" targetId={profile.id} />}
        <Link to="/friends" className="back-link">
          <ArrowLeft size={16} />
          {tr('screen555')}</Link>
        <PageHeading
          title={own ? tr('screen351') : tr('screen556')}
          description={
            own ? tr('screen557') : tr('screen558')
          }
        />
        <div className="profile-card">
          <div className="profile-card-content">
            <div className="profile-avatar-row">
              <div className="editable-avatar">
                <Avatar
                  user={{
                    ...person,
                    avatarUrl:
                      editing && avatar !== null ? avatar : person.avatarUrl,
                  }}
                  size="xl"
                />
                {own && editing && (
                  <button
                    aria-label={tr('screen559')}
                    onClick={() => file.current?.click()}
                  >
                    <Camera size={16} />
                  </button>
                )}
                <input
                  hidden
                  ref={file}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 10 * 1024 * 1024) {
                      toast(tr('screen560'), true);
                      return;
                    }
                    setBusy(true);
                    const data = new FormData();
                    data.append("file", f);
                    const a = await task(() =>
                      api<Attachment>("/uploads", {
                        method: "POST",
                        body: data,
                      }),
                    );
                    if (a) setAvatar(`/api/uploads/${a.id}`);
                    setBusy(false);
                  }}
                />
              </div>
              {own && !editing && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setAvatar(person.avatarUrl);
                    setEditing(true);
                  }}
                >
                  {tr('screen378')}<ArrowUpRight size={15} />
                </button>
              )}
              {!own && (
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    if (!friends.some((f) => f.id === person.id)) {
                      await task(async () => {
                        await api(
                          "/friend-requests",
                          json("POST", { userId: person.id }),
                        );
                        await refresh();
                      }, tr('screen547'));
                    } else {
                      const c = await task(() =>
                        api<Conversation>(
                          "/conversations/direct",
                          json("POST", { userId: person.id }),
                        ),
                      );
                      if (c) {
                        await refresh();
                        navigate(`/chat/${c.id}`);
                      }
                    }
                  }}
                >
                  {friends.some((f) => f.id === person.id) ? (
                    <MessageCircle size={16} />
                  ) : (
                    <UserPlus size={16} />
                  )}{" "}
                  {friends.some((f) => f.id === person.id)
                    ? tr('screen479')
                    : tr('screen518')}
                </button>
              )}
            </div>
            {editing ? (
              <form
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  const data = new FormData(e.currentTarget);
                  const result = await task(() =>
                    api<User>(
                      "/users/me",
                      json("PATCH", {
                        displayName: data.get("displayName"),
                        bio: data.get("bio"),
                        avatarUrl: avatar,
                      }),
                    ),
                  );
                  if (result) {
                    await reloadUser();
                    await refresh();
                    setEditing(false);
                    toast(tr('screen561'));
                  }
                  setBusy(false);
                }}
              >
                <label>
                  {tr('auth36')}<input
                    name="displayName"
                    defaultValue={person.displayName}
                    required
                    minLength={1}
                    maxLength={50}
                  />
                </label>
                <label>
                  {tr('screen562')}<textarea
                    name="bio"
                    defaultValue={person.bio}
                    maxLength={500}
                    rows={3}
                    placeholder={tr('screen563')}
                  />
                </label>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditing(false)}
                  >
                    {tr('cancel')}</button>
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? tr('screen564') : tr('screen231')}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h1 className="profile-name">
                  {person.displayName}
                  <span
                    className={`status-inline ${person.status.toLowerCase()}`}
                  >
                    <i />
                    {statusText(person)}
                  </span>
                </h1>
                <p className="profile-username">@{person.username}</p>
                <div className="profile-detail">
                  <span className="section-label">{tr('screen562')}</span>
                  <p>{person.bio || tr('screen565')}</p>
                </div>
                <div className="profile-facts">
                  <div>
                    <small>{tr('screen566')}</small>
                    <span>
                      {person.role === "ADMIN" ? tr('screen567') : tr('screen568')}
                    </span>
                  </div>
                  <div>
                    <small>{tr('screen569')}</small>
                    <span>
                      {own
                        ? tr('screen570')
                        : friends.some((f) => f.id === person.id)
                          ? tr('screen571')
                          : tr('screen572')}
                    </span>
                  </div>
                </div>
                {!own && (
                  <div className="profile-block">
                    <button
                      className="text-danger"
                      onClick={() => setBlocking(true)}
                    >
                      {tr('screen573')}</button>
                    <span>{tr('screen574')}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {blocking && (
          <Dialog
            title={tr('screen575', {v0: person.displayName})}
            onClose={() => setBlocking(false)}
          >
            <p className="muted">
              {tr('screen576')}</p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setBlocking(false)}
              >
                {tr('cancel')}</button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  setBlocking(false);
                  await task(async () => {
                    await api(`/blocks/${person.id}`, json("POST"));
                    await refresh();
                  }, tr('screen577'));
                }}
              >
                {tr('screen578')}</button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
