import { ButtonLink } from "@maneman/ui/Button";
import { BRAND_MARKS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import { Icon } from "@maneman/ui/Icon";
import type { TryOnState } from "./machine.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import shared from "./TryOn.module.css";
import { LegalLinks } from "../LegalLinks.tsx";
import styles from "./sent.module.css";

/** The sent screen's heading: the look shown here, a visitor back after one no longer kept, or the look on its way. */
function titleOf({ returning, shown }: { returning: boolean; shown: boolean }): string {
  const { sent } = tryOn;
  if (shown) return sent.ready.title;
  return returning ? sent.returning.title : sent.title;
}

/**
 * After the gate: the look is on its way to WhatsApp, and shown here beside the photograph once it is ready, to the
 * page that proved the number (ADR 0214). A visitor back after their look is shown it alone while it is kept, and
 * told it was sent, without the number, which the page does not know.
 */
export function Sent(props: {
  state: Pick<TryOnState, "mobile" | "returning">;
  look: string | null;
  heading: HeadingRef;
}) {
  const { sent } = tryOn;
  const { mobile, returning } = props.state;
  const { look } = props;
  return (
    <div>
      {/* On its way: where it went, as a tile; once shown, the look is the step's picture (Picture.tsx). */}
      {look === null && (
        <>
          <span class={styles.tile}>
            <Icon d={BRAND_MARKS.whatsapp} size="md" />
          </span>
          <p class={shared.stepLabel}>{tryOn.sent.frame}</p>
        </>
      )}
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
      <div class={shared.foot}>
        <ButtonLink variant="primary" size="action" href="/book">
          {sent.book}
        </ButtonLink>
        <ButtonLink variant="outline" size="action" href="/">
          {sent.home}
        </ButtonLink>
      </div>
      <LegalLinks alone={shared.legal} />
    </div>
  );
}
