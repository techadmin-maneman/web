// Sharing an invite (boards F2 to F4): which card, the consent its own photographs need, and then the preview
// exactly as the friend receives it. The card is composed on the phone (card.ts) and sent only when the client
// chooses their own; choosing the example takes any card of theirs down (docs/decisions/0048-referrals.md).

import { useEffect, useRef, useState } from "react";
import { api, putCard, type Refer } from "../api.ts";
import { booking, profile, refer } from "../content.ts";
import { useSession } from "../session.ts";
import { composeCard, firstFitPhotos } from "./card.ts";
import styles from "./refer.module.css";

type Step = "choice" | "consent" | "composing" | "share";
type Which = "mine" | "house";

/** The chat's preview, as WhatsApp draws it from the invite's tags (board F4). */
function Preview({ name, link }: { name: string; link: string }) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewCard} aria-hidden="true" />
      <div className={styles.previewText}>
        <p className={styles.previewDomain}>{refer.preview.domain}</p>
        <p className={styles.previewTitle}>{refer.preview.heading(name)}</p>
        <p className={styles.previewBody}>{refer.preview.body}</p>
      </div>
      <p className={styles.previewMessage}>{refer.preview.message(link)}</p>
    </div>
  );
}

export function ShareSheet({ refer: state, onClose }: { refer: Refer; onClose: (changed: boolean) => void }) {
  const { me } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("choice");
  const [which, setWhich] = useState<Which>(state.card.state === "personal" ? "mine" : "house");
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const changed = useRef(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const close = () => dialog.current?.close();
  const message = refer.preview.message(state.link);

  /** Their own card: composed here, then stored; the API refuses it without the consent. */
  async function useTheirOwn() {
    setStep("composing");
    setProblem(null);
    const photos = await api.photos();
    const pair = photos.ok ? firstFitPhotos(photos.body) : null;
    const card = pair === null ? null : await composeCard(pair).catch(() => null);
    const stored = card === null ? null : await putCard(card);
    if (stored?.ok !== true) {
      setWhich("house");
      setProblem(refer.cardFailed);
    } else {
      changed.current = true;
    }
    setStep("share");
  }

  async function useTheExample() {
    if (state.card.state === "personal") {
      await api.revokeCard();
      changed.current = true;
    }
    setStep("share");
  }

  async function copyLink() {
    await navigator.clipboard.writeText(state.link);
    setCopied(true);
  }

  async function shareElsewhere() {
    if (typeof navigator.share !== "function") {
      await copyLink();
      return;
    }
    await navigator.share({ text: message }).catch(() => undefined);
  }

  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby="share-title"
      onClose={() => {
        onClose(changed.current);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <button className={styles.close} type="button" onClick={close}>
        {booking.close}
      </button>
      {step === "choice" && (
        <>
          <h2 className={styles.sheetTitle} id="share-title">
            {refer.card.title}
          </h2>
          <p className={styles.sheetLine}>{refer.card.what}</p>
          <div className={styles.choices} role="radiogroup" aria-label={refer.card.title}>
            {(["mine", "house"] as const).map((option) => (
              <button
                key={option}
                className={option === which ? `${styles.choice} ${styles.chosen}` : styles.choice}
                type="button"
                role="radio"
                aria-checked={option === which}
                onClick={() => {
                  setWhich(option);
                }}
              >
                <span className={styles.choiceName}>{refer.card[option].name}</span>
                <span className={styles.choiceNote}>{refer.card[option].note}</span>
              </button>
            ))}
          </div>
          <button
            className={styles.primary}
            type="button"
            onClick={() => {
              // Their own photographs need the consent first; the example needs nothing.
              if (which === "house") void useTheExample();
              else if (state.card.state === "personal") setStep("share");
              else setStep("consent");
            }}
          >
            {refer.card.next}
          </button>
        </>
      )}
      {step === "consent" && (
        <>
          <h2 className={styles.sheetTitle} id="share-title">
            {refer.consent.title}
          </h2>
          <ul className={styles.lines}>
            {profile.referralCards.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button
            className={styles.primary}
            type="button"
            onClick={() => {
              void api.switchConsent("photos_referral_cards", true).then(() => useTheirOwn());
            }}
          >
            {refer.consent.allow}
          </button>
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              setWhich("house");
              void useTheExample();
            }}
          >
            {refer.consent.instead}
          </button>
        </>
      )}
      {step === "composing" && (
        <p className={styles.sheetLine} role="status">
          {refer.composing}
        </p>
      )}
      {step === "share" && (
        <>
          <h2 className={styles.sheetTitle} id="share-title">
            {refer.preview.title}
          </h2>
          <Preview name={me.first_name} link={state.link} />
          {problem !== null && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <a
            className={styles.primary}
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            rel="noopener"
            target="_blank"
          >
            {refer.preview.whatsapp}
          </a>
          <button className={styles.secondary} type="button" onClick={() => void shareElsewhere()}>
            {refer.preview.other}
          </button>
          <button className={styles.secondary} type="button" onClick={() => void copyLink()}>
            {copied ? refer.preview.copied : refer.preview.copy}
          </button>
        </>
      )}
    </dialog>
  );
}
