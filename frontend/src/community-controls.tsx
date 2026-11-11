import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api, json } from "./api";
import { getLanguage, translate as tr, useLanguage } from "./i18n";
import { useApp } from "./state";
import { Dialog, ErrorBox } from "./ui";
import type { CommunityDetail } from "./types";
export function CopyTicketId({ id }: { id: string }) {
  useLanguage();
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="ticket-id">
      <span>{tr("controlsTicketId", { id })}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label={tr(copied ? "controlsCopied" : "controlsCopyId")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setError("");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1400);
          } catch {
            setError(tr("controlsCopyFailed"));
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
export function TicketSettings({ server }: { server: CommunityDetail }) {
  useLanguage();
  const app = useApp(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [values, setValues] = useState({
      privateTicketsEnabled: server.privateTicketsEnabled,
      guestTicketsEnabled: server.guestTicketsEnabled,
      adminTicketClaimEnabled: server.adminTicketClaimEnabled || false,
    });
  useEffect(
    () =>
      setValues({
        privateTicketsEnabled: server.privateTicketsEnabled,
        guestTicketsEnabled: server.guestTicketsEnabled,
        adminTicketClaimEnabled: server.adminTicketClaimEnabled || false,
      }),
    [
      server.privateTicketsEnabled,
      server.guestTicketsEnabled,
      server.adminTicketClaimEnabled,
    ],
  );
  const change = async (
    privateTicketsEnabled: boolean,
    guestTicketsEnabled: boolean,
  ) => {
    setBusy(true);
    setError("");
    const prior = values;
    setValues({ ...values, privateTicketsEnabled, guestTicketsEnabled });
    try {
      await api(
        `/servers/${server.id}/ticket-settings`,
        json("PATCH", { privateTicketsEnabled, guestTicketsEnabled }),
      );
      await app.refresh();
      setConfirm(false);
    } catch (e) {
      setValues(prior);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="community-setting-section" id="ticket-settings">
      <h2>{tr("controlsTickets")}</h2>
      <label className="check-label">
        <input
          type="checkbox"
          checked={values.privateTicketsEnabled}
          disabled={busy}
          onChange={(e) =>
            e.target.checked ? void change(true, false) : setConfirm(true)
          }
        />
        {tr("controlsPrivateEnabled")}
      </label>
      <p className="field-note">{tr("controlsExistingKept")}</p>
      {confirm && (
        <div className="inline-confirm">
          <p>{tr("controlsDisableConfirm")}</p>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void change(false, false)}
          >
            {tr("controlsConfirmDisable")}
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            {tr("communityCancel")}
          </button>
        </div>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={values.guestTicketsEnabled}
          disabled={busy || !values.privateTicketsEnabled}
          onChange={(e) => void change(true, e.target.checked)}
        />
        {tr("controlsGuestEnabled")}
      </label>
      <p className="field-note">{tr("controlsGuestExisting")}</p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={values.adminTicketClaimEnabled}
          disabled={busy}
          onChange={async (e) => {
            const previous = values;
            const next = {
              ...values,
              adminTicketClaimEnabled: e.target.checked,
            };
            setValues(next);
            setBusy(true);
            setError("");
            try {
              await api(
                `/servers/${server.id}/ticket-settings`,
                json("PATCH", next),
              );
              await app.refresh();
            } catch (e) {
              setValues(previous);
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
        {tr("adminClaimSetting")}
      </label>
      <p className="field-note">{tr("adminClaimSettingNote")}</p>
      {values.privateTicketsEnabled && values.guestTicketsEnabled && (
        <label>
          {tr("controlsGuestLink")}
          <input
            readOnly
            value={`${location.origin}/guest/${server.id}`}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${location.origin}/guest/${server.id}`,
                );
              } catch {
                setError(tr("controlsCopyFailed"));
              }
            }}
          >
            {tr("communityCopyLink")}
          </button>
        </label>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
export function ChannelRestrictions({
  server,
  userId,
  onClose,
}: {
  server: CommunityDetail;
  userId?: string;
  onClose: () => void;
}) {
  useLanguage();
  const app = useApp(),
    [selected, setSelected] = useState<string[]>([]),
    [current, setCurrent] = useState<
      { channelId: string; reason: string; until: string | null }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(!userId),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    if (userId)
      api<typeof current>(
        `/servers/${server.id}/members/${userId}/channel-restrictions`,
      )
        .then((v) => {
          if (live) {
            setCurrent(v);
            setLoaded(true);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [server.id, userId, revision]);
  return (
    <Dialog
      title={tr(userId ? "controlsRestrictMember" : "controlsReadonlyChannels")}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !selected.length) return;
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            if (userId)
              await api(
                `/servers/${server.id}/members/${userId}/channel-restrictions`,
                json("PUT", {
                  channelIds: selected,
                  minutes: Number(f.get("minutes")),
                  reason: f.get("reason"),
                }),
              );
            else
              await api(
                `/servers/${server.id}/channels-readonly`,
                json("PATCH", {
                  channelIds: selected,
                  readOnly: f.get("readOnly") === "true",
                }),
              );
            await app.refresh();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend>{tr("controlsSelectChannels")}</legend>
          {server.channels
            .filter((c) => !c.archivedAt)
            .map((c) => {
              const active = current.find((r) => r.channelId === c.id);
              return (
                <label className="check-label restriction-channel" key={c.id}>
                  <input
                    type="checkbox"
                    name="channelIds"
                    value={c.id}
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected((v) =>
                        e.target.checked
                          ? [...v, c.id]
                          : v.filter((id) => id !== c.id),
                      )
                    }
                  />
                  <span>
                    #{c.conversation.name}
                    {active && (
                      <small>
                        {active.reason} ·{" "}
                        {active.until
                          ? new Date(active.until).toLocaleString(getLanguage())
                          : tr("controlsPermanent")}
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
        </fieldset>
        {userId ? (
          <>
            <label>
              {tr("controlsDuration")}
              <select name="minutes" defaultValue="60">
                <option value="10">{tr("controlsTenMinutes")}</option>
                <option value="60">{tr("controlsOneHour")}</option>
                <option value="1440">{tr("controlsOneDay")}</option>
                <option value="-1">{tr("controlsPermanent")}</option>
                <option value="0">{tr("controlsRemoveSelected")}</option>
              </select>
            </label>
            <label>
              {tr("controlsReason")}
              <input name="reason" maxLength={300} />
            </label>
          </>
        ) : (
          <label>
            {tr("controlsChannelMode")}
            <select name="readOnly">
              <option value="true">{tr("communityReadOnly")}</option>
              <option value="false">{tr("controlsRemoveReadonly")}</option>
            </select>
          </label>
        )}
        {error &&
          (!loaded ? (
            <ErrorBox
              message={error}
              retry={() => {
                setError("");
                setRevision((v) => v + 1);
              }}
            />
          ) : (
            <p role="alert" className="form-error">
              {error}
            </p>
          ))}
        <button
          className="btn btn-primary"
          disabled={busy || !selected.length || !loaded}
        >
          {tr(busy ? "communitySubmitting" : "communitySave")}
        </button>
      </form>
    </Dialog>
  );
}
