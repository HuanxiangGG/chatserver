import { getLanguage, translate as tr, useLanguage } from './i18n';
import { AdminReports } from './reports';
import { useTranslation } from './i18n';
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
  useLanguage();
  const t = useTranslation();
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
        title={tr('screen262')}
        description={tr('screen263')}
      />
    );
  return (
    <div className="page-scroll">
      <div className="page-content admin-page">
        <PageHeading
          eyebrow={tr('screen213')}
          title={tr('screen264')}
          description={tr('screen265')}
          action={
            <button className="btn btn-secondary" onClick={() => void load()}>
              <RefreshCw size={16} />
              {tr('screen266')}</button>
          }
        />
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div className="stats-grid">
              {[
                {
                  label: tr('screen267'),
                  value: stats?.users,
                  icon: <Users size={21} />,
                },
                {
                  label: tr('screen268'),
                  value: stats?.conversations,
                  icon: <MessageCircle size={21} />,
                },
                {
                  label: tr('screen269'),
                  value: stats?.messages,
                  icon: <FileText size={21} />,
                },
                {
                  label: tr('screen270'),
                  value: stats?.activeSessions,
                  icon: <Activity size={21} />,
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <span>{s.icon}</span>
                  <p>{s.label}</p>
                  <strong>{s.value?.toLocaleString(getLanguage()) || "0"}</strong>
                </div>
              ))}
            </div>
            <div className="admin-notice">
              <ShieldCheck size={18} />
              <p>
                {tr('screen271')}<strong>{user.displayName}</strong>{" "}
                {tr('screen272')}</p>
              <span>{stats?.bannedUsers || 0} {tr('screen273')}</span>
            </div>
            <div className="page-tabs"><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>{t("reportsTitle")}</button>
              <button
                className={tab === "users" ? "active" : ""}
                onClick={() => setTab("users")}
              >
                {tr('screen274')}</button>
              <button
                className={tab === "moderation" ? "active" : ""}
                onClick={() => setTab("moderation")}
              >
                {tr('screen275')}</button>
              <button
                className={tab === "actions" ? "active" : ""}
                onClick={() => setTab("actions")}
              >
                {tr('screen276')}</button>
            </div>
            {tab === "reports" && <AdminReports />}
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
                      placeholder={tr('screen277')}
                      aria-label={tr('screen278')}
                    />
                  </div>
                  <button className="btn btn-secondary btn-small">{tr('searchButton')}</button>
                  <span className="muted">{tr('screen279')}{users.length} {tr('screen280')}</span>
                </form>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{tr('screen281')}</th>
                        <th>{tr('screen282')}</th>
                        <th>{tr('screen283')}</th>
                        <th>{tr('screen284')}</th>
                        <th>{tr('screen285')}</th>
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
                          <td>{u.role === "ADMIN" ? tr('screen236') : tr('screen281')}</td>
                          <td>
                            {u.createdAt ? formatTime(u.createdAt, true) : "—"}
                          </td>
                          <td>
                            <span
                              className={`table-status ${u.banned ? "banned" : ""}`}
                            >
                              {u.banned ? tr('screen286') : tr('screen287')}
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
                              {u.banned ? tr('screen288') : tr('screen289')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {users.length === 0 && (
                    <Empty
                      title={tr('screen290')}
                      description={tr('screen291')}
                    />
                  )}
                </div>
              </>
            )}
            {tab === "moderation" && (
              <section className="settings-section moderation-section">
                <h2>{tr('screen292')}</h2>
                <p>
                  {tr('screen293')}</p>
                <form
                  className="form-stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      !window.confirm(
                        tr('screen294'),
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
                    }, tr('screen295'));
                    if (result) form.reset();
                    setBusy(false);
                  }}
                >
                  <label>
                    {tr('screen296')}<input
                      name="messageId"
                      required
                      maxLength={100}
                      placeholder={tr('screen297')}
                    />
                  </label>
                  <label>
                    {tr('screen298')}<textarea
                      name="reason"
                      required
                      minLength={3}
                      maxLength={500}
                      rows={3}
                      placeholder={tr('screen299')}
                    />
                  </label>
                  <button className="btn btn-danger" disabled={busy}>
                    <Trash2 size={16} />
                    {busy ? tr('auth58') : tr('screen300')}
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
                          {tr('screen301')}{a.actor?.displayName ||
                            a.admin?.displayName ||
                            tr('screen236')}{" "}
                          {tr('screen302')}<code>{a.targetId || "—"}</code>
                        </p>
                        <blockquote>{a.reason || tr('screen303')}</blockquote>
                      </div>
                    </article>
                  ))
                ) : (
                  <Empty
                    icon={<ShieldCheck size={29} />}
                    title={tr('screen304')}
                    description={tr('screen305')}
                  />
                )}
              </div>
            )}
          </>
        )}
        {banTarget && (
          <Dialog
            title={`${banTarget.banned ? tr('screen288') : tr('screen289')} ${banTarget.displayName}？`}
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
                        until: !banTarget.banned && Number(f.get("duration")) > 0 ? new Date(Date.now() + Number(f.get("duration"))).toISOString() : null,
                        reason: f.get("reason"),
                      }),
                    );
                    await load();
                    return true;
                  },
                  banTarget.banned
                    ? tr('screen306')
                    : tr('screen307'),
                );
                if (result) setBanTarget(null);
                setBusy(false);
              }}
            >
              {!banTarget.banned && <label>{t("banDuration")}<select name="duration"><option value="0">{t("banPermanent")}</option><option value="3600000">{t("banHour")}</option><option value="86400000">{t("banDay")}</option><option value="604800000">{t("banWeek")}</option></select></label>}
              <p className="muted">
                {banTarget.banned
                  ? tr('screen308')
                  : tr('screen309')}
              </p>
              <label>
                {tr('screen310')}<textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  placeholder={tr('screen311')}
                />
              </label>
              <button
                className={`btn ${banTarget.banned ? "btn-primary" : "btn-danger"}`}
                disabled={busy}
              >
                {busy ? tr('auth58') : tr('screen312')}
              </button>
            </form>
          </Dialog>
        )}
      </div>
    </div>
  );
}
