// The invite a client came with, under their Payments, beside the credits it
// grants: where its grant stands, and who attached it, if ops did. Who sent it,
// and its code, head the client's page. A client who came with none may have
// one attached, for a friend who booked away from the invite's own page: the
// code and why, under the landing's own rules
// (docs/decisions/0089-an-invite-is-not-lost.md). No board draws it
// (docs/fidelity-method.md).

import { Button } from "@maneman/ui/Button";
import { Field, TextArea, TextInput } from "@maneman/ui/Field";
import { longDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, isErased, type ClientInvite } from "../api.ts";
import { clients } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./clients.module.css";

const copy = clients.invite;

/** The longest reason kept, as the route allows (src/policy/decision-reasons.ts). */
const REASON_MAX_CHARS = 300;

/** Where the form is: being filled, sending, or refused with the API's code. */
type Attaching =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

/** What the form last found: the invite attached, or one the client came with meanwhile. */
export type InviteNews = keyof typeof copy.news;

function Details({ invite, news }: { invite: ClientInvite; news: InviteNews | null }) {
  const rows = [
    { key: copy.grant, value: copy.grants[invite.grant] },
    { key: copy.since, value: longDate(invite.since) },
    ...(invite.attached === null
      ? []
      : [
          { key: copy.attachedBy, value: invite.attached.by },
          { key: copy.why, value: invite.attached.reason ?? clients.unknown },
        ]),
  ];
  return (
    <>
      <dl className={styles.address}>
        {rows.map((row) => (
          <div className={styles.addressRow} key={row.key}>
            <dt className={styles.metaKey}>{row.key}</dt>
            <dd className={styles.addressValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {news !== null && (
        <p className={styles.done} role="status">
          {copy.news[news]}
        </p>
      )}
    </>
  );
}

function AttachForm({
  clientId,
  onInvite,
}: {
  clientId: string;
  onInvite: (invite: ClientInvite, news: InviteNews) => void;
}) {
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [attaching, setAttaching] = useState<Attaching>({ step: "open" });
  const sending = attaching.step === "sending";
  const ready = code.trim() !== "" && reason.trim() !== "";

  const send = async () => {
    setAttaching({ step: "sending" });
    const answer = await api.attachInvite(clientId, { code: code.trim(), reason: reason.trim() });
    if (answer.ok) {
      onInvite(answer.body, "attached");
      return;
    }
    // The client came with one meanwhile: their record now says which, and the page shows it.
    if (answer.code === "already_invited") {
      const record = await api.client(clientId);
      if (record.ok && !isErased(record.body) && record.body.invite !== null) {
        onInvite(record.body.invite, "already_invited");
        return;
      }
    }
    setAttaching({ step: "failed", code: answer.code });
  };

  return (
    <form
      className={styles.creditForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void send();
      }}
    >
      <p className={styles.findHint}>{copy.none}</p>
      <Field label={copy.form.code} hint={copy.form.codeHint}>
        {(control) => (
          <TextInput
            {...control}
            className={styles.numberField}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            value={code}
            disabled={sending}
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
        )}
      </Field>
      <Field className={styles.inviteReason} label={copy.form.reason} hint={copy.form.reasonHint}>
        {(control) => (
          <TextArea
            {...control}
            className={styles.inviteReasonField}
            maxLength={REASON_MAX_CHARS}
            value={reason}
            disabled={sending}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      <p className={styles.note}>{copy.form.note}</p>
      <Button variant="primary" size="small" className={styles.primary} type="submit" disabled={sending || !ready}>
        {sending ? copy.form.saving : copy.form.save}
      </Button>
      {attaching.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.form.errors[attaching.code] ?? copy.form.errors.unknown}
        </p>
      )}
    </form>
  );
}

export function Invite({
  clientId,
  invite,
  news,
  onInvite,
}: {
  clientId: string;
  invite: ClientInvite | null;
  /** What this page's form found just now, if anything. */
  news: InviteNews | null;
  onInvite: (invite: ClientInvite, news: InviteNews) => void;
}) {
  const mayAttach = useAccess().mayCall("POST /api/clients/{id}/referral");
  return (
    <section className={styles.invite} aria-labelledby="invite">
      <h3 className={styles.sectionTitle} id="invite">
        {copy.title}
      </h3>
      {invite !== null && <Details invite={invite} news={news} />}
      {invite === null && mayAttach && <AttachForm clientId={clientId} onInvite={onInvite} />}
      {invite === null && !mayAttach && <p className={styles.findHint}>{copy.noInvite}</p>}
    </section>
  );
}
