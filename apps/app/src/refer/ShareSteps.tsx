// The share sheet's three steps, drawn from its flow (./share-flow.ts): which card, the lines its own
// photographs need agreeing to, and the invite's preview with the ways to send it.

import { ChoiceCard, TickBox } from "@maneman/ui/ChoiceCard";
import { capsLook } from "@maneman/ui/Caps";
import { SheetClose, SheetPanel } from "@maneman/ui/Sheet";
import { IconButton } from "@maneman/ui/IconButton";
import { classes } from "@maneman/ui/classes";
import { GLYPHS, ICONS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { whatsappShare } from "@maneman/web-kit/whatsapp";
import type { Refer } from "../api.ts";
import { profile, refer } from "../content.ts";
import { useSession } from "../session.ts";
import { CardPreview, type Shown } from "./CardPreview.tsx";
import { rewardOf } from "./reward.ts";
import { HOUSE, type ShareFlow, type Which } from "./share-flow.ts";
import { withCard } from "./share.ts";
import referSheet from "./refer.module.css";
import styles from "./share-steps.module.css";

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

/** The card choice: one of the two cards, drawn, with its box ticked when chosen. */
function Choice(props: { which: Which; chosen: boolean; shown: Shown; onChoose: () => void }) {
  const { which, chosen } = props;
  return (
    <ChoiceCard look="ticked" name="refer-card" checked={chosen} onChange={props.onChoose}>
      <CardPreview shown={props.shown} />
      <span className={referSheet.choiceText}>
        <span>
          <span className={referSheet.choiceName}>{refer.card[which].name}</span>
          <span className={referSheet.choiceNote}>{refer.card[which].note}</span>
        </span>
        <TickBox checked={chosen} />
      </span>
    </ChoiceCard>
  );
}

/** The card choice: which card the friend sees. */
export function ChoiceStep({ flow, onClose }: StepProps) {
  const { which, made, pair } = flow;
  return (
    <div className={referSheet.screen}>
      <div className={referSheet.screenHead}>
        <IconButton className={referSheet.back} d={ICONS.back} size="md" label={refer.close} onClick={onClose} />
        <h2 className={referSheet.screenTitle} id={TITLE_ID}>
          {refer.card.title}
        </h2>
      </div>
      <div className={referSheet.screenBody}>
        <p className={referSheet.lead}>{refer.card.what}</p>
        {!flow.offerTheirOwn && <p className={referSheet.lead}>{refer.card.mineNotYet}</p>}
        <div className={referSheet.choices} role="radiogroup" aria-labelledby={TITLE_ID}>
          {flow.offerTheirOwn && (
            <Choice
              which="mine"
              chosen={which === "mine"}
              shown={made === null ? { kind: "mine", pair } : { kind: "made", url: made.url }}
              onChoose={() => {
                // "Without consent, the first option opens the consent instead of selecting."
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
        <Problem line={flow.problem} className={referSheet.problem} />
        <Button
          variant="primary"
          size="action"
          className={referSheet.primary}
          disabled={flow.busy}
          onClick={flow.continueToShare}
        >
          {refer.card.next}
        </Button>
      </div>
    </div>
  );
}

/** The consent sheet: the lines their own photographs on a card need agreeing to, and the card being composed once they do. */
export function ConsentStep({ flow, onClose }: StepProps) {
  return (
    <>
      <SheetClose onClose={onClose}>{refer.close}</SheetClose>
      <SheetPanel className={referSheet.sheet}>
        <h2 className={referSheet.sheetTitle} id={TITLE_ID}>
          {refer.consent.title}
        </h2>
        <ul className={referSheet.lines}>
          {profile.referralCards.lines.map((line) => (
            <li key={line} className={referSheet.line}>
              <span className={referSheet.bullet} aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <Problem line={flow.problem} className={referSheet.problem} />
        {flow.step === "composing" && (
          <p className={referSheet.composing} role="status">
            {refer.composing}
          </p>
        )}
        <div className={referSheet.stack}>
          <Button
            variant="primary"
            size="action"
            className={referSheet.primary}
            disabled={flow.busy}
            onClick={() => void flow.makeTheirOwn(true)}
          >
            {refer.consent.allow}
          </Button>
          <Button
            variant="outline"
            size="action"
            className={referSheet.outline}
            disabled={flow.busy}
            onClick={() => void flow.takeTheExample()}
          >
            {refer.consent.instead}
          </Button>
        </div>
      </SheetPanel>
    </>
  );
}

/** The preview: the chat's bubble, as WhatsApp draws the invite's preview above the message. */
function Bubble({ state, card }: { state: Refer; card: Shown }) {
  const { me } = useSession();
  return (
    <div className={referSheet.bubble}>
      <div className={styles.bubblePreview}>
        <CardPreview shown={card} />
        <div className={referSheet.bubbleText}>
          <p className={styles.bubbleTitle}>{refer.preview.heading(state.named ? me.first_name : null)}</p>
          <p className={referSheet.bubbleLine}>{refer.preview.body(rewardOf(me))}</p>
          <p className={referSheet.bubbleDomain}>{refer.preview.domain}</p>
        </div>
      </div>
      <p className={referSheet.bubbleMessage}>{refer.preview.message(state.link)}</p>
    </div>
  );
}

/** The preview: the invite as the friend will see it, and the ways to send it; the empty tracker where one failed. */
export function ShareStep({ flow, onClose }: StepProps) {
  const { shareFailed, file, message } = flow;
  return (
    <div className={classes(referSheet.screen, referSheet.inkScreen)}>
      <SheetClose quiet onClose={onClose}>
        {refer.close}
      </SheetClose>
      <div className={referSheet.screenBody}>
        <h2 className={capsLook(referSheet.eyebrow)} id={TITLE_ID}>
          {refer.preview.title}
        </h2>
        <Bubble state={flow.state} card={flow.card} />
        <Problem line={flow.problem} className={styles.inkProblem} />
        {shareFailed !== null && (
          <div className={referSheet.failed} role="alert">
            <p className={capsLook(referSheet.failedLabel)}>{refer.preview.failed.label}</p>
            <p>{refer.preview.failed.line}</p>
            <Button
              variant="outline"
              size="small"
              className={referSheet.retry}
              onClick={() => void flow.sharing(shareFailed)}
            >
              {refer.preview.failed.retry}
            </Button>
          </div>
        )}
        <section className={referSheet.via} aria-labelledby="share-via">
          <h3 className={capsLook(referSheet.eyebrow)} id="share-via">
            {refer.preview.via}
          </h3>
          <div className={styles.ways}>
            <ButtonLink
              variant="gold"
              size="action"
              className={styles.way}
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
              <Icon d={ICONS.whatsapp} size="md" />
              <span>{refer.preview.whatsapp}</span>
            </ButtonLink>
            <Button
              variant="outlineOnInk"
              size="action"
              className={styles.way}
              onClick={() => void flow.sharing(flow.otherApps)}
            >
              <Icon d={GLYPHS.otherApps} size="md" />
              <span>{refer.preview.other}</span>
            </Button>
            <Button
              variant="outlineOnInk"
              size="action"
              className={styles.way}
              onClick={() => void flow.sharing(flow.copyLink)}
            >
              <Icon d={GLYPHS.copyLink} size="md" />
              <span>{flow.copied ? refer.preview.copied : refer.preview.copy}</span>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
