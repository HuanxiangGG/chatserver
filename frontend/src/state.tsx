import { localizeApiError } from './i18n';
import { useAppearance, useAppearanceRuntime, updateAppearance } from './appearance-store';
import { translate as tr, useLanguage } from './i18n';
import { coalescedRefresh } from './coalesced-refresh';
import { soundSessionTimes } from './sound';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { ApiError, api, json, setCsrf } from "./api";
import type { Community, Conversation, RequestList, User } from "./types";
interface State {
  user: User | null;
  loading: boolean;
  csrfToken: string;
  login: (user: User, token: string) => void;
  logout: () => Promise<void>;
  reloadUser: () => Promise<void>;
  communities: Community[];
  conversations: Conversation[];
  friends: User[];
  requests: RequestList;
  refresh: () => Promise<void>;
  socket: Socket | null;
  connected: boolean;
  sync: number;
  toast: (message: string, error?: boolean) => void;
  theme: string;
  setTheme: (theme: string) => void;
}
const Context = createContext<State | null>(null);
export function useApp() {
  const value = useContext(Context);
  if (!value) throw Error("Application context missing");
  return value;
}
export function AppProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [csrfToken, setToken] = useState(""),
    [communities, setCommunities] = useState<Community[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [friends, setFriends] = useState<User[]>([]),
    [requests, setRequests] = useState<RequestList>({
      incoming: [],
      outgoing: [],
    }),
    [socket, setSocket] = useState<Socket | null>(null),
    [connected, setConnected] = useState(false),
    [sync, setSync] = useState(0),
    [notice, setNotice] = useState<{ message: string; error: boolean } | null>(
      null,
    );
  const { resolved: theme } = useAppearance();
  useAppearanceRuntime(user?.id);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    authUserId = useRef<string | null>(null),
    deliveredIds = useRef(new Map<string, string>());
  const toast = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  }, []);
  const login = useCallback((next: User, token: string) => {
    authUserId.current = next.id;
    setCsrf(token);
    setToken(token);
    setUser(next);
  }, []);
  const reloadUser = useCallback(async () => {
    const data = await api<{ user: User; csrfToken: string }>("/auth/me");
    login(data.user, data.csrfToken);
  }, [login]);
  useEffect(() => {
    reloadUser()
      .catch(e => { if (!(e instanceof ApiError && e.status === 401)) toast(e.message || tr('screen420'), true); })
      .finally(() => setLoading(false));
  }, [reloadUser, toast]);
  const refreshPass = useCallback(async () => {
    if (!user) return;
    try {
      const [c, f, r, communities] = await Promise.all([
        api<Conversation[]>("/conversations"),
        api<User[]>("/friends"),
        api<RequestList>("/friend-requests"),
        api<Community[]>("/servers"),
      ]);
      if (authUserId.current !== user.id) return;
      setCommunities(communities);
      setConversations(c);
      setFriends(f);
      setRequests(r);
      for (const conversation of c) {
        const last = conversation.lastMessage;
        if (
          last &&
          last.senderId !== user.id &&
          deliveredIds.current.get(conversation.id) !== last.id
        ) {
          deliveredIds.current.set(conversation.id, last.id);
          void api(
            `/conversations/${conversation.id}/delivered`,
            json("POST", { messageId: last.id }),
          ).catch(() => {
            if (deliveredIds.current.get(conversation.id) === last.id)
              deliveredIds.current.delete(conversation.id);
          });
        }
      }
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status === 401 &&
        authUserId.current === user.id
      ) {
        authUserId.current = null;
        setCsrf("");
        setToken("");
        setUser(null);
        setCommunities([]);
        setConversations([]);
        setFriends([]);
        setRequests({ incoming: [], outgoing: [] });
        deliveredIds.current.clear();
      }
      throw e;
    }
  }, [user?.id]);
  const refresh = useMemo(() => coalescedRefresh(refreshPass), [refreshPass]);
  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", json("POST"));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    authUserId.current = null;
    deliveredIds.current.clear();
    setCsrf("");
    setUser(null);
    setToken("");
    setCommunities([]);
    setConversations([]);
    setFriends([]);
    setRequests({ incoming: [], outgoing: [] });
  }, []);
  useEffect(() => {
    if (!user) return;
    void refresh().catch((e) => toast(e.message, true));
    const interval = setInterval(() => void refresh().catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, [user?.id, refresh, toast]);
  useEffect(() => {
    if (!user || !csrfToken) return;
    const client = io({
      transports: ["websocket"],
      withCredentials: true,
      auth: { csrfToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    setSocket(client);
    client.on('session:ready', (data: { serverTime: number }) => {
      if (Number.isFinite(data.serverTime)) soundSessionTimes.set(client, data.serverTime);
    });
    client.on("connect", () => {
      soundSessionTimes.delete(client);
      setConnected(true);
      setSync((x) => x + 1);
      void refresh().catch(() => {});
    });
    client.on("disconnect", (reason) => {
      setConnected(false);
      if (reason === "io server disconnect") void refresh().catch(() => {});
    });
    client.on("connect_error", () => setConnected(false));
    client.on("operation:error", (data: { error: string }) =>
      toast(localizeApiError(data.error), true),
    );
    const update = () => {
      setSync((x) => x + 1);
      void refresh().catch(() => {});
    };
    client.on("conversation:updated", update);
    client.on("server:updated", update);
    client.on("ticket:updated", update);
    client.on("friend-request:updated", update);
    client.on("friends:updated", update);
    client.on("message:new", () => void refresh().catch(() => {}));
    client.on("receipt:updated", () => void refresh().catch(() => {}));
    client.on(
      "presence:updated",
      (data: {
        userId: string;
        status: User["status"];
        lastSeenAt: string;
      }) => {
        const merge = (u: User) =>
          u.id === data.userId
            ? { ...u, status: data.status, lastSeenAt: data.lastSeenAt }
            : u;
        setUser((u) => (u ? merge(u) : null));
        setFriends((f) => f.map(merge));
        setConversations((c) =>
          c.map((v) => ({
            ...v,
            members: v.members.map((m) => ({ ...m, user: merge(m.user) })),
          })),
        );
      },
    );
    return () => {
      client.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id, csrfToken, refresh]);
  function setTheme(value: string) {
    updateAppearance({ mode: value === 'light' || value === 'system' ? value : 'dark' });
  }
  return (
    <Context.Provider
      value={{
        user,
        loading,
        csrfToken,
        login,
        logout,
        reloadUser,
        conversations,
        communities,
        friends,
        requests,
        refresh,
        socket,
        connected,
        sync,
        toast,
        theme,
        setTheme,
      }}
    >
      {children}
      {notice && (
        <div
          className={`toast ${notice.error ? "toast-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          <button aria-label={tr('screen421')} onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
