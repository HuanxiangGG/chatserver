import { translate as tr, useLanguage } from './i18n';
import { ReportButton } from './reports';
import { GroupModerationPanel } from './group-moderation';
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  Crown,
  LogOut,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import type { Attachment, Conversation, Member } from "./types";
import {
  Avatar,
  Dialog,
  Empty,
  PageHeading,
  Spinner,
  statusText,
  useTask,
} from "./ui";
export function GroupPage() {
  useLanguage();
  const { id } = useParams(),
    { user, friends, refresh, toast } = useApp(),
    [group, setGroup] = useState<Conversation | null>(null),
    [loading, setLoading] = useState(true),
    [inviting, setInviting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      body: string;
      run: () => Promise<void>;
    } | null>(null),
    avatarInput = useRef<HTMLInputElement>(null),
    task = useTask(),
    navigate = useNavigate();
  const load = useCallback(async () => {
    if (!id) return;
    try {
      setGroup(await api<Conversation>(`/conversations/${id}`));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [id, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <Spinner />;
  if (!group || group.type !== "GROUP")
    return (
      <Empty
        icon={<Users size={29} />}
        title={tr('screen207')}
        description={tr('screen208')}
      >
        <Link to="/chat" className="btn btn-secondary">
          {tr('screen209')}</Link>
      </Empty>
    );
  const g = group,
    membership = g.members.find((m) => m.userId === user!.id),
    owner = membership?.role === "OWNER",
    manager = owner || membership?.role === "ADMIN",
    available = friends.filter(
      (f) => !g.members.some((m) => m.userId === f.id),
    );
  async function mutate(path: string, method: string, data?: unknown) {
    await api(path, json(method, data));
    await load();
    await refresh();
  }
  function remove(m: Member) {
    setConfirm({
      title: tr('screen210', {v0: m.user.displayName}),
      body: tr('screen211'),
      run: () => mutate(`/conversations/${id}/members/${m.userId}`, "DELETE"),
    });
  }
  return (
    <div className="page-scroll">
      <div className="page-content group-page">
        <Link className="back-link" to={`/chat/${id}`}>
          <ArrowLeft size={16} />
          {tr('screen212')}</Link>
        <PageHeading
          eyebrow={tr('screen213')}
          title={tr('screen214')}
          description={tr('screen215')}
          action={
            manager && (
              <button
                className="btn btn-primary"
                onClick={() => setInviting(true)}
              >
                <UserPlus size={17} />
                {tr('screen216')}</button>
            )
          }
        />
        <ReportButton targetType="GROUP" targetId={g.id} /><GroupModerationPanel conversation={g} />
        <div className="group-summary">
          <div className="group-avatar-edit">
            <Avatar
              user={{ displayName: g.name || tr('screen217'), avatarUrl: g.avatarUrl }}
              group
              size="xl"
            />
            {manager && (
              <>
                <button
                  aria-label={tr('screen218')}
                  onClick={() => avatarInput.current?.click()}
                  disabled={busy}
                >
                  <Camera size={16} />
                </button>
                <input
                  ref={avatarInput}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) {
                      toast(tr('screen219'), true);
                      return;
                    }
                    setBusy(true);
                    await task(async () => {
                      const data = new FormData();
                      data.append("file", file);
                      const uploaded = await api<Attachment>(`/uploads?conversationId=${encodeURIComponent(g.id)}`, {
                        method: "POST",
                        body: data,
                      });
                      await mutate(`/conversations/${id}`, "PATCH", {
                        avatarUrl: `/api/uploads/${uploaded.id}`,
                      });
                    }, tr('screen220'));
                    setBusy(false);
                  }}
                />
              </>
            )}
          </div>
          <div>
            <h2>{g.name}</h2>
            <p>{g.description || tr('screen221')}</p>
            <span className="pending-pill">
              <Users size={13} />
              {g.members.length} {tr('screen222')}</span>
          </div>
          <span className="role-badge">
            {owner ? tr('screen223') : manager ? tr('screen224') : tr('screen225')}
          </span>
        </div>
        {manager && (
          <section className="settings-section">
            <h2>{tr('screen226')}</h2>
            <form
              className="form-stack group-edit-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                await task(
                  () =>
                    mutate(`/conversations/${id}`, "PATCH", {
                      name: f.get("name"),
                      description: f.get("description"),
                    }),
                  tr('screen227'),
                );
                setBusy(false);
              }}
            >
              <label>
                {tr('screen228')}<input
                  name="name"
                  defaultValue={g.name || ""}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                {tr('screen229')}<textarea
                  name="description"
                  defaultValue={g.description || ""}
                  rows={2}
                  maxLength={500}
                />
              </label>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? tr('screen230') : tr('screen231')}
              </button>
            </form>
          </section>
        )}
        <section className="settings-section">
          <div className="section-toolbar">
            <div>
              <h2>
                {tr('screen232')}<span className="count-pill">{g.members.length}</span>
              </h2>
              <p>{tr('screen233')}</p>
            </div>
          </div>
          <div className="member-table">
            {g.members.map((m) => (
              <div className="group-member-row" key={m.userId}>
                <Link to={`/profile/${m.userId}`}>
                  <Avatar user={m.user} size="sm" showStatus />
                </Link>
                <div className="member-name">
                  <Link to={`/profile/${m.userId}`}>
                    <strong>
                      {m.user.displayName}
                      {m.userId === user!.id && <small>{tr('screen234')}</small>}
                    </strong>
                  </Link>
                  <span>{statusText(m.user)}</span>
                </div>
                <span className={`member-role ${m.role.toLowerCase()}`}>
                  {m.role === "OWNER" ? (
                    <>
                      <Crown size={13} />
                      {tr('screen235')}</>
                  ) : m.role === "ADMIN" ? (
                    <>
                      <Shield size={13} />
                      {tr('screen236')}</>
                  ) : (
                    tr('screen237')
                  )}
                </span>
                {owner && m.userId !== user!.id && (
                  <div className="member-actions">
                    <select
                      value={m.role}
                      aria-label={tr('screen238', {v0: m.user.displayName})}
                      onChange={(e) =>
                        void task(
                          () =>
                            mutate(
                              `/conversations/${id}/members/${m.userId}`,
                              "PATCH",
                              { role: e.target.value },
                            ),
                          tr('screen239'),
                        )
                      }
                    >
                      <option value="MEMBER">{tr('screen240')}</option>
                      <option value="ADMIN">{tr('screen236')}</option>
                    </select>
                    <button
                      className="text-link"
                      onClick={() =>
                        setConfirm({
                          title: tr('screen241', {v0: m.user.displayName}),
                          body: tr('screen242'),
                          run: () =>
                            mutate(`/conversations/${id}/transfer`, "POST", {
                              userId: m.userId,
                            }),
                        })
                      }
                    >
                      {tr('screen243')}</button>
                  </div>
                )}
                {manager &&
                  m.userId !== user!.id &&
                  m.role !== "OWNER" &&
                  (owner || m.role === "MEMBER") && (
                    <button
                      className="icon-btn danger-subtle"
                      onClick={() => remove(m)}
                      aria-label={tr('screen244', {v0: m.user.displayName})}
                      title={tr('screen245')}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
              </div>
            ))}
          </div>
        </section>
        <section className="group-danger">
          <div>
            <h3>{owner ? tr('screen246') : tr('screen247')}</h3>
            <p>
              {owner
                ? tr('screen248')
                : tr('screen249')}
            </p>
          </div>
          <button
            className="btn btn-danger-outline"
            onClick={() =>
              setConfirm({
                title: owner ? tr('screen250') : tr('screen251'),
                body: owner
                  ? tr('screen252')
                  : tr('screen253'),
                run: async () => {
                  await api(
                    owner
                      ? `/conversations/${id}`
                      : `/conversations/${id}/members/${user!.id}`,
                    json("DELETE"),
                  );
                  await refresh();
                  navigate("/chat");
                },
              })
            }
          >
            {owner ? <Trash2 size={16} /> : <LogOut size={16} />}{" "}
            {owner ? tr('screen246') : tr('screen247')}
          </button>
        </section>
        {inviting && (
          <Dialog title={tr('screen254')} onClose={() => setInviting(false)}>
            <div className="form-stack">
              <p className="muted">
                {tr('screen255')}</p>
              <div className="pick-list">
                {available.length ? (
                  available.map((f) => (
                    <button
                      type="button"
                      className={`pick-row ${selected.includes(f.id) ? "selected" : ""}`}
                      key={f.id}
                      onClick={() =>
                        setSelected((old) =>
                          old.includes(f.id)
                            ? old.filter((uid) => uid !== f.id)
                            : [...old, f.id],
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
                  <p className="muted">{tr('screen256')}</p>
                )}
              </div>
              <button
                className="btn btn-primary"
                disabled={!selected.length || busy}
                onClick={async () => {
                  setBusy(true);
                  await task(async () => {
                    await mutate(`/conversations/${id}/members`, "POST", {
                      userIds: selected,
                    });
                    setInviting(false);
                    setSelected([]);
                  }, tr('screen257'));
                  setBusy(false);
                }}
              >
                {tr('screen258')}{selected.length || ""} {tr('screen259')}</button>
            </div>
          </Dialog>
        )}
        {confirm && (
          <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
            <p className="muted">{confirm.body}</p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setConfirm(null)}
              >
                {tr('cancel')}</button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const run = confirm.run;
                  setConfirm(null);
                  await task(run, tr('screen260'));
                }}
              >
                {tr('screen261')}</button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
