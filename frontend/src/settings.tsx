import { AppearanceSettings } from './appearance';
import { translate as tr, useLanguage } from './i18n';
import { NotificationSettings } from './notification-ui';
import { SoundSettingsPanel } from './sound-ui';
import { useSendShortcut } from './send-preference';
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Ban,
  ChevronRight,
  KeyRound,
  LogOut,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { api, json, ApiError } from "./api";
import { useApp } from "./state";
import type { User } from "./types";
import { Avatar, Dialog, Empty, ErrorBox, PageHeading, Spinner, useTask } from "./ui";
export function SettingsPage() {
  useLanguage();
  const [sendShortcut, setSendShortcut] = useSendShortcut();
  const { user, reloadUser, socket, logout, toast } = useApp(),
    [blocks, setBlocks] = useState<User[]>([]),
    [blocksLoaded, setBlocksLoaded] = useState(false),
    [blocksLoading, setBlocksLoading] = useState(true),
    [blocksError, setBlocksError] = useState<{ message: string; invalidResponse: boolean } | null>(null),
    [blocksRevision, setBlocksRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [changePassword, setChangePassword] = useState(false),
    [confirmLogout, setConfirmLogout] = useState(false),
    task = useTask();
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setBlocksLoading(true);
    setBlocksError(null);
    void api<User[]>("/blocks", { signal: controller.signal })
      .then(value => {
        if (!Array.isArray(value)) throw new ApiError(tr('apiUnreadableResponse'), 200, 'INVALID_RESPONSE');
        if (current) { setBlocks(value); setBlocksLoaded(true); }
      })
      .catch((e) => { if (current) setBlocksError({ message: e.message, invalidResponse: e instanceof ApiError && e.code === 'INVALID_RESPONSE' }); })
      .finally(() => { if (current) setBlocksLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [blocksRevision]);
  async function status(value: "ONLINE" | "BUSY") {
    const result = await task(() =>
      api<User>("/users/me", json("PATCH", { status: value })),
    );
    if (result) {
      socket?.emit("presence:set", { status: value });
      await reloadUser();
    }
  }
  return (
    <div className="page-scroll">
      <div className="page-content settings-page">
        <PageHeading
          title={tr('screen349')}
          description={tr('screen367')}
        />
        <div className="settings-grid">
          <nav className="settings-nav" aria-label={tr('screen368')}>
            <a href="#account">
              <UserRound size={17} />
              {tr('screen369')}</a>
            <a href="#appearance">
              <Sun size={17} />
              {tr('screen370')}</a>
            <a href="#security">
              <ShieldCheck size={17} />
              {tr('screen371')}</a>
            <a href="#blocked">
              <Ban size={17} />
              {tr('screen372')}<span>{blocksLoaded ? blocks.length : '—'}</span>
            </a>
          </nav>
          <div className="settings-main"><SoundSettingsPanel /><NotificationSettings />
            <section className="settings-section"><h2>{tr('screen373')}</h2><label>{tr('screen374')}<select value={sendShortcut} onChange={e => setSendShortcut(e.target.value === "modifier" ? "modifier" : "enter")}><option value="enter">{tr('screen375')}</option><option value="modifier">{tr('screen376')}</option></select></label></section>
            <section className="settings-section" id="account">
              <h2>{tr('screen369')}</h2>
              <p>{tr('screen377')}</p>
              <Link to="/profile" className="settings-profile">
                <Avatar user={user} size="lg" />
                <div>
                  <strong>{user!.displayName}</strong>
                  <span>@{user!.username}</span>
                </div>
                <span>
                  {tr('screen378')}<ChevronRight size={16} />
                </span>
              </Link>
              <div className="setting-row">
                <div>
                  <strong>{tr('screen379')}</strong>
                  <small>{tr('screen380')}</small>
                </div>
                <div className="segmented">
                  <button
                    className={user!.status === "ONLINE" ? "selected" : ""}
                    onClick={() => void status("ONLINE")}
                  >
                    <i className="online-dot" />
                    {tr('screen317')}</button>
                  <button
                    className={user!.status === "BUSY" ? "selected" : ""}
                    onClick={() => void status("BUSY")}
                  >
                    <i className="busy-dot" />
                    {tr('screen381')}</button>
                </div>
              </div>
            </section>
            <AppearanceSettings />
            <section className="settings-section" id="security">
              <h2>{tr('screen371')}</h2>
              <p>{tr('screen385')}</p>
              <div className="setting-row">
                <div>
                  <strong>{tr('screen386')}</strong>
                  <small>{tr('screen387')}</small>
                </div>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setChangePassword(true)}
                >
                  <KeyRound size={15} />
                  {tr('screen388')}</button>
              </div>
              <div className="security-information">
                <ShieldCheck size={20} />
                <p>
                  {tr('screen389')}<strong>{tr('screen390')}</strong>
                </p>
              </div>
            </section>
            <section className="settings-section blocked-settings" id="blocked" aria-busy={blocksLoading}>
              <h2>
                {tr('screen372')}<span className="count-pill">{blocksLoaded ? blocks.length : '—'}</span>
              </h2>
              <p>{tr('screen391')}</p>
              <button type="button" className="btn btn-secondary btn-small blocked-refresh" disabled={blocksLoading} onClick={() => setBlocksRevision(value => value + 1)}>{tr('screen322')}</button>
              {blocksLoading && <Spinner />}
              {blocksError && <ErrorBox message={blocksError.invalidResponse ? tr('apiUnreadableResponse') : blocksError.message} retry={() => setBlocksRevision(value => value + 1)} />}
              {blocksLoaded && blocks.length ? (
                blocks.map((u) => (
                  <div className="blocked-row" key={u.id}>
                    <Avatar user={u} size="sm" />
                    <div>
                      <strong>{u.displayName}</strong>
                      <small>@{u.username}</small>
                    </div>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() =>
                        void task(async () => {
                          await api(`/blocks/${u.id}`, json("DELETE"));
                          setBlocks((old) => old.filter((v) => v.id !== u.id));
                        }, tr('screen392'))
                      }
                    >
                      {tr('screen393')}</button>
                  </div>
                ))
              ) : !blocksLoading && !blocksError && blocksLoaded ? (
                <Empty
                  icon={<Ban size={25} />}
                  title={tr('screen394')}
                  description={tr('screen395')}
                />
              ) : null}
            </section>
            <div className="settings-signout">
              <div>
                <strong>{tr('screen396')}</strong>
                <p>{tr('screen397')}</p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmLogout(true)}
              >
                <LogOut size={16} />
                {tr('screen352')}</button>
            </div>
            <div className="settings-version">
              {tr('screen398')}<span>{tr('versionLabel', {version: '1.0.0'})}</span>
              <Link to="/chat">
                {tr('screen399')}<ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </div>
        {changePassword && (
          <Dialog title={tr('screen400')} onClose={() => setChangePassword(false)}>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                try {
                  await api(
                    "/auth/password",
                    json("POST", {
                      currentPassword: f.get("currentPassword"),
                      newPassword: f.get("newPassword"),
                    }),
                  );
                  window.location.assign("/login");
                } catch (err) {
                  toast((err as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="muted">
                {tr('screen401')}</p>
              <label>
                {tr('screen402')}<input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={72}
                />
              </label>
              <label>
                {tr('auth42')}<input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={72}
                  placeholder={tr('screen403')}
                />
              </label>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? tr('screen404') : tr('screen405')}
              </button>
            </form>
          </Dialog>
        )}
        {confirmLogout && (
          <Dialog title={tr('screen406')} onClose={() => setConfirmLogout(false)}>
            <p className="muted">{tr('screen407')}</p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmLogout(false)}
              >
                {tr('screen399')}</button>
              <button
                className="btn btn-primary"
                onClick={() => void task(logout)}
              >
                {tr('screen352')}</button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
