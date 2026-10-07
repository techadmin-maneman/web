// The services clients book, and every price each has had and is to have (docs/decisions/0085-services-ops-can-edit.md,
// 0061-ops-editable-inputs.md). A kind of visit is code; the services within it are ops', and each is added, renamed,
// described, timed, priced, ordered and retired from a day here. A price is a row from the day it applies, so an
// invoice already issued keeps the figure it was issued under, and the row in force and the spent ones stay.
//
// Each kind is a table, a row a service: its price in force and the next to come. A row's Edit opens what may be done
// to it, with its prices still to come and its earlier ones. One action is open at a time, and each shows what it
// changes before it is sent (./ServiceForms.tsx).

import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState, type ReactNode } from "react";
import { api, type Kind, type LateFee, type OpsService, type Price, type ServiceBook } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { useAccess, type OpsCall } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { rulePath } from "./rule-groups.ts";
import {
  AddForm,
  DescribeForm,
  LengthForm,
  OrderCheck,
  PriceForm,
  priceWords,
  RenameForm,
  RestoreCheck,
  RetireForm,
  TakeBack,
  type Priced,
  type Written,
} from "./ServiceForms.tsx";
import styles from "../components/forms.module.css";
import prices from "./prices.module.css";

const copy = settings.services;

/** A service's buttons, each named by its words and its label. */
type ServiceWord = "price" | "rename" | "describe" | "length" | "retire" | "restore" | "up" | "down";

/** The one action open, and the block it is open in. */
type Action =
  | { readonly kind: "price"; readonly target: Priced }
  | { readonly kind: "correct" | "takeBack"; readonly target: Priced; readonly row: Price }
  | { readonly kind: "rename" | "describe" | "length" | "retire" | "restore"; readonly service: OpsService }
  | { readonly kind: "order"; readonly of: Kind; readonly tiers: readonly string[] }
  | { readonly kind: "add"; readonly of: Kind };

/** The call each action makes: an action is offered only where the person's access reaches its call. */
const CALL_OF: Readonly<Record<Action["kind"], OpsCall>> = {
  price: "POST /api/prices",
  correct: "POST /api/prices/correct",
  takeBack: "POST /api/prices/withdraw",
  rename: "POST /api/services/{kind}/{tier}/name",
  describe: "POST /api/services/{kind}/{tier}/description",
  length: "POST /api/services/{kind}/{tier}/length",
  retire: "POST /api/services/{kind}/{tier}/retire",
  restore: "POST /api/services/{kind}/{tier}/restore",
  order: "POST /api/services/{kind}/order",
  add: "POST /api/services",
};

/** Where a block is, so an action and what came of it are shown in the one it belongs to. */
const whereOf = (item: string, tier: string) => `${item}/${tier}`;

const actionWhere = (action: Action): string => {
  if (action.kind === "order" || action.kind === "add") return action.of;
  if ("target" in action) return whereOf(action.target.item, action.target.tier);
  return whereOf(action.service.kind, action.service.tier);
};

/** The book after a price is set or taken back: each service's and late fee's rows, from the book's answer. */
function withPrices(book: ServiceBook, prices: readonly Price[]): ServiceBook {
  const rowsOf = (item: string, tier: string) => prices.filter((row) => row.item === item && row.tier === tier);
  return {
    ...book,
    services: book.services.map((service) => ({ ...service, prices: rowsOf(service.kind, service.tier) })),
    late_fees: book.late_fees.map((fee) => ({ ...fee, prices: rowsOf(fee.item, "standard") })),
  };
}

const asPriced = (service: OpsService): Priced => ({
  item: service.kind,
  tier: service.tier,
  name: service.name,
  prices: service.prices,
});

const lateFeePriced = (fee: LateFee): Priced => ({
  item: fee.item,
  tier: "standard",
  name: copy.lateFees[fee.item] ?? fee.item,
  prices: fee.prices,
});
/** When a service stops, or stopped, being offered; nothing while it is offered. */
function standing(service: OpsService, today: string): string | null {
  if (service.retired_date === null) return null;
  const from = longDate(service.retired_date);
  return service.retired_date > today ? copy.retiring(from) : copy.retired(from);
}

/** A row's own prices: the one in force, those still to come, soonest first, and the spent ones. */
function pricesOf(target: Priced, today: string) {
  return {
    inForce: target.prices.find((price) => price.in_force),
    toCome: target.prices.filter((price) => price.valid_from > today).reverse(),
    spent: target.prices.filter((price) => !price.in_force && price.valid_from <= today),
  };
}

interface Opened {
  readonly action: Action | null;
  readonly outcome: { readonly where: string; readonly said: string } | null;
  readonly book: ServiceBook;
  /** The row whose Edit is open, if one is. */
  readonly expanded: string | null;
  /** Whether the person's access lets them take this kind of action. */
  readonly may: (kind: Action["kind"]) => boolean;
  readonly onExpand: (where: string | null) => void;
  readonly onAct: (action: Action) => void;
  readonly onDone: (written: Written & { ok: true }) => void;
  readonly onCancel: () => void;
}

/** The form or check open in a block, if this block has one. */
function OpenAction({ opened, where }: { opened: Opened; where: string }) {
  const { action, book } = opened;
  if (action === null || actionWhere(action) !== where) return null;
  const bounds = { min: book.min_minutes, max: book.max_minutes };
  const done = opened.onDone;
  const cancel = opened.onCancel;
  switch (action.kind) {
    case "price":
    case "correct":
      return (
        <PriceForm
          target={action.target}
          {...(action.kind === "correct" ? { correcting: action.row } : {})}
          today={book.today}
          maxAmount={book.max_amount_ex_gst}
          maxGst={book.max_gst_percent}
          onDone={done}
          onCancel={cancel}
        />
      );
    case "takeBack":
      return <TakeBack target={action.target} row={action.row} onDone={done} onKeep={cancel} />;
    case "rename":
      return <RenameForm service={action.service} onDone={done} onCancel={cancel} />;
    case "describe":
      return <DescribeForm service={action.service} maxLength={book.max_description} onDone={done} onCancel={cancel} />;
    case "length":
      return <LengthForm service={action.service} bounds={bounds} onDone={done} onCancel={cancel} />;
    case "retire":
      return <RetireForm service={action.service} today={book.today} onDone={done} onCancel={cancel} />;
    case "restore":
      return <RestoreCheck service={action.service} onDone={done} onKeep={cancel} />;
    case "order": {
      const was = book.services.filter((service) => service.kind === action.of);
      const now = action.tiers.flatMap((tier) => was.filter((service) => service.tier === tier));
      return <OrderCheck kind={action.of} was={was} now={now} onDone={done} onKeep={cancel} />;
    }
    case "add": {
      const minutes = book.kinds.find((each) => each.kind === action.of)?.minutes ?? bounds.min;
      return <AddForm kind={action.of} minutes={minutes} bounds={bounds} onDone={done} onCancel={cancel} />;
    }
  }
}

/** What the last action came to, in the block it was taken in. */
function Outcome({ opened, where }: { opened: Opened; where: string }) {
  if (opened.outcome?.where !== where) return null;
  return (
    <p className={styles.saved} role="status">
      {opened.outcome.said}
    </p>
  );
}

/** One of a block's buttons, offered only where the person's access reaches what it does. */
function ActionButton(props: {
  readonly opened: Opened;
  readonly kind: Action["kind"];
  /** Its whole name, which says which service or fee it acts on. */
  readonly label?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  if (!props.opened.may(props.kind)) return null;
  return (
    <button
      className={classes(styles.inline, prices.action)}
      type="button"
      aria-label={props.label}
      disabled={props.opened.action !== null}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** One of a row's actions: the button's words, the call it makes, and what it opens. */
interface RowAction {
  readonly kind: Action["kind"];
  readonly word: ServiceWord;
  readonly onClick: () => void;
}

/** What an open row offers: its actions, its prices still to come with their own, and its earlier prices. */
function Strip(props: {
  readonly id: string;
  readonly where: string;
  readonly target: Priced;
  readonly actions: readonly RowAction[];
  readonly link?: ReactNode;
  readonly opened: Opened;
}) {
  const { target, opened } = props;
  const { toCome, spent } = pricesOf(target, opened.book.today);
  const busy = opened.action !== null;
  return (
    <tr className={prices.strip} id={props.id}>
      <td colSpan={copy.columns.length + 1}>
        <div className={styles.actions}>
          {props.actions.map((action) => (
            <ActionButton
              key={action.word}
              opened={opened}
              kind={action.kind}
              label={copy.labels[action.word](target.name)}
              onClick={action.onClick}
            >
              {copy.actions[action.word]}
            </ActionButton>
          ))}
          {props.link}
        </div>
        {toCome.map((row) => (
          <p key={row.valid_from} className={prices.line}>
            {copy.toCome(priceWords(row), longDate(row.valid_from))}
            {opened.may("correct") && (
              <button
                className={styles.inline}
                type="button"
                aria-label={copy.labels.correct(target.name, longDate(row.valid_from))}
                disabled={busy}
                onClick={() => {
                  opened.onAct({ kind: "correct", target, row });
                }}
              >
                {copy.actions.correct}
              </button>
            )}
            {opened.may("takeBack") && (
              <button
                className={styles.inline}
                type="button"
                aria-label={copy.labels.takeBack(target.name, longDate(row.valid_from))}
                disabled={busy}
                onClick={() => {
                  opened.onAct({ kind: "takeBack", target, row });
                }}
              >
                {copy.actions.takeBack}
              </button>
            )}
          </p>
        ))}
        {spent.length > 0 && (
          <p className={classes(prices.line, prices.muted)}>
            {copy.earlier(spent.map((row) => copy.toCome(priceWords(row), longDate(row.valid_from))))}
          </p>
        )}
        <OpenAction opened={opened} where={props.where} />
        <Outcome opened={opened} where={props.where} />
      </td>
    </tr>
  );
}

/** One row of a kind's table, a service or a late fee: its name, length and prices, and its Edit. */
function PriceRow(props: {
  readonly where: string;
  /** What the row shows; the target's name says it in full to a screen reader. */
  readonly name: string;
  readonly lines: readonly string[];
  readonly minutes: number | null;
  readonly target: Priced;
  readonly retired: boolean;
  readonly actions: readonly RowAction[];
  readonly link?: ReactNode;
  readonly opened: Opened;
}) {
  const { where, target, opened } = props;
  const { inForce, toCome } = pricesOf(target, opened.book.today);
  const next = toCome[0];
  const open = opened.expanded === where;
  const stripId = `prices-${where.replace("/", "-")}`;
  return (
    <>
      <tr className={props.retired ? prices.retired : undefined}>
        <th scope="row" className={prices.name}>
          <span>{props.name}</span>
          {props.lines.map((line) => (
            <span key={line} className={prices.sub}>
              {line}
            </span>
          ))}
        </th>
        <td className={prices.figure}>{props.minutes === null ? "" : copy.minutes(props.minutes)}</td>
        <td className={prices.figure}>{inForce === undefined ? copy.unpriced : rupees(inForce.amount_ex_gst)}</td>
        <td className={prices.figure}>{inForce === undefined ? "" : copy.percent(inForce.gst_percent)}</td>
        <td>
          {next === undefined
            ? ""
            : copy.toCome(
                next.gst_percent === inForce?.gst_percent ? rupees(next.amount_ex_gst) : priceWords(next),
                longDate(next.valid_from),
              )}
        </td>
        <td className={prices.edit}>
          <button
            className={styles.inline}
            type="button"
            aria-label={copy.labels.edit(target.name)}
            aria-expanded={open}
            aria-controls={open ? stripId : undefined}
            disabled={opened.action !== null && !open}
            onClick={() => {
              opened.onExpand(open ? null : where);
            }}
          >
            {copy.actions.edit}
          </button>
        </td>
      </tr>
      {open && (
        <Strip id={stripId} where={where} target={target} actions={props.actions} link={props.link} opened={opened} />
      )}
    </>
  );
}

/** A service's row, offering what may be done to it: no new price once it is retired, and no move past an end. */
function ServiceRow(props: {
  readonly service: OpsService;
  readonly siblings: readonly OpsService[];
  readonly opened: Opened;
}) {
  const { service, siblings, opened } = props;
  const today = opened.book.today;
  const place = siblings.findIndex((each) => each.tier === service.tier);
  const act = (kind: "rename" | "describe" | "length" | "retire" | "restore") => () => {
    opened.onAct({ kind, service });
  };
  const move = (by: -1 | 1) => () => {
    const tiers = siblings.map((each) => each.tier);
    const [moved] = tiers.splice(place, 1);
    if (moved !== undefined) tiers.splice(place + by, 0, moved);
    opened.onAct({ kind: "order", of: service.kind, tiers });
  };
  const retiredNow = service.retired_date !== null && service.retired_date <= today;
  const actions: readonly RowAction[] = [
    ...(retiredNow
      ? []
      : [
          {
            kind: "price" as const,
            word: "price" as const,
            onClick: () => {
              opened.onAct({ kind: "price", target: asPriced(service) });
            },
          },
        ]),
    { kind: "rename", word: "rename", onClick: act("rename") },
    { kind: "describe", word: "describe", onClick: act("describe") },
    { kind: "length", word: "length", onClick: act("length") },
    service.retired_date === null
      ? { kind: "retire", word: "retire", onClick: act("retire") }
      : { kind: "restore", word: "restore", onClick: act("restore") },
    ...(place > 0 ? [{ kind: "order" as const, word: "up" as const, onClick: move(-1) }] : []),
    ...(place < siblings.length - 1 ? [{ kind: "order" as const, word: "down" as const, onClick: move(1) }] : []),
  ];
  const lines = [standing(service, today), service.description].filter((line) => line !== null);
  return (
    <PriceRow
      where={whereOf(service.kind, service.tier)}
      name={service.name}
      lines={lines}
      minutes={service.minutes}
      target={asPriced(service)}
      retired={retiredNow}
      actions={actions}
      opened={opened}
    />
  );
}

/** A kind's late fee, one figure for the kind, with the way to the rule that says when it is charged. */
function LateFeeRow({ fee, opened }: { fee: LateFee; opened: Opened }) {
  const mayOpenRules = useAccess().mayCall("GET /api/settings");
  const target = lateFeePriced(fee);
  const price: RowAction = {
    kind: "price",
    word: "price",
    onClick: () => {
      opened.onAct({ kind: "price", target });
    },
  };
  return (
    <PriceRow
      where={whereOf(fee.item, "standard")}
      name={copy.lateFee}
      lines={[]}
      minutes={null}
      target={target}
      retired={false}
      actions={[price]}
      link={
        mayOpenRules && (
          <OpsLink className={classes(styles.link, prices.ruleLink)} to={rulePath("late_change_charge")}>
            {copy.lateFeeRule}
          </OpsLink>
        )
      }
      opened={opened}
    />
  );
}

/** One kind of visit: its services in their order and its late fee in one table, and a way to add another. */
function KindSection({ kind, opened }: { kind: Kind; opened: Opened }) {
  const services = opened.book.services.filter((service) => service.kind === kind);
  const fee = opened.book.late_fees.find((each) => each.kind === kind);
  const name = copy.kinds[kind] ?? kind;
  const titleId = `kind-${kind}`;
  return (
    <section className={classes(styles.kind, prices.kind)} aria-labelledby={titleId}>
      <h3 className={styles.kindTitle} id={titleId}>
        {name}
      </h3>
      <div className={prices.scroll}>
        <Table className={classes(styles.table, prices.table)}>
          <caption>
            <VisuallyHidden>{name}</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              {copy.columns.map((column, at) => (
                <th key={column} scope="col" className={at > 0 && at < 4 ? prices.figure : undefined}>
                  {column}
                </th>
              ))}
              <th scope="col">
                <VisuallyHidden>{copy.actionsColumn}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <ServiceRow key={service.tier} service={service} siblings={services} opened={opened} />
            ))}
            {fee !== undefined && <LateFeeRow fee={fee} opened={opened} />}
          </tbody>
        </Table>
      </div>
      <OpenAction opened={opened} where={kind} />
      <Outcome opened={opened} where={kind} />
      {opened.may("add") && (opened.action === null || actionWhere(opened.action) !== kind) && (
        <div className={classes(styles.actions, prices.add)}>
          <ActionButton
            opened={opened}
            kind="add"
            onClick={() => {
              opened.onAct({ kind: "add", of: kind });
            }}
          >
            {kind === "first_fit" ? copy.actions.addHairSystem : copy.actions.add(name)}
          </ActionButton>
        </div>
      )}
    </section>
  );
}

export function Services() {
  const [loaded, retry] = useLoad(api.services);
  /** The book after a change, so the panel follows without reading it again. */
  const [book, setBook] = useState<ServiceBook | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [outcome, setOutcome] = useState<Opened["outcome"]>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const current = book ?? loaded.value;
  const opened: Opened = {
    action,
    outcome,
    book: current,
    expanded,
    may: (kind) => access.mayCall(CALL_OF[kind]),
    onExpand: (where) => {
      setOutcome(null);
      setAction(null);
      setExpanded(where);
    },
    onAct: (next) => {
      setOutcome(null);
      setAction(next);
    },
    onDone: (written) => {
      if (action !== null) setOutcome({ where: actionWhere(action), said: written.said });
      if (written.services !== undefined) setBook(written.services);
      else if (written.prices !== undefined) setBook(withPrices(current, written.prices));
      setAction(null);
    },
    onCancel: () => {
      setAction(null);
    },
  };

  return (
    <Panel titleId="services" title={copy.title} className={styles.panel}>
      {current.kinds.map(({ kind }) => (
        <KindSection key={kind} kind={kind} opened={opened} />
      ))}
    </Panel>
  );
}
