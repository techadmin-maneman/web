// Finance · Discount codes (docs/decisions/0108-discount-codes.md): what every code has come to, then a table of codes
// with their uses and takings. A code is made, and found by how it begins; a row opens its record beside the list,
// where it is switched off or, while no booking has taken it, deleted. Codes switched off fold away beneath.

import { Badge } from "@maneman/ui/Badge";
import { Toast } from "@maneman/ui/Toast";
import { Panel } from "@maneman/ui/Panel";
import { Note } from "@maneman/ui/Note";
import { Table, TableScroll } from "@maneman/ui/Table";
import { TextButton } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState, type ReactNode } from "react";
import { type DiscountCode, type DiscountCodes as DiscountCodeList } from "../api.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { FormDrawer } from "../components/FormDrawer.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { CodeRecord } from "./CodeRecord.tsx";
import { DiscountCodeForm } from "./DiscountCodeForm.tsx";
import { FindForm } from "./FindCode.tsx";
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

const endsOf = (code: DiscountCode, today: string): string =>
  code.expires_on === null
    ? copy.noEnd
    : (code.expires_on < today ? copy.ended : copy.ends)(shortDate(code.expires_on));

/** Where a code stands: live, past its end, or switched off; one filter, and a pill in its row. */
const stateOf = (code: DiscountCode, today: string): "live" | "ended" | "off" => {
  if (code.switched_off !== null) return "off";
  return code.expires_on !== null && code.expires_on < today ? "ended" : "live";
};

const STATE_TONES = { live: "done", ended: "neutral", off: "neutral" } as const;

/** A code by its name, the way its record opens. */
function CodeHead({ code, onOpen }: { code: DiscountCode; onOpen: (id: string) => void }) {
  return (
    <th scope="row" className={styles.code}>
      <TextButton
        compact
        aria-label={copy.open(code.code)}
        onClick={() => {
          onOpen(code.id);
        }}
      >
        {code.code}
      </TextButton>
    </th>
  );
}

/** A code: its terms, where it stands, and its figures. */
function CodeRow({ code, today, onOpen }: { code: DiscountCode; today: string; onOpen: (id: string) => void }) {
  return (
    <tr>
      <CodeHead code={code} onOpen={onOpen} />
      <td>{discountOf(code)}</td>
      <td>{coversOf(code)}</td>
      <td>{endsOf(code, today)}</td>
      <td>
        <Badge tone={STATE_TONES[stateOf(code, today)]}>
          {code.switched_off === null ? copy.states[stateOf(code, today)] : copy.offSince(dayOf(code.switched_off.at))}
        </Badge>
      </td>
      <td className={styles.figure}>{usesOf(code)}</td>
      <td className={styles.figure}>{code.clients}</td>
      <td className={styles.figure}>{rupees(code.given)}</td>
      <td className={styles.figure}>{rupees(code.paid)}</td>
      <td>{dayOf(code.last_used)}</td>
    </tr>
  );
}

/** Every code: sorted by any column, narrowed by what they apply to and where they stand. */
function CodesTable({
  codes,
  today,
  find,
  onOpen,
}: {
  codes: readonly DiscountCode[];
  today: string;
  find: ReactNode;
  onOpen: (id: string) => void;
}) {
  const tableColumns: readonly Column<DiscountCode>[] = [
    { label: columns.code, sort: (code) => code.code },
    { label: columns.discount },
    { label: columns.covers, choice: coversOf },
    { label: columns.ends, sort: (code) => code.expires_on ?? "9999-12-31" },
    { label: columns.state, choice: (code) => copy.states[stateOf(code, today)] },
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
      <TableScroll labelledBy="discount-codes">
        <Table className={styles.table}>
          <thead>
            <tr>
              <SortHeads view={view} />
            </tr>
          </thead>
          <tbody>
            {view.shown.map((code) => (
              <CodeRow key={code.id} code={code} today={today} onOpen={onOpen} />
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <TableEnd view={view} />
    </>
  );
}

/** A code's record, beside the list, its values read as its row reads them. */
function OpenCode(props: {
  code: DiscountCode;
  today: string;
  onClose: () => void;
  onDone: (said: string) => Promise<void>;
}) {
  const { code } = props;
  return (
    <FormDrawer title={code.code} onClose={props.onClose}>
      <CodeRecord
        code={code}
        reads={{
          discount: discountOf(code),
          covers: coversOf(code),
          ends: endsOf(code, props.today),
          uses: usesOf(code),
          lastUsed: dayOf(code.last_used),
          offOn: dayOf(code.switched_off?.at ?? null),
        }}
        onDone={props.onDone}
      />
    </FormDrawer>
  );
}

/** Making codes, from the list's head, for a person who may. */
function MakeCodes({ codes, onMade }: { codes: DiscountCodeList; onMade: () => void }) {
  if (!useAccess().mayCall("POST /api/discount-codes")) return null;
  return (
    <DrawerButton primary label={copy.make}>
      {(close) => <DiscountCodeForm today={codes.today} most={codes.batch_most} onMade={onMade} onClose={close} />}
    </DrawerButton>
  );
}

export function DiscountCodes() {
  const [finding, setFinding] = useState<string | null>(null);
  const load = useCallback(() => discountCodesApi.discountCodes(finding), [finding]);
  const [loaded, retry] = useLoad(load);
  /** The list as it was read again after a change, so what was typed above it stays. */
  const [refreshed, setRefreshed] = useState<DiscountCodeList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const refresh = async () => {
    const answer = await discountCodesApi.discountCodes(finding);
    if (answer.ok) setRefreshed(answer.body);
  };
  const opening = (id: string) => {
    setSaid(null);
    setOpen(id);
  };

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const codes = refreshed ?? loaded.value;
  const findForm = (
    <FindForm
      finding={finding}
      onFind={(code) => {
        setRefreshed(null);
        setFinding(code);
      }}
    />
  );
  const opened = codes.codes.find((code) => code.id === open);

  return (
    <Panel
      titleId="discount-codes"
      title={copy.title}
      actions={<MakeCodes codes={codes} onMade={() => void refresh()} />}
    >
      <Figures totals={codes.totals} />
      {said !== null && <Toast>{said}</Toast>}
      {codes.codes.length === 0 ? (
        <>
          <div className={styles.tools}>{findForm}</div>
          <Note>{finding === null ? copy.none : copy.noneFound}</Note>
        </>
      ) : (
        <>
          <CodesTable codes={codes.codes} today={codes.today} find={findForm} onOpen={opening} />
        </>
      )}
      {opened !== undefined && (
        <OpenCode
          code={opened}
          today={codes.today}
          onClose={() => {
            setOpen(null);
          }}
          onDone={async (words) => {
            setOpen(null);
            setSaid(words);
            await refresh();
          }}
        />
      )}
    </Panel>
  );
}
