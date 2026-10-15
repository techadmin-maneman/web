// Finance · Discount codes (docs/decisions/0108-discount-codes.md): what every code has come to, then a table of codes
// with their uses and takings. A code is made, found by how it begins, switched off after a check (ADR 0071), or
// deleted while no booking has taken it; codes switched off fold away beneath.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Disclosure } from "@maneman/ui/Disclosure";
import { errorText } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { RowButton } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState, type ReactNode } from "react";
import { type DiscountCode, type DiscountCodes as DiscountCodeList } from "../api.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ActionCheck, sentOf } from "../settings/index.ts";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { DiscountCodeForm } from "./DiscountCodeForm.tsx";
import { FindForm } from "./FindCode.tsx";
import form from "../components/forms.module.css";
import styles from "./discount-codes.module.css";
import { discountCodesApi } from "./discount-codes-api.ts";
import { DrawerButton } from "../components/DrawerButton.tsx";

const copy = settings.discountCodes;
const columns = copy.columns;

const discountOf = (code: DiscountCode): string =>
  code.kind === "amount"
    ? rupees(code.value)
    : copy.percentOff(code.value, code.cap === null ? null : rupees(code.cap));
const coversOf = (code: DiscountCode): string => code.covers.map((kind) => copy.coverShort[kind]).join(", ");
const dayOf = (instant: string | null): string => (instant === null ? copy.never : shortDate(indiaDate(instant)));
const usesOf = (code: DiscountCode): string =>
  code.max_uses === null ? String(code.uses) : copy.usesOf(code.uses, code.max_uses);

/** What every code has come to together, standing uses only. */
function Figures({ totals }: { totals: DiscountCodeList["totals"] }) {
  const figures: readonly (readonly [string, string])[] = [
    [copy.figures.live, String(totals.live)],
    [copy.figures.uses, String(totals.uses)],
    [copy.figures.clients, String(totals.clients)],
    [copy.figures.given, rupees(totals.given)],
    [copy.figures.paid, rupees(totals.paid)],
  ];
  return (
    <dl className={styles.figures}>
      {figures.map(([label, value]) => (
        <div key={label} className={styles.total}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What is open beneath a code's row: the check before switching it off, or the question before deleting it. */
type Acting = { readonly id: string; readonly kind: "off" | "delete" } | null;

/** Which row actions the person's access reaches. */
interface May {
  readonly off: boolean;
  readonly delete: boolean;
}

/** What a row needs to offer its actions and show what they open. */
interface RowProps {
  readonly acting: Acting;
  readonly may: May;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (said: string) => void;
}

/** The question before a code is switched off; only Confirm sends. */
function SwitchOffCheck({ code, onDone, onBack }: { code: DiscountCode; onDone: () => void; onBack: () => void }) {
  return (
    <ActionCheck
      label={copy.switchOff}
      question={copy.switchTitle(code.code)}
      lines={[copy.switchLine(code.uses)]}
      send={async () => sentOf(await discountCodesApi.switchOffDiscountCode(code.id), () => ({}))}
      onDone={onDone}
      errors={copy.errors}
      onCancel={onBack}
    />
  );
}

/** A code's row actions: switched off while it is on, and deleted while no booking has taken it. */
function CodeActions({ code, acting, may, onAct }: { code: DiscountCode } & Omit<RowProps, "onDone">) {
  return (
    <td className={styles.actions}>
      {may.off && code.switched_off === null && (
        <RowButton
          beside
          aria-label={copy.switchOffLabel(code.code)}
          disabled={acting !== null}
          onClick={() => {
            onAct({ id: code.id, kind: "off" });
          }}
        >
          {copy.switchOff}
        </RowButton>
      )}
      {may.delete && code.deletable && (
        <RowButton
          beside
          aria-label={copy.deleteLabel(code.code)}
          disabled={acting !== null}
          onClick={() => {
            onAct({ id: code.id, kind: "delete" });
          }}
        >
          {copy.delete}
        </RowButton>
      )}
    </td>
  );
}

/** Beneath a code's row, what its action opened. */
function CodeActingRow({ code, span, acting, onAct, onDone }: { code: DiscountCode; span: number } & RowProps) {
  if (acting?.id !== code.id) return null;
  const cancel = () => {
    onAct(null);
  };
  return (
    <tr className={styles.acting}>
      <td colSpan={span}>
        {acting.kind === "off" ? (
          <SwitchOffCheck
            code={code}
            onDone={() => {
              onDone(copy.switchedOff);
            }}
            onBack={cancel}
          />
        ) : (
          <div className={styles.ask}>
            <DeleteAction
              name={code.code}
              send={() => discountCodesApi.deleteDiscountCode(code.id)}
              refusal={(refused) =>
                refused === "in_use" ? copy.inUse : errorText(copy.errors, { code: refused, fields: [] })
              }
              onDeleted={() => {
                onDone(copy.deleted);
              }}
              onCancel={cancel}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

const ON_COLUMNS = 10;

/** A code still on: its terms and its figures, and beneath it what its action opened. */
function CodeRows({ code, today, ...row }: { code: DiscountCode; today: string } & RowProps) {
  const ends =
    code.expires_on === null
      ? copy.noEnd
      : (code.expires_on < today ? copy.ended : copy.ends)(shortDate(code.expires_on));
  return (
    <>
      <tr>
        <th scope="row" className={styles.code}>
          {code.code}
        </th>
        <td>{discountOf(code)}</td>
        <td>{coversOf(code)}</td>
        <td>{ends}</td>
        <td className={styles.figure}>{usesOf(code)}</td>
        <td className={styles.figure}>{code.clients}</td>
        <td className={styles.figure}>{rupees(code.given)}</td>
        <td className={styles.figure}>{rupees(code.paid)}</td>
        <td>{dayOf(code.last_used)}</td>
        <CodeActions code={code} {...row} />
      </tr>
      <CodeActingRow code={code} span={ON_COLUMNS} {...row} />
    </>
  );
}

/** The codes still on: sorted by any column, narrowed by what they apply to. */
function CodesTable({
  codes,
  today,
  find,
  ...row
}: { codes: readonly DiscountCode[]; today: string; find: ReactNode } & RowProps) {
  const tableColumns: readonly Column<DiscountCode>[] = [
    { label: columns.code, sort: (code) => code.code },
    { label: columns.discount },
    { label: columns.covers, choice: coversOf },
    { label: columns.ends, sort: (code) => code.expires_on ?? "9999-12-31" },
    { label: columns.uses, sort: (code) => code.uses, figure: true },
    { label: columns.clients, sort: (code) => code.clients, figure: true },
    { label: columns.given, sort: (code) => code.given, figure: true },
    { label: columns.paid, sort: (code) => code.paid, figure: true },
    { label: columns.lastUsed, sort: (code) => code.last_used ?? "" },
  ];
  const view = useTableView(codes, tableColumns);
  return (
    <>
      <div className={styles.tools}>
        {find}
        <Narrowing view={view} label={copy.narrow} className={styles.narrow} />
      </div>
      <div className={styles.scroll}>
        <Table controls className={styles.table}>
          <thead>
            <tr>
              <SortHeads view={view} />
              <th scope="col">
                <VisuallyHidden>{columns.actions}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.shown.map((code) => (
              <CodeRows key={code.id} code={code} today={today} {...row} />
            ))}
          </tbody>
        </Table>
      </div>
      <TableEnd view={view} />
    </>
  );
}

const OFF_COLUMNS = 7;

/** A code switched off: its figures stay, and one never used may still be deleted. */
function OffRows({ code, ...row }: { code: DiscountCode } & RowProps) {
  return (
    <>
      <tr>
        <th scope="row" className={styles.code}>
          {code.code}
        </th>
        <td>{discountOf(code)}</td>
        <td className={styles.figure}>{usesOf(code)}</td>
        <td className={styles.figure}>{rupees(code.given)}</td>
        <td className={styles.figure}>{rupees(code.paid)}</td>
        <td>{dayOf(code.switched_off?.at ?? null)}</td>
        <CodeActions code={code} {...row} />
      </tr>
      <CodeActingRow code={code} span={OFF_COLUMNS} {...row} />
    </>
  );
}

/** The codes switched off, folded beneath the table. */
function SwitchedOff({ codes, ...row }: { codes: readonly DiscountCode[] } & RowProps) {
  if (codes.length === 0) return null;
  const heads: readonly (readonly [string, boolean])[] = [
    [columns.code, false],
    [columns.discount, false],
    [columns.uses, true],
    [columns.given, true],
    [columns.paid, true],
    [columns.offOn, false],
  ];
  return (
    <Disclosure
      className={styles.off}
      summaryClassName={styles.offSummary}
      summary={copy.switchedOffTitle(codes.length)}
    >
      <div className={styles.scroll}>
        <Table controls className={styles.table}>
          <thead>
            <tr>
              {heads.map(([label, figure]) => (
                <th key={label} scope="col" className={figure ? styles.figure : undefined}>
                  {label}
                </th>
              ))}
              <th scope="col">
                <VisuallyHidden>{columns.actions}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <OffRows key={code.id} code={code} {...row} may={{ off: false, delete: row.may.delete }} />
            ))}
          </tbody>
        </Table>
      </div>
    </Disclosure>
  );
}

export function DiscountCodes() {
  const [finding, setFinding] = useState<string | null>(null);
  const load = useCallback(() => discountCodesApi.discountCodes(finding), [finding]);
  const [loaded, retry] = useLoad(load);
  /** The list as it was read again after a change, so what was typed above it stays. */
  const [refreshed, setRefreshed] = useState<DiscountCodeList | null>(null);
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const mayMake = access.mayCall("POST /api/discount-codes");
  const may: May = {
    off: access.mayCall("POST /api/discount-codes/{id}/off"),
    delete: access.mayCall("POST /api/discount-codes/{id}/delete"),
  };

  const find = (code: string | null) => {
    setRefreshed(null);
    setFinding(code);
  };
  const refresh = async () => {
    const answer = await discountCodesApi.discountCodes(finding);
    if (answer.ok) setRefreshed(answer.body);
  };
  const row: RowProps = {
    acting,
    may,
    onAct: (next) => {
      setSaid(null);
      setActing(next);
    },
    onDone: (words) => {
      setActing(null);
      setSaid(words);
      void refresh();
    },
  };

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const codes = refreshed ?? loaded.value;
  const on = codes.codes.filter((code) => code.switched_off === null);
  const findForm = <FindForm finding={finding} onFind={find} />;
  const off = codes.codes.filter((code) => code.switched_off !== null);

  return (
    <Panel
      titleId="discount-codes"
      title={copy.title}
      padded
      actions={
        mayMake && (
          <DrawerButton primary label={copy.make}>
            {(close) => (
              <DiscountCodeForm
                today={codes.today}
                most={codes.batch_most}
                onMade={() => void refresh()}
                onClose={close}
              />
            )}
          </DrawerButton>
        )
      }
    >
      <Figures totals={codes.totals} />
      {said !== null && (
        <InlineMessage tone="saved" className={form.saved}>
          {said}
        </InlineMessage>
      )}
      {codes.codes.length === 0 ? (
        <>
          <div className={styles.tools}>{findForm}</div>
          <Note>{finding === null ? copy.none : copy.noneFound}</Note>
        </>
      ) : (
        <>
          <CodesTable codes={on} today={codes.today} find={findForm} {...row} />
          <SwitchedOff codes={off} {...row} />
        </>
      )}
    </Panel>
  );
}
