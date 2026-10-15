// What a service's block holds once one of its actions is chosen (./Services.tsx): the form or check open in it, what
// the last one did, and each action's button, named by its words and its label.

import { InlineMessage } from "@maneman/ui/InlineMessage";
import { RowButton } from "@maneman/ui/Button";
import { classes } from "@maneman/ui/classes";
import { type ReactNode } from "react";
import { type ServiceCatalogue } from "../api.ts";
import {
  AddForm,
  DescribeForm,
  LengthForm,
  OrderCheck,
  RenameForm,
  RestoreCheck,
  RetireForm,
  type Written,
} from "./ServiceForms.tsx";
import { PriceForm, TakeBack } from "./PriceForms.tsx";
import { actionWhere, type Action } from "./service-actions.ts";
import form from "../components/forms.module.css";
import styles from "./service-actions.module.css";

export interface Opened {
  readonly action: Action | null;
  readonly outcome: { readonly where: string; readonly said: string } | null;
  readonly services: ServiceCatalogue;
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
export function OpenAction({ opened, where }: { opened: Opened; where: string }) {
  const { action, services } = opened;
  if (action === null || actionWhere(action) !== where) return null;
  const bounds = { min: services.min_minutes, max: services.max_minutes };
  const done = opened.onDone;
  const cancel = opened.onCancel;
  // What every form is handed: how it ends, saved or not.
  const ends = { onDone: done, onCancel: cancel };
  switch (action.kind) {
    case "price":
    case "correct":
      return (
        <PriceForm
          target={action.target}
          {...(action.kind === "correct" ? { correcting: action.row } : {})}
          today={services.today}
          maxAmount={services.max_amount_ex_gst}
          maxGst={services.max_gst_percent}
          {...ends}
        />
      );
    case "takeBack":
      return <TakeBack target={action.target} row={action.row} onDone={done} onKeep={cancel} />;
    case "rename":
      return <RenameForm service={action.service} {...ends} />;
    case "describe":
      return <DescribeForm service={action.service} maxLength={services.max_description} {...ends} />;
    case "length":
      return <LengthForm service={action.service} bounds={bounds} {...ends} />;
    case "retire":
      return <RetireForm service={action.service} today={services.today} {...ends} />;
    case "restore":
      return <RestoreCheck service={action.service} onDone={done} onKeep={cancel} />;
    case "order": {
      const was = services.services.filter((service) => service.kind === action.of);
      const now = action.tiers.flatMap((tier) => was.filter((service) => service.tier === tier));
      return <OrderCheck kind={action.of} was={was} now={now} onDone={done} onKeep={cancel} />;
    }
    case "add": {
      const minutes = services.kinds.find((each) => each.kind === action.of)?.minutes ?? bounds.min;
      return <AddForm kind={action.of} minutes={minutes} bounds={bounds} {...ends} />;
    }
  }
}

/** What the last action came to, in the block it was taken in. */
export function Outcome({ opened, where }: { opened: Opened; where: string }) {
  if (opened.outcome?.where !== where) return null;
  return (
    <InlineMessage tone="saved" className={form.saved}>
      {opened.outcome.said}
    </InlineMessage>
  );
}

/** One of a block's buttons, offered only where the person's access reaches what it does. */
export function ActionButton(props: {
  readonly opened: Opened;
  readonly kind: Action["kind"];
  /** Its whole name, which says which service or fee it acts on. */
  readonly label?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  if (!props.opened.may(props.kind)) return null;
  return (
    <RowButton
      className={classes(form.inline, styles.action)}
      aria-label={props.label}
      disabled={props.opened.action !== null}
      onClick={props.onClick}
    >
      {props.children}
    </RowButton>
  );
}
