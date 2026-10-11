// Partners who send us clients on their own code (docs/decisions/0123-partner-referral-channels.md): each with its
// link, what its friend gets, its commission per fit, and what has come through it. No board draws it.

import { Button } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { paiseFromRupees, rupees } from "@maneman/web-kit/money";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type Partner, type Partners as PartnerList, type PartnerTerms } from "../api.ts";
import { BOOKING_URL } from "../content/common.ts";
import { partners as copy } from "../content/partners.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import form from "../components/forms.module.css";
import styles from "./referrals.module.css";

/** The site the partner's link opens: the environment's own. */
const SITE = new URL(BOOKING_URL[import.meta.env.MM_ENV]);

interface Draft {
  readonly name: string;
  readonly friendVisits: string;
  readonly validDays: string;
  readonly commission: string;
}

const draftOf = (partner: Partner | null): Draft => ({
  name: partner?.name ?? "",
  friendVisits: String(partner?.friend_visits ?? 2),
  validDays: String(partner?.valid_days ?? 365),
  commission: partner === null ? "" : String(partner.commission / 100),
});

const termsOf = (draft: Draft): PartnerTerms => ({
  name: draft.name.trim(),
  friend_visits: Number(draft.friendVisits),
  valid_days: Number(draft.validDays),
  commission: paiseFromRupees(draft.commission === "" ? "0" : draft.commission),
});

function Input(props: { id: string; label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <div className={form.field}>
      <label className={form.fieldLabel} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        className={props.type === undefined ? form.number : form.text}
        id={props.id}
        type={props.type ?? "number"}
        min={props.type === undefined ? 0 : undefined}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </div>
  );
}

/** The form's button: Add for a new partner, Save for one changed, each saying it is sending. */
function saveLabel(adding: boolean, sending: boolean): string {
  if (adding) return sending ? copy.adding : copy.add;
  return sending ? copy.form.saving : copy.form.save;
}

/** The partner added or changed, sent; whether it went through. */
function usePartnerSave(partner: Partner | null, onSaved: (list: PartnerList) => void) {
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const save = async (terms: PartnerTerms): Promise<boolean> => {
    setSending(true);
    const answer = partner === null ? await api.addPartner(terms) : await api.changePartner(partner.id, terms);
    setSending(false);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return false;
    }
    onSaved(answer.body);
    return true;
  };
  return { sending, failure, save, clear: () => { setFailure(null); } };
}

/** Adds a partner, or changes one: its name and terms. */
function PartnerForm(props: { partner: Partner | null; onSaved: (list: PartnerList) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState<Draft>(draftOf(props.partner));
  const { sending, failure, save: send, clear } = usePartnerSave(props.partner, props.onSaved);
  const id = props.partner?.id ?? "new";
  const edit = (change: Partial<Draft>) => {
    setDraft({ ...draft, ...change });
    clear();
  };
  const save = async () => {
    if ((await send(termsOf(draft))) && props.partner === null) setDraft(draftOf(null));
  };
  return (
    <form
      className={form.group}
      aria-label={props.partner === null ? copy.add : copy.editLabel(props.partner.name)}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className={form.fields}>
        <Input
          id={`partner-${id}-name`}
          label={copy.form.name}
          type="text"
          value={draft.name}
          onChange={(name) => {
            edit({ name });
          }}
        />
        <Input
          id={`partner-${id}-visits`}
          label={copy.form.friendVisits}
          value={draft.friendVisits}
          onChange={(friendVisits) => {
            edit({ friendVisits });
          }}
        />
        <Input
          id={`partner-${id}-days`}
          label={copy.form.validDays}
          value={draft.validDays}
          onChange={(validDays) => {
            edit({ validDays });
          }}
        />
        <Input
          id={`partner-${id}-commission`}
          label={copy.form.commission}
          value={draft.commission}
          onChange={(commission) => {
            edit({ commission });
          }}
        />
      </div>
      <div className={form.actions}>
        <Button type="submit" variant="primary" size="small" disabled={draft.name.trim() === "" || sending}>
          {saveLabel(props.partner === null, sending)}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="outline" size="small" onClick={props.onCancel}>
            {copy.form.cancel}
          </Button>
        )}
      </div>
      {failure !== null && (
        <p className={form.error} role="alert">
          {errorText(copy.errors, failure)}
        </p>
      )}
    </form>
  );
}

function PartnerRow(props: { partner: Partner; mayChange: boolean; onChanged: (list: PartnerList) => void }) {
  const { partner } = props;
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const paused = partner.paused_at !== null;
  const togglePause = async () => {
    const answer = await api.pausePartner(partner.id, !paused);
    if (!answer.ok) {
      setFailure({ code: answer.code, fields: answer.fields });
      return;
    }
    props.onChanged(answer.body);
  };
  if (editing) {
    return (
      <tr>
        <td colSpan={9}>
          <PartnerForm
            partner={partner}
            onSaved={(list) => {
              setEditing(false);
              props.onChanged(list);
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row" className={styles.name}>
        {partner.name}
        {paused && <span className={styles.quietFigure}> · {copy.paused}</span>}
      </th>
      <td>
        <a href={`${SITE.origin}/r/${partner.code}`} target="_blank" rel="noopener">
          {copy.link(SITE.host, partner.code)}
        </a>
      </td>
      <td>{copy.friendGets(partner.friend_visits, partner.valid_days)}</td>
      <td className={styles.figure}>{rupees(partner.commission)}</td>
      <td className={styles.figure}>{partner.opens}</td>
      <td className={styles.figure}>{partner.referred}</td>
      <td className={styles.figure}>{partner.fitted}</td>
      <td className={styles.figure}>{rupees(partner.earned)}</td>
      <td>
        {props.mayChange && (
          <div className={form.actions}>
            <Button
              variant="outline"
              size="small"
              aria-label={copy.editLabel(partner.name)}
              onClick={() => {
                setEditing(true);
              }}
            >
              {copy.edit}
            </Button>
            <Button
              variant="outline"
              size="small"
              aria-label={paused ? copy.resumeLabel(partner.name) : copy.pauseLabel(partner.name)}
              onClick={() => void togglePause()}
            >
              {paused ? copy.resume : copy.pause}
            </Button>
          </div>
        )}
        {failure !== null && (
          <p className={form.error} role="alert">
            {errorText(copy.errors, failure)}
          </p>
        )}
      </td>
    </tr>
  );
}

function PartnerTable(props: { list: PartnerList; mayChange: boolean; onChanged: (list: PartnerList) => void }) {
  const heads = copy.columns;
  return (
    <Table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{heads.name}</th>
          <th scope="col">{heads.link}</th>
          <th scope="col">{heads.friend}</th>
          <th scope="col">{heads.commission}</th>
          <th scope="col">{heads.opens}</th>
          <th scope="col">{heads.referred}</th>
          <th scope="col">{heads.fitted}</th>
          <th scope="col">{heads.earned}</th>
          <th scope="col">
            <VisuallyHidden>{heads.change}</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {props.list.channels.map((partner) => (
          <PartnerRow key={partner.id} partner={partner} mayChange={props.mayChange} onChanged={props.onChanged} />
        ))}
      </tbody>
    </Table>
  );
}

export function Partners() {
  const [loaded, retry] = useLoad(api.partners);
  /** The list as the last change left it, so the panel follows a change without reading it again. */
  const [changed, setChanged] = useState<PartnerList | null>(null);
  const access = useAccess();
  const mayChange = access.mayCall("POST /api/referral-channels");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const list = changed ?? loaded.value;
  return (
    <Panel titleId="partners" title={copy.title} className={form.panel}>
      {mayChange && <PartnerForm partner={null} onSaved={setChanged} />}
      {list.channels.length === 0 ? (
        <p className={form.note}>{copy.none}</p>
      ) : (
        <PartnerTable list={list} mayChange={mayChange} onChanged={setChanged} />
      )}
    </Panel>
  );
}
