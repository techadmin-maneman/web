// A1: the mobile number (design/phase2/Client App, board A1).

import { Mark } from "../components/Mark.tsx";
import { login } from "../content.ts";
import styles from "./MobileScreen.module.css";

export function MobileScreen() {
  const copy = login.mobile;
  return (
    <main className={styles.screen}>
      <Mark className={styles.mark} />
      <h1 className={styles.title}>{copy.title}</h1>
      <form className={styles.form} noValidate>
        <div className={styles.field}>
          <span className={styles.prefix} aria-hidden="true">
            {copy.prefix}
          </span>
          <input
            className={styles.input}
            name="mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            aria-label={copy.label}
          />
        </div>
        <div className={styles.foot}>
          <button className={styles.primary} type="submit">
            {copy.send}
          </button>
          <p className={styles.hint}>{copy.hint}</p>
        </div>
      </form>
    </main>
  );
}
