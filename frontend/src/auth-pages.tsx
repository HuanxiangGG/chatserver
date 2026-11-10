import { HarborScene } from './harbor-scene';
import { AppearanceSettings } from './appearance';
import { getLanguage, setLanguage, useTranslation, type TranslationKey } from './i18n';
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  Palette,
} from "lucide-react";
import { api, json } from "./api";
import { useApp } from "./state";
import { Brand, Dialog, Spinner } from "./ui";
import type { User } from "./types";
export function AuthPage({
  mode,
}: {
  mode: "login" | "register" | "forgot" | "reset";
}) {
  const t = useTranslation();
  const [recoveryMail, setRecoveryMail] = useState(false);
  const [sceneQuiet, setSceneQuiet] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { user, loading, login, toast } = useApp(),
    navigate = useNavigate(),
    location = useLocation();
  const [recoveryToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get("token") || new URLSearchParams(window.location.search).get("token") || "",
  );
  useEffect(() => {
    if (recoveryToken)
      window.history.replaceState(null, "", window.location.pathname);
  }, [recoveryToken]);
  const submitting = useRef(false);
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, TranslationKey | ''>>({});
  const strength = [password.length >= 10, /[a-z]/.test(password) && /[A-Z]/.test(password), /[0-9]/.test(password), /[^a-zA-Z0-9]/.test(password)].filter(Boolean).length;
  function fieldError(name: string, value: string, form: HTMLFormElement): TranslationKey | '' {
    if (name === 'username' && mode === 'register' && !/^[A-Za-z0-9_]{3,24}$/.test(value)) return 'auth1';
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'auth2';
    if ((name === 'password' || name === 'newPassword') && mode !== 'login' && (value.length < 10 || new TextEncoder().encode(value).length > 72)) return 'auth3';
    if (name === 'confirmPassword' && value !== String(new FormData(form).get(mode === 'reset' ? 'newPassword' : 'password'))) return 'auth4';
    if (!value.trim()) return 'auth5';
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
        <Spinner label={t('auth6')} />
      </div>
    );
  if (user) return <Navigate to="/chat" replace />;
  const titles = {
    login: t('harborLoginTitle'),
    register: t('auth8'),
    forgot: t('auth9'),
    reset: t('auth10'),
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    setError("");
    const issues: Record<string, TranslationKey> = {};
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
        const result = await api<{recovery: string}>("/auth/forgot-password", json("POST", { ...data, language: getLanguage() }));
        setRecoveryMail(result.recovery === "accepted");
        setSent(true);
      } else if (mode === "reset") {
        await api("/auth/reset-password", json("POST", data));
        toast(t('auth11'));
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
      setError(err instanceof Error ? err.message : t('auth12'));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <main className={`auth-screen auth-${mode}`} data-harbor={mode === 'register' ? 'dawn' : 'night'} data-scene-quiet={sceneQuiet}>
      <HarborScene dawn={mode === 'register'} />
      <div className="auth-layout">
      <section className="auth-form-panel">
        <div className="auth-brand"><Brand /></div>
        <div className="auth-toolbar"><label className="auth-language">{t('language')}<select value={getLanguage()} onChange={e => setLanguage(e.target.value === 'en' ? 'en' : 'zh-CN')}><option value="zh-CN">{t('chinese')}</option><option value="en">{t('english')}</option></select></label><button type="button" className="btn btn-secondary auth-appearance" onClick={() => setAppearanceOpen(true)}><Palette size={16}/>{t('appearanceTitle')}</button></div>
        <div className="auth-form-wrap">
          <h2>{titles[mode]}</h2>
          <p>
            {mode === "login"
              ? t('auth24')
              : mode === "register"
                ? t('auth25')
                : mode === "forgot"
                  ? t('auth26')
                  : t('auth27')}
          </p>
          {sent ? (
            <div className="success-panel">
              <Check size={24} />
              <h3>{t('auth28')}</h3>
              <p>
                {recoveryMail ? t('auth29') : t('auth30')}
              </p>
              <Link className="btn btn-primary" to="/reset-password">
                {t('auth31')}</Link>
            </div>
          ) : (
            <form onSubmit={submit} onInput={() => setSceneQuiet(true)} className="form-stack" noValidate aria-busy={busy}
              onChange={e => {
                const target = e.target as unknown;
                if (!(target instanceof HTMLInputElement)) return;
                const input = target;
                if (!input.name) return;
                const message = fieldError(input.name, input.value, e.currentTarget);
                input.setAttribute('aria-invalid', String(!!message));
                input.setAttribute('aria-describedby', `auth-error-${input.name}`);
                setFields(previous => ({ ...previous, [input.name]: message }));
                if (['password', 'newPassword'].includes(input.name)) {
                  setPassword(input.value);
                  const confirm = e.currentTarget.elements.namedItem('confirmPassword') as HTMLInputElement | null;
                  if (confirm?.value) setFields(previous => ({ ...previous, confirmPassword: confirm.value !== input.value ? 'auth4' as const : '' }));
                }
              }}>
              {(mode === "login" || mode === "register") && (
                <label>
                  {t('auth32')}<input
                    name="username"
                    aria-invalid={!!fields.username}
                    aria-describedby="auth-error-username"
                    required
                    autoComplete="username"
                    minLength={3}
                    maxLength={mode === "register" ? 24 : 254}
                    placeholder={
                      mode === "login" ? t('auth33') : t('auth34')
                    }
                    pattern={
                      mode === "register" ? "[A-Za-z0-9_]{3,24}" : undefined
                    }
                    title={
                      mode === "register"
                        ? t('auth35')
                        : undefined
                    }
                  />
                  {fields.username && <span id="auth-error-username" className="field-error">{t(fields.username)}</span>}
                </label>
              )}
              {mode === "register" && (
                <>
                  <label>
                    {t('auth36')}<input
                      name="displayName"
                      aria-invalid={!!fields.displayName}
                      aria-describedby="auth-error-displayName"
                      required
                      minLength={1}
                      maxLength={50}
                      autoComplete="nickname"
                      placeholder={t('auth37')}
                    />
                    {fields.displayName && <span id="auth-error-displayName" className="field-error">{t(fields.displayName)}</span>}
                  </label>
                  <label>
                    {t('auth38')}<input
                      name="email"
                      aria-invalid={!!fields.email}
                      aria-describedby="auth-error-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder={t('authEmailExample')}
                      maxLength={254}
                    />
                    {fields.email && <span id="auth-error-email" className="field-error">{t(fields.email)}</span>}
                  </label>
                </>
              )}
              {mode === "forgot" && (
                <label>
                  {t('auth39')}<input
                    name="email"
                      aria-invalid={!!fields.email}
                      aria-describedby="auth-error-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={t('authEmailExample')}
                  />
                  {fields.email && <span id="auth-error-email" className="field-error">{t(fields.email)}</span>}
                </label>
              )}
              {mode === "reset" && (
                <label>
                  {t('auth40')}<input
                    name="token"
                    aria-invalid={!!fields.token}
                    aria-describedby="auth-error-token"
                    defaultValue={recoveryToken}
                    required
                    autoComplete="off"
                    placeholder={t('auth41')}
                  />
                  {fields.token && <span id="auth-error-token" className="field-error">{t(fields.token)}</span>}
                </label>
              )}
              {mode !== "forgot" && (
                <label>
                  {mode === "reset" ? t('auth42') : t('auth43')}
                  <span className="password-field">
                    <input
                      name={mode === "reset" ? "newPassword" : "password"}
                      aria-invalid={!!fields[mode === "reset" ? "newPassword" : "password"] || (mode === "login" && !!error)}
                      aria-describedby={mode === "login" && error ? "auth-login-error" : `auth-error-${mode === "reset" ? "newPassword" : "password"}`}
                      type={show ? "text" : "password"}
                      required
                      minLength={mode === "login" ? 1 : 10}
                      maxLength={72}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      placeholder={
                        mode === "login" ? t('auth44') : t('auth45')
                      }
                    />
                    <button
                      type="button"
                      aria-label={show ? t('auth46') : t('auth47')}
                      aria-pressed={show}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </span>
                  {fields[mode === 'reset' ? 'newPassword' : 'password'] && <span id={`auth-error-${mode === 'reset' ? 'newPassword' : 'password'}`} className="field-error">{t(fields[mode === 'reset' ? 'newPassword' : 'password'] as TranslationKey)}</span>}
                </label>
              )}
              {mode === 'login' && error && <div id="auth-login-error" className="form-error" role="alert">{error}</div>}
              {(mode === 'register' || mode === 'reset') && <>
                <div className="password-strength" role="status" aria-live="polite">
                  <meter min={0} max={4} value={strength} aria-label={t('auth48')} />
                  <small>{password ? t('authPasswordStrength', {strength: [t('auth49'), t('auth49'), t('auth50'), t('auth51'), t('auth52')][strength]}) : t('auth53')}</small>
                </div>
                <label>{t('auth54')}<input name="confirmPassword" aria-invalid={!!fields.confirmPassword} type={show ? 'text' : 'password'} autoComplete="new-password" required placeholder={t('auth55')} aria-describedby="auth-error-confirmPassword" />{fields.confirmPassword && <span id="auth-error-confirmPassword" className="field-error">{t(fields.confirmPassword)}</span>}</label>
              </>}

              {mode === "login" && (
                <div className="form-helper">
                  <span>
                    <ShieldCheck size={14} /> {t('auth56')}</span>
                  <Link to="/forgot-password">{t('auth57')}</Link>
                </div>
              )}
              {error && mode !== 'login' && (
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
                  ? t('auth58')
                  : mode === "login"
                    ? t('auth59')
                    : mode === "register"
                      ? t('auth60')
                      : mode === "forgot"
                        ? t('auth61')
                        : t('auth62')}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          <div className="auth-switch">
            {mode === "login" ? (
              <>
                {t('auth63')}<Link to="/register">{t('auth64')}</Link>
              </>
            ) : mode === "register" ? (
              <>
                {t('auth65')}<Link to="/login">{t('auth66')}</Link>
              </>
            ) : (
              <Link to="/login">{t('auth67')}</Link>
            )}
          </div>
          {mode === "register" && <p className="auth-note">{t('auth68')}</p>}
        </div>
      </section>
      </div>
      {appearanceOpen && <Dialog title={t('appearanceTitle')} onClose={() => setAppearanceOpen(false)}><AppearanceSettings /></Dialog>}
    </main>
  );
}
