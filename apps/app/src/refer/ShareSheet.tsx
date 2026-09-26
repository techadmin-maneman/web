// Sharing an invite (boards F2 to F4): which card, the consent its own photographs need, and then the preview
// exactly as the friend receives it. F2 and F4 fill the screen, as drawn; F3 is a sheet over the dark ground.
//
// Choosing their own card without having agreed to the cards' lines opens those lines (F3) instead of choosing
// it. Their card is composed first, then the consent recorded, then the card stored: nothing is agreed to for a
// card the phone could not make. Every step that changes what the invite shows waits for the API's answer, and a
// refusal says so and changes nothing: an invite must never carry photographs the client thinks are gone
// (docs/decisions/0048-referrals.md).

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { Sheet } from "@maneman/ui/Sheet";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useRef, useState } from "react";
import { api, putCard, type Refer } from "../api.ts";
import { profile, refer } from "../content.ts";
import { CHECK, COPY_LINK, OTHER_APPS } from "../icons.ts";
import { focusIfLost } from "../lib/arrival.ts";
import { whatsappShare } from "../lib/whatsapp.ts";
import { useSession } from "../session.ts";
import { composeCard, firstFitPhotos, type FirstFitPair } from "./card.ts";
import { CardPreview, type Shown } from "./CardPreview.tsx";
import styles from "./refer.module.css";

type Step = "choice" | "consent" | "composing" | "share";
type Which = "mine" | "house";

const TITLE_ID = "share-title";
const HOUSE: Shown = { kind: "house" };

/** The card the friend will see: one just made, the client's stored one, or the house example. */
function sentCard(state: Refer, made: string | null): Shown {
  if (made !== null) return { kind: "made", url: made };
  if (state.card.state === "personal") {
    return { kind: "made", url: `/api/og/${state.code}.jpg?v=${String(state.card.version)}` };
  }
  return HOUSE;
}

/** Board F2: one of the two cards, drawn, with its box ticked when chosen. */
function Choice(props: { which: Which; chosen: boolean; shown: Shown; onChoose: () => void }) {
  const { which, chosen } = props;
  return (
    <button
      className={chosen ? `${styles.choice} ${styles.chosen}` : styles.choice}
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={props.onChoose}
    >
      <CardPreview shown={props.shown} />
      <span className={styles.choiceText}>
        <span>
          <span className={styles.choiceName}>{refer.card[which].name}</span>
          <span className={styles.choiceNote}>{refer.card[which].note}</span>
        </span>
        <span className={styles.box} aria-hidden="true">
          {chosen && <Icon d={CHECK} size={13} />}
        </span>
      </span>
    </button>
  );
}

/** Board F4: the chat's bubble, as WhatsApp draws the invite's preview above the message. */
function Bubble({ state, card }: { state: Refer; card: Shown }) {
  const { me } = useSession();
  return (
    <div className={styles.bubble}>
      <div className={styles.bubblePreview}>
        <CardPreview shown={card} />
        <div className={styles.bubbleText}>
          <p className={styles.bubbleTitle}>{refer.preview.heading(state.named ? me.first_name : null)}</p>
          <p className={styles.bubbleLine}>{refer.preview.body}</p>
          <p className={styles.bubbleDomain}>{refer.preview.domain}</p>
        </div>
      </div>
      <p className={styles.bubbleMessage}>{refer.preview.message(state.link)}</p>
    </div>
  );
}

export function ShareSheet({ refer: opened, onClose }: { refer: Refer; onClose: (changed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The invite as it stands, read again once the sheet has changed it: the preview must name the client, and show
  // the card, exactly as the invite now will.
  const [state, setState] = useState(opened);
  const agreed = state.card.state === "personal" || state.card.consented;
  const [step, setStep] = useState<Step>("choice");
  const [which, setWhich] = useState<Which>(state.card.state === "personal" ? "mine" : "house");
  const [pair, setPair] = useState<FirstFitPair | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shareFailed, setShareFailed] = useState<(() => Promise<void>) | null>(null);
  const [copied, setCopied] = useState(false);
  const changed = useRef(false);
  // One card per intent: a second Allow would record the consent again and build the whole card again.
  const [busy, once] = useOneAtATime();

  useEffect(() => {
    let current = true;
    void api.photos().then((answer) => {
      if (current && answer.ok) setPair(firstFitPhotos(answer.body));
    });
    return () => {
      current = false;
    };
  }, []);

  // A card made here lives in the page until the sheet closes.
  useEffect(
    () => () => {
      if (made !== null) URL.revokeObjectURL(made);
    },
    [made],
  );

  // Each step's heading takes the focus the last step's button took with it.
  useEffect(() => {
    focusIfLost(dialog.current?.querySelector<HTMLElement>(`#${TITLE_ID}`) ?? null);
  }, [step]);

  const close = () => dialog.current?.close();
  const message = refer.preview.message(state.link);

  function toShare(card: "house" | "theirs", line: string | null) {
    setWhich(card === "house" ? "house" : "mine");
    setProblem(line);
    setStep("share");
  }

  /** The sheet changed the invite: it is read again, and the Refer page will be when the sheet closes. */
  async function changedInvite() {
    changed.current = true;
    const fresh = await api.refer();
    if (fresh.ok) setState(fresh.body);
  }

  /** Their own card: composed, then the consent recorded if it is still to give, then stored. */
  const makeTheirOwn = (consentToo: boolean) =>
    once(async () => {
      setStep("composing");
      setProblem(null);
      const photos = pair ?? (await api.photos().then((answer) => (answer.ok ? firstFitPhotos(answer.body) : null)));
      const card = photos === null ? null : await composeCard(photos);
      if (card === null) {
        toShare("house", refer.cardFailed);
        return;
      }
      if (consentToo) {
        const consent = await api.switchConsent("photos_referral_cards", true);
        if (!consent.ok) {
          setProblem(refer.notChanged);
          setStep("consent");
          return;
        }
        changed.current = true;
      }
      const stored = await putCard(card);
      if (!stored.ok) {
        if (consentToo) await changedInvite();
        toShare("house", refer.cardFailed);
        return;
      }
      setMade(URL.createObjectURL(card));
      await changedInvite();
      toShare("theirs", null);
    });

  /** The example: any card of theirs comes down first, and until it has, nothing is shared. */
  const useTheExample = () =>
    once(async () => {
      if (state.card.state === "personal") {
        const revoked = await api.revokeCard();
        if (!revoked.ok) {
          setProblem(refer.notChanged);
          return;
        }
        await changedInvite();
      }
      toShare("house", null);
    });

  function continueToShare() {
    if (which === "house") void useTheExample();
    else if (state.card.state === "personal") toShare("theirs", null);
    else void makeTheirOwn(false);
  }

  /** A way to share that failed (not one the client backed out of) is board F6's "Share failed". */
  async function sharing(attempt: () => Promise<void>) {
    setShareFailed(null);
    await attempt().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareFailed(() => attempt);
    });
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(state.link);
    setCopied(true);
  };
  const otherApps = async () => {
    if (typeof navigator.share === "function") await navigator.share({ text: message });
    else await copyLink();
  };

  const card = which === "house" ? HOUSE : sentCard(state, made);
  return (
    <Sheet
      ref={dialog}
      className={styles.dialog}
      labelledBy={TITLE_ID}
      busy={busy}
      onClose={() => {
        onClose(changed.current);
      }}
    >
      {step === "choice" && (
        <div className={styles.screen}>
          <div className={styles.screenHead}>
            <button className={styles.back} type="button" aria-label={refer.close} onClick={close}>
              <Icon d={ICONS.back} size={22} />
            </button>
            <h2 className={styles.screenTitle} id={TITLE_ID}>
              {refer.card.title}
            </h2>
          </div>
          <div className={styles.screenBody}>
            <p className={styles.lead}>{refer.card.what}</p>
            <div className={styles.choices} role="radiogroup" aria-labelledby={TITLE_ID}>
              <Choice
                which="mine"
                chosen={which === "mine"}
                shown={made === null ? { kind: "mine", pair } : { kind: "made", url: made }}
                onChoose={() => {
                  // "Without consent, the first option opens F3 instead of selecting."
                  if (agreed) setWhich("mine");
                  else setStep("consent");
                }}
              />
              <Choice
                which="house"
                chosen={which === "house"}
                shown={HOUSE}
                onChoose={() => {
                  setWhich("house");
                }}
              />
            </div>
            {problem !== null && (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            )}
            <button className={styles.primary} type="button" disabled={busy} onClick={continueToShare}>
              {refer.card.next}
            </button>
          </div>
        </div>
      )}
      {(step === "consent" || step === "composing") && (
        <>
          <button className={styles.close} type="button" onClick={close}>
            {refer.close}
          </button>
          <div className={styles.sheet}>
            <h2 className={styles.sheetTitle} id={TITLE_ID}>
              {refer.consent.title}
            </h2>
            <ul className={styles.lines}>
              {profile.referralCards.lines.map((line) => (
                <li key={line} className={styles.line}>
                  <span className={styles.bullet} aria-hidden="true" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {problem !== null && (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            )}
            {step === "composing" && (
              <p className={styles.composing} role="status">
                {refer.composing}
              </p>
            )}
            <div className={styles.stack}>
              <button className={styles.primary} type="button" disabled={busy} onClick={() => void makeTheirOwn(true)}>
                {refer.consent.allow}
              </button>
              <button className={styles.outline} type="button" disabled={busy} onClick={() => void useTheExample()}>
                {refer.consent.instead}
              </button>
            </div>
          </div>
        </>
      )}
      {step === "share" && (
        <div className={`${styles.screen} ${styles.inkScreen}`}>
          <button className={styles.inkClose} type="button" onClick={close}>
            {refer.close}
          </button>
          <div className={styles.screenBody}>
            <h2 className={styles.eyebrow} id={TITLE_ID}>
              {refer.preview.title}
            </h2>
            <Bubble state={state} card={card} />
            {problem !== null && (
              <p className={styles.inkProblem} role="alert">
                {problem}
              </p>
            )}
            {shareFailed !== null && (
              <div className={styles.failed} role="alert">
                <p className={styles.failedLabel}>{refer.preview.failed.label}</p>
                <p>{refer.preview.failed.line}</p>
                <button className={styles.retry} type="button" onClick={() => void sharing(shareFailed)}>
                  {refer.preview.failed.retry}
                </button>
              </div>
            )}
            <section className={styles.via} aria-labelledby="share-via">
              <h3 className={styles.eyebrow} id="share-via">
                {refer.preview.via}
              </h3>
              <div className={styles.ways}>
                <a
                  className={`${styles.way} ${styles.whatsapp}`}
                  href={whatsappShare(message)}
                  rel="noopener"
                  target="_blank"
                >
                  <Icon d={ICONS.whatsapp} size={21} />
                  <span>{refer.preview.whatsapp}</span>
                </a>
                <button className={styles.way} type="button" onClick={() => void sharing(otherApps)}>
                  <Icon d={OTHER_APPS} size={21} />
                  <span>{refer.preview.other}</span>
                </button>
                <button className={styles.way} type="button" onClick={() => void sharing(copyLink)}>
                  <Icon d={COPY_LINK} size={21} />
                  <span>{copied ? refer.preview.copied : refer.preview.copy}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </Sheet>
  );
}
