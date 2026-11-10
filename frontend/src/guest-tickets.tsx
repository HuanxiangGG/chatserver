import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { Paperclip, Send, Reply, X } from "lucide-react";
import { ApiError } from "./api";
import {
  getLanguage,
  localizeApiError,
  setLanguage,
  translate as tr,
  useLanguage,
} from "./i18n";
import { Brand, Dialog, ErrorBox, Spinner } from "./ui";
import { CopyTicketId } from "./community-controls";
import type { Message, Attachment } from "./types";
type GuestTicket = {
  id: string;
  number: number;
  serverId: string;
  conversationId: string;
  subject: string;
  guestName: string;
  status: string;
};
async function guestApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  csrfToken?: string,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/guest${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(tr("screen408"), 0);
  }
  let data;
  try {
    data = await r.json();
  } catch {
    throw new ApiError(tr("apiUnreadableResponse"), r.status);
  }
  if (!r.ok)
    throw new ApiError(
      data.error ? localizeApiError(data.error) : tr("apiUnknownError"),
      r.status,
      data.code,
    );
  return data;
}
function recoveryCode() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function GuestTickets() {
  useLanguage();
  const { serverId, ticketId } = useParams(),
    navigate = useNavigate(),
    [community, setCommunity] = useState<{
      id: string;
      name: string;
      canCreate: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [mode, setMode] = useState<"create" | "query">("query"),
    [busy, setBusy] = useState(false),
    lock = useRef(false),
    pending = useRef<{ clientId: string; recoveryCode: string } | null>(null),
    [session, setSession] = useState<{
      ticket: GuestTicket;
      csrfToken: string;
    } | null>(null),
    [savedCode, setSavedCode] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setCommunity(null);
    setError("");
    guestApi<typeof community>(`/${serverId}`)
      .then((v) => {
        if (live) {
          setCommunity(v);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [serverId, revision]);
  useEffect(() => {
    let live = true;
    setSession(null);
    if (ticketId)
      guestApi<NonNullable<typeof session>>(`/${serverId}/tickets/${ticketId}`)
        .then((v) => {
          if (live) {
            setSession(v);
            setError("");
          }
        })
        .catch((e) => {
          if (live) {
            setError(e.message);
            setMode("query");
          }
        });
    return () => {
      live = false;
    };
  }, [serverId, ticketId, revision]);
  const enter = (s: NonNullable<typeof session>) => {
    setSession(s);
    navigate(`/guest/${serverId}/tickets/${s.ticket.id}`);
  };
  return (
    <main className={`guest-workspace ${session ? "guest-in-chat" : ""}`}>
      <header className="guest-header">
        <Link
          to={`/guest/${serverId}`}
          onClick={() => {
            setSavedCode("");
            setSession(null);
          }}
        >
          <Brand compact />
        </Link>
        <strong>{community?.name}</strong>
        <select
          aria-label={tr("language")}
          value={getLanguage()}
          onChange={(e) =>
            setLanguage(e.target.value === "en" ? "en" : "zh-CN")
          }
        >
          <option value="zh-CN">{tr("chinese")}</option>
          <option value="en">{tr("english")}</option>
        </select>
      </header>
      {!community ? (
        error ? (
          <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />
        ) : (
          <Spinner />
        )
      ) : session ? (
        <>
          <div className="guest-ticket-heading">
            <h1>{session.ticket.subject}</h1>
            <CopyTicketId id={session.ticket.id} />
          </div>
          {savedCode && (
            <section
              className="guest-recovery"
              aria-label={tr("controlsRecoveryCode")}
            >
              <strong>{tr("controlsSaveRecovery")}</strong>
              <p>{tr("controlsRecoveryNote")}</p>
              <label>
                {tr("controlsRecoveryCode")}
                <input
                  type="password"
                  readOnly
                  value={savedCode}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(savedCode);
                  } catch {
                    setError(tr("controlsCopyFailed"));
                  }
                }}
              >
                {tr("controlsCopyRecovery")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSavedCode("")}
              >
                {tr("controlsSavedRecovery")}
              </button>
            </section>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <GuestChat
            key={session.ticket.id}
            session={session}
            onTicket={(ticket) => setSession((s) => (s ? { ...s, ticket } : s))}
          />
        </>
      ) : (
        <section className="guest-entry">
          <h1>{tr("controlsGuestSupport")}</h1>
          <p>{tr("controlsGuestPrivacy")}</p>
          <div className="guest-entry-tabs">
            <button
              className={`btn ${mode === "create" ? "btn-primary" : "btn-secondary"}`}
              disabled={!community.canCreate}
              onClick={() => {
                setMode("create");
                setError("");
              }}
            >
              {tr("controlsNewTicket")}
            </button>
            <button
              className={`btn ${mode === "query" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => {
                setMode("query");
                setError("");
              }}
            >
              {tr("controlsFindExisting")}
            </button>
          </div>
          {!community.canCreate && (
            <p className="field-note">{tr("controlsGuestClosed")}</p>
          )}
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                if (mode === "create") {
                  if (!pending.current)
                    pending.current = {
                      clientId: crypto.randomUUID(),
                      recoveryCode: recoveryCode(),
                    };
                  const s = await guestApi<NonNullable<typeof session>>(
                    `/${serverId}/tickets`,
                    "POST",
                    {
                      ...pending.current,
                      displayName: f.get("displayName"),
                      subject: f.get("subject"),
                      content: f.get("content"),
                    },
                  );
                  setSavedCode(pending.current.recoveryCode);
                  pending.current = null;
                  enter(s);
                } else {
                  const id = String(f.get("ticketId")).trim(),
                    code = String(f.get("recoveryCode")).trim();
                  const s = code
                    ? await guestApi<NonNullable<typeof session>>(
                        `/${serverId}/recover`,
                        "POST",
                        { ticketId: id, recoveryCode: code },
                      )
                    : await guestApi<NonNullable<typeof session>>(
                        `/${serverId}/tickets/${encodeURIComponent(id)}`,
                      );
                  enter(s);
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            {mode === "create" ? (
              <>
                <label>
                  {tr("controlsTemporaryName")}
                  <input
                    name="displayName"
                    required
                    maxLength={60}
                    autoComplete="off"
                  />
                </label>
                <label>
                  {tr("communitySubject")}
                  <input name="subject" required maxLength={120} />
                </label>
                <label>
                  {tr("communityFirstMessage")}
                  <textarea name="content" required maxLength={4000} rows={4} />
                </label>
              </>
            ) : (
              <>
                <label>
                  {tr("controlsTicketIdLabel")}
                  <input
                    name="ticketId"
                    required
                    maxLength={100}
                    defaultValue={ticketId || ""}
                    autoComplete="off"
                  />
                </label>
                <label>
                  {tr("controlsRecoveryCode")}
                  <input
                    name="recoveryCode"
                    type="password"
                    maxLength={64}
                    autoComplete="off"
                    pattern="[a-f0-9]{64}"
                  />
                </label>
                <p className="field-note">{tr("controlsRecoveryOptional")}</p>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="btn btn-primary"
              disabled={busy || (mode === "create" && !community.canCreate)}
            >
              {tr(
                busy
                  ? "communitySubmitting"
                  : mode === "create"
                    ? "communityCreateTicket"
                    : "controlsOpenTicket",
              )}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
interface Pending {
  key: string;
  text: string;
  attachments: Attachment[];
  reply: Message | null;
  error: string;
}
function GuestChat({
  session,
  onTicket,
}: {
  session: { ticket: GuestTicket; csrfToken: string };
  onTicket: (t: GuestTicket) => void;
}) {
  useLanguage();
  const { ticket, csrfToken } = session,
    path = `/${ticket.serverId}/tickets/${ticket.id}`,
    [messages, setMessages] = useState<Message[] | null>(null),
    [hasMore, setHasMore] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [draft, setDraft] = useState(""),
    draftRef = useRef(""),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    filesRef = useRef<Attachment[]>([]),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(0),
    [reply, setReply] = useState<Message | null>(null),
    [preview, setPreview] = useState<Attachment | null>(null),
    [pending, setPending] = useState<Pending[]>([]),
    queue = useRef<Pending[]>([]),
    draining = useRef(false),
    text = useRef<HTMLTextAreaElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    [latest, setLatest] = useState(false),
    [retry, setRetry] = useState(0),
    live = useRef(true),
    knownIds = useRef(new Set<string>()),
    historyLoaded = useRef(false);
  const fileUrl = (a: Attachment) => `/api/guest${path}/files/${a.id}`;
  const refresh = useCallback(async () => {
    const [info, rows] = await Promise.all([
      guestApi<{ ticket: GuestTicket }>(path),
      guestApi<{ messages: Message[]; hasMore: boolean }>(`${path}/messages`),
    ]);
    // On reconnect, walk backwards to a known message instead of dropping a gap
    // when more than one page arrived while this browser was offline.
    const combined = [...rows.messages];
    let more = rows.hasMore;
    while (
      live.current &&
      knownIds.current.size &&
      more &&
      !combined.some((m) => knownIds.current.has(m.id))
    ) {
      const older = await guestApi<{ messages: Message[]; hasMore: boolean }>(
        `${path}/messages?before=${combined[0]!.id}`,
      );
      combined.unshift(...older.messages);
      more = older.hasMore;
    }
    if (live.current) {
      onTicket(info.ticket);
      setMessages((old) => {
        const merged = new Map(
          [...(old || []), ...combined].map((m) => [m.id, m]),
        );
        return [...merged.values()].sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      });
      if (!historyLoaded.current) {
        setHasMore(more);
        historyLoaded.current = true;
      }
      for (const m of combined) knownIds.current.add(m.id);
      setError("");
    }
  }, [path]);
  useEffect(() => {
    live.current = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined,
      refreshing = false,
      dirty = false;
    const scheduleRefresh = () => {
      dirty = true;
      if (refreshTimer || refreshing || !navigator.onLine) return;
      refreshTimer = setTimeout(async () => {
        refreshTimer = undefined;
        refreshing = true;
        dirty = false;
        try {
          await refresh();
        } catch (e) {
          if (live.current) setError((e as Error).message);
        } finally {
          refreshing = false;
          if (dirty && live.current) scheduleRefresh();
        }
      }, 350);
    };
    scheduleRefresh();
    const socket = io("/guest-tickets", {
      forceNew: true,
      transports: ["websocket"],
      withCredentials: true,
      auth: { serverId: ticket.serverId, ticketId: ticket.id, csrfToken },
    });
    socket.on("connect", () => {
      setConnected(true);
      scheduleRefresh();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("ticket:changed", scheduleRefresh);
    // Browsers can retain an existing WebSocket until its heartbeat times out.
    // Reflect a known network loss immediately and reconnect on restoration.
    const offline = () => {
      socket.disconnect();
      setConnected(false);
    };
    const online = () => {
      socket.connect();
      scheduleRefresh();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    if (!navigator.onLine) offline();
    return () => {
      live.current = false;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.disconnect();
    };
  }, [path, csrfToken, retry, refresh]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) {
      if (atBottom.current) {
        el.scrollTop = el.scrollHeight;
        setLatest(false);
      } else setLatest(true);
    }
  }, [messages, pending]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const resize = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = text.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [draft]);
  const update = (v: string) => {
    draftRef.current = v;
    setDraft(v);
  };
  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current[0]!;
        try {
          item.error = "";
          setPending([...queue.current]);
          const m = await guestApi<Message>(
            `${path}/messages`,
            "POST",
            {
              content: item.text,
              clientId: item.key,
              replyToId: item.reply?.id,
              attachmentIds: item.attachments.map((a) => a.id),
            },
            csrfToken,
          );
          queue.current.shift();
          if (live.current) {
            setMessages((v) =>
              [...(v || []).filter((old) => old.id !== m.id), m].sort(
                (a, b) =>
                  a.createdAt.localeCompare(b.createdAt) ||
                  a.id.localeCompare(b.id),
              ),
            );
            setPending([...queue.current]);
          }
        } catch (e) {
          item.error = (e as Error).message;
          if (live.current) setPending([...queue.current]);
          break;
        }
      }
    } finally {
      draining.current = false;
    }
  };
  const send = () => {
    if (
      ticket.status === "CLOSED" ||
      (!draftRef.current.trim() && !filesRef.current.length) ||
      uploading
    )
      return;
    const item = {
      key: crypto.randomUUID(),
      text: draftRef.current.trim(),
      attachments: filesRef.current,
      reply,
      error: "",
    };
    queue.current.push(item);
    setPending([...queue.current]);
    update("");
    filesRef.current = [];
    setAttachments([]);
    setReply(null);
    atBottom.current = true;
    void drain();
  };
  const upload = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError(tr("controlsFileLimit"));
      return;
    }
    setUploading(true);
    setProgress(0);
    setError("");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/guest${path}/uploads`);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setProgress(Math.round((100 * e.loaded) / e.total));
    };
    xhr.onload = () => {
      try {
        const a = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          throw Error(localizeApiError(a.error));
        filesRef.current = [...filesRef.current, a];
        setAttachments(filesRef.current);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading(false);
      }
    };
    xhr.onerror = xhr.ontimeout = () => {
      setError(tr("screen411"));
      setUploading(false);
    };
    const f = new FormData();
    f.append("file", file);
    xhr.send(f);
  };
  return (
    <section className="guest-chat">
      <div className="guest-connection" role="status">
        {!connected && (
          <>
            <span>{tr("controlsReconnecting")}</span>
            <button
              className="btn btn-secondary"
              onClick={() => setRetry((v) => v + 1)}
            >
              {tr("retry")}
            </button>
          </>
        )}
        {ticket.status === "CLOSED" && (
          <span>{tr("communityTicketClosed")}</span>
        )}
      </div>
      {error && (
        <ErrorBox
          message={error}
          retry={() => void refresh().catch((e) => setError(e.message))}
        />
      )}
      <div
        className="guest-messages"
        ref={scroller}
        onScroll={(e) => {
          atBottom.current =
            e.currentTarget.scrollHeight -
              e.currentTarget.scrollTop -
              e.currentTarget.clientHeight <
            70;
          if (atBottom.current) setLatest(false);
        }}
      >
        {hasMore && (
          <button
            className="btn btn-secondary"
            disabled={loadingOlder}
            onClick={async () => {
              if (!messages?.length) return;
              const el = scroller.current!,
                height = el.scrollHeight,
                top = el.scrollTop;
              setLoadingOlder(true);
              try {
                const rows = await guestApi<{
                  messages: Message[];
                  hasMore: boolean;
                }>(`${path}/messages?before=${messages[0].id}`);
                atBottom.current = false;
                setMessages((v) => [...rows.messages, ...(v || [])]);
                setHasMore(rows.hasMore);
                requestAnimationFrame(() => {
                  el.scrollTop = top + el.scrollHeight - height;
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLoadingOlder(false);
              }
            }}
          >
            {tr("communityMoreTickets")}
          </button>
        )}
        {!messages ? (
          <Spinner />
        ) : !messages.length ? (
          <p>{tr("screen449")}</p>
        ) : (
          messages.map((m, index) => (
            <article
              className={`guest-message ${m.senderId === `guest:${ticket.id}` ? "own" : ""} ${index > 0 && messages[index - 1]!.senderId === m.senderId && Date.parse(m.createdAt) - Date.parse(messages[index - 1]!.createdAt) < 300000 ? "grouped" : ""}`}
              key={m.id}
            >
              <div className="message-meta">
                <strong>{m.sender?.displayName}</strong>
                {m.sender?.role === "GUEST" && (
                  <span className="bot-marker">{tr("controlsGuestBadge")}</span>
                )}
                <time
                  tabIndex={0}
                  title={new Date(m.createdAt).toLocaleString(getLanguage())}
                >
                  {new Date(m.createdAt).toLocaleTimeString(getLanguage(), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              {m.replyTo && (
                <blockquote>
                  {m.replyTo.sender?.displayName} ·{" "}
                  {m.replyTo.retractedAt
                    ? tr("deletedOriginal")
                    : m.replyTo.content || tr("fileType")}
                </blockquote>
              )}
              <p>{m.retractedAt ? tr("deletedOriginal") : m.content}</p>
              {m.attachments.map((a) => (
                <div className="guest-file" key={a.id}>
                  {a.mimeType.startsWith("image/") && (
                    <button
                      type="button"
                      onClick={() => setPreview(a)}
                      aria-label={tr("controlsPreviewFile", {
                        name: a.filename || tr("fileType"),
                      })}
                    >
                      <img loading="lazy" src={fileUrl(a)} alt={a.filename} />
                    </button>
                  )}
                  <a href={fileUrl(a)} target="_blank" rel="noreferrer">
                    {a.filename} ·{" "}
                    {new Intl.NumberFormat(getLanguage(), {
                      style: "unit",
                      unit:
                        a.size >= 1048576
                          ? "megabyte"
                          : a.size >= 1024
                            ? "kilobyte"
                            : "byte",
                      maximumFractionDigits: 1,
                    }).format(
                      a.size /
                        (a.size >= 1048576
                          ? 1048576
                          : a.size >= 1024
                            ? 1024
                            : 1),
                    )}
                  </a>
                </div>
              ))}
              {!m.retractedAt && ticket.status !== "CLOSED" && (
                <button
                  type="button"
                  className="icon-btn guest-reply-action"
                  aria-label={tr("screen460")}
                  onClick={() => {
                    setReply(m);
                    text.current?.focus({ preventScroll: true });
                  }}
                >
                  <Reply size={16} />
                </button>
              )}
            </article>
          ))
        )}
        {pending
          .filter(
            (item) =>
              !messages?.some(
                (m) =>
                  m.clientId === item.key &&
                  m.senderId === `guest:${ticket.id}`,
              ),
          )
          .map((item) => (
            <article className="guest-message own" key={item.key}>
              <p>{item.text}</p>
              {item.attachments.map((a) => (
                <span key={a.id}>{a.filename}</span>
              ))}
              {item.error ? (
                <>
                  <p className="form-error">{item.error}</p>
                  <button
                    className="btn btn-secondary"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => void drain()}
                  >
                    {tr("uiSendFailed")}
                  </button>
                </>
              ) : (
                <span>{tr("uiSending")}</span>
              )}
            </article>
          ))}
      </div>
      {latest && (
        <button
          className="btn btn-secondary"
          onClick={() => {
            atBottom.current = true;
            scroller.current!.scrollTop = scroller.current!.scrollHeight;
            setLatest(false);
          }}
        >
          {tr("backLatest")}
        </button>
      )}
      {reply && (
        <div className="guest-reply">
          <span>
            {reply.sender?.displayName} · {reply.content || tr("fileType")}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={tr("communityCancel")}
            onClick={() => setReply(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="guest-attachments">
          {attachments.map((a) => (
            <span key={a.id}>
              {a.filename}
              <button
                className="icon-btn"
                aria-label={tr("communityRemove")}
                onClick={() => {
                  filesRef.current = filesRef.current.filter(
                    (f) => f.id !== a.id,
                  );
                  setAttachments(filesRef.current);
                }}
              >
                <X size={16} />
              </button>
            </span>
          ))}
        </div>
      )}
      {uploading && (
        <progress
          value={progress}
          max={100}
          aria-label={tr("controlsUploading")}
        />
      )}
      <form
        className="guest-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label
          className={`icon-btn ${ticket.status === "CLOSED" || uploading ? "disabled" : ""}`}
          aria-label={tr("screen475")}
        >
          <Paperclip size={20} />
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            disabled={
              ticket.status === "CLOSED" || uploading || attachments.length >= 5
            }
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </label>
        <textarea
          ref={text}
          rows={1}
          maxLength={4000}
          value={draft}
          disabled={ticket.status === "CLOSED"}
          aria-label={tr("communityMessagePlaceholder")}
          placeholder={tr(
            ticket.status === "CLOSED"
              ? "communityReadOnly"
              : "communityMessagePlaceholder",
          )}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="icon-btn"
          type="submit"
          aria-label={tr("screen479")}
          disabled={
            ticket.status === "CLOSED" ||
            uploading ||
            (!draft.trim() && !attachments.length)
          }
          onPointerDown={(e) => {
            if (document.activeElement === text.current) e.preventDefault();
          }}
        >
          <Send size={20} />
        </button>
      </form>
      {preview && (
        <Dialog
          title={preview.filename || tr("fileType")}
          onClose={() => setPreview(null)}
        >
          <img
            className="guest-preview"
            src={fileUrl(preview)}
            alt={preview.filename}
          />
          <a className="btn btn-secondary" href={fileUrl(preview)} download>
            {tr("controlsDownload")}
          </a>
        </Dialog>
      )}
    </section>
  );
}
