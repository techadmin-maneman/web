// The services clients book, and every price each has had and is to have (docs/decisions/0085-services-ops-can-edit.md,
// 0061-ops-editable-inputs.md). A kind of visit is code; its services are ops'. A price is a row from the day it
// applies, so an issued invoice keeps its figure. One action is open at a time, each checked before it is sent
// (./ServiceForms.tsx).

import { RowButton } from "@maneman/ui/Button";
import { Panel } from "@maneman/ui/Panel";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState, type ReactNode } from "react";
import { type Kind, type LateFee, type OpsService, type ServiceCatalogue } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { rulePath } from "../settings/index.ts";
import { priceWords, type Priced } from "./PriceForms.tsx";
import {
  CALL_OF,
  whereOf,
  actionWhere,
  withPrices,
  asPriced,
  lateFeePriced,
  standing,
  pricesOf,
  type ServiceWord,
  type Action,
} from "./service-actions.ts";
import form from "../components/forms.module.css";
import styles from "./prices.module.css";
import { FormActions } from "../components/FormActions.tsx";
import { type Opened, OpenAction, Outcome, ActionButton } from "./ServiceActions.tsx";
import { pricesApi } from "./prices-api.ts";

const copy = settings.services;

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
  const { toCome, spent } = pricesOf(target, opened.services.today);
  const busy = opened.action !== null;
  return (
    <tr className={styles.strip} id={props.id}>
      <td colSpan={copy.columns.length + 1}>
        <FormActions>
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
        </FormActions>
        {toCome.map((row) => (
          <p key={row.valid_from} className={styles.line}>
            {copy.toCome(priceWords(row), longDate(row.valid_from))}
            {opened.may("correct") && (
              <RowButton
                className={form.inline}
                aria-label={copy.labels.correct(target.name, longDate(row.valid_from))}
                disabled={busy}
                onClick={() => {
                  opened.onAct({ kind: "correct", target, row });
                }}
              >
                {copy.actions.correct}
              </RowButton>
            )}
            {opened.may("takeBack") && (
              <RowButton
                className={form.inline}
                aria-label={copy.labels.takeBack(target.name, longDate(row.valid_from))}
                disabled={busy}
                onClick={() => {
                  opened.onAct({ kind: "takeBack", target, row });
                }}
              >
                {copy.actions.takeBack}
              </RowButton>
            )}
          </p>
        ))}
        {spent.length > 0 && (
          <p className={classes(styles.line, styles.muted)}>
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
  const { inForce, toCome } = pricesOf(target, opened.services.today);
  const next = toCome[0];
  const open = opened.expanded === where;
  const stripId = `prices-${where.replace("/", "-")}`;
  return (
    <>
      <tr className={props.retired ? styles.retired : undefined}>
        <th scope="row" className={styles.name}>
          <span>{props.name}</span>
          {props.lines.map((line) => (
            <span key={line} className={styles.sub}>
              {line}
            </span>
          ))}
        </th>
        <td className={styles.figure}>{props.minutes === null ? "" : copy.minutes(props.minutes)}</td>
        <td className={styles.figure}>{inForce === undefined ? copy.unpriced : rupees(inForce.amount_ex_gst)}</td>
        <td className={styles.figure}>{inForce === undefined ? "" : copy.percent(inForce.gst_percent)}</td>
        <td>
          {next === undefined
            ? ""
            : copy.toCome(
                next.gst_percent === inForce?.gst_percent ? rupees(next.amount_ex_gst) : priceWords(next),
                longDate(next.valid_from),
              )}
        </td>
        <td className={styles.edit}>
          <RowButton
            className={form.inline}
            aria-label={copy.labels.edit(target.name)}
            aria-expanded={open}
            aria-controls={open ? stripId : undefined}
            disabled={opened.action !== null && !open}
            onClick={() => {
              opened.onExpand(open ? null : where);
            }}
          >
            {copy.actions.edit}
          </RowButton>
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
  const today = opened.services.today;
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
          <OpsLink className={classes(form.link, styles.ruleLink)} to={rulePath("late_change_charge")}>
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
  const services = opened.services.services.filter((service) => service.kind === kind);
  const fee = opened.services.late_fees.find((each) => each.kind === kind);
  const name = copy.kinds[kind];
  const titleId = `kind-${kind}`;
  return (
    <section className={classes(styles.kindSection, styles.kind)} aria-labelledby={titleId}>
      <h3 className={styles.kindTitle} id={titleId}>
        {name}
      </h3>
      <div className={styles.scroll}>
        <Table className={classes(form.table, styles.table)}>
          <caption>
            <VisuallyHidden>{name}</VisuallyHidden>
          </caption>
          <thead>
            <tr>
              {copy.columns.map((column, at) => (
                <th key={column} scope="col" className={at > 0 && at < 4 ? styles.figure : undefined}>
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
        <div className={classes(form.actions, styles.add)}>
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
  const [loaded, retry] = useLoad(pricesApi.services);
  /** The services after a change, so the panel follows without reading it again. */
  const [services, setServices] = useState<ServiceCatalogue | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [outcome, setOutcome] = useState<Opened["outcome"]>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const access = useAccess();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const current = services ?? loaded.value;
  const opened: Opened = {
    action,
    outcome,
    services: current,
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
      if (written.services !== undefined) setServices(written.services);
      else if (written.prices !== undefined) setServices(withPrices(current, written.prices));
      setAction(null);
    },
    onCancel: () => {
      setAction(null);
    },
  };

  return (
    <Panel titleId="services" title={copy.title} className={form.panel}>
      {current.kinds.map(({ kind }) => (
        <KindSection key={kind} kind={kind} opened={opened} />
      ))}
    </Panel>
  );
}
