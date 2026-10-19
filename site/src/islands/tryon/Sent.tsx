import { capsLook } from "@maneman/ui/Caps";
import { ButtonLink } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { tryOn, tryOnTeaser } from "../../content/site.ts";
import { Icon } from "@maneman/ui/Icon";
import BeforeAfter from "../BeforeAfter.tsx";
import type { TryOnState } from "./machine.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import shared from "./TryOn.module.css";
import styles from "./sent.module.css";

/** The photograph beside the look made from it, on the shared compare. */
function Look(props: { photo: string; look: string }) {
  return (
    <div class={styles.lookFrame}>
      <BeforeAfter
        className={styles.look}
        start={tryOnTeaser.start_percent}
        beforeLabel={tryOnTeaser.before}
        afterLabel={tryOnTeaser.after}
        sliderLabel={tryOnTeaser.sliderLabel}
        sliderValue={tryOnTeaser.sliderValue}
        before={<img src={props.photo} alt={tryOn.sent.ready.photoAlt} />}
        after={<img src={props.look} alt={tryOn.sent.ready.lookAlt} />}
      />
    </div>
  );
}

/** The sent screen's heading: the look shown here, a visitor back after one no longer kept, or the look on its way. */
function titleOf({ returning, shown }: { returning: boolean; shown: boolean }): string {
  const { sent } = tryOn;
  if (shown) return sent.ready.title;
  return returning ? sent.returning.title : sent.title;
}

/** What the screen shows above its words: the look beside the photograph, the look alone, or where it went. */
function Shown(props: { photo: string | null; look: string | null }) {
  const { sent } = tryOn;
  if (props.look !== null && props.photo !== null) return <Look photo={props.photo} look={props.look} />;
  if (props.look !== null) return <img class={styles.lookOnly} src={props.look} alt={sent.ready.lookAlt} />;
  return (
    <div class={shared.noticeFrame}>
      <Icon d={ICONS.whatsapp} size="xl" />
      <div class={capsLook()}>{sent.frame}</div>
    </div>
  );
}

/**
 * After the gate: the look is on its way to WhatsApp, and shown here beside the photograph once it is ready, to the
 * page that proved the number (ADR 0214). A visitor back after their look is shown it alone while it is kept, and
 * told it was sent, without the number, which the page does not know.
 */
export function Sent(props: {
  state: Pick<TryOnState, "mobile" | "returning" | "photo">;
  look: string | null;
  heading: HeadingRef;
}) {
  const { sent } = tryOn;
  const { mobile, returning, photo } = props.state;
  const { look } = props;
  return (
    <div class={shared.notice}>
      <Shown photo={photo} look={look} />
      <Title heading={props.heading} className={shared.noticeTitle}>
        {titleOf({ returning, shown: look !== null })}
      </Title>
      {returning ? (
        <p class={shared.noticeBody}>{sent.returning.body}</p>
      ) : (
        <p class={shared.noticeBody}>
          {sent.to.before}
          <span class={styles.number}>{`+91 ${mobile}`}</span>
          {`${sent.to.after} ${sent.privacy}`}
        </p>
      )}
      <div class={shared.disclaimer}>{sent.disclaimer}</div>
      <div class={shared.noticeActions}>
        <ButtonLink variant="light" size="action" href="/book">
          {sent.book}
        </ButtonLink>
        <ButtonLink variant="outlineOnInk" size="action" href="/">
          {sent.home}
        </ButtonLink>
      </div>
    </div>
  );
}
