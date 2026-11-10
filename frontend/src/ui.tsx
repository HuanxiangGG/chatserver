import { getLanguage, translate as tr, useLanguage } from './i18n';
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  Anchor,
  LoaderCircle,
  X,
  ArrowRight,
  Users,
  MessageCircle,
} from "lucide-react";
import type { Conversation, User } from "./types";
import { useApp } from "./state";
export function Brand({ compact = false }: { compact?: boolean }) {
  useLanguage();
  return (
    <span className="brand">
      <span className="brand-mark">
        <Anchor size={23} strokeWidth={2.3} />
      </span>
      {!compact && (
        <span>
          {tr('screen313')}<small>{tr('brandLatin')}</small>
        </span>
      )}
    </span>
  );
}
export function Avatar({
  user,
  size = "md",
  group = false,
  showStatus = false,
}: {
  user?: Partial<User> | null;
  size?: "sm" | "md" | "lg" | "xl";
  group?: boolean;
  showStatus?: boolean;
}) {
  useLanguage();
  const name = user?.displayName || user?.username || tr('screen314');
  const hash = [...name].reduce((x, v) => x + v.charCodeAt(0), 0) % 6;
  return (
    <span
      className={`avatar avatar-${size} avatar-tone-${hash} ${group ? "avatar-group" : ""}`}
      aria-label={name}
    >
      {user?.avatarUrl ? (
        <img src={user.avatarUrl} alt="" loading="lazy" />
      ) : group ? (
        <Users size={size === "xl" ? 30 : 21} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
      {showStatus && (
        <i
          className={`presence-dot ${user?.status?.toLowerCase() || "offline"}`}
          title={statusText(user as User)}
          role="img"
          aria-label={statusText(user as User)}
        />
      )}
    </span>
  );
}
export function conversationTitle(c: Conversation, me: string) {
  return c.type !== "DIRECT"
    ? c.name || tr('screen315')
    : c.members.find((m) => m.userId !== me)?.user.displayName || tr('screen316');
}
export function conversationUser(c: Conversation, me: string) {
  return c.type !== "DIRECT"
    ? { displayName: c.name || tr('screen217'), avatarUrl: c.avatarUrl }
    : c.members.find((m) => m.userId !== me)?.user;
}
export function statusText(user?: Partial<User> | null) {
  return user?.status === "ONLINE"
    ? tr('screen317')
    : user?.status === "BUSY"
      ? tr('screen318')
      : user?.lastSeenAt
        ? tr('screen319', {v0: formatTime(user.lastSeenAt)})
        : tr('screen320');
}
export function formatTime(date: string, full = false) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return full
    ? d.toLocaleString(getLanguage(), {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : today
      ? d.toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(getLanguage(), { month: "short", day: "numeric" });
}
export function Spinner({ label = tr('screen321') }: { label?: string }) {
  useLanguage();
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={23} />
      <span>{label}</span>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
  icon = <MessageCircle size={30} />,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  useLanguage();
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  useLanguage();
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  useLanguage();
  const dialog = useRef<HTMLElement>(null);
  const priorFocus = useRef(document.activeElement as HTMLElement | null);
  const closeHandler = useRef(onClose); closeHandler.current = onClose;
  useEffect(() => {
    const previous = priorFocus.current;
    const panel = dialog.current;
    if (panel && !panel.contains(document.activeElement)) panel.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const escape = (event: globalThis.KeyboardEvent) => {
      const panels = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (event.key === 'Escape' && panels[panels.length - 1] === panel) { event.preventDefault(); event.stopPropagation(); closeHandler.current(); }
    };
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('keydown', escape, true); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={`dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const items = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                'a[href],button:not([disabled]),input:not([disabled]):not([hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
              ),
            ].filter((v) => v.offsetParent !== null);
            const first = items[0],
              last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-btn"
            aria-label={tr('close')}
            onClick={onClose}
            autoFocus
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  useLanguage();
  return (
    <div className="error-box" role="alert">
      <p>{message}</p>
      {retry && (
        <button className="btn btn-secondary" onClick={retry}>
          {tr('screen322')}<ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}
export function useTask() {
  const { toast } = useApp();
  return async <T,>(
    action: () => Promise<T>,
    success?: string,
  ): Promise<T | undefined> => {
    try {
      const result = await action();
      if (success) toast(success);
      return result;
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('screen323'), true);
      return undefined;
    }
  };
}
