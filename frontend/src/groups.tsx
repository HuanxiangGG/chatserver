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
        title="无法打开群聊管理"
        description="群聊可能已解散，或你已不是群成员。"
      >
        <Link to="/chat" className="btn btn-secondary">
          返回消息
        </Link>
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
      title: `移出 ${m.user.displayName}？`,
      body: "移出后，这位成员将无法继续读取或发送群消息。",
      run: () => mutate(`/conversations/${id}/members/${m.userId}`, "DELETE"),
    });
  }
  return (
    <div className="page-scroll">
      <div className="page-content group-page">
        <Link className="back-link" to={`/chat/${id}`}>
          <ArrowLeft size={16} />
          返回聊天
        </Link>
        <PageHeading
          eyebrow="YOUR SHARED SPACE"
          title="群聊管理"
          description="给共同的空间，一点用心的照料。"
          action={
            manager && (
              <button
                className="btn btn-primary"
                onClick={() => setInviting(true)}
              >
                <UserPlus size={17} />
                邀请成员
              </button>
            )
          }
        />
        <div className="group-summary">
          <div className="group-avatar-edit">
            <Avatar
              user={{ displayName: g.name || "群聊", avatarUrl: g.avatarUrl }}
              group
              size="xl"
            />
            {manager && (
              <>
                <button
                  aria-label="上传群头像"
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
                      toast("群头像不能超过10MB", true);
                      return;
                    }
                    setBusy(true);
                    await task(async () => {
                      const data = new FormData();
                      data.append("file", file);
                      const uploaded = await api<Attachment>("/uploads", {
                        method: "POST",
                        body: data,
                      });
                      await mutate(`/conversations/${id}`, "PATCH", {
                        avatarUrl: `/api/uploads/${uploaded.id}`,
                      });
                    }, "群头像已更新");
                    setBusy(false);
                  }}
                />
              </>
            )}
          </div>
          <div>
            <h2>{g.name}</h2>
            <p>{g.description || "还没有群简介"}</p>
            <span className="pending-pill">
              <Users size={13} />
              {g.members.length} 位成员
            </span>
          </div>
          <span className="role-badge">
            {owner ? "你是群主" : manager ? "你是管理员" : "你是群成员"}
          </span>
        </div>
        {manager && (
          <section className="settings-section">
            <h2>基本信息</h2>
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
                  "群资料已更新",
                );
                setBusy(false);
              }}
            >
              <label>
                群名称
                <input
                  name="name"
                  defaultValue={g.name || ""}
                  required
                  maxLength={80}
                />
              </label>
              <label>
                群简介
                <textarea
                  name="description"
                  defaultValue={g.description || ""}
                  rows={2}
                  maxLength={500}
                />
              </label>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "保存中…" : "保存修改"}
              </button>
            </form>
          </section>
        )}
        <section className="settings-section">
          <div className="section-toolbar">
            <div>
              <h2>
                群成员 <span className="count-pill">{g.members.length}</span>
              </h2>
              <p>群主、管理员与成员，各司其职。</p>
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
                      {m.userId === user!.id && <small>（你）</small>}
                    </strong>
                  </Link>
                  <span>{statusText(m.user)}</span>
                </div>
                <span className={`member-role ${m.role.toLowerCase()}`}>
                  {m.role === "OWNER" ? (
                    <>
                      <Crown size={13} />
                      群主
                    </>
                  ) : m.role === "ADMIN" ? (
                    <>
                      <Shield size={13} />
                      管理员
                    </>
                  ) : (
                    "成员"
                  )}
                </span>
                {owner && m.userId !== user!.id && (
                  <div className="member-actions">
                    <select
                      value={m.role}
                      aria-label={`设置 ${m.user.displayName} 的权限`}
                      onChange={(e) =>
                        void task(
                          () =>
                            mutate(
                              `/conversations/${id}/members/${m.userId}`,
                              "PATCH",
                              { role: e.target.value },
                            ),
                          "成员权限已更新",
                        )
                      }
                    >
                      <option value="MEMBER">普通成员</option>
                      <option value="ADMIN">管理员</option>
                    </select>
                    <button
                      className="text-link"
                      onClick={() =>
                        setConfirm({
                          title: `转让群主给 ${m.user.displayName}？`,
                          body: "转让后，你将成为管理员，失去群主专属权限。此操作需新群主主动转回才能恢复。",
                          run: () =>
                            mutate(`/conversations/${id}/transfer`, "POST", {
                              userId: m.userId,
                            }),
                        })
                      }
                    >
                      转让群主
                    </button>
                  </div>
                )}
                {manager &&
                  m.userId !== user!.id &&
                  m.role !== "OWNER" &&
                  (owner || m.role === "MEMBER") && (
                    <button
                      className="icon-btn danger-subtle"
                      onClick={() => remove(m)}
                      aria-label={`移出 ${m.user.displayName}`}
                      title="移出成员"
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
            <h3>{owner ? "解散群聊" : "退出群聊"}</h3>
            <p>
              {owner
                ? "解散后，所有成员将无法再访问这个群聊。"
                : "退出后将无法访问群消息，需要再次被邀请才能加入。"}
            </p>
          </div>
          <button
            className="btn btn-danger-outline"
            onClick={() =>
              setConfirm({
                title: owner ? "确定解散这个群聊？" : "确定退出这个群聊？",
                body: owner
                  ? "这个操作无法撤销，所有成员将失去此群聊的访问权限。"
                  : "你可以由群管理员再次邀请加入。",
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
            {owner ? "解散群聊" : "退出群聊"}
          </button>
        </section>
        {inviting && (
          <Dialog title="邀请好友加入群聊" onClose={() => setInviting(false)}>
            <div className="form-stack">
              <p className="muted">
                选择要邀请的好友。只有你的好友可以被邀请。
              </p>
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
                  <p className="muted">没有可邀请的好友了。</p>
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
                  }, "已邀请好友加入");
                  setBusy(false);
                }}
              >
                邀请 {selected.length || ""} 位好友
              </button>
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
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const run = confirm.run;
                  setConfirm(null);
                  await task(run, "操作已完成");
                }}
              >
                确认
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
