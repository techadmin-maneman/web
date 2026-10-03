// The /stop page, which the link at the foot of a reminder or the launch alert opens. The link's token is in the
// address's fragment, so no server or log sees it until the tap sends it.

import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { stopMessages as words, whatsapp } from "../content/site.ts";
import { stopMessages, type StoppedMessages } from "../lib/api.ts";
import styles from "./StopMessages.module.css";

type Screen =
  | { readonly kind: "ask"; readonly busy: boolean; readonly offline: boolean }
  | { readonly kind: "done"; readonly purpose: StoppedMessages["purpose"] }
  | { readonly kind: "expired" };

const WHATSAPP_HOLE = "{whatsapp}";

/** A sentence with the business number, where it names it, as a link to a WhatsApp chat. */
function WithChatLink(props: { text: string }) {
  const parts = props.text.split(WHATSAPP_HOLE);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <a href={whatsappChat(whatsapp.number)}>{whatsapp.display}</a>}
          {part}
        </Fragment>
      ))}
    </>
  );
}

function tokenInAddress(): string {
  return window.location.hash.slice(1);
}

export default function StopMessages() {
  const [screen, setScreen] = useState<Screen>({ kind: "ask", busy: false, offline: false });
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (tokenInAddress() === "") setScreen({ kind: "expired" });
  }, []);

  // A new screen's heading takes the focus, so a screen reader hears what changed.
  useEffect(() => {
    if (screen.kind !== "ask") heading.current?.focus();
  }, [screen.kind]);

  async function stop(): Promise<void> {
    if (screen.kind !== "ask" || screen.busy) return;
    setScreen({ kind: "ask", busy: true, offline: false });
    const answer = await stopMessages(tokenInAddress());
    if (answer.ok) {
      window.history.replaceState(null, "", window.location.pathname);
      setScreen({ kind: "done", purpose: answer.body.purpose });
      return;
    }
    if (answer.code === "network") {
      setScreen({ kind: "ask", busy: false, offline: true });
      return;
    }
    setScreen({ kind: "expired" });
  }

  if (screen.kind === "done") {
    return (
      <section class={styles.page}>
        <h1 ref={heading} tabIndex={-1} class="section-title">
          {words.done.title}
        </h1>
        <p class={`lead ${styles.body}`}>{words.done[screen.purpose]}</p>
        <p class={styles.note}>
          <WithChatLink text={words.done.again} />
        </p>
      </section>
    );
  }

  if (screen.kind === "expired") {
    return (
      <section class={styles.page}>
        <h1 ref={heading} tabIndex={-1} class="section-title">
          {words.expired.title}
        </h1>
        <p class={`lead ${styles.body}`}>
          <WithChatLink text={words.expired.body} />
        </p>
      </section>
    );
  }

  return (
    <section class={styles.page}>
      <h1 class="section-title">{words.ask.title}</h1>
      <p class={`lead ${styles.body}`}>{words.ask.body}</p>
      <button
        type="button"
        class="btn btn--lg btn--ink"
        aria-disabled={screen.busy}
        onClick={() => {
          void stop();
        }}
      >
        {words.ask.button}
      </button>
      <div aria-live="polite">{screen.offline && <p class={styles.failure}>{words.offline}</p>}</div>
    </section>
  );
}
