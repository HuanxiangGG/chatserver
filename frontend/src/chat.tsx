import { getLanguage, translate as tr, useLanguage } from './i18n';
import { ReportButton } from './reports';
import { ForwardDialog } from './forward-dialog';
import { AttachmentPreview } from './attachment-preview';
import { MessageSearch } from './message-search';
import { useSoundText } from './sound-ui';
import { shouldSend, useSendShortcut } from './send-preference';
import { TypingReporter } from './typing-reporter';
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Forward,
  ChevronDown,
  Copy,
  File,
  Info,
  Hash,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Send,
  ShieldCheck,
  Smile,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { MediaDraft, clipboardImages } from './media-draft';
import { ApiError, api, json, uploadFile } from "./api";
import { useApp } from "./state";
import type { Attachment, Conversation, Message } from "./types";
import {
  Avatar,
  Dialog,
  Empty,
  ErrorBox,
  conversationTitle,
  conversationUser,
  formatTime,
  statusText,
  useTask,
} from "./ui";
import { CreateGroup } from "./layout";
const emojis = [
  "😀",
  "😊",
  "🥰",
  "😂",
  "🤔",
  "😎",
  "🥳",
  "👋",
  "👍",
  "❤️",
  "✨",
  "🎉",
  "🔥",
  "🙏",
  "🌿",
  "☕",
  "🚀",
  "💡",
  "✅",
  "🌊",
];
export function ChatPage() {
  useLanguage();
  const { id } = useParams(),
    app = useApp(),
    { user, conversations, socket, sync, refresh, toast } = app;
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [loading, setLoading] = useState(!!id),
    [error, setError] = useState(""),
    [hasMore, setHasMore] = useState(false),
    [olderLoading, setOlderLoading] = useState(false),
    [draft, setDraft] = useState(""),
    [, renderDraft] = useState(0),
    [uploading, setUploading] = useState(false),
    [uploadProgress, setUploadProgress] = useState(0),
    [uploadName, setUploadName] = useState(""),
    [sending, setSending] = useState(false),
    [reply, setReply] = useState<Message | null>(null),
    [editing, setEditing] = useState<Message | null>(null),
    [editedText, setEditedText] = useState(""),
    [emojiOpen, setEmojiOpen] = useState(false),
    [infoOpen, setInfoOpen] = useState(false),
    [atBottom, setAtBottom] = useState(true),
    [firstUnreadId, setFirstUnreadId] = useState<string | null>(null),
    [group, setGroup] = useState(false),
    [typing, setTyping] = useState<Record<string, number>>({}),
    [confirm, setConfirm] = useState<{
      title: string;
      description: string;
      run: () => Promise<void>;
    } | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null),
    typingReporter = useRef<TypingReporter | null>(null),
    activeId = useRef(id),
    readIds = useRef(new Set<string>()),
    followBottom = useRef(true),
    task = useTask(),
    navigate = useNavigate();
  const drafts = useRef(new Map<string, MediaDraft>());
  const sendLock = useRef(false);
  const outbox = useRef<{ conversationId: string; pending: MediaDraft; reply: Message | null }[]>([]);
  const alive = useRef(true);
  const [failedSend, setFailedSend] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (!sendLock.current) { outbox.current.forEach(item => item.pending.clear()); outbox.current = []; } }; }, []);
  const [sendShortcut] = useSendShortcut();
  const t = useSoundText();
  const [contextView, setContextView] = useState(false);
  const [selecting, setSelecting] = useState(false), [forwardIds, setForwardIds] = useState<string[]>([]), [forwardOpen, setForwardOpen] = useState(false);
  async function locateMessage(messageId: string) {
    if (!id) return; const targetId = id;
    const result = await api<{ messages: Message[]; hasMore: boolean }>(`/conversations/${id}/messages/${messageId}/context`);
    if (activeId.current !== targetId) return;
    followBottom.current = false; setContextView(true); setMessages(result.messages); setHasMore(result.hasMore);
    requestAnimationFrame(() => {
      const box = scroll.current, target = document.getElementById(`message-${messageId}`);
      if (box && target && activeId.current === targetId) { box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2; target.classList.add("located-message"); }
    });
  }
  const scrollBottom = () => { const box = scroll.current; if (box) box.scrollTop = box.scrollHeight; };
  const queue = (key = id) => {
    if (!key) throw Error(tr('screen423'));
    if (!drafts.current.has(key)) drafts.current.set(key, new MediaDraft());
    return drafts.current.get(key)!;
  };
  const media = id ? queue() : null;
  useEffect(() => () => { drafts.current.forEach(d => d.clear()); drafts.current.clear(); }, []);
  activeId.current = id;
  const load = useCallback(
    async (quiet = false) => {
      if (!id) return;
      if (!quiet) followBottom.current = true;
      if (!quiet) setLoading(true);
      setError("");
      try {
        const [c, result] = await Promise.all([
          api<Conversation>(`/conversations/${id}`),
          api<{ messages: Message[]; hasMore: boolean }>(
            `/conversations/${id}/messages`,
          ),
        ]);
        if (activeId.current !== id) return;
        setConversation(c);
        if (!quiet) {
          const lastRead = c.members.find(m => m.userId === user?.id)?.lastReadAt;
          setFirstUnreadId(c.unreadCount > 0 ? result.messages.find(m => m.senderId !== user?.id && (!lastRead || m.createdAt > lastRead))?.id || null : null);
        }
        setMessages((old) => {
          if (!quiet || !old.length || !result.messages.length)
            return result.messages;
          const first = result.messages[0]!;
          return [
            ...old.filter(
              (m) =>
                new Date(m.createdAt) < new Date(first.createdAt) ||
                (m.createdAt === first.createdAt && m.id < first.id),
            ),
            ...result.messages,
          ];
        });
        setHasMore(result.hasMore);
        if (!quiet)
          setTimeout(
            () => { if (activeId.current === id && followBottom.current) scrollBottom(); },
            50,
          );
      } catch (e) {
        if (activeId.current === id)
          setError(e instanceof Error ? e.message : tr('screen424'));
      } finally {
        if (activeId.current === id) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    setMessages([]); setAtBottom(true); setFirstUnreadId(null);
    setContextView(false); setSelecting(false); setForwardIds([]); setForwardOpen(false);
    setConversation(null);
    setDraft(id ? queue(id).text : "");
    setReply(null);
    setTyping({});
    setInfoOpen(false);
    void load();
  }, [load]);
  useEffect(() => {
    if (id && sync > 0) void load(true);
  }, [sync, id, load]);
  useEffect(() => {
    const updated = conversations.find((c) => c.id === id);
    if (updated) setConversation(old => ({ ...updated, canWrite: old?.canWrite, mute: old?.mute, unreadAnnouncements: old?.unreadAnnouncements }));
  }, [conversations, id]);
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const reloadPermission = async () => {
      try { const current = await api<Conversation>(`/conversations/${id}`); if (!stopped && activeId.current === id) setConversation(current); }
      catch (e) { if (!stopped) setError(e instanceof Error ? e.message : t('groupActionFailed')); }
    };
    const changed = (data: { id: string }) => { if (data.id === id) void reloadPermission(); };
    socket?.on('conversation:updated', changed);
    const until = conversation?.mute?.until;
    const timer = until ? setTimeout(() => void reloadPermission(), Math.min(2147483647, Math.max(0, new Date(until).getTime() - Date.now()) + 100)) : undefined;
    return () => { stopped = true; socket?.off('conversation:updated', changed); if (timer) clearTimeout(timer); };
  }, [id, socket, conversation?.mute?.until]);
  useEffect(() => {
    if (!socket || !id) return;
    const onMessage = (message: Message) => {
      if (message.conversationId !== id) return;
      setMessages((old) =>
        old.some((m) => m.id === message.id) ? old : old.concat(message),
      );
    };
    const onUpdate = (message: Message) => {
      if (message.conversationId === id)
        setMessages((old) =>
          old.map((m) => (m.id === message.id ? message : m)),
        );
    };
    const onTyping = (data: {
      conversationId: string;
      userId: string;
      typing: boolean;
    }) => {
      if (data.conversationId === id && data.userId !== user!.id)
        setTyping((old) => ({
          ...old,
          [data.userId]: data.typing ? Date.now() : 0,
        }));
    };
    const onReceipt = (data: {
      conversationId: string;
      userId: string;
      messageId: string;
      type: string;
    }) => {
      if (data.conversationId !== id) return;
      setMessages((old) => {
        const boundary = old.findIndex((m) => m.id === data.messageId);
        if (boundary < 0) return old;
        const now = new Date().toISOString();
        return old.map((m, i) => {
          if (i > boundary || m.senderId === data.userId) return m;
          const reads = m.reads || [],
            prior = reads.find((r) => r.userId === data.userId);
          const receipt = {
            userId: data.userId,
            deliveredAt: prior?.deliveredAt || now,
            readAt: prior?.readAt || (data.type === "read" ? now : null),
          };
          return {
            ...m,
            reads: [...reads.filter((r) => r.userId !== data.userId), receipt],
          };
        });
      });
    };
    socket.on("message:new", onMessage);
    socket.on("message:updated", onUpdate);
    socket.on("typing", onTyping);
    socket.on("receipt:updated", onReceipt);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("message:updated", onUpdate);
      socket.off("typing", onTyping);
      socket.off("receipt:updated", onReceipt);
    };
  }, [socket, id, user?.id]);
  useEffect(() => {
    const input = composer.current; if (!input) return;
    input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }, [draft, id, loading]);
  useEffect(() => {
    const box = scroll.current;
    if (!box) return;
    let frame = 0;
    // Keyboard/composer changes resize the scroller without creating a message.
    // Keep the latest message visible only while the reader was following it.
    const preserveLatest = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (scroll.current === box && followBottom.current) box.scrollTop = box.scrollHeight;
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(preserveLatest);
    observer?.observe(box);
    // Images may grow after lazy loading without resizing the scroller itself.
    box.addEventListener('load', preserveLatest, true);
    window.addEventListener('resize', preserveLatest);
    return () => {
      observer?.disconnect();
      box.removeEventListener('load', preserveLatest, true);
      window.removeEventListener('resize', preserveLatest);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [id, loading]);
  const latestId = messages.at(-1)?.id;
  useEffect(() => { if (followBottom.current) scrollBottom(); }, [latestId]);
  useEffect(() => {
    if (!id || !latestId) return;
    const read = () => {
      const container = scroll.current,
        key = `${id}:${latestId}`;
      if (
        document.visibilityState === "visible" &&
        container &&
        container.scrollHeight - container.scrollTop - container.clientHeight <
          160 &&
        !readIds.current.has(key)
      ) {
        readIds.current.add(key);
        void Promise.all([
          api(
            `/conversations/${id}/delivered`,
            json("POST", { messageId: latestId }),
          ),
          api(
            `/conversations/${id}/read`,
            json("POST", { messageId: latestId }),
          ),
        ])
          .then(() => refresh())
          .catch(() => readIds.current.delete(key));
      }
    };
    const container = scroll.current;
    read();
    document.addEventListener("visibilitychange", read);
    container?.addEventListener("scroll", read, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", read);
      container?.removeEventListener("scroll", read);
    };
  }, [id, latestId, refresh]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setTyping((old) =>
          Object.fromEntries(
            Object.entries(old).filter(([, at]) => at > Date.now() - 4500),
          ),
        ),
      2000,
    );
    return () => clearInterval(timer);
  }, []);
  async function older() {
    if (!messages[0] || !id || olderLoading) return;
    setOlderLoading(true);
    const height = scroll.current?.scrollHeight || 0;
    const previousTop = scroll.current?.scrollTop || 0;
    const targetId = id;
    try {
      const result = await api<{ messages: Message[]; hasMore: boolean }>(
        `/conversations/${id}/messages?before=${encodeURIComponent(messages[0].id)}`,
      );
      if (activeId.current !== targetId) return;
      setMessages((old) => [
        ...result.messages.filter((m) => !old.some((v) => v.id === m.id)),
        ...old,
      ]);
      setHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (scroll.current && activeId.current === targetId)
          scroll.current.scrollTop = previousTop + scroll.current.scrollHeight - height;
      });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setOlderLoading(false);
    }
  }
  useEffect(() => {
    if (!id || !socket) return;
    const reporter = new TypingReporter(typing => {
      if (socket.connected) socket.emit('typing', { conversationId: id, typing });
    });
    typingReporter.current = reporter;
    return () => {
      reporter.stop();
      if (typingReporter.current === reporter) typingReporter.current = null;
    };
  }, [socket, id]);
  function updateDraft(value: string) {
    setDraft(value);
    if (id) queue().text = value;
    typingReporter.current?.update(!!value);
  }
  async function drainOutbox() {
    if (sendLock.current || !outbox.current.length) return;
    sendLock.current = true; setSending(true); setFailedSend(false);
    try {
      while (outbox.current.length && alive.current) {
        const item = outbox.current[0]!, targetId = item.conversationId, pending = item.pending;
        try {
          setUploading(!!pending.items.length);
          const attachmentIds = await pending.upload(chosen => {
            if (activeId.current === targetId) { setUploadName(chosen.name); setUploadProgress(0); }
            return uploadFile<Attachment>(chosen, progress => { if (alive.current && activeId.current === targetId) setUploadProgress(progress); }, targetId);
          });
          setUploading(false);
          const result = await api<Message>(`/conversations/${targetId}/messages`, json('POST', pending.prepare(pending.text.trim(), attachmentIds, item.reply?.id)));
          outbox.current.shift();
          // Normal success owns only its submitted snapshot. An asynchronous
          // receipt must never rewrite the newer, independently editable draft.
          const replacement = drafts.current.get(targetId) === pending ? new MediaDraft() : null;
          if (replacement) drafts.current.set(targetId, replacement);
          pending.clear();
          if (alive.current && activeId.current === targetId) {
            setMessages(old => old.some(m => m.id === result.id) ? old : old.concat(result));
            // A failed draft may have been restored before another room resumed
            // its retry. Clear only that exact replacement, rechecking on commit
            // so later typing always wins over this lower-priority completion.
            if (replacement) setDraft(current => drafts.current.get(targetId) === replacement && !replacement.text ? '' : current);
            renderDraft(v => v + 1);
          }
          if (alive.current) void refresh().catch(error => toast((error as Error).message, true));
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) pending.rejected();
          const current = drafts.current.get(targetId);
          // A failed snapshot returns to the input if it would not replace new typing.
          if (!current?.text && !current?.items.length) {
            drafts.current.set(targetId, pending);
            if (alive.current && activeId.current === targetId) { setDraft(pending.text); setReply(item.reply); }
          }
          if (alive.current) { setFailedSend(true); renderDraft(v => v + 1); toast((error as Error).message + tr('screen425'), true); }
          break;
        }
      }
    } finally {
      sendLock.current = false;
      if (alive.current) { setSending(false); setUploading(false); renderDraft(v => v + 1); }
      else { outbox.current.forEach(item => item.pending.clear()); outbox.current = []; }
    }
  }
  function send(e?: FormEvent) {
    e?.preventDefault();
    if (conversation?.canWrite === false || !id) return;
    const pending = queue();
    if (!pending.text.trim() && !pending.items.length) return;
    const existing = outbox.current.find(item => item.pending === pending);
    if (existing) existing.reply = reply;
    else outbox.current.push({ conversationId: id, pending, reply });
    drafts.current.set(id, new MediaDraft());
    setDraft(''); setReply(null); renderDraft(v => v + 1);
    typingReporter.current?.stop();
    if (composer.current) composer.current.style.height = 'auto';
    void drainOutbox();
  }
  function upload(files: FileList | File[] | null) {
    if (conversation?.canWrite === false) return;
    if (!files?.length || !id) return;
    try { queue().stage(Array.from(files)); renderDraft(v => v + 1); }
    catch (error) { toast((error as Error).message, true); }
    if (file.current) file.current.value = '';
  }
  const selectedTyping = Object.entries(typing)
    .filter(([, at]) => at > Date.now() - 4500)
    .map(
      ([uid]) =>
        conversation?.members.find((m) => m.userId === uid)?.user.displayName ||
        tr('screen426'),
    );
  if (!id)
    return (
      <section className="welcome-chat">
        <div className="welcome-center">
          <MessageCircle size={32} strokeWidth={1.5} aria-hidden="true" />
          <h1>{tr(conversations.length ? 'screen431' : 'screen432')}</h1>
          <p>{tr('screen433')}</p>
          <div className="welcome-actions">
            <Link to="/friends" className="btn btn-primary">{tr('screen435')}</Link>
            <button type="button" className="btn btn-secondary" onClick={() => setGroup(true)}><Plus size={17} />{tr('screen333')}</button>
          </div>
        </div>
        {group && <CreateGroup onClose={() => setGroup(false)} />}
      </section>
    );
  if (loading) return <section className="chat-skeleton" role="status" aria-label={tr('uiChatLoading')}>{Array.from({length: 5}, (_, i) => <div key={i}><span className="skeleton-line" /><span className="skeleton-line" /></div>)}</section>;
  if (error)
    return (
      <div className="chat-error">
        <Link className="back-link" to="/chat">
          <ArrowLeft size={17} /> {tr('screen209')}</Link>
        <ErrorBox message={error} retry={() => void load()} />
      </div>
    );
  if (!conversation)
    return (
      <Empty
        title={tr('screen440')}
        description={tr('screen441')}
      >
        <Link to="/chat" className="btn btn-secondary">
          {tr('screen209')}</Link>
      </Empty>
    );
  const title = conversationTitle(conversation, user!.id),
    other = conversationUser(conversation, user!.id),
    isChannel = conversation.type === "CHANNEL",
    isGroup = conversation.type !== "DIRECT",
    writable = conversation.canWrite !== false;
  return (
    <div className="chat-room">
      <div className="chat-primary">
        <header className="chat-header">
          <Link
            className="icon-btn mobile-back"
            to={isChannel ? `/servers/${conversation.channel?.serverId}` : "/chat"}
            aria-label={tr('screen442')}
          >
            <ArrowLeft size={22} />
          </Link>
          {isChannel ? <div className="channel-symbol"><Hash size={28} /></div> : <Avatar user={other} group={isGroup} showStatus={!isGroup} />}
          <div className="chat-header-title">
            <h1>
              <span className="chat-title-text">{title}</span>
              {isGroup && <span className="group-tag">{isChannel ? tr('screen443') : tr('screen217')}</span>}
            </h1>
            <span>
              {isChannel ? conversation.description || tr('screen443') : isGroup
                ? tr('screen444', {v0: conversation.members.length, v1: conversation.members.filter((m) => m.user.status === "ONLINE").length})
                : statusText(other)}
            </span>
          </div>
          <div className="chat-header-actions"><button type="button" className="icon-btn forward-trigger" title={t(selecting ? "forwardCancel" : "forwardSelect")} aria-label={t(selecting ? "forwardCancel" : "forwardSelect")} onClick={() => { setSelecting(!selecting); setForwardIds([]); }}><Forward size={19} /></button><MessageSearch key={conversation.id} conversation={conversation} locate={locateMessage} />
            <button
              className={`icon-btn ${infoOpen ? "selected" : ""}`}
              onClick={() => setInfoOpen(!infoOpen)}
              aria-label={tr('screen445')}
              aria-expanded={infoOpen}
            >
              <Info size={21} />
            </button>
            {isGroup && (
              <Link
                className="icon-btn"
                to={isChannel ? `/servers/${conversation.channel?.serverId}/settings` : `/groups/${id}`}
                aria-label={isChannel ? tr('screen446') : tr('screen214')}
              >
                <MoreHorizontal size={23} />
              </Link>
            )}
          </div>
        </header>
        {!!conversation.unreadAnnouncements && conversation.type === 'GROUP' && <Link className="announcement-banner" to={`/groups/${id}#announcements`}>{t('unreadAnnouncements', {count: conversation.unreadAnnouncements})}</Link>}
        {conversation.mute && !writable && <p className="mute-banner" role="status">{tr('uiMuted')}</p>}
        {contextView && <button className="btn btn-secondary" onClick={() => { setContextView(false); void load(); }}>{t("backLatest")}</button>}
        {selecting && <button type="button" className="btn btn-primary" disabled={!forwardIds.length} onClick={() => setForwardOpen(true)}>{t("forwardCount", { count: forwardIds.length })}</button>}
        <div className="chat-security-note">
          <ShieldCheck size={12} />
          <span>{tr('screen447')}</span>
        </div>
        <div
          className="messages-scroll"
          ref={scroll}
          onScroll={() => {
            const box = scroll.current;
            if (box) { followBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 160; setAtBottom(followBottom.current); }
            if (
              scroll.current &&
              scroll.current.scrollTop < 60 &&
              hasMore &&
              !olderLoading
            )
              void older();
          }}
        >
          {hasMore && (
            <button
              className="load-older"
              onClick={() => void older()}
              disabled={olderLoading}
            >
              {olderLoading ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <ChevronDown size={14} />
              )}{" "}
              {tr('screen448')}</button>
          )}
          {messages.length === 0 ? (
            <div className="conversation-start">
              {isChannel ? <div className="channel-symbol channel-symbol-large"><Hash size={40} /></div> : <Avatar user={other} group={isGroup} size="xl" />}
              <h2>
                {isGroup ? tr('screen449') : tr('screen450', {v0: title})}
              </h2>
              <p>
                {isGroup
                  ? tr('screen451')
                  : tr('screen452')}
              </p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  updateDraft(tr('screen453'));
                  composer.current?.focus();
                }}
              >
                {tr('screen454')}</button>
            </div>
          ) : (
            messages.map((m, index) => {
              const previous = messages[index - 1],
                showDate =
                  !previous ||
                  new Date(previous.createdAt).toDateString() !==
                    new Date(m.createdAt).toDateString();
              return (
                <div key={m.id} id={`message-${m.id}`}>
                  {selecting && !m.retractedAt && <label className="forward-select"><input type="checkbox" checked={forwardIds.includes(m.id)} disabled={!forwardIds.includes(m.id) && forwardIds.length >= 20} onChange={e => setForwardIds(old => e.target.checked ? [...old, m.id] : old.filter(id => id !== m.id))} />{t("forwardSelected")}</label>}
                  {showDate && (
                    <div className="date-divider">
                      <span>
                        {new Date(m.createdAt).toLocaleDateString(getLanguage(), {
                          month: "long",
                          day: "numeric",
                          weekday: "long",
                        })}
                      </span>
                    </div>
                  )}
                  {m.id === firstUnreadId && <div className="unread-divider" role="separator">{tr('uiUnreadDivider')}</div>}
                  <MessageRow
                    message={m}
                    conversation={conversation}
                    own={m.senderId === user!.id}
                    onLocate={locateMessage}
                    onForward={() => { setForwardIds([m.id]); setForwardOpen(true); }}
                    onReply={() => {
                      setReply(m);
                      composer.current?.focus();
                    }}
                    onEdit={() => {
                      setEditing(m);
                      setEditedText(m.content);
                    }}
                    onRetract={() =>
                      setConfirm({
                        title: tr('screen455'),
                        description: tr('screen456'),
                        run: async () => {
                          const result = await api<Message>(
                            `/messages/${m.id}/retract`,
                            json("POST"),
                          );
                          setMessages((old) =>
                            old.map((v) => (v.id === m.id ? result : v)),
                          );
                          await refresh();
                        },
                      })
                    }
                    onHide={() =>
                      setConfirm({
                        title: tr('screen457'),
                        description:
                          tr('screen458'),
                        run: async () => {
                          await api(`/messages/${m.id}`, json("DELETE"));
                          setMessages((old) =>
                            old.filter((v) => v.id !== m.id),
                          );
                          await refresh();
                        },
                      })
                    }
                  />
                </div>
              );
            })
          )}
          <div ref={end} />
        </div>
        {!atBottom && !contextView && <button type="button" className="btn btn-secondary jump-latest" onClick={() => { followBottom.current = true; setAtBottom(true); scrollBottom(); }}><ChevronDown size={16} />{t("backLatest")}</button>}
        <div className="typing-indicator" aria-live="polite">
          {selectedTyping.length > 0 && (
            <>
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {selectedTyping.join("、")} {tr('screen459')}</>
          )}
        </div>
        <form className="composer-wrap" onSubmit={send}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); upload(e.dataTransfer.files); } }}>
          {reply && (
            <div className="composer-reply">
              <Reply size={15} />
              <div>
                <strong>{tr('screen460')}{reply.sender?.displayName || tr('screen354')}</strong>
                <p>{reply.content || tr('screen360')}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setReply(null)}
                aria-label={tr('screen461')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {!!media?.items.length && <div className="pending-media" aria-label={tr('screen462')}>
            {media.items.map(item => <div className="pending-media-item" key={item.id}>
              {item.preview ? <a href={item.preview} target="_blank" rel="noreferrer" aria-label={tr('screen463', {v0: item.file.name})}><img src={item.preview} alt={item.file.name} /></a> : <File size={24} />}
              <span>{item.file.name}<small>{(item.file.size / 1024 / 1024).toFixed(2)} {tr('mib')}{item.attachment ? tr('screen464') : tr('screen465')}</small></span>
              <button type="button" className="icon-btn" disabled={!!media.delivery} aria-label={tr('screen466', {v0: item.file.name})} onClick={() => { media.remove(item.id); renderDraft(v => v + 1); }}><X size={16} /></button>
            </div>)}
          </div>}
          {failedSend && outbox.current.length > 0 && <div className="outbox-status" role="status"><span>{tr('outboxFailed', { count: outbox.current.length })}</span>{failedSend && <><p>{outbox.current[0]?.pending.text || tr('fileType')}</p><button type="button" className="btn btn-secondary" onClick={() => {
            const first = outbox.current[0];
            if (first && drafts.current.get(first.conversationId) === first.pending) {
              drafts.current.set(first.conversationId, new MediaDraft());
              if (activeId.current === first.conversationId) { setDraft(''); setReply(null); }
            }
            void drainOutbox();
          }}>{tr('retry')}</button></>}</div>}
          {media?.delivery && !sending && <p className="form-error" role="status">{tr('screen467')}</p>}
          {uploading && <div className="upload-progress" role="status"><span>{uploadProgress === 100 ? tr('screen468') : tr('screen469', {v0: uploadProgress})} · {uploadName}</span><progress max={100} value={uploadProgress} aria-label={tr('screen470')} /></div>}
          <div className="composer">
            <textarea
              ref={composer}
              disabled={!writable}
              readOnly={!!media?.delivery}
              aria-busy={sending}
              onPaste={e => { const images = clipboardImages(e.clipboardData.items); if (images.length) { e.preventDefault(); upload(images); } }}
              rows={1}
              value={draft}
              onChange={(e) => {
                updateDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (
                  shouldSend(e, sendShortcut)
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              onBlur={() =>
                typingReporter.current?.stop()
              }
              placeholder={!writable ? tr('screen471') : tr('screen472', {v0: title})}
              aria-label={tr('screen473')}
              maxLength={4000}
            />
            <div className="composer-toolbar">
              <div>
                <button
                  type="button"
                  className={`icon-btn ${emojiOpen ? "selected" : ""}`}
                  onClick={() => setEmojiOpen(!emojiOpen)}
                  aria-label={tr('screen474')}
                  aria-expanded={emojiOpen}
                >
                  <Smile size={21} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={tr('screen475')}
                  onClick={() => file.current?.click()}
                  disabled={!writable || !!media?.delivery}
                >
                  {uploading ? (
                    <LoaderCircle size={20} className="spin" />
                  ) : (
                    <Paperclip size={21} />
                  )}
                </button>
                <input
                  hidden
                  type="file"
                  multiple
                  ref={file}
                  accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                  onChange={(e) => void upload(e.target.files)}
                />
                <span className="composer-file-hint">
                  {tr('screen476')}</span>
              </div>
              <div>
                <span className="send-hint">
                  {sendShortcut === "enter" ? tr('screen477') : tr('screen478')} <kbd>↵</kbd>
                </span>
                <button
                  type="submit"
                  className="send-button"
                  onPointerDown={e => { if (document.activeElement === composer.current) e.preventDefault(); }}
                  disabled={
                    !writable ||
                    (!draft.trim() && !media?.items.length)
                  }
                  aria-label={tr('screen479')}
                >
                  {sending ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </div>
            </div>
            {emojiOpen && (
              <div className="emoji-palette" role="group" aria-label={tr('screen480')}>
                {emojis.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => {
                      updateDraft(draft + emoji);
                      setEmojiOpen(false);
                      composer.current?.focus();
                    }}
                    aria-label={tr('screen481', {v0: emoji})}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-footnote">
            {tr('screen482')}<span>
              {draft.length
                ? `${draft.length} / 4000`
                : null}
            </span>
          </div>
        </form>
      </div>
      {forwardOpen && <ForwardDialog messages={messages.filter(m => forwardIds.includes(m.id))} close={() => setForwardOpen(false)} done={() => { setForwardOpen(false); setSelecting(false); setForwardIds([]); toast(t("forwardDone")); void refresh().catch(e => toast(e.message, true)); }} />}
      {infoOpen && (
        <InfoPanel close={() => setInfoOpen(false)}>
        <aside className="conversation-info">
          <header>
            <span>{tr('screen484')}</span>
            <button
              className="icon-btn"
              aria-label={tr('screen485')}
              onClick={() => setInfoOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="info-profile">
            {isChannel ? <div className="channel-symbol channel-symbol-large"><Hash size={40} /></div> : <Avatar user={other} group={isGroup} size="xl" />}
            <h2>{title}</h2>
            <p>
              {isGroup
                ? conversation.description || tr('screen486')
                : (other as { bio?: string })?.bio ||
                  tr('screen487')}
            </p>
            <span className="info-badge">
              {isGroup ? <Users size={13} /> : <MessageCircle size={13} />}{" "}
              {isGroup ? tr('screen488', {v0: conversation.members.length}) : tr('screen489')}
            </span>
          </div>
          {isGroup ? (
            <>
              <div className="info-section-title">
                {isChannel ? tr('screen490') : tr('screen232')} <span>{conversation.members.length}</span>
              </div>
              <div className="info-member-list">
                {conversation.members.map((m) => (
                  <Link key={m.userId} to={`/profile/${m.userId}`}>
                    <Avatar user={m.user} size="sm" showStatus />
                    <span>
                      {m.user.displayName}
                      <small>
                        {m.role === "OWNER"
                          ? (isChannel ? tr('screen491') : tr('screen235'))
                          : m.role === "ADMIN"
                            ? tr('screen236')
                            : statusText(m.user)}
                      </small>
                    </span>
                    <ArrowUpRight size={14} />
                  </Link>
                ))}
              </div>
              <Link to={isChannel ? `/servers/${conversation.channel?.serverId}/settings` : `/groups/${id}`} className="btn btn-secondary">
                {isChannel ? tr('screen492') : tr('screen493')} <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() =>
                navigate(`/profile/${(other as { id?: string })?.id}`)
              }
            >
              {tr('screen494')}<ArrowUpRight size={15} />
            </button>
          )}
          <div className="info-section-title">{tr('uiInfoFiles')}</div>
          <section className="info-files"><p>{tr('uiInfoFilesHint')}</p>{messages.flatMap(m => m.attachments).length ? messages.flatMap(m => m.attachments).map(a => <AttachmentPreview key={a.id} attachment={a} />) : <p>{tr('uiNoFiles')}</p>}</section>
          <div className="info-privacy">
            <ShieldCheck size={20} />
            <p>
              {tr('screen495')}<br />
              <small>{tr('screen496')}</small>
            </p>
          </div>
        </aside></InfoPanel>
      )}
      {editing && (
        <Dialog title={tr('screen497')} onClose={() => setEditing(null)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await task(() =>
                api<Message>(
                  `/messages/${editing.id}`,
                  json("PATCH", { content: editedText }),
                ),
              );
              if (result) {
                setMessages((old) =>
                  old.map((m) => (m.id === result.id ? result : m)),
                );
                setEditing(null);
                void refresh();
              }
            }}
          >
            <label>
              {tr('screen473')}<textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                required
                maxLength={4000}
                rows={5}
              />
            </label>
            <button className="btn btn-primary">{tr('screen231')}</button>
          </form>
        </Dialog>
      )}
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="muted">{confirm.description}</p>
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
              {tr('screen498')}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function MessageRow({
  message: m,
  conversation,
  own,
  onReply,
  onEdit,
  onRetract,
  onHide,
  onLocate,
  onForward,
}: {
  message: Message;
  conversation: Conversation;
  own: boolean;
  onReply: () => void;
  onEdit: () => void;
  onRetract: () => void;
  onHide: () => void;
  onLocate: (id: string) => Promise<void>;
  onForward?: () => void;
}) {
  useLanguage();
  const t = useSoundText();
  const [menu, setMenu] = useState(false),
    { toast } = useApp();
  const peers = conversation.members.filter((v) => v.userId !== m.senderId),
    read =
      peers.length > 0 &&
      peers.every((v) =>
        m.reads?.some((r) => r.userId === v.userId && r.readAt),
      ),
    delivered =
      peers.length > 0 &&
      peers.every((v) =>
        m.reads?.some((r) => r.userId === v.userId && r.deliveredAt),
      );
  if (m.retractedAt || m.deletedAt)
    return (
      <div className="retracted-message">
        {own ? tr('screen499') : m.sender?.displayName || tr('screen426')}{tr('screen500')}{" "}
        <span>{formatTime(m.createdAt)}</span>
      </div>
    );
  return (
    <article className={`message-row ${own ? "own" : ""}`}>
      <Link
        className="message-avatar"
        to={`/profile/${m.senderId}`}
        aria-label={tr('screen501', {v0: m.sender?.displayName || tr('genericUser')})}
      >
        <Avatar user={m.sender} size="sm" />
      </Link>
      <div className="message-column">
        <div className="message-meta">
          <strong>{own ? tr('screen499') : m.sender?.displayName || tr('screen281')}</strong>
          <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
        </div>
        <div className="message-body">
          {m.replyTo && (
            <button
              className="reply-preview"
              onClick={() => void onLocate(m.replyTo!.id).catch(e => toast(t(e instanceof ApiError && e.status === 404 ? 'deletedOriginal' : 'searchError'), true))}
            >
              <Reply size={13} />
              <span>
                <strong>{m.replyTo.sender?.displayName || tr('screen354')}</strong>
                <span>
                  {m.replyTo.retractedAt
                    ? t("deletedOriginal")
                    : m.replyTo.content || t(m.replyTo.attachments?.some(a => a.mimeType.startsWith('image/')) ? 'imageType' : 'fileType')}
                </span>
              </span>
            </button>
          )}
          {m.forwardedFrom && <p className="forwarded-label">{t("forwardedLabel", { name: m.forwardedFrom.senderName })}</p>}
          {m.content && <div className="message-content">{m.content}</div>}
          {m.attachments?.map(a => <AttachmentPreview key={a.id} attachment={a} />)}
        </div>
        <div className="message-footer">
          {m.editedAt && <span>{tr('screen502')}</span>}
          {own && (
            <span
              className={`message-receipt ${read ? "read" : ""}`}
              title={read ? tr('screen503') : delivered ? tr('screen504') : tr('screen505')}
            >
              {read || delivered ? (
                <CheckCheck size={14} />
              ) : (
                <Check size={14} />
              )}{" "}
              {read ? tr('screen506') : delivered ? tr('screen504') : tr('screen505')}
            </span>
          )}
        </div>
      </div>
      <div className="message-tools"><ReportButton targetType="MESSAGE" targetId={m.id} />
        <button
          className="icon-btn"
          onClick={onReply}
          aria-label={tr('screen507')}
          title={tr('screen460')}
        >
          <Reply size={16} />
        </button>
        <button
          className="icon-btn message-more"
          onClick={() => setMenu(!menu)}
          aria-label={tr('screen508')}
          aria-expanded={menu}
        >
          <MoreHorizontal size={18} />
        </button>
        {menu && (
          <div className="message-menu" role="group" aria-label={tr('screen508')} onKeyDown={e => { if (e.key === "Escape") setMenu(false); }}>
            <button className="message-reply-mobile" onClick={() => { setMenu(false); onReply(); }}><Reply size={14} />{tr('screen507')}</button>
            {onForward && <button onClick={() => { setMenu(false); onForward(); }}><Forward size={14} />{t("forwardSelect")}</button>}
            <ReportButton targetType="MESSAGE" targetId={m.id} />
            <button
              onClick={() => {
                setMenu(false);
                const copy = navigator.clipboard?.writeText(m.id);
                if (copy)
                  void copy
                    .then(() => toast(tr('screen509')))
                    .catch(() => toast(tr('screen510', {v0: m.id})));
                else toast(tr('screen510', {v0: m.id}));
              }}
            >
              <Copy size={14} />
              {tr('screen511')}</button>
            {own && (
              <>
                <button
                  onClick={() => {
                    setMenu(false);
                    onEdit();
                  }}
                >
                  <Pencil size={14} />
                  {tr('screen512')}</button>
                <button
                  onClick={() => {
                    setMenu(false);
                    onRetract();
                  }}
                >
                  <Reply size={14} />
                  {tr('screen513')}</button>
              </>
            )}
            <button
              onClick={() => {
                setMenu(false);
                onHide();
              }}
            >
              <Trash2 size={14} />
              {tr('screen514')}</button>
          </div>
        )}
      </div>
    </article>
  );
}

function InfoPanel({children, close}: {children: import('react').ReactNode; close: () => void}) {
 const [overlay, setOverlay] = useState(() => window.matchMedia('(max-width:1279px)').matches);
 useEffect(() => { const media = window.matchMedia('(max-width:1279px)'); const update = () => setOverlay(media.matches); media.addEventListener('change',update); return () => media.removeEventListener('change',update); },[]);
 return overlay ? <Dialog title={tr('screen484')} className="info-dialog" onClose={close}>{children}</Dialog> : <>{children}</>;
}
