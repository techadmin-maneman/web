// The service, for a client with more than one open to them (ADR 0085).

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import type { OfferedService } from "../../api.ts";
import { booking, VISIT_TYPES } from "../../content.ts";
import { priceFigures } from "../../lib/money.ts";
import styles from "../booking.module.css";
import { Heading } from "./shared.tsx";

/** A first fit's hair system as the consultation recommended it: its tier, and the technician's first name. */
export interface Recommended {
  readonly tier: string;
  readonly by: string | null;
}

/**
 * No board draws it: every service open to the client, when there is more than one, a kind at a time in the order
 * ops keep them, each with the line ops wrote for it, how long it takes and what it costs from the first day it can
 * be booked (ADR 0085). The services are native radio buttons of one name, drawn as the window step's rows: one
 * choice among them all, one tab stop, and the arrow keys move between them. `before`: the steps the sheet will take
 * before the date.
 */
export function ServiceStep(props: {
  before: number;
  services: readonly OfferedService[];
  chosen: OfferedService | null;
  /** The hair system the consultation recommended, and who recommended it; marked beside its name. */
  recommended?: Recommended;
  onChoose: (service: OfferedService) => void;
  onNext: () => void;
}) {
  const copy = booking.service;
  const kinds = [...new Set(props.services.map((service) => service.type))];
  const title = kinds.length === 1 && kinds[0] === "first_fit" ? copy.titleFirstFit : copy.title;
  return (
    <>
      <Heading title={title} step={booking.step(1, 3 + props.before)} />
      {kinds.map((kind) => (
        <div key={kind} className={styles.kind}>
          <h3 className={capsLook(styles.label)} id={`booking-kind-${kind}`}>
            {VISIT_TYPES[kind]}
          </h3>
          <div className={styles.windows} role="radiogroup" aria-labelledby={`booking-kind-${kind}`}>
            {props.services
              .filter((service) => service.type === kind)
              .map((service) => {
                const { amount, split } = priceFigures(service.price);
                return (
                  <label key={service.tier} className={styles.window}>
                    <input
                      className={styles.radio}
                      type="radio"
                      name="booking-service"
                      checked={service.type === props.chosen?.type && service.tier === props.chosen.tier}
                      onChange={() => {
                        props.onChoose(service);
                      }}
                    />
                    <span>
                      <span className={styles.windowName}>{service.name}</span>
                      {service.type === "first_fit" && service.tier === props.recommended?.tier && (
                        <span className={capsLook(styles.recommended)}>
                          {booking.recommended(props.recommended.by)}
                        </span>
                      )}
                      {service.description !== null && (
                        <span className={styles.serviceLine}>{service.description}</span>
                      )}
                      <span className={styles.windowTime}>{booking.length(service.minutes)}</span>
                    </span>
                    <span className={styles.serviceMoney}>
                      <span className={styles.windowName}>{service.price.amount === 0 ? copy.free : amount}</span>
                      {split !== null && <span className={styles.windowTime}>{split}</span>}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
      ))}
      <Button
        variant="primary"
        size="action"
        className={styles.primary}
        disabled={props.chosen === null}
        onClick={props.onNext}
      >
        {copy.continue}
      </Button>
    </>
  );
}
