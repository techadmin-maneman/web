// Partners who send us clients on their own code (docs/decisions/0123-partner-referral-channels.md): each with its
// link, what its friend gets, its commission per fit, and what has come through it. Each row edits the partner or
// pauses it, shown before it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import { Button } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { useState } from "react";
import { api, type Partner, type Partners as PartnerList } from "../api.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { BOOKING_URL } from "../content/common.ts";
import { partners as copy } from "../content/partners.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { PartnerForm } from "./PartnerForm.tsx";
import styles from "../components/forms.module.css";
import own from "./partners.module.css";

/** The site the partner's link opens: the environment's own. */
const SITE = new URL(BOOKING_URL[import.meta.env.MM_ENV]);

const COLUMNS = 9;

/** What is open beneath a partner's row. */
type Acting = { readonly id: string; readonly kind: "edit" | "pause" } | null;

interface RowProps {
  readonly list: PartnerList;
  readonly mayChange: boolean;
  readonly acting: Acting;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (list: PartnerList, said: string) => void;
}

/** The check before a partner is paused or resumed; only its second press sends. */
function PauseCheck({ partner, onDone, onBack }: { partner: Partner; onDone: RowProps["onDone"]; onBack: () => void }) {
  const [step, setStep] = useState<"checking" | "sending" | Failure>("checking");
  const paused = partner.paused_at !== null;
  const send = async () => {
    setStep("sending");
    const answer = await api.pausePartner(partner.id, !paused);
    if (!answer.ok) {
      setStep({ code: answer.code, fields: answer.fields });
      return;
    }
    onDone(answer.body, paused ? copy.done.resumed : copy.done.paused);
  };
  return (
    <>
      <CheckPanel
        title={paused ? copy.check.resumeTitle(partner.name) : copy.check.pauseTitle(partner.name)}
        lines={[paused ? copy.check.resumeLine : copy.check.pauseLine]}
        send={copy.check.send}
        sending={copy.check.saving}
        back={copy.check.back}
        busy={step === "sending"}
        onSend={() => void send()}
        onBack={onBack}
      />
      {typeof step === "object" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, step)}
        </p>
      )}
    </>
  );
}

function RowActions({ partner, acting, onAct }: { partner: Partner } & Pick<RowProps, "acting" | "onAct">) {
  const paused = partner.paused_at !== null;
  const actions: readonly (readonly [NonNullable<Acting>["kind"], string, string])[] = [
    ["edit", copy.edit, copy.editLabel(partner.name)],
    paused
      ? ["pause", copy.resume, copy.resumeLabel(partner.name)]
      : ["pause", copy.pause, copy.pauseLabel(partner.name)],
  ];
  return actions.map(([kind, words, label]) => (
    <button
      key={kind}
      className={styles.inline}
      type="button"
      aria-label={label}
      disabled={acting !== null}
      onClick={() => {
        onAct({ id: partner.id, kind });
      }}
    >
      {words}
    </button>
  ));
}

/** Beneath a partner's row, what its action opened. */
function ActingRow({ partner, list, acting, onAct, onDone }: { partner: Partner } & RowProps) {
  if (acting?.id !== partner.id) return null;
  const cancel = () => {
    onAct(null);
  };
  return (
    <tr className={own.acting}>
      <td colSpan={COLUMNS}>
        {acting.kind === "edit" ? (
          <PartnerForm
            partner={partner}
            limits={list.limits}
            onDone={(next) => {
              onDone(next, copy.done.saved);
            }}
            onCancel={cancel}
          />
        ) : (
          <PauseCheck partner={partner} onDone={onDone} onBack={cancel} />
        )}
      </td>
    </tr>
  );
}

function PartnerRows({ partner, ...row }: { partner: Partner } & RowProps) {
  return (
    <>
      <tr>
        <th scope="row" className={own.name}>
          {partner.name}
          {partner.paused_at !== null && <span className={own.paused}> · {copy.paused}</span>}
        </th>
        <td>
          <a className={own.link} href={`${SITE.origin}/r/${partner.code}`} target="_blank" rel="noopener">
            {copy.link(SITE.host, partner.code)}
          </a>
        </td>
        <td>{copy.friendGets(partner.friend_visits, partner.valid_days)}</td>
        <td className={own.figure}>{rupees(partner.commission)}</td>
        <td className={own.figure}>{partner.opens}</td>
        <td className={own.figure}>{partner.referred}</td>
        <td className={own.figure}>{partner.fitted}</td>
        <td className={own.figure}>{rupees(partner.earned)}</td>
        <td className={own.actions}>{row.mayChange && <RowActions partner={partner} {...row} />}</td>
      </tr>
      <ActingRow partner={partner} {...row} />
    </>
  );
}

function PartnerTable(row: RowProps) {
  const heads = copy.columns;
  const figures = [heads.commission, heads.opens, heads.referred, heads.fitted, heads.earned];
  return (
    <div className={own.scroll}>
      <Table className={classes(styles.table, own.table)}>
        <thead>
          <tr>
            <th scope="col">{heads.name}</th>
            <th scope="col">{heads.link}</th>
            <th scope="col">{heads.friend}</th>
            {figures.map((label) => (
              <th key={label} scope="col" className={own.figure}>
                {label}
              </th>
            ))}
            <th scope="col">
              <VisuallyHidden>{heads.change}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {row.list.channels.map((partner) => (
            <PartnerRows key={partner.id} partner={partner} {...row} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function Partners() {
  const [loaded, retry] = useLoad(api.partners);
  /** The list as the last change left it, so the panel follows a change without reading it again. */
  const [changed, setChanged] = useState<PartnerList | null>(null);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState<string | null>(null);
  const mayChange = useAccess().mayCall("POST /api/referral-channels");
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const list = changed ?? loaded.value;
  const done = (next: PartnerList, words: string) => {
    setAdding(false);
    setActing(null);
    setSaid(words);
    setChanged(next);
  };
  const act = (next: Acting) => {
    setSaid(null);
    setActing(next);
  };
  return (
    <Panel
      titleId="partners"
      title={copy.title}
      className={styles.panel}
      actions={
        mayChange &&
        !adding && (
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            onClick={() => {
              act(null);
              setAdding(true);
            }}
          >
            {copy.add}
          </Button>
        )
      }
    >
      {adding && (
        <PartnerForm
          partner={null}
          limits={list.limits}
          onDone={(next) => {
            done(next, copy.done.added);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      )}
      {said !== null && (
        <p className={styles.saved} role="status">
          {said}
        </p>
      )}
      {list.channels.length === 0 ? (
        <p className={styles.note}>{copy.none}</p>
      ) : (
        <PartnerTable list={list} mayChange={mayChange} acting={acting} onAct={act} onDone={done} />
      )}
    </Panel>
  );
}
