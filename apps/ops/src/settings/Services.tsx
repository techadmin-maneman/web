// The services clients book, and every price each has had and is to have (docs/decisions/0085-services-ops-can-edit.md,
// 0061-ops-editable-inputs.md). A kind of visit is code; the services within it are ops', and each is added, renamed,
// timed, priced, ordered and retired from a day here. A price is a row from the day it applies, so an invoice already
// issued keeps the figure it was issued under, and the row in force and the spent ones stay.
//
// Each service shows all three states at once -- in force, still to come, and, folded away, what it cost before --
// because a price set for next month is a decision somebody has to see and be able to take back or correct before it
// lands. One action is open at a time, in the block it acts on, and each shows what it changes before it is sent
// (./ServiceForms.tsx).

import { Button } from "@maneman/ui/Button";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
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
import styles from "./settings.module.css";

const copy = settings.services;

/** The one action open, and the block it is open in. */
type Action =
  | { readonly kind: "price"; readonly target: Priced }
  | { readonly kind: "correct" | "takeBack"; readonly target: Priced; readonly row: Price }
  | { readonly kind: "rename" | "length" | "retire" | "restore"; readonly service: OpsService }
  | { readonly kind: "order"; readonly of: Kind; readonly tiers: readonly string[] }
  | { readonly kind: "add"; readonly of: Kind };

/** The call each action makes: an action is offered only where the person's access reaches its call. */
const CALL_OF: Readonly<Record<Action["kind"], OpsCall>> = {
  price: "POST /api/prices",
  correct: "POST /api/prices/correct",
  takeBack: "POST /api/prices/withdraw",
  rename: "POST /api/services/{kind}/{tier}/name",
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

/** Whether a service is offered today, retires on a later day, or is retired. */
function standing(service: OpsService, today: string): string {
  if (service.retired_date === null) return copy.offered;
  const from = longDate(service.retired_date);
  return service.retired_date > today ? copy.retiring(from) : copy.retired(from);
}

/** A price's lines: the one in force, each still to come with what may be done to it, and the spent ones folded. */
function PriceLines(props: {
  readonly target: Priced;
  readonly today: string;
  readonly busy: boolean;
  readonly may: Opened["may"];
  readonly onAct: (action: Action) => void;
}) {
  const { target, today } = props;
  const inForce = target.prices.find((price) => price.in_force);
  const toCome = target.prices.filter((price) => price.valid_from > today).reverse();
  const spent = target.prices.filter((price) => !price.in_force && price.valid_from <= today);
  return (
    <>
      <p className={styles.priceNow}>
        {inForce === undefined ? copy.unpriced : copy.now(priceWords(inForce), longDate(inForce.valid_from))}
      </p>
      {toCome.map((row) => (
        <p key={row.valid_from} className={styles.priceToCome}>
          {copy.toCome(priceWords(row), longDate(row.valid_from))}
          {props.may("correct") && (
            <button
              className={styles.inline}
              type="button"
              aria-label={copy.labels.correct(target.name, longDate(row.valid_from))}
              disabled={props.busy}
              onClick={() => {
                props.onAct({ kind: "correct", target, row });
              }}
            >
              {copy.actions.correct}
            </button>
          )}
          {props.may("takeBack") && (
            <button
              className={styles.inline}
              type="button"
              aria-label={copy.labels.takeBack(target.name, longDate(row.valid_from))}
              disabled={props.busy}
              onClick={() => {
                props.onAct({ kind: "takeBack", target, row });
              }}
            >
              {copy.actions.takeBack}
            </button>
          )}
        </p>
      ))}
      {spent.length > 0 && (
        <details className={styles.history}>
          <summary>{copy.history(spent.length)}</summary>
          <Table className={styles.table}>
            <caption>
              <VisuallyHidden>{copy.historyCaption(target.name)}</VisuallyHidden>
            </caption>
            <thead>
              <tr>
                {copy.historyColumns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spent.map((row) => (
                <tr key={row.valid_from} className={styles.spent}>
                  <td className={styles.figure}>{rupees(row.amount_ex_gst)}</td>
                  <td className={styles.figure}>{copy.percent(row.gst_percent)}</td>
                  <td className={styles.figure}>{longDate(row.valid_from)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>
      )}
    </>
  );
}

interface Opened {
  readonly action: Action | null;
  readonly outcome: { readonly where: string; readonly said: string } | null;
  readonly book: ServiceBook;
  /** Whether the person's access lets them take this kind of action. */
  readonly may: (kind: Action["kind"]) => boolean;
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
    <Button
      variant="outline"
      size="small"
      className={styles.quiet}
      aria-label={props.label}
      disabled={props.opened.action !== null}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/** One service: what it is, what it costs, and what may be done to it. */
function ServiceBlock(props: {
  readonly service: OpsService;
  readonly siblings: readonly OpsService[];
  readonly opened: Opened;
}) {
  const { service, siblings, opened } = props;
  const today = opened.book.today;
  const where = whereOf(service.kind, service.tier);
  const place = siblings.findIndex((each) => each.tier === service.tier);
  const busy = opened.action !== null;
  const act = (kind: "rename" | "length" | "retire" | "restore") => () => {
    opened.onAct({ kind, service });
  };
  const move = (by: -1 | 1) => () => {
    const tiers = siblings.map((each) => each.tier);
    const [moved] = tiers.splice(place, 1);
    if (moved !== undefined) tiers.splice(place + by, 0, moved);
    opened.onAct({ kind: "order", of: service.kind, tiers });
  };
  const retiredNow = service.retired_date !== null && service.retired_date <= today;
  const nameId = `service-${service.kind}-${service.tier}`;
  return (
    <li className={styles.service}>
      <h4 className={styles.serviceName} id={nameId}>
        {service.name}
      </h4>
      <p className={styles.facts}>
        {[
          copy.facts(service.minutes, service.tier),
          service.fsm_item_id === null ? copy.fsm.notYet : copy.fsm.linked,
          standing(service, today),
        ].join(" · ")}
      </p>
      <PriceLines target={asPriced(service)} today={today} busy={busy} may={opened.may} onAct={opened.onAct} />
      <div className={styles.actions}>
        {!retiredNow && (
          <ActionButton
            opened={opened}
            kind="price"
            label={copy.labels.price(service.name)}
            onClick={() => {
              opened.onAct({ kind: "price", target: asPriced(service) });
            }}
          >
            {copy.actions.price}
          </ActionButton>
        )}
        <ActionButton opened={opened} kind="rename" label={copy.labels.rename(service.name)} onClick={act("rename")}>
          {copy.actions.rename}
        </ActionButton>
        <ActionButton opened={opened} kind="length" label={copy.labels.length(service.name)} onClick={act("length")}>
          {copy.actions.length}
        </ActionButton>
        {service.retired_date === null ? (
          <ActionButton opened={opened} kind="retire" label={copy.labels.retire(service.name)} onClick={act("retire")}>
            {copy.actions.retire}
          </ActionButton>
        ) : (
          <ActionButton
            opened={opened}
            kind="restore"
            label={copy.labels.restore(service.name)}
            onClick={act("restore")}
          >
            {copy.actions.restore}
          </ActionButton>
        )}
        {place > 0 && (
          <ActionButton opened={opened} kind="order" label={copy.labels.up(service.name)} onClick={move(-1)}>
            {copy.actions.up}
          </ActionButton>
        )}
        {place < siblings.length - 1 && (
          <ActionButton opened={opened} kind="order" label={copy.labels.down(service.name)} onClick={move(1)}>
            {copy.actions.down}
          </ActionButton>
        )}
      </div>
      <OpenAction opened={opened} where={where} />
      <Outcome opened={opened} where={where} />
    </li>
  );
}

/** A late fee, one figure for its kind, beside the kind's services. */
function LateFeeBlock({ fee, opened }: { fee: LateFee; opened: Opened }) {
  const mayOpenRules = useAccess().mayCall("GET /api/settings");
  const target = lateFeePriced(fee);
  const where = whereOf(fee.item, "standard");
  const nameId = `late-fee-${fee.item}`;
  return (
    <li className={styles.service}>
      <h4 className={styles.serviceName} id={nameId}>
        {target.name}
      </h4>
      <p className={styles.facts}>
        {copy.lateFeeNote}
        {mayOpenRules && (
          <>
            {" "}
            <OpsLink className={styles.link} to={rulePath("late_change_charge")}>
              {copy.lateFeeRule}
            </OpsLink>
          </>
        )}
      </p>
      <PriceLines
        target={target}
        today={opened.book.today}
        busy={opened.action !== null}
        may={opened.may}
        onAct={opened.onAct}
      />
      <div className={styles.actions}>
        <ActionButton
          opened={opened}
          kind="price"
          label={copy.labels.price(target.name)}
          onClick={() => {
            opened.onAct({ kind: "price", target });
          }}
        >
          {copy.actions.price}
        </ActionButton>
      </div>
      <OpenAction opened={opened} where={where} />
      <Outcome opened={opened} where={where} />
    </li>
  );
}

/** One kind of visit: its services in their order, its late fee where it has one, and a way to add another. */
function KindSection({ kind, opened }: { kind: Kind; opened: Opened }) {
  const services = opened.book.services.filter((service) => service.kind === kind);
  const fee = opened.book.late_fees.find((each) => each.kind === kind);
  const name = copy.kinds[kind] ?? kind;
  const titleId = `kind-${kind}`;
  return (
    <section className={styles.kind} aria-labelledby={titleId}>
      <h3 className={styles.kindTitle} id={titleId}>
        {name}
      </h3>
      {kind === "first_fit" && <p className={styles.note}>{copy.hairSystems}</p>}
      <ul className={styles.services}>
        {services.map((service) => (
          <ServiceBlock key={service.tier} service={service} siblings={services} opened={opened} />
        ))}
        {fee !== undefined && <LateFeeBlock fee={fee} opened={opened} />}
      </ul>
      <OpenAction opened={opened} where={kind} />
      <Outcome opened={opened} where={kind} />
      {opened.may("add") && (opened.action === null || actionWhere(opened.action) !== kind) && (
        <div className={styles.actions}>
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
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const current = book ?? loaded.value;
  const opened: Opened = {
    action,
    outcome,
    book: current,
    may: (kind) => access.mayCall(CALL_OF[kind]),
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
    <section className={styles.panel} aria-labelledby="services">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="services">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>{copy.note}</p>
      {current.kinds.map(({ kind }) => (
        <KindSection key={kind} kind={kind} opened={opened} />
      ))}
    </section>
  );
}
