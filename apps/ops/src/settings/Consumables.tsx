// Settings, Consumables (docs/decisions/0087-consumables-and-stock.md): what a
// technician may record using on a job, what one costs us, the levels a kit and
// the central store are low at, and where each stands in FSM's catalogue; and
// beneath, what each service is expected to use, which the technician's
// steppers start at.
//
// The owner ruled on 27 September 2026 that the list is ops', that it reaches
// FSM's catalogue as parts, and that a job's use is ours alone: no client's
// invoice carries a consumable, so what one costs is only ever read here. Each
// change shows its old figure beside the new before it is sent (ADR 0071).

import { Table } from "@maneman/ui/Table";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import { api, type Consumable, type Consumables as Book } from "../api.ts";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { ConsumableForm } from "./ConsumableForm.tsx";
import { Retirement } from "./Retirement.tsx";
import { ServiceUsage } from "./ServiceUsage.tsx";
import own from "./consumables.module.css";
import styles from "./settings.module.css";

const copy = settings.consumables;

/** What the panel's form is doing: adding one, or changing, retiring or restoring the one named. */
type Doing = { readonly kind: "add" } | { readonly kind: "change" | "retire" | "restore"; readonly code: string };

/** Which of those the person's access lets them do. */
type MayDo = Readonly<Record<Doing["kind"], boolean>>;

function useMayDo(): MayDo {
  const access = useAccess();
  return {
    add: access.mayCall("POST /api/consumables"),
    change: access.mayCall("POST /api/consumables/{code}"),
    retire: access.mayCall("POST /api/consumables/{code}/retire"),
    restore: access.mayCall("POST /api/consumables/{code}/restore"),
  };
}

function fsmWords(consumable: Consumable): string {
  switch (consumable.fsm.state) {
    case "linked":
      return copy.fsm.linked;
    case "renamed":
      return copy.fsm.renamed(consumable.fsm.name ?? "");
    case "missing":
      return copy.fsm.missing;
    case "unchecked":
      return copy.fsm.unchecked;
  }
}

function stateWords(consumable: Consumable): string {
  if (consumable.retired_from === null) return copy.states.offered;
  const from = longDate(consumable.retired_from);
  return consumable.offered ? copy.states.retiring(from) : copy.states.retired(from);
}

function Row({ consumable, may, onDo }: { consumable: Consumable; may: MayDo; onDo: (doing: Doing) => void }) {
  const { code, name } = consumable;
  const notRetired = consumable.retired_from === null;
  return (
    <tr>
      <th scope="row" className={styles.rowHead}>
        {name} <span className={own.unit}>{consumable.unit}</span>
      </th>
      <td className={styles.figure}>{rupees(consumable.unit_cost)}</td>
      <td>{copy.levels(consumable.reorder_kit, consumable.reorder_central)}</td>
      <td className={consumable.fsm.state === "linked" ? undefined : own.quiet}>{fsmWords(consumable)}</td>
      <td className={own.actions}>
        <span className={consumable.offered ? undefined : own.quiet}>{stateWords(consumable)}</span>
        {may.change && (
          <button
            className={styles.inline}
            type="button"
            aria-label={copy.changeLabel(name)}
            onClick={() => {
              onDo({ kind: "change", code });
            }}
          >
            {copy.change}
          </button>
        )}
        {notRetired && may.retire && (
          <button
            className={styles.inline}
            type="button"
            aria-label={copy.retireLabel(name)}
            onClick={() => {
              onDo({ kind: "retire", code });
            }}
          >
            {copy.retire}
          </button>
        )}
        {!notRetired && may.restore && (
          <button
            className={styles.inline}
            type="button"
            aria-label={copy.restoreLabel(name)}
            onClick={() => {
              onDo({ kind: "restore", code });
            }}
          >
            {copy.restore}
          </button>
        )}
      </td>
    </tr>
  );
}

/** The form beneath the table: the one a row's button asked for, else adding a new one, where access allows it. */
function Form({
  book,
  doing,
  mayAdd,
  onSaved,
  onCancel,
}: {
  book: Book;
  doing: Doing;
  mayAdd: boolean;
  onSaved: (book: Book, said: string) => void;
  onCancel: () => void;
}) {
  const named = doing.kind === "add" ? undefined : book.consumables.find((each) => each.code === doing.code);
  if (named === undefined || doing.kind === "add") {
    if (!mayAdd) return null;
    return (
      <ConsumableForm key="new" consumable={null} maxUnitCost={book.max_unit_cost} onSaved={onSaved} onCancel={null} />
    );
  }
  if (doing.kind === "change") {
    return (
      <ConsumableForm
        key={named.code}
        consumable={named}
        maxUnitCost={book.max_unit_cost}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    );
  }
  return (
    <Retirement
      key={`${doing.kind}-${named.code}`}
      consumable={named}
      today={book.today}
      restoring={doing.kind === "restore"}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

export function Consumables() {
  const [loaded, retry] = useLoad(api.consumables);
  /** The list after a change, so the table follows without reading it again. */
  const [book, setBook] = useState<Book | null>(null);
  const [doing, setDoing] = useState<Doing>({ kind: "add" });
  const [said, setSaid] = useState<string | null>(null);
  const may = useMayDo();

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;
  const current = book ?? loaded.value;

  const saved = (next: Book, words: string) => {
    setBook(next);
    setDoing({ kind: "add" });
    setSaid(words);
  };

  return (
    <>
      <section className={styles.panel} aria-labelledby="consumables">
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id="consumables">
            {copy.title}
          </h2>
        </div>
        <p className={styles.note}>{copy.note}</p>
        <p className={styles.note}>{current.fsm_push ? copy.fsmNote.on : copy.fsmNote.off}</p>
        {current.consumables.length === 0 ? (
          <p className={styles.note}>{copy.none}</p>
        ) : (
          <Table className={styles.table}>
            <thead>
              <tr>
                {copy.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.consumables.map((consumable) => (
                <Row
                  key={consumable.code}
                  consumable={consumable}
                  may={may}
                  onDo={(next) => {
                    setDoing(next);
                    setSaid(null);
                  }}
                />
              ))}
            </tbody>
          </Table>
        )}
        {said !== null && (
          <p className={styles.saved} role="status">
            {said}
          </p>
        )}
        <Form
          book={current}
          doing={doing}
          mayAdd={may.add}
          onSaved={saved}
          onCancel={() => {
            setDoing({ kind: "add" });
          }}
        />
      </section>
      <ServiceUsage book={current} onSaved={setBook} />
    </>
  );
}
