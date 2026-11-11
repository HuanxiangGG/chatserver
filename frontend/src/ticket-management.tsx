import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { api, json, ApiError } from "./api";
import { translate as tr, useLanguage, getLanguage } from "./i18n";
import { useApp } from "./state";
import { Dialog, ErrorBox, Spinner, Empty } from "./ui";
import { ChatPage } from "./chat";
import { CopyTicketId } from "./community-controls";
import { ticketPath, type Ticket } from "./community-workspace";
import type { CommunityDetail } from "./types";
export function TicketPrivacyChoice() {
  useLanguage();
  return (
    <fieldset className="ticket-privacy-choice">
      <legend>{tr("adminWhoCanRead")}</legend>
      <label className="check-label">
        <input type="radio" name="ownerOnly" value="false" defaultChecked />
        {tr("adminAllowStaff")}
      </label>
      <label className="check-label">
        <input type="radio" name="ownerOnly" value="true" />
        {tr("adminOwnerOnly")}
      </label>
      <p className="field-note">{tr("adminPrivacyNotice")}</p>
    </fieldset>
  );
}
export function ClaimableTickets({ serverId }: { serverId: string }) {
  useLanguage();
  const app = useApp(),
    navigate = useNavigate();
  const [rows, setRows] = useState<
      Pick<Ticket, "id" | "number" | "category" | "createdAt">[] | null
    >(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ tickets: NonNullable<typeof rows>; cursor: string | null }>(
      `/servers/${serverId}/tickets/claimable`,
    )
      .then((v) => {
        if (live) {
          setRows(v.tickets);
          setCursor(v.cursor);
          setError("");
        }
      })
      .catch((e) => {
        if (live) {
          setRows(null);
          setError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [serverId, app.sync, revision]);
  return (
    <section className="claimable-tickets" aria-label={tr("adminClaimQueue")}>
      <h2>{tr("adminClaimQueue")}</h2>
      <p className="field-note">{tr("adminRedactedQueue")}</p>
      {error ? (
        <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />
      ) : !rows ? (
        <Spinner />
      ) : !rows.length ? (
        <Empty title={tr("adminNoClaimable")} />
      ) : (
        rows.map((t) => (
          <div className="claimable-row" key={t.id}>
            <div>
              <strong>#{t.number}</strong>
              <span>
                {t.category === "GENERAL"
                  ? tr("communityGeneral")
                  : t.category === "GUEST"
                    ? tr("controlsGuestBadge")
                    : t.category}
              </span>
              <time dateTime={t.createdAt}>
                {tr("adminWaitingSince", {
                  time: new Date(t.createdAt).toLocaleString(getLanguage()),
                })}
              </time>
            </div>
            <button
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(t.id);
                setError("");
                try {
                  const ticket = await api<Ticket>(
                    `/tickets/${t.id}/claim`,
                    json("POST"),
                  );
                  await app.refresh();
                  navigate(ticketPath(ticket));
                } catch (e) {
                  setError((e as Error).message);
                  setRevision((v) => v + 1);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {tr(busy === t.id ? "communitySubmitting" : "adminClaim")}
            </button>
          </div>
        ))
      )}
      {cursor && (
        <button
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("page");
            try {
              const v = await api<{
                tickets: NonNullable<typeof rows>;
                cursor: string | null;
              }>(`/servers/${serverId}/tickets/claimable?cursor=${cursor}`);
              setRows((old) => [...(old || []), ...v.tickets]);
              setCursor(v.cursor);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          {tr("communityMoreTickets")}
        </button>
      )}
    </section>
  );
}
export function TicketChat() {
  useLanguage();
  const { serverId, ticketId, id } = useParams(),
    app = useApp(),
    navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null),
    [server, setServer] = useState<CommunityDetail | null>(null),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [menu, setMenu] = useState(false),
    [assign, setAssign] = useState(false),
    [target, setTarget] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([
      api<Ticket>(`/tickets/${ticketId}`),
      api<CommunityDetail>(`/servers/${serverId}`),
    ])
      .then(([t, s]) => {
        if (!live) return;
        if (t.serverId !== serverId || t.conversationId !== id) {
          navigate(ticketPath(t), { replace: true });
          return;
        }
        setTicket(t);
        setServer(s);
        setLoadError("");
      })
      .catch((e) => {
        if (live) {
          setLoadError(e.message);
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            setTicket(null);
            setServer(null);
          }
        }
      });
    return () => {
      live = false;
    };
  }, [ticketId, serverId, id, app.sync, revision]);
  useEffect(() => {
    const socket = app.socket;
    function revoked(v: { id: string }) {
      if (v.id === ticketId) {
        setTicket(null);
        setServer(null);
        setLoadError(tr("adminAccessRevoked"));
      }
    }
    socket?.on("ticket:access-revoked", revoked);
    return () => {
      socket?.off("ticket:access-revoked", revoked);
    };
  }, [app.socket, ticketId]);
  async function change(data: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setTicket(await api<Ticket>(`/tickets/${ticketId}`, json("PATCH", data)));
      setMenu(false);
      setAssign(false);
      await app.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ticket || !server || ticket.id !== ticketId)
    return loadError ? (
      <ErrorBox message={loadError} retry={() => setRevision((v) => v + 1)} />
    ) : (
      <Spinner />
    );
  const owner = server.ownerId === app.user?.id,
    participant = ticket.memberId === app.user?.id,
    handler = owner || ticket.assigneeId === app.user?.id;
  return (
    <div className="ticket-chat" key={ticket.id}>
      <header className="ticket-toolbar">
        <div className="ticket-toolbar-top">
          <Link to={`/servers/${serverId}/tickets`}>
            {tr("communityTicketQueue")}
          </Link>
          <CopyTicketId id={ticket.id} />
        </div>
        <div className="ticket-toolbar-title">
          <h1 title={ticket.subject}>
            #{ticket.number} · {ticket.subject}
          </h1>
          <div className="ticket-toolbar-actions">
            {ticket.status === "CLOSED" ? (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void change({ status: "OPEN" })}
              >
                {tr("communityReopen")}
              </button>
            ) : ticket.status === "OPEN" && handler ? (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void change({ status: "IN_PROGRESS" })}
              >
                {tr("communityTakeTicket")}
              </button>
            ) : null}
            <button
              className="icon-btn"
              aria-label={tr("adminTicketActions")}
              aria-haspopup="dialog"
              onClick={() => setMenu(true)}
            >
              <MoreHorizontal size={20} />
            </button>
          </div>
        </div>
        <p className="ticket-handler-line">
          {tr(
            ticket.status === "CLOSED"
              ? "communityTicketClosed"
              : ticket.status === "IN_PROGRESS"
                ? "communityTicketProgress"
                : "communityTicketOpen",
          )}{" "}
          · {tr("communityHandler")}:{" "}
          {ticket.assignee?.displayName || tr("adminCommunityOwner")}
        </p>
      </header>
      {ticket.handoffAssigneeId && (
        <section className="ticket-consent-banner">
          <p>
            {tr("adminHandoffRequest", {
              name: ticket.handoffAssignee?.displayName || tr("screen236"),
            })}
          </p>
          {participant ? (
            <div className="dialog-actions">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void change({
                    handoffConsent: "APPROVE",
                    expectedAssigneeId: ticket.handoffAssigneeId,
                  })
                }
              >
                {tr("adminConsentApprove")}
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void change({
                    handoffConsent: "DECLINE",
                    expectedAssigneeId: ticket.handoffAssigneeId,
                  })
                }
              >
                {tr("adminConsentDecline")}
              </button>
            </div>
          ) : (
            <small>{tr("adminConsentWaiting")}</small>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="form-error ticket-action-error">
          {error}
        </p>
      )}
      <ChatPage sendLabel={tr("adminReply")} compactHeader />
      {menu && (
        <Dialog
          className="ticket-action-sheet"
          title={tr("adminTicketActions")}
          onClose={() => setMenu(false)}
        >
          <div className="member-action-list">
            {owner && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setMenu(false);
                  setTarget(ticket.assigneeId || "");
                  setAssign(true);
                }}
              >
                {tr("adminReassign")}
              </button>
            )}
            {ticket.status !== "CLOSED" && (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void change({ status: "CLOSED" })}
              >
                {tr("communityCloseTicket")}
              </button>
            )}
            {ticket.handoffAssigneeId && owner && (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void change({ requestAssigneeId: null })}
              >
                {tr("adminCancelHandoff")}
              </button>
            )}
          </div>
        </Dialog>
      )}
      {assign && (
        <Dialog
          className="ticket-action-sheet"
          title={tr("adminReassign")}
          onClose={() => setAssign(false)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void change(
                target && ticket.ownerOnly && target !== ticket.assigneeId
                  ? { requestAssigneeId: target }
                  : { assigneeId: target || null },
              );
            }}
          >
            <p>
              {tr(
                ticket.ownerOnly
                  ? "adminOwnerOnlyHandoff"
                  : "adminAssignmentNotice",
              )}
            </p>
            <label>
              {tr("communityHandler")}
              <select
                aria-label={tr("communityAssign")}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{tr("adminCommunityOwner")}</option>
                {server.members
                  .filter(
                    (m) =>
                      m.ticketEligible &&
                      m.userId !== ticket.memberId &&
                      m.userId !== server.ownerId,
                  )
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.displayName}
                    </option>
                  ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="btn btn-primary" disabled={busy}>
              {tr(
                busy
                  ? "communitySubmitting"
                  : target && ticket.ownerOnly && target !== ticket.assigneeId
                    ? "adminRequestConsent"
                    : "communitySave",
              )}
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
