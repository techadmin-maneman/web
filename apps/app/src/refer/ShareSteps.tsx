// The share sheet's three steps (boards F2 to F4), drawn from its flow (./share-flow.ts): which card, the lines its own
// photographs need agreeing to, and the invite's preview with the ways to send it.

import { classes } from "@maneman/ui/classes";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { whatsappShare } from "@maneman/web-kit/whatsapp";
import type { Refer } from "../api.ts";
import { profile, refer } from "../content.ts";
import { CHECK, COPY_LINK, OTHER_APPS } from "../icons.ts";
import { useSession } from "../session.ts";
import { CardPreview, type Shown } from "./CardPreview.tsx";
import { rewardOf } from "./reward.ts";
import { HOUSE, type ShareFlow, type Which } from "./share-flow.ts";
import { withCard } from "./share.ts";
import styles from "./refer.module.css";

export const TITLE_ID = "share-title";

interface StepProps {
  readonly flow: ShareFlow;
  readonly onClose: () => void;
}

function Problem({ line, className }: { line: string | null; className: string | undefined }) {
  if (line === null) return null;
  return (
    <p className={className} role="alert">
      {line}
    </p>
  );
}

/** Board F2: one of the two cards, drawn, with its box ticked when chosen. */
function Choice(props: { which: Which; chosen: boolean; shown: Shown; onChoose: () => void }) {
  const { which, chosen } = props;
  return (
    <label className={chosen ? `${styles.choice} ${styles.chosen}` : styles.choice}>
      <input className={styles.radio} type="radio" name="refer-card" checked={chosen} onChange={props.onChoose} />
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
    </label>
  );
}

/** Board F2: which card the friend sees. */
export function ChoiceStep({ flow, onClose }: StepProps) {
  const { which, made, pair } = flow;
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <button className={styles.back} type="button" aria-label={refer.close} onClick={onClose}>
          <Icon d={ICONS.back} size={22} />
        </button>
        <h2 className={styles.screenTitle} id={TITLE_ID}>
          {refer.card.title}
        </h2>
      </div>
      <div className={styles.screenBody}>
        <p className={styles.lead}>{refer.card.what}</p>
        {!flow.offerTheirOwn && <p className={styles.lead}>{refer.card.mineNotYet}</p>}
        <div className={styles.choices} role="radiogroup" aria-labelledby={TITLE_ID}>
          {flow.offerTheirOwn && (
            <Choice
              which="mine"
              chosen={which === "mine"}
              shown={made === null ? { kind: "mine", pair } : { kind: "made", url: made.url }}
              onChoose={() => {
                // "Without consent, the first option opens F3 instead of selecting."
                if (flow.agreed) flow.choose("mine");
                else flow.askConsent();
              }}
            />
          )}
          <Choice
            which="house"
            chosen={which === "house"}
            shown={HOUSE}
            onChoose={() => {
              flow.choose("house");
            }}
          />
        </div>
        <Problem line={flow.problem} className={styles.problem} />
        <Button
          variant="primary"
          size="action"
          className={styles.primary}
          disabled={flow.busy}
          onClick={flow.continueToShare}
        >
          {refer.card.next}
        </Button>
      </div>
    </div>
  );
}

/** Board F3: the lines their own photographs on a card need agreeing to, and the card being composed once they do. */
export function ConsentStep({ flow, onClose }: StepProps) {
  return (
    <>
      <button className={styles.close} type="button" onClick={onClose}>
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
        <Problem line={flow.problem} className={styles.problem} />
        {flow.step === "composing" && (
          <p className={styles.composing} role="status">
            {refer.composing}
          </p>
        )}
        <div className={styles.stack}>
          <Button
            variant="primary"
            size="action"
            className={styles.primary}
            disabled={flow.busy}
            onClick={() => void flow.makeTheirOwn(true)}
          >
            {refer.consent.allow}
          </Button>
          <Button
            variant="outline"
            size="action"
            className={styles.outline}
            disabled={flow.busy}
            onClick={() => void flow.takeTheExample()}
          >
            {refer.consent.instead}
          </Button>
        </div>
      </div>
    </>
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
          <p className={styles.bubbleLine}>{refer.preview.body(rewardOf(me))}</p>
          <p className={styles.bubbleDomain}>{refer.preview.domain}</p>
        </div>
      </div>
      <p className={styles.bubbleMessage}>{refer.preview.message(state.link)}</p>
    </div>
  );
}

/** Board F4: the invite as the friend will see it, and the ways to send it; board F6 where one failed. */
export function ShareStep({ flow, onClose }: StepProps) {
  const { shareFailed, file, message } = flow;
  return (
    <div className={classes(styles.screen, styles.inkScreen)}>
      <button className={styles.inkClose} type="button" onClick={onClose}>
        {refer.close}
      </button>
      <div className={styles.screenBody}>
        <h2 className={styles.eyebrow} id={TITLE_ID}>
          {refer.preview.title}
        </h2>
        <Bubble state={flow.state} card={flow.card} />
        <Problem line={flow.problem} className={styles.inkProblem} />
        {shareFailed !== null && (
          <div className={styles.failed} role="alert">
            <p className={styles.failedLabel}>{refer.preview.failed.label}</p>
            <p>{refer.preview.failed.line}</p>
            <button className={styles.retry} type="button" onClick={() => void flow.sharing(shareFailed)}>
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
              className={classes(styles.way, styles.whatsapp)}
              href={whatsappShare(message)}
              rel="noopener"
              target="_blank"
              onClick={(event) => {
                // The card itself, captioned with the words, where the phone can send it; else the link.
                const shared = withCard(navigator, file, message);
                if (shared === null) return;
                event.preventDefault();
                void flow.sharing(() => navigator.share(shared));
              }}
            >
              <Icon d={ICONS.whatsapp} size={21} />
              <span>{refer.preview.whatsapp}</span>
            </a>
            <button className={styles.way} type="button" onClick={() => void flow.sharing(flow.otherApps)}>
              <Icon d={OTHER_APPS} size={21} />
              <span>{refer.preview.other}</span>
            </button>
            <button className={styles.way} type="button" onClick={() => void flow.sharing(flow.copyLink)}>
              <Icon d={COPY_LINK} size={21} />
              <span>{flow.copied ? refer.preview.copied : refer.preview.copy}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
