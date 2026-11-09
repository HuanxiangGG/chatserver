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
      accept ? "你们已经是好友了" : "已拒绝好友申请",
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
          eyebrow="YOUR PEOPLE"
          title="好友"
          description="把重要的人，放在触手可及的地方。"
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
              添加好友
            </button>
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
            我的好友 <span>{friends.length}</span>
          </button>
          <button
            className={tab === "requests" ? "active" : ""}
            onClick={() => setTab("requests")}
          >
            好友申请
            {requests.incoming.length > 0 && (
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
            发现好友
          </button>
        </div>
        {tab === "friends" && (
          <>
            <div className="section-toolbar">
              <div className="search-input">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索好友昵称或用户名"
                  aria-label="搜索好友"
                />
              </div>
              <span className="muted">
                {friends.filter((f) => f.status !== "OFFLINE").length} 人在线
              </span>
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
                      {f.bio || "期待与你分享生活中的点滴。"}
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
                        aria-label={`删除好友 ${f.displayName}`}
                        title="删除好友"
                      >
                        <UserMinus size={17} />
                      </button>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => void start(f)}
                    >
                      <MessageCircle size={16} />
                      发送消息
                      <ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                icon={<Users size={30} />}
                title={query ? "没有匹配的好友" : "你的好友列表，等待新的相遇"}
                description={
                  query
                    ? "换个昵称或用户名试试看。"
                    : "搜索朋友的用户名，发送第一份好友邀请。"
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
                    发现好友 <ArrowUpRight size={16} />
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
                收到的申请 <span>{requests.incoming.length}</span>
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
                        <p>@{person?.username} 想成为你的好友</p>
                      </div>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => void respond(r.id, false)}
                      >
                        <X size={15} />
                        拒绝
                      </button>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => void respond(r.id, true)}
                      >
                        <Check size={15} />
                        接受
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="inline-empty">
                  <Check size={20} /> 暂时没有待处理的申请
                </div>
              )}
            </section>
            <section>
              <div className="section-label">
                发出的申请 <span>{requests.outgoing.length}</span>
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
                        等待回应
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="inline-empty">你还没有发出好友申请</div>
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
                <span className="eyebrow">SAY HELLO</span>
                <h2>找到你的朋友</h2>
                <p>输入用户名或昵称，开启一段新的连接。</p>
              </div>
              <div className="find-search">
                <Search size={20} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  required
                  minLength={2}
                  maxLength={64}
                  placeholder="搜索用户名或昵称，至少 2 个字符"
                  aria-label="搜索用户"
                />
                <button className="btn btn-primary" disabled={searching}>
                  {searching ? "搜索中…" : "搜索"}
                </button>
              </div>
            </form>
            {searching ? (
              <Spinner label="正在寻找…" />
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
                            @{u.username} · {u.bio || "来打个招呼吧"}
                          </p>
                        </div>
                        {friendIds.has(u.id) ? (
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => void start(u)}
                          >
                            发消息
                          </button>
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
                              }, "好友申请已发送")
                            }
                            disabled={requests.outgoing.some(
                              (r) => (r.to || r.receiver)?.id === u.id,
                            )}
                          >
                            <UserPlus size={15} />
                            {requests.outgoing.some(
                              (r) => (r.to || r.receiver)?.id === u.id,
                            )
                              ? "已申请"
                              : "添加好友"}
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              ) : (
                <Empty
                  icon={<Search size={28} />}
                  title="没有找到相关用户"
                  description="检查拼写，或试试其他用户名。"
                />
              )
            ) : (
              <div className="find-note">
                <ShieldCheck size={18} />
                <span>
                  只有接受好友申请后，才能开启私聊。你可以随时删除或屏蔽用户。
                </span>
              </div>
            )}
          </>
        )}
        {confirm && (
          <Dialog
            title={`删除好友 ${confirm.displayName}？`}
            onClose={() => setConfirm(null)}
          >
            <p className="muted">
              删除后如需继续私聊，你们需要重新添加好友。已有聊天记录会保留。
            </p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const target = confirm;
                  setConfirm(null);
                  await task(async () => {
                    await api(`/friends/${target.id}`, json("DELETE"));
                    await refresh();
                  }, "已删除好友");
                }}
              >
                删除好友
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
export function ProfilePage() {
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
      <Empty title="找不到这位用户">
        <Link to="/friends" className="btn btn-secondary">
          返回好友
        </Link>
      </Empty>
    );
  const person = profile;
  return (
    <div className="page-scroll">
      <div className="page-content profile-page">
        <Link to="/friends" className="back-link">
          <ArrowLeft size={16} />
          返回好友
        </Link>
        <PageHeading
          eyebrow="A LITTLE ABOUT YOU"
          title={own ? "个人资料" : "认识一下"}
          description={
            own ? "让朋友们更容易认出你。" : "每一段连接，从了解彼此开始。"
          }
        />
        <div className="profile-card">
          <div className="profile-cover">
            <div />
            <span>STAY CONNECTED.</span>
          </div>
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
                    aria-label="上传头像"
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
                      toast("头像不能超过 10 MB", true);
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
                  编辑资料 <ArrowUpRight size={15} />
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
                      }, "好友申请已发送");
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
                    ? "发送消息"
                    : "添加好友"}
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
                    toast("个人资料已更新");
                  }
                  setBusy(false);
                }}
              >
                <label>
                  显示名称
                  <input
                    name="displayName"
                    defaultValue={person.displayName}
                    required
                    minLength={1}
                    maxLength={50}
                  />
                </label>
                <label>
                  个人简介
                  <textarea
                    name="bio"
                    defaultValue={person.bio}
                    maxLength={500}
                    rows={3}
                    placeholder="分享一点关于你的事…"
                  />
                </label>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </button>
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? "正在保存…" : "保存修改"}
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
                  <span className="section-label">个人简介</span>
                  <p>{person.bio || "这里还没有留下介绍，先打个招呼吧。"}</p>
                </div>
                <div className="profile-facts">
                  <div>
                    <small>用户身份</small>
                    <span>
                      {person.role === "ADMIN" ? "站点管理员" : "泊岸用户"}
                    </span>
                  </div>
                  <div>
                    <small>连接方式</small>
                    <span>
                      {own
                        ? "这是你的个人空间"
                        : friends.some((f) => f.id === person.id)
                          ? "你们已是好友"
                          : "还不是好友"}
                    </span>
                  </div>
                </div>
                {!own && (
                  <div className="profile-block">
                    <button
                      className="text-danger"
                      onClick={() => setBlocking(true)}
                    >
                      屏蔽此用户
                    </button>
                    <span>屏蔽后将无法继续私聊</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {blocking && (
          <Dialog
            title={`屏蔽 ${person.displayName}？`}
            onClose={() => setBlocking(false)}
          >
            <p className="muted">
              将解除好友关系并阻止新的好友申请和私聊消息。可以在设置中解除屏蔽。
            </p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setBlocking(false)}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  setBlocking(false);
                  await task(async () => {
                    await api(`/blocks/${person.id}`, json("POST"));
                    await refresh();
                  }, "用户已屏蔽");
                }}
              >
                确认屏蔽
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
