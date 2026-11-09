import { useSendShortcut } from './send-preference';
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Ban,
  Check,
  ChevronRight,
  KeyRound,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import type { User } from "./types";
import { Avatar, Dialog, Empty, PageHeading, useTask } from "./ui";
export function SettingsPage() {
  const [sendShortcut, setSendShortcut] = useSendShortcut();
  const { user, theme, setTheme, reloadUser, socket, logout, toast } = useApp(),
    [blocks, setBlocks] = useState<User[]>([]),
    [busy, setBusy] = useState(false),
    [changePassword, setChangePassword] = useState(false),
    [confirmLogout, setConfirmLogout] = useState(false),
    task = useTask();
  useEffect(() => {
    void api<User[]>("/blocks")
      .then(setBlocks)
      .catch((e) => toast(e.message, true));
  }, [toast]);
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
          eyebrow="泊岸 · 你的交流空间"
          title="设置"
          description="按自己的节奏，享受每一次交流。"
        />
        <div className="settings-grid">
          <nav className="settings-nav" aria-label="设置分区">
            <a href="#account">
              <UserRound size={17} />
              账号与状态
            </a>
            <a href="#appearance">
              <Sun size={17} />
              外观主题
            </a>
            <a href="#security">
              <ShieldCheck size={17} />
              安全与隐私
            </a>
            <a href="#blocked">
              <Ban size={17} />
              屏蔽列表 <span>{blocks.length}</span>
            </a>
          </nav>
          <div className="settings-main">
            <section className="settings-section"><h2>消息发送快捷键</h2><label>发送方式<select value={sendShortcut} onChange={e => setSendShortcut(e.target.value === "modifier" ? "modifier" : "enter")}><option value="enter">Enter 发送，Shift + Enter 换行</option><option value="modifier">Ctrl / ⌘ + Enter 发送，Enter 换行</option></select></label></section>
            <section className="settings-section" id="account">
              <h2>账号与状态</h2>
              <p>管理个人资料，让朋友知道你是否方便聊天。</p>
              <Link to="/profile" className="settings-profile">
                <Avatar user={user} size="lg" />
                <div>
                  <strong>{user!.displayName}</strong>
                  <span>@{user!.username}</span>
                </div>
                <span>
                  编辑资料 <ChevronRight size={16} />
                </span>
              </Link>
              <div className="setting-row">
                <div>
                  <strong>当前状态</strong>
                  <small>多设备在线状态会自动同步</small>
                </div>
                <div className="segmented">
                  <button
                    className={user!.status === "ONLINE" ? "selected" : ""}
                    onClick={() => void status("ONLINE")}
                  >
                    <i className="online-dot" />
                    在线
                  </button>
                  <button
                    className={user!.status === "BUSY" ? "selected" : ""}
                    onClick={() => void status("BUSY")}
                  >
                    <i className="busy-dot" />
                    忙碌
                  </button>
                </div>
              </div>
            </section>
            <section className="settings-section" id="appearance">
              <h2>外观主题</h2>
              <p>为你此刻的环境，选择舒适的色调。</p>
              <div className="theme-options">
                <button
                  className={`theme-choice ${theme === "light" ? "selected" : ""}`}
                  onClick={() => setTheme("light")}
                >
                  <span className="theme-preview preview-light">
                    <i />
                    <div>
                      <i />
                      <i />
                      <i />
                    </div>
                  </span>
                  <span>
                    <Sun size={16} />
                    亮色模式{theme === "light" && <Check size={16} />}
                  </span>
                </button>
                <button
                  className={`theme-choice ${theme === "dark" ? "selected" : ""}`}
                  onClick={() => setTheme("dark")}
                >
                  <span className="theme-preview preview-dark">
                    <i />
                    <div>
                      <i />
                      <i />
                      <i />
                    </div>
                  </span>
                  <span>
                    <Moon size={16} />
                    深色模式{theme === "dark" && <Check size={16} />}
                  </span>
                </button>
              </div>
            </section>
            <section className="settings-section" id="security">
              <h2>安全与隐私</h2>
              <p>独立的强密码，守护你的聊天空间。</p>
              <div className="setting-row">
                <div>
                  <strong>账号密码</strong>
                  <small>密码加密存储，修改后所有设备将退出登录</small>
                </div>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setChangePassword(true)}
                >
                  <KeyRound size={15} />
                  修改密码
                </button>
              </div>
              <div className="security-information">
                <ShieldCheck size={20} />
                <p>
                  登录会话通过 HttpOnly Cookie 保护，消息与文件由成员权限控制。
                  <strong>服务不提供端到端加密。</strong>
                </p>
              </div>
            </section>
            <section className="settings-section" id="blocked">
              <h2>
                屏蔽列表 <span className="count-pill">{blocks.length}</span>
              </h2>
              <p>被屏蔽的用户无法向你申请好友或发送私聊消息。</p>
              {blocks.length ? (
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
                        }, "已解除屏蔽")
                      }
                    >
                      解除屏蔽
                    </button>
                  </div>
                ))
              ) : (
                <Empty
                  icon={<Ban size={25} />}
                  title="你的屏蔽列表是空的"
                  description="可以在用户资料页屏蔽某位用户。"
                />
              )}
            </section>
            <div className="settings-signout">
              <div>
                <strong>离开一会儿？</strong>
                <p>退出只会结束当前登录会话。</p>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmLogout(true)}
              >
                <LogOut size={16} />
                退出登录
              </button>
            </div>
            <div className="settings-version">
              HARBOR · 泊岸 <span>Version 1.0.0</span>
              <Link to="/chat">
                继续聊天 <ArrowUpRight size={13} />
              </Link>
            </div>
          </div>
        </div>
        {changePassword && (
          <Dialog title="修改账号密码" onClose={() => setChangePassword(false)}>
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
                修改成功后，所有设备会退出登录。请使用新密码重新登录。
              </p>
              <label>
                当前密码
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={72}
                />
              </label>
              <label>
                新密码
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={72}
                  placeholder="至少 12 个字符"
                />
              </label>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "正在更新…" : "确认修改"}
              </button>
            </form>
          </Dialog>
        )}
        {confirmLogout && (
          <Dialog title="退出泊岸？" onClose={() => setConfirmLogout(false)}>
            <p className="muted">聊天记录会保留，随时欢迎回来。</p>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmLogout(false)}
              >
                继续聊天
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void task(logout)}
              >
                退出登录
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}
