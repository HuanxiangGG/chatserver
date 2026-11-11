import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { api, json } from "./api";
import { translate as tr, useLanguage } from "./i18n";
import { useApp } from "./state";
import { Dialog } from "./ui";
import { ChannelRestrictions } from "./community-controls";
import type { CommunityDetail } from "./types";
export function MemberActions({
  server,
  member,
  ticket,
}: {
  server: CommunityDetail;
  member: CommunityDetail["members"][number];
  ticket: () => void;
}) {
  useLanguage();
  const app = useApp();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<"ADMIN" | "MODERATOR" | "MEMBER" | null>(
      null,
    ),
    [restricting, setRestricting] = useState(false);
  async function mutate(method: string, data: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/servers/${server.id}/members/${member.userId}`,
        json(method, data),
      );
      await app.refresh();
      setOpen(false);
      setConfirm(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="icon-btn"
        aria-label={tr("screen652", { v0: member.user.displayName })}
        aria-haspopup="dialog"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <Dialog
          className="member-action-sheet"
          title={tr("screen643", { v0: member.user.displayName })}
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setConfirm(null);
            }
          }}
        >
          {confirm ? (
            <div className="form-stack">
              <p className="member-confirm">
                {tr(
                  confirm === "ADMIN"
                    ? "adminConfirmAppoint"
                    : confirm === "MODERATOR"
                      ? "adminConfirmModerator"
                      : "adminConfirmRevoke",
                  { member: member.user.displayName, community: server.name },
                )}
              </p>
              <p className="muted">{tr("adminScopeNotice")}</p>
              <div className="dialog-actions">
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void mutate("PATCH", { role: confirm })}
                >
                  {tr(busy ? "communitySubmitting" : "adminConfirm")}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  {tr("communityCancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="member-action-list">
              {server.role === "OWNER" && (
                <>
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      setConfirm(member.role === "ADMIN" ? "MEMBER" : "ADMIN")
                    }
                  >
                    {tr(
                      member.role === "ADMIN" ? "adminRevoke" : "adminAppoint",
                    )}
                  </button>
                  {member.role === "MEMBER" && (
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => setConfirm("MODERATOR")}
                    >
                      {tr("adminAppointModerator")}
                    </button>
                  )}
                </>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setOpen(false);
                  setRestricting(true);
                }}
              >
                {tr("controlsRestrictMember")}
              </button>
              {server.role === "OWNER" && server.privateTicketsEnabled && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setOpen(false);
                    ticket();
                  }}
                >
                  {tr("communityStartTicket")}
                </button>
              )}
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void mutate("PATCH", {
                    muteMinutes:
                      member.mutedUntil &&
                      new Date(member.mutedUntil) > new Date()
                        ? 0
                        : 60,
                  })
                }
              >
                {tr(
                  member.mutedUntil && new Date(member.mutedUntil) > new Date()
                    ? "unmute"
                    : "screen655",
                )}
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void mutate("DELETE", {})}
              >
                {tr("screen656")}
              </button>
              {["OWNER", "ADMIN"].includes(server.role) && (
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() =>
                    void mutate("DELETE", {
                      ban: true,
                      reason: tr("screen657"),
                    })
                  }
                >
                  {tr("screen658")}
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {restricting && (
        <ChannelRestrictions
          server={server}
          userId={member.userId}
          onClose={() => setRestricting(false)}
        />
      )}
    </>
  );
}

export function CommunityIdentity({ userId }: { userId: string }) {
  useLanguage();
  const location = useLocation(),
    app = useApp(),
    [value, setValue] = useState<{ name: string; role: string } | null>(null),
    [error, setError] = useState("");
  const serverId =
    typeof location.state?.communityId === "string"
      ? location.state.communityId
      : null;
  useEffect(() => {
    let live = true;
    setValue(null);
    setError("");
    if (serverId)
      api<CommunityDetail>(`/servers/${serverId}`)
        .then((s) => {
          const m = s.members.find((m) => m.userId === userId);
          if (live && m) setValue({ name: s.name, role: m.role });
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [serverId, userId, app.sync]);
  if (error)
    return (
      <p role="alert" className="form-error">
        {error}
      </p>
    );
  return value ? (
    <p className="profile-community-role">
      {value.name} ·{" "}
      {tr(
        value.role === "OWNER"
          ? "adminCommunityOwner"
          : value.role === "ADMIN"
            ? "screen236"
            : value.role === "MODERATOR"
              ? "screen579"
              : "screen237",
      )}
    </p>
  ) : null;
}
