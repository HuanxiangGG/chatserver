import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import { Brand, Spinner } from "./ui";
import type { User } from "./types";
export function AuthPage({
  mode,
}: {
  mode: "login" | "register" | "forgot" | "reset";
}) {
  const { user, loading, login, toast } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
  const [recoveryToken] = useState(
    () => new URLSearchParams(window.location.search).get("token") || "",
  );
  useEffect(() => {
    if (recoveryToken)
      window.history.replaceState(null, "", window.location.pathname);
  }, [recoveryToken]);
  const submitting = useRef(false);
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const strength = [password.length >= 10, /[a-z]/.test(password) && /[A-Z]/.test(password), /[0-9]/.test(password), /[^a-zA-Z0-9]/.test(password)].filter(Boolean).length;
  function fieldError(name: string, value: string, form: HTMLFormElement) {
    if (name === 'username' && mode === 'register' && !/^[A-Za-z0-9_]{3,24}$/.test(value)) return '用户名需为 3–24 位字母、数字或下划线';
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '请输入有效的邮箱地址';
    if ((name === 'password' || name === 'newPassword') && mode !== 'login' && (value.length < 10 || new TextEncoder().encode(value).length > 72)) return '密码至少 10 个字符，且不超过 72 个 UTF-8 字节';
    if (name === 'confirmPassword' && value !== String(new FormData(form).get(mode === 'reset' ? 'newPassword' : 'password'))) return '两次输入的密码不一致';
    if (!value.trim()) return '此项不能为空';
    return '';
  }
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [show, setShow] = useState(false),
    [sent, setSent] = useState(false);
  if (loading)
    return (
      <div className="app-bootstrap">
        <Brand />
        <Spinner label="正在检查登录会话…" />
      </div>
    );
  if (user) return <Navigate to="/chat" replace />;
  const titles = {
    login: "很高兴，再次见到你。",
    register: "给每一次相遇，一个开始。",
    forgot: "找回你的账号",
    reset: "设置新的密码",
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    setError("");
    const issues: Record<string, string> = {};
    for (const [name, value] of new FormData(e.currentTarget)) {
      const issue = fieldError(name, String(value), e.currentTarget);
      if (issue) issues[name] = issue;
    }
    setFields(issues);
    if (Object.keys(issues).length) { e.currentTarget.querySelector<HTMLInputElement>(`[name="${Object.keys(issues)[0]}"]`)?.focus(); return; }
    submitting.current = true;
    setBusy(true);
    const f = new FormData(e.currentTarget),
      data = Object.fromEntries(f.entries());
    delete data.confirmPassword;
    try {
      if (mode === "forgot") {
        await api("/auth/forgot-password", json("POST", data));
        setSent(true);
      } else if (mode === "reset") {
        await api("/auth/reset-password", json("POST", data));
        toast("密码已重设，请使用新密码登录");
        navigate("/login");
      } else {
        const session = await api<{ user: User; csrfToken: string }>(
          `/auth/${mode}`,
          json("POST", data),
        );
        // Confirm that the browser actually stored/sent the HttpOnly session cookie.
        await api('/auth/me');
        login(session.user, session.csrfToken);
        navigate(
          (location.state as { from?: string } | null)?.from || "/chat",
          { replace: true },
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="story-content">
          <span className="story-kicker">
            <span /> 与重要的人，自在交流
          </span>
          <h1>
            让交流，
            <br />
            自在发生<span>。</span>
          </h1>
          <p>
            一条消息，拉近彼此的距离。
            <br />
            在泊岸，留一处空间给重要的人。
          </p>
          <div className="story-art" aria-hidden="true">
            <div className="art-orbit orbit-1" />
            <div className="art-orbit orbit-2" />
            <div className="art-center">
              <MessageCircle size={53} strokeWidth={1.3} />
            </div>
            <span className="art-chip chip-1">
              <Sparkles size={18} /> 让想法相遇
            </span>
            <span className="art-chip chip-2">
              <span className="mini-dot" /> 即时连接
            </span>
            <span className="art-chip chip-3">
              <Check size={17} /> 消息已送达
            </span>
          </div>
        </div>
        <footer>
          <ShieldCheck size={16} />
          <span>安全连接 · 私密空间 · 多端同步</span>
          <span className="story-year">
            © {new Date().getFullYear()} Harbor
          </span>
        </footer>
      </section>
      <section className="auth-form-panel">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <span className="eyebrow">
            {mode === "register" ? "欢迎加入泊岸" : "欢迎回到泊岸"}
          </span>
          <h2>{titles[mode]}</h2>
          <p>
            {mode === "login"
              ? "登录泊岸，接着聊聊。"
              : mode === "register"
                ? "创建你的泊岸账号，与朋友保持连接。"
                : mode === "forgot"
                  ? "请联系站点管理员完成身份核验，获取一次性重设令牌。"
                  : "输入管理员提供的一次性令牌和新密码。"}
          </p>
          {sent ? (
            <div className="success-panel">
              <Check size={24} />
              <h3>请求已收到</h3>
              <p>
                请联系站点管理员完成身份验证，并获取一次性重设令牌。此站点暂未接入邮件发送服务。
              </p>
              <Link className="btn btn-primary" to="/reset-password">
                我已有重设令牌
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="form-stack" noValidate aria-busy={busy}
              onChange={e => {
                const target = e.target as unknown;
                if (!(target instanceof HTMLInputElement)) return;
                const input = target;
                if (!input.name) return;
                const message = fieldError(input.name, input.value, e.currentTarget);
                input.setAttribute('aria-invalid', String(!!message));
                input.setAttribute('aria-describedby', 'auth-field-errors');
                setFields(previous => ({ ...previous, [input.name]: message }));
                if (['password', 'newPassword'].includes(input.name)) {
                  setPassword(input.value);
                  const confirm = e.currentTarget.elements.namedItem('confirmPassword') as HTMLInputElement | null;
                  if (confirm?.value) setFields(previous => ({ ...previous, confirmPassword: confirm.value !== input.value ? '两次输入的密码不一致' : '' }));
                }
              }}>
              {(mode === "login" || mode === "register") && (
                <label>
                  用户名
                  <input
                    name="username"
                    required
                    autoComplete="username"
                    autoFocus
                    minLength={3}
                    maxLength={mode === "register" ? 24 : 254}
                    placeholder={
                      mode === "login" ? "用户名或邮箱" : "你的用户名"
                    }
                    pattern={
                      mode === "register" ? "[A-Za-z0-9_]{3,24}" : undefined
                    }
                    title={
                      mode === "register"
                        ? "3–24 位英文字母、数字或下划线"
                        : undefined
                    }
                  />
                </label>
              )}
              {mode === "register" && (
                <>
                  <label>
                    显示名称
                    <input
                      name="displayName"
                      required
                      minLength={1}
                      maxLength={50}
                      autoComplete="nickname"
                      placeholder="朋友们如何称呼你"
                    />
                  </label>
                  <label>
                    邮箱
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      maxLength={254}
                    />
                  </label>
                </>
              )}
              {mode === "forgot" && (
                <label>
                  注册邮箱
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="you@example.com"
                  />
                </label>
              )}
              {mode === "reset" && (
                <label>
                  重设令牌
                  <input
                    name="token"
                    defaultValue={recoveryToken}
                    required
                    autoComplete="off"
                    autoFocus
                    placeholder="粘贴一次性令牌"
                  />
                </label>
              )}
              {mode !== "forgot" && (
                <label>
                  {mode === "reset" ? "新密码" : "密码"}
                  <span className="password-field">
                    <input
                      name={mode === "reset" ? "newPassword" : "password"}
                      type={show ? "text" : "password"}
                      required
                      minLength={mode === "login" ? 1 : 10}
                      maxLength={72}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      placeholder={
                        mode === "login" ? "输入密码" : "至少 10 个字符"
                      }
                    />
                    <button
                      type="button"
                      aria-label={show ? "隐藏密码" : "显示密码"}
                      aria-pressed={show}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </span>
                </label>
              )}
              {(mode === 'register' || mode === 'reset') && <>
                <div className="password-strength" role="status" aria-live="polite">
                  <meter min={0} max={4} value={strength} aria-label="密码强度" />
                  <small>{password ? `密码强度：${['较弱', '较弱', '一般', '良好', '较强'][strength]}` : '建议组合大小写字母、数字与符号'}</small>
                </div>
                <label>确认密码<input name="confirmPassword" type={show ? 'text' : 'password'} autoComplete="new-password" required placeholder="再次输入密码" aria-describedby="auth-field-errors" /></label>
              </>}
              <div id="auth-field-errors" aria-live="polite">{Object.entries(fields).filter(([, message]) => message).map(([name, message]) => <p className="field-error" key={name}>{message}</p>)}</div>
              {mode === "login" && (
                <div className="form-helper">
                  <span>
                    <ShieldCheck size={14} /> 安全会话登录
                  </span>
                  <Link to="/forgot-password">忘记密码？</Link>
                </div>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="btn btn-primary btn-large"
              >
                {busy
                  ? "正在处理…"
                  : mode === "login"
                    ? "登录泊岸"
                    : mode === "register"
                      ? "创建账号"
                      : mode === "forgot"
                        ? "提交恢复申请"
                        : "重设密码"}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          <div className="auth-switch">
            {mode === "login" ? (
              <>
                还没有账号？ <Link to="/register">立即注册</Link>
              </>
            ) : mode === "register" ? (
              <>
                已经有账号？ <Link to="/login">前往登录</Link>
              </>
            ) : (
              <Link to="/login">返回登录</Link>
            )}
          </div>
          <p className="auth-note">
            {mode === "register"
              ? "请使用独立且足够长的密码，保护你的聊天账号。"
              : "属于你的对话，始终在这里。"}
          </p>
        </div>
        <div className="auth-bottom">以你的节奏，保持连接。</div>
      </section>
    </main>
  );
}
