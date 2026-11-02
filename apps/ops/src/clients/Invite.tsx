// The invite a client came with, on their Referrals tab: where its grant stands, and who attached it if ops did. A
// client who came with none may have one attached, for a friend who booked away from the invite's page
// (docs/decisions/0089-an-invite-is-not-lost.md).

import { CancelButton } from "@maneman/ui/CancelButton";
import { DrawerButton } from "@maneman/ui/DrawerButton";
import { FormActions } from "@maneman/ui/FormActions";
import { EmptyState } from "@maneman/ui/EmptyState";
import { Panel } from "@maneman/ui/Panel";
import form from "@maneman/ui/forms.module.css";
import { Toast } from "@maneman/ui/Toast";
import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { errorText } from "@maneman/web-kit/refusal";
import { Button } from "@maneman/ui/Button";
import { Field, TextArea, TextInput } from "@maneman/ui/Field";
import { longDate } from "@maneman/web-kit/dates";
import { useState, type ReactNode } from "react";
import { api, isErased, type ClientInvite } from "../api.ts";
import { clients } from "../content.ts";
import { OpsLink } from "../frame/Shell.tsx";
import { clientPath } from "../route.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import shared from "./clients.module.css";
import { Refusal } from "@maneman/ui/Refusal";
import { clientsApi } from "./clients-api.ts";

const copy = clients.invite;

/** Where the form is: being filled, sending, or refused with the API's code. */
type Attaching =
  { readonly step: "open" } | { readonly step: "sending" } | { readonly step: "failed"; readonly code: string };

/** What the form last found: the invite attached, or one the client came with meanwhile. */
export type InviteNews = keyof typeof copy.news;

/** Who invited the client, a way to their page, and the invite's code: "Vikram Sethi (VSAB23)". */
function InvitedBy({ invite }: { invite: ClientInvite }) {
  const code = clients.meta.inviteCode(invite.code);
  if (invite.referrer === null) return `${copy.erased} ${code}`;
  return (
    <>
      <OpsLink to={clientPath(invite.referrer.id, "visits")}>{invite.referrer.name}</OpsLink> {code}
    </>
  );
}

function Details({ invite, news }: { invite: ClientInvite; news: InviteNews | null }) {
  const rows: { key: string; value: ReactNode }[] = [
    { key: clients.meta.invitedBy, value: <InvitedBy invite={invite} /> },
    { key: copy.grant, value: copy.grants[invite.grant] },
    { key: copy.since, value: longDate(invite.since) },
    ...(invite.attached === null
      ? []
      : [
          { key: copy.attachedBy, value: whoWords(invite.attached.by) },
          { key: copy.why, value: invite.attached.reason ?? clients.unknown },
        ]),
  ];
  return (
    <>
      <dl className={shared.address}>
        {rows.map((row) => (
          <div className={shared.addressRow} key={row.key}>
            <dt className={shared.metaKey}>{row.key}</dt>
            <dd className={shared.addressValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {news !== null && <Toast>{copy.news[news]}</Toast>}
    </>
  );
}

/** The invite's code and why it is attached, the drawer's two boxes. */
function InviteFields(props: {
  code: string;
  reason: string;
  disabled: boolean;
  onCode: (code: string) => void;
  onReason: (reason: string) => void;
}) {
  return (
    <div className={form.fields}>
      <Field label={copy.form.code} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            width="choice"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            value={props.code}
            disabled={props.disabled}
            onChange={(event) => {
              props.onCode(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.form.reason} className={form.field}>
        {(control) => (
          <TextArea
            {...control}
            rows={3}
            maxLength={REASON_MAX_CHARS}
            value={props.reason}
            disabled={props.disabled}
            onChange={(event) => {
              props.onReason(event.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

function AttachForm({
  clientId,
  onInvite,
  onCancel,
}: {
  clientId: string;
  onInvite: (invite: ClientInvite, news: InviteNews) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [attaching, setAttaching] = useState<Attaching>({ step: "open" });
  const sending = attaching.step === "sending";
  const ready = code.trim() !== "" && reason.trim() !== "";

  const send = async () => {
    setAttaching({ step: "sending" });
    const answer = await clientsApi.attachInvite(clientId, { code: code.trim(), reason: reason.trim() });
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
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void send();
      }}
    >
      <InviteFields code={code} reason={reason} disabled={sending} onCode={setCode} onReason={setReason} />
      {attaching.step === "failed" && (
        <Refusal className={shared.error} said={errorText(copy.form.errors, { code: attaching.code })} />
      )}
      <FormActions>
        <Button variant="primary" size="small" type="submit" disabled={sending || !ready}>
          {sending ? copy.form.saving : copy.form.save}
        </Button>
        <CancelButton disabled={sending} onClick={onCancel} />
      </FormActions>
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
    <Panel
      titleId="invite"
      title={copy.title}
      actions={
        invite === null &&
        mayAttach && (
          <DrawerButton label={copy.attach}>
            {(close) => (
              <AttachForm
                clientId={clientId}
                onInvite={(attached, said) => {
                  close();
                  onInvite(attached, said);
                }}
                onCancel={close}
              />
            )}
          </DrawerButton>
        )
      }
    >
      {invite === null ? (
        <EmptyState look="panel" line={copy.none} />
      ) : (
        <div className={form.group}>
          <Details invite={invite} news={news} />
        </div>
      )}
    </Panel>
  );
}
