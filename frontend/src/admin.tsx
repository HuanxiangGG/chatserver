import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Ban,
  Check,
  FileText,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import type { AuditAction, User } from "./types";
import {
  Avatar,
  Dialog,
  Empty,
  PageHeading,
  Spinner,
  formatTime,
  useTask,
} from "./ui";
type Stats = {
  users: number;
  conversations: number;
  messages: number;
  activeSessions: number;
  bannedUsers: number;
};
export function AdminPage() {
  const { user, toast } = useApp(),
    [stats, setStats] = useState<Stats | null>(null),
    [users, setUsers] = useState<User[]>([]),
    [actions, setActions] = useState<(AuditAction & { actor?: User })[]>([]),
    [tab, setTab] = useState("users"),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [banTarget, setBanTarget] = useState<User | null>(null),
    [busy, setBusy] = useState(false),
    task = useTask();
  const load = useCallback(async () => {
    try {
      const [s, u, a] = await Promise.all([
        api<Stats>("/admin/stats"),
        api<User[]>(`/admin/users?q=${encodeURIComponent(query)}`),
        api<(AuditAction & { actor?: User })[]>("/admin/actions"),
      ]);
      setStats(s);
      setUsers(u);
      setActions(a);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [query, toast]);
  useEffect(() => {
    if (user?.role === "ADMIN") void load();
  }, [user?.role]);
  if (user?.role !== "ADMIN")
    return (
      <Empty
        icon={<ShieldCheck size={30} />}
        title="仅管理员可访问"
        description="请使用管理员账号登录后继续。"
      />
    );
  return (
    <div className="page-scroll">
      <div className="page-content admin-page">
        <PageHeading
          eyebrow="泊岸 · 你的交流空间"
          title="管理后台"
          description="维护友善的交流空间。每一次管理操作，都有迹可循。"
          action={
            <button className="btn btn-secondary" onClick={() => void load()}>
              <RefreshCw size={16} />
              刷新数据
            </button>
          }
        />
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="stats-grid">
              {[
                {
                  label: "注册用户",
                  value: stats?.users,
                  icon: <Users size={21} />,
                },
                {
                  label: "会话总数",
                  value: stats?.conversations,
                  icon: <MessageCircle size={21} />,
                },
                {
                  label: "消息总数",
                  value: stats?.messages,
                  icon: <FileText size={21} />,
                },
                {
                  label: "活跃登录会话",
                  value: stats?.activeSessions,
                  icon: <Activity size={21} />,
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <span>{s.icon}</span>
                  <p>{s.label}</p>
                  <strong>{s.value?.toLocaleString() || "0"}</strong>
                </div>
              ))}
            </div>
            <div className="admin-notice">
              <ShieldCheck size={18} />
              <p>
                当前以 <strong>{user.displayName}</strong>{" "}
                的管理员身份操作。封禁与内容删除会记录操作人、目标、原因和时间。
              </p>
              <span>{stats?.bannedUsers || 0} 个封禁账号</span>
            </div>
            <div className="page-tabs">
              <button
                className={tab === "users" ? "active" : ""}
                onClick={() => setTab("users")}
              >
                用户管理
              </button>
              <button
                className={tab === "moderation" ? "active" : ""}
                onClick={() => setTab("moderation")}
              >
                消息管理
              </button>
              <button
                className={tab === "actions" ? "active" : ""}
                onClick={() => setTab("actions")}
              >
                操作日志
              </button>
            </div>
            {tab === "users" && (
              <>
                <form
                  className="section-toolbar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void load();
                  }}
                >
                  <div className="search-input">
                    <Search size={17} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      maxLength={64}
                      placeholder="搜索用户名或昵称"
                      aria-label="搜索用户"
                    />
                  </div>
                  <button className="btn btn-secondary btn-small">搜索</button>
                  <span className="muted">显示 {users.length} 位用户</span>
                </form>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>用户</th>
                        <th>身份</th>
                        <th>注册时间</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <div className="table-user">
                              <Avatar user={u} size="sm" />
                              <div>
                                <strong>{u.displayName}</strong>
                                <small>@{u.username}</small>
                              </div>
                            </div>
                          </td>
                          <td>{u.role === "ADMIN" ? "管理员" : "用户"}</td>
                          <td>
                            {u.createdAt ? formatTime(u.createdAt, true) : "—"}
                          </td>
                          <td>
                            <span
                              className={`table-status ${u.banned ? "banned" : ""}`}
                            >
                              {u.banned ? "已封禁" : "正常"}
                            </span>
                          </td>
                          <td>
                            <button
                              className={`btn btn-small ${u.banned ? "btn-secondary" : "btn-danger-outline"}`}
                              disabled={u.role === "ADMIN"}
                              onClick={() => setBanTarget(u)}
                            >
                              {u.banned ? (
                                <Check size={14} />
                              ) : (
                                <Ban size={14} />
                              )}{" "}
                              {u.banned ? "解除封禁" : "封禁"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {users.length === 0 && (
                    <Empty
                      title="没有找到相关用户"
                      description="试试其他用户名。"
                    />
                  )}
                </div>
              </>
            )}
            {tab === "moderation" && (
              <section className="settings-section moderation-section">
                <h2>删除违规消息</h2>
                <p>
                  填写消息 ID
                  与处理原因。删除后所有会话成员都无法再查看消息内容。
                </p>
                <form
                  className="form-stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      !window.confirm(
                        "确认删除这条消息？操作将记录到管理员日志。",
                      )
                    )
                      return;
                    const form = e.currentTarget,
                      values = new FormData(form);
                    setBusy(true);
                    const result = await task(async () => {
                      await api(
                        `/admin/messages/${encodeURIComponent(String(values.get("messageId")))}`,
                        json("DELETE", { reason: values.get("reason") }),
                      );
                      await load();
                      return true;
                    }, "消息已删除，操作日志已记录");
                    if (result) form.reset();
                    setBusy(false);
                  }}
                >
                  <label>
                    消息 ID
                    <input
                      name="messageId"
                      required
                      maxLength={100}
                      placeholder="粘贴需要处理的消息 ID"
                    />
                  </label>
                  <label>
                    处理原因
                    <textarea
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      rows={3}
                      placeholder="记录核实情况和处理原因，至少 3 个字符"
                    />
                  </label>
                  <button className="btn btn-danger" disabled={busy}>
                    <Trash2 size={16} />
                    {busy ? "正在处理…" : "删除消息并记录日志"}
                  </button>
                </form>
              </section>
            )}
            {tab === "actions" && (
              <div className="audit-list">
                {actions.length ? (
                  actions.map((a) => (
                    <article className="audit-row" key={a.id}>
                      <span className="audit-icon">
                        <ShieldCheck size={19} />
                      </span>
                      <div>
                        <h3>
                          {a.action}
                          <span>{formatTime(a.createdAt, true)}</span>
                        </h3>
                        <p>
                          操作人：
                          {a.actor?.displayName ||
                            a.admin?.displayName ||
                            "管理员"}{" "}
                          · 目标：<code>{a.targetId || "—"}</code>
                        </p>
                        <blockquote>{a.reason || "未填写原因"}</blockquote>
                      </div>
                    </article>
                  ))
                ) : (
                  <Empty
                    icon={<ShieldCheck size={29} />}
                    title="暂时没有管理操作"
                    description="封禁和删除消息等操作会出现在这里。"
                  />
                )}
              </div>
            )}
          </>
        )}
        {banTarget && (
          <Dialog
            title={`${banTarget.banned ? "解除封禁" : "封禁"} ${banTarget.displayName}？`}
            onClose={() => setBanTarget(null)}
          >
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                const result = await task(
                  async () => {
                    await api(
                      `/admin/users/${banTarget.id}/ban`,
                      json("POST", {
                        banned: !banTarget.banned,
                        reason: f.get("reason"),
                      }),
                    );
                    await load();
                    return true;
                  },
                  banTarget.banned
                    ? "已解除封禁"
                    : "用户已封禁并退出所有登录会话",
                );
                if (result) setBanTarget(null);
                setBusy(false);
              }}
            >
              <p className="muted">
                {banTarget.banned
                  ? "解除后用户可以重新登录。"
                  : "封禁后用户会退出所有设备，并无法继续登录。"}
              </p>
              <label>
                操作原因
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  placeholder="至少 3 个字符，将写入操作日志"
                />
              </label>
              <button
                className={`btn ${banTarget.banned ? "btn-primary" : "btn-danger"}`}
                disabled={busy}
              >
                {busy ? "正在处理…" : "确认并记录日志"}
              </button>
            </form>
          </Dialog>
        )}
      </div>
    </div>
  );
}
