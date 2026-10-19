import { capsLook } from "@maneman/ui/Caps";
import { ButtonLink } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { tryOn, tryOnTeaser } from "../../content/site.ts";
import { Icon } from "@maneman/ui/Icon";
import BeforeAfter from "../BeforeAfter.tsx";
import { Title, type HeadingRef } from "./Title.tsx";
import shared from "./TryOn.module.css";
import styles from "./sent.module.css";

/** The photograph beside the look made from it, on the shared compare. */
function Look(props: { photo: string; look: string }) {
  return (
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
  );
}

/**
 * After the gate: the look is on its way to WhatsApp, and shown here beside the photograph once it is ready, to the
 * page that proved the number (ADR 0214). A visitor back after their look is told it was sent, without the number,
 * which the page does not know.
 */
export function Sent(props: {
  mobile: string;
  returning: boolean;
  heading: HeadingRef;
  photo: string | null;
  look: string | null;
}) {
  const { sent } = tryOn;
  const shown = props.look !== null && props.photo !== null;
  return (
    <div class={shared.notice}>
      {props.look !== null && props.photo !== null ? (
        <Look photo={props.photo} look={props.look} />
      ) : (
        <div class={shared.noticeFrame}>
          <Icon d={ICONS.whatsapp} size="xl" />
          <div class={capsLook()}>{sent.frame}</div>
        </div>
      )}
      <Title heading={props.heading} className={shared.noticeTitle}>
        {props.returning ? sent.returning.title : shown ? sent.ready.title : sent.title}
      </Title>
      {props.returning ? (
        <p class={shared.noticeBody}>{sent.returning.body}</p>
      ) : (
        <p class={shared.noticeBody}>
          {sent.to.before}
          <span class={styles.number}>{`+91 ${props.mobile}`}</span>
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
