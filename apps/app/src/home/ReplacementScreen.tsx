// What a replacement involves: the page Home's prompt opens with "See what that involves", in place of a WhatsApp
// message to us (docs/open-points.md, item 46; ADR 0025, item 70; ADR 0086). A replacement is booked and paid for in
// the app like any other visit, so a fitted client books it from here. No board draws the page, and every word on it
// is a placeholder.

import { replacement, messages } from "../content.ts";
import { BookButton } from "../booking/BookButton.tsx";
import { useSession } from "../session.ts";
import { Shell } from "./Shell.tsx";
import styles from "./home.module.css";

export function ReplacementScreen() {
  const { me } = useSession();
  const offered = me.booking.next?.type === "replacement" ? me.booking.next : null;
  const book = me.booking.types.includes("replacement") ? (
    <BookButton
      className={styles.footerBook}
      type="replacement"
      label={replacement.book}
      message={messages.bookReplacement}
      {...(offered === null ? {} : { tier: offered.tier, offer: { date: offered.date, window: offered.window } })}
    />
  ) : undefined;
  return (
    <Shell
      header={{ kind: "back", title: replacement.title, to: "/", label: replacement.back }}
      tab="/"
      {...(book === undefined ? {} : { footer: book })}
    >
      <div className={styles.home}>
        <ol className={styles.steps}>
          {replacement.lines.map((line, index) => (
            <li key={line} className={styles.step}>
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </Shell>
  );
}
