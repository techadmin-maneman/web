// Home for a lead (board B2): the consultation, and what to expect. Until
// self-serve booking is on, Reschedule and Add a note open WhatsApp to ops
// with a message ready (docs/prompts/phase2-backend.md, "Booking"). Offline,
// booking and rescheduling wait for the connection (board B3).

import { shortDate } from "@maneman/web-kit/dates";
import type { Me } from "../api.ts";
import { BOOKING_URL, home, whatsapp, WINDOWS } from "../content.ts";
import styles from "./home.module.css";

const whatsappWith = (text: string) => `https://wa.me/${whatsapp.number}?text=${encodeURIComponent(text)}`;

export function HomeScreen({ me, offline }: { me: Me; offline: boolean }) {
  const { consultation } = me;
  if (consultation === null) {
    return (
      <section className={styles.nothing}>
        <h1 className={styles.nothingTitle}>{home.nothing.title}</h1>
        <p>{home.nothing.body}</p>
        {offline ? (
          <button className={styles.book} type="button" disabled>
            {home.nothing.book}
          </button>
        ) : (
          <a className={styles.book} href={BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production}>
            {home.nothing.book}
          </a>
        )}
      </section>
    );
  }

  const date = shortDate(consultation.date);
  const copy = home.consultation;
  return (
    <>
      <section aria-labelledby="consultation">
        <h1 className={styles.label} id="consultation">
          {copy.label}
        </h1>
        <div className={styles.card}>
          <p className={styles.date}>{date}</p>
          <p className={styles.window}>{WINDOWS[consultation.window_label]}</p>
          {consultation.place !== "" && <p className={styles.place}>{consultation.place}</p>}
          <p className={styles.free}>{copy.free}</p>
          <div className={styles.actions}>
            {offline ? (
              <button className={styles.action} type="button" disabled>
                {copy.reschedule}
              </button>
            ) : (
              <a className={styles.action} href={whatsappWith(copy.rescheduleMessage(date))} rel="noopener">
                {copy.reschedule}
              </a>
            )}
            <a className={styles.action} href={whatsappWith(copy.noteMessage(date))} rel="noopener">
              {copy.note}
            </a>
          </div>
        </div>
      </section>
      <section className={styles.expect} aria-labelledby="expect">
        <h2 className={styles.label} id="expect">
          {home.expect.label}
        </h2>
        <ol className={styles.steps}>
          {home.expect.steps.map((step, index) => (
            <li key={step} className={styles.step}>
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
