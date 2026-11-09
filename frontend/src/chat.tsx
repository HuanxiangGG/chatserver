import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  File,
  Image,
  Info,
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
  Sparkles,
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
  Spinner,
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
    typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    activeId = useRef(id),
    readIds = useRef(new Set<string>()),
    task = useTask(),
    navigate = useNavigate();
  const drafts = useRef(new Map<string, MediaDraft>());
  const sendLock = useRef(false);
  const queue = (key = id) => {
    if (!key) throw Error('请先选择会话');
    if (!drafts.current.has(key)) drafts.current.set(key, new MediaDraft());
    return drafts.current.get(key)!;
  };
  const media = id ? queue() : null;
  useEffect(() => () => { drafts.current.forEach(d => d.clear()); drafts.current.clear(); }, []);
  activeId.current = id;
  const load = useCallback(
    async (quiet = false) => {
      if (!id) return;
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
            () => end.current?.scrollIntoView({ behavior: "instant" }),
            50,
          );
      } catch (e) {
        if (activeId.current === id)
          setError(e instanceof Error ? e.message : "无法加载会话");
      } finally {
        if (activeId.current === id) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    setMessages([]);
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
    if (updated) setConversation(updated);
  }, [conversations, id]);
  useEffect(() => {
    if (!socket || !id) return;
    const onMessage = (message: Message) => {
      if (message.conversationId !== id) return;
      const nearBottom =
        !scroll.current ||
        scroll.current.scrollHeight -
          scroll.current.scrollTop -
          scroll.current.clientHeight <
          160;
      setMessages((old) =>
        old.some((m) => m.id === message.id) ? old : old.concat(message),
      );
      if (nearBottom || message.senderId === user!.id)
        setTimeout(
          () => end.current?.scrollIntoView({ behavior: "smooth" }),
          50,
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
      socket.emit("typing", { conversationId: id, typing: false });
    };
  }, [socket, id, user?.id]);
  const latestId = messages.at(-1)?.id;
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
    try {
      const result = await api<{ messages: Message[]; hasMore: boolean }>(
        `/conversations/${id}/messages?before=${encodeURIComponent(messages[0].id)}`,
      );
      setMessages((old) => [
        ...result.messages.filter((m) => !old.some((v) => v.id === m.id)),
        ...old,
      ]);
      setHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (scroll.current)
          scroll.current.scrollTop = scroll.current.scrollHeight - height;
      });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setOlderLoading(false);
    }
  }
  function updateDraft(value: string) {
    setDraft(value);
    if (id) queue().text = value;
    if (!id || !socket) return;
    socket.emit("typing", { conversationId: id, typing: !!value });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(
      () => socket.emit("typing", { conversationId: id, typing: false }),
      1500,
    );
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!id || sendLock.current || (!draft.trim() && !queue().items.length)) return;
    const targetId = id, pending = queue(), content = draft.trim(), replyToId = reply?.id;
    sendLock.current = true;
    setSending(true);
    try {
      setUploading(!!pending.items.length);
      const attachmentIds = await pending.upload(chosen => {
        if (activeId.current === targetId) { setUploadName(chosen.name); setUploadProgress(0); }
        return uploadFile<Attachment>(chosen, progress => { if (activeId.current === targetId) setUploadProgress(progress); });
      });
      setUploading(false);
      const result = await api<Message>(`/conversations/${targetId}/messages`, json('POST', pending.prepare(content, attachmentIds, replyToId)));
      pending.clear();
      if (activeId.current === targetId) {
        setMessages(old => old.some(m => m.id === result.id) ? old : old.concat(result));
        setDraft(''); setReply(null); renderDraft(v => v + 1);
        end.current?.scrollIntoView({ behavior: 'smooth' });
        if (composer.current) { composer.current.style.height = 'auto'; composer.current.focus(); }
      }
      socket?.emit('typing', { conversationId: targetId, typing: false });
      void refresh().catch(() => {});
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) pending.rejected();
      renderDraft(v => v + 1);
      toast((error as Error).message + '；草稿已保留，可再次发送重试', true);
    } finally {
      sendLock.current = false; setSending(false); setUploading(false);
    }
  }
  function upload(files: FileList | File[] | null) {
    if (!files?.length || sendLock.current || !id) return;
    try { queue().stage(Array.from(files)); renderDraft(v => v + 1); }
    catch (error) { toast((error as Error).message, true); }
    if (file.current) file.current.value = '';
  }
  const selectedTyping = Object.entries(typing)
    .filter(([, at]) => at > Date.now() - 4500)
    .map(
      ([uid]) =>
        conversation?.members.find((m) => m.userId === uid)?.user.displayName ||
        "对方",
    );
  if (!id)
    return (
      <section className="welcome-chat">
        <div className="welcome-top">
          <span>你的日常，从一句问候开始。</span>
          <span>
            <span className="tiny-online" /> 连接彼此
          </span>
        </div>
        <div className="welcome-center">
          <div className="welcome-illustration" aria-hidden="true">
            <div className="welcome-ring ring-outer" />
            <div className="welcome-ring ring-inner" />
            <div className="welcome-chat-icon">
              <MessageCircle size={48} strokeWidth={1.5} />
              <span />
            </div>
            <span className="floating-spark">
              <Sparkles size={23} />
            </span>
            <span className="floating-bubble">
              嗨！<span>👋</span>
            </span>
            <span className="floating-dot" />
          </div>
          <span className="eyebrow">让每一天，靠近一点</span>
          <h1>
            在这里，
            <br />
            与重要的人保持靠近<span>。</span>
          </h1>
          <p>
            选择一段对话，或开启一段新的连接。
            <br />
            从日常小事，到闪光的想法，都有地方安放。
          </p>
          <div className="welcome-actions">
            <Link to="/friends" className="btn btn-primary">
              发现你的好友
              <ArrowUpRight size={17} />
            </Link>
            <button
              className="btn btn-secondary"
              onClick={() => setGroup(true)}
            >
              <Plus size={17} />
              创建群聊
            </button>
          </div>
        </div>
        <div className="welcome-bottom">
          <span>
            <ShieldCheck size={16} /> 私密对话，由你掌握
          </span>
          <span>
            <CheckCheck size={17} /> 跨设备，随时接续
          </span>
          <span>
            <Image size={16} /> 分享不止于文字
          </span>
        </div>
        {group && <CreateGroup onClose={() => setGroup(false)} />}
      </section>
    );
  if (loading) return <Spinner label="正在打开对话…" />;
  if (error)
    return (
      <div className="chat-error">
        <Link className="back-link" to="/chat">
          <ArrowLeft size={17} /> 返回消息
        </Link>
        <ErrorBox message={error} retry={() => void load()} />
      </div>
    );
  if (!conversation)
    return (
      <Empty
        title="找不到这段对话"
        description="会话可能已解散，或你已被移出。"
      >
        <Link to="/chat" className="btn btn-secondary">
          返回消息
        </Link>
      </Empty>
    );
  const title = conversationTitle(conversation, user!.id),
    other = conversationUser(conversation, user!.id),
    isGroup = conversation.type === "GROUP";
  return (
    <div className="chat-room">
      <div className="chat-primary">
        <header className="chat-header">
          <Link
            className="icon-btn mobile-back"
            to="/chat"
            aria-label="返回消息列表"
          >
            <ArrowLeft size={22} />
          </Link>
          <Avatar user={other} group={isGroup} showStatus={!isGroup} />
          <div className="chat-header-title">
            <h1>
              {title}
              {isGroup && <span className="group-tag">群聊</span>}
            </h1>
            <span>
              {isGroup
                ? `${conversation.members.length} 位成员 · ${conversation.members.filter((m) => m.user.status === "ONLINE").length} 人在线`
                : statusText(other)}
            </span>
          </div>
          <div className="chat-header-actions">
            <button
              className={`icon-btn ${infoOpen ? "selected" : ""}`}
              onClick={() => setInfoOpen(!infoOpen)}
              aria-label="查看会话信息"
              aria-expanded={infoOpen}
            >
              <Info size={21} />
            </button>
            {isGroup && (
              <Link
                className="icon-btn"
                to={`/groups/${id}`}
                aria-label="群聊管理"
              >
                <MoreHorizontal size={23} />
              </Link>
            )}
          </div>
        </header>
        <div className="chat-security-note">
          <ShieldCheck size={12} />
          <span>仅会话成员可访问聊天记录</span>
        </div>
        <div
          className="messages-scroll"
          ref={scroll}
          onScroll={() => {
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
              加载更早的消息
            </button>
          )}
          {messages.length === 0 ? (
            <div className="conversation-start">
              <Avatar user={other} group={isGroup} size="xl" />
              <h2>
                {isGroup ? "新的空间，新的对话" : `向 ${title} 打个招呼吧`}
              </h2>
              <p>
                {isGroup
                  ? "用第一条消息，开启这里的故事。"
                  : "一句简单的问候，就是美好的开始。"}
              </p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  updateDraft("嗨！很高兴在这里见到你 👋");
                  composer.current?.focus();
                }}
              >
                发送一个问候 👋
              </button>
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
                  {showDate && (
                    <div className="date-divider">
                      <span>
                        {new Date(m.createdAt).toLocaleDateString("zh-CN", {
                          month: "long",
                          day: "numeric",
                          weekday: "long",
                        })}
                      </span>
                    </div>
                  )}
                  <MessageRow
                    message={m}
                    conversation={conversation}
                    own={m.senderId === user!.id}
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
                        title: "撤回这条消息？",
                        description: "撤回后，所有成员将无法再查看此消息内容。",
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
                        title: "从你的记录中删除？",
                        description:
                          "这条消息会从你的聊天记录中隐藏，其他成员仍可查看。",
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
        <div className="typing-indicator" aria-live="polite">
          {selectedTyping.length > 0 && (
            <>
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {selectedTyping.join("、")} 正在输入…
            </>
          )}
        </div>
        <form className="composer-wrap" onSubmit={send}
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); upload(e.dataTransfer.files); } }}>
          {reply && (
            <div className="composer-reply">
              <Reply size={15} />
              <div>
                <strong>回复 {reply.sender?.displayName || "消息"}</strong>
                <p>{reply.content || "[文件]"}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setReply(null)}
                aria-label="取消回复"
              >
                <X size={17} />
              </button>
            </div>
          )}
          {!!media?.items.length && <div className="pending-media" aria-label="待发送附件">
            {media.items.map(item => <div className="pending-media-item" key={item.id}>
              {item.preview ? <a href={item.preview} target="_blank" rel="noreferrer" aria-label={`预览 ${item.file.name}`}><img src={item.preview} alt={item.file.name} /></a> : <File size={24} />}
              <span>{item.file.name}<small>{(item.file.size / 1024 / 1024).toFixed(2)} MiB{item.attachment ? ' · 已上传' : ' · 待发送'}</small></span>
              <button type="button" className="icon-btn" disabled={sending || !!media.delivery} aria-label={`移除 ${item.file.name}`} onClick={() => { media.remove(item.id); renderDraft(v => v + 1); }}><X size={16} /></button>
            </div>)}
          </div>}
          {media?.delivery && !sending && <p className="form-error" role="status">消息确认失败，原内容已保留。请再次点击发送确认，确认前暂停编辑以避免重复消息。</p>}
          {uploading && <div className="upload-progress" role="status"><span>{uploadProgress === 100 ? '正在验证文件' : `正在上传 ${uploadProgress}%`} · {uploadName}</span><progress max={100} value={uploadProgress} aria-label="文件上传进度" /></div>}
          <div className="composer">
            <textarea
              ref={composer}
              disabled={sending || !!media?.delivery}
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
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              onBlur={() =>
                socket?.emit("typing", { conversationId: id, typing: false })
              }
              placeholder={`发送消息给${isGroup ? "群聊" : ` ${title}`}…`}
              aria-label="消息内容"
              maxLength={4000}
            />
            <div className="composer-toolbar">
              <div>
                <button
                  type="button"
                  className={`icon-btn ${emojiOpen ? "selected" : ""}`}
                  onClick={() => setEmojiOpen(!emojiOpen)}
                  aria-label="选择表情"
                  aria-expanded={emojiOpen}
                >
                  <Smile size={21} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="添加图片或文件"
                  onClick={() => file.current?.click()}
                  disabled={uploading || sending}
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
                  图片 / 文件 · 最大 10 MiB · 可粘贴或拖入
                </span>
              </div>
              <div>
                <span className="send-hint">
                  回车发送 <kbd>↵</kbd>
                </span>
                <button
                  type="submit"
                  className="send-button"
                  disabled={
                    sending ||
                    uploading ||
                    (!draft.trim() && !media?.items.length)
                  }
                  aria-label="发送消息"
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
              <div className="emoji-palette" role="group" aria-label="表情选择">
                {emojis.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => {
                      updateDraft(draft + emoji);
                      setEmojiOpen(false);
                      composer.current?.focus();
                    }}
                    aria-label={`插入 ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-footnote">
            Shift + Enter 换行
            <span>
              {draft.length
                ? `${draft.length} / 4000`
                : "让每一句话，都有回应。"}
            </span>
          </div>
        </form>
      </div>
      {infoOpen && (
        <aside className="conversation-info">
          <header>
            <span>会话信息</span>
            <button
              className="icon-btn"
              aria-label="关闭会话信息"
              onClick={() => setInfoOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="info-profile">
            <Avatar user={other} group={isGroup} size="xl" />
            <h2>{title}</h2>
            <p>
              {isGroup
                ? conversation.description || "一起聊聊，让想法自然发生。"
                : (other as { bio?: string })?.bio ||
                  "从一句问候开始，慢慢熟悉彼此。"}
            </p>
            <span className="info-badge">
              {isGroup ? <Users size={13} /> : <MessageCircle size={13} />}{" "}
              {isGroup ? `${conversation.members.length} 位成员` : "好友私聊"}
            </span>
          </div>
          {isGroup ? (
            <>
              <div className="info-section-title">
                群成员 <span>{conversation.members.length}</span>
              </div>
              <div className="info-member-list">
                {conversation.members.map((m) => (
                  <Link key={m.userId} to={`/profile/${m.userId}`}>
                    <Avatar user={m.user} size="sm" showStatus />
                    <span>
                      {m.user.displayName}
                      <small>
                        {m.role === "OWNER"
                          ? "群主"
                          : m.role === "ADMIN"
                            ? "管理员"
                            : statusText(m.user)}
                      </small>
                    </span>
                    <ArrowUpRight size={14} />
                  </Link>
                ))}
              </div>
              <Link to={`/groups/${id}`} className="btn btn-secondary">
                管理群聊 <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() =>
                navigate(`/profile/${(other as { id?: string })?.id}`)
              }
            >
              查看个人资料
              <ArrowUpRight size={15} />
            </button>
          )}
          <div className="info-privacy">
            <ShieldCheck size={20} />
            <p>
              这个空间，属于你们。
              <br />
              <small>成员权限在服务端验证。</small>
            </p>
          </div>
        </aside>
      )}
      {editing && (
        <Dialog title="编辑消息" onClose={() => setEditing(null)}>
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
              消息内容
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                required
                maxLength={4000}
                rows={5}
              />
            </label>
            <button className="btn btn-primary">保存修改</button>
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
              确认操作
            </button>
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
}: {
  message: Message;
  conversation: Conversation;
  own: boolean;
  onReply: () => void;
  onEdit: () => void;
  onRetract: () => void;
  onHide: () => void;
}) {
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
        {own ? "你" : m.sender?.displayName || "对方"}撤回了一条消息{" "}
        <span>{formatTime(m.createdAt)}</span>
      </div>
    );
  return (
    <article className={`message-row ${own ? "own" : ""}`}>
      <Link
        className="message-avatar"
        to={`/profile/${m.senderId}`}
        aria-label={`查看 ${m.sender?.displayName || "用户"} 的资料`}
      >
        <Avatar user={m.sender} size="sm" />
      </Link>
      <div className="message-column">
        <div className="message-meta">
          <strong>{own ? "你" : m.sender?.displayName || "用户"}</strong>
          <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
        </div>
        <div className="message-body">
          {m.replyTo && (
            <button
              className="reply-preview"
              onClick={() =>
                document
                  .getElementById(`message-${m.replyTo!.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            >
              <Reply size={13} />
              <span>
                <strong>{m.replyTo.sender?.displayName || "消息"}</strong>
                <span>
                  {m.replyTo.retractedAt
                    ? "消息已撤回"
                    : m.replyTo.content || "[文件]"}
                </span>
              </span>
            </button>
          )}
          {m.content && <div className="message-content">{m.content}</div>}
          {m.attachments?.map((a) => (
            <div className="message-attachment" key={a.id}>
              {a.mimeType.startsWith("image/") ? (
                <a
                  href={a.url || `/api/uploads/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={a.url || `/api/uploads/${a.id}`}
                    alt={a.originalName || a.filename || "聊天图片"}
                    loading="lazy"
                  />
                </a>
              ) : (
                <a
                  href={a.url || `/api/uploads/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="file-card"
                >
                  <span className="file-icon">
                    <File size={23} />
                  </span>
                  <span>
                    <strong>{a.originalName || a.filename || "文件"}</strong>
                    <small>
                      {a.size < 1024 * 1024
                        ? `${Math.ceil(a.size / 1024)} KB`
                        : `${(a.size / 1024 / 1024).toFixed(1)} MB`}{" "}
                      · PDF 文件
                    </small>
                  </span>
                  <Download size={17} />
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="message-footer">
          {m.editedAt && <span>已编辑</span>}
          {own && (
            <span
              className={`message-receipt ${read ? "read" : ""}`}
              title={read ? "所有成员已读" : delivered ? "已送达" : "已发送"}
            >
              {read || delivered ? (
                <CheckCheck size={14} />
              ) : (
                <Check size={14} />
              )}{" "}
              {read ? "已读" : delivered ? "已送达" : "已发送"}
            </span>
          )}
        </div>
      </div>
      <div className="message-tools">
        <button
          className="icon-btn"
          onClick={onReply}
          aria-label="回复消息"
          title="回复"
        >
          <Reply size={16} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setMenu(!menu)}
          aria-label="更多消息操作"
          aria-expanded={menu}
        >
          <MoreHorizontal size={18} />
        </button>
        {menu && (
          <div className="message-menu">
            <button
              onClick={() => {
                setMenu(false);
                const copy = navigator.clipboard?.writeText(m.id);
                if (copy)
                  void copy
                    .then(() => toast("消息 ID 已复制"))
                    .catch(() => toast(`消息 ID：${m.id}`));
                else toast(`消息 ID：${m.id}`);
              }}
            >
              <Copy size={14} />
              复制消息 ID
            </button>
            {own && (
              <>
                <button
                  onClick={() => {
                    setMenu(false);
                    onEdit();
                  }}
                >
                  <Pencil size={14} />
                  编辑
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    onRetract();
                  }}
                >
                  <Reply size={14} />
                  撤回
                </button>
              </>
            )}
            <button
              onClick={() => {
                setMenu(false);
                onHide();
              }}
            >
              <Trash2 size={14} />
              删除此消息
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
