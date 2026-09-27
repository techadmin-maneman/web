import { ICONS } from "@maneman/brand/icons";
import { whatsappShare } from "@maneman/web-kit/whatsapp";
import { useEffect, useRef } from "preact/hooks";
import { looks, tryOn } from "../../content/site.ts";
import { downloadFile } from "../../lib/download.ts";
import { fitFrameToPhotos } from "../../lib/frame-aspect.ts";
import BeforeAfter from "../BeforeAfter.tsx";
import { Icon } from "../Drawings.tsx";
import type { Rendered, Showing } from "./machine.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

function shareOnWhatsApp(file: File | null) {
  const text = tryOn.result.share;
  if (file !== null && "canShare" in navigator && navigator.canShare({ files: [file] })) {
    void navigator.share({ files: [file], text }).catch(() => undefined);
    return;
  }
  // Without file sharing, WhatsApp gets the words only; the image is never put in a link.
  window.open(whatsappShare(text), "_blank", "noopener");
}

/** The result: beside the photograph, or alone for a returning visitor, whose photograph is not kept. */
export function Result(props: {
  photo: string | null;
  /** The stand-in photograph for ?state=result. */
  mockBefore: string;
  look: number;
  showing: Showing | null;
  rendered: Rendered | null;
  demo: boolean;
  mobile: string;
  heading: HeadingRef;
}) {
  const { showing, rendered } = props;
  const soloFrame = useRef<HTMLDivElement>(null);

  // The result shown alone takes the photograph's shape, so it is never cropped.
  useEffect(() => fitFrameToPhotos(soloFrame.current), [rendered]);

  // A returning visitor's look may be a preset no longer offered: then it goes unnamed rather than misnamed.
  const chosenLook = props.look >= 0 ? looks[props.look] : undefined;
  const showCopyLine = (props.demo && showing?.returning !== true) || showing?.claim?.whatsapp_copy === true;
  const returning = showing?.returning === true;
  const file = rendered?.file ?? null;
  const afterImage =
    rendered === null ? (
      <div class={styles.pending} data-after-note>
        <Icon path={ICONS.sending} size={20} stroke={1.5} />
        <span class="caps">{tryOn.result.pending}</span>
      </div>
    ) : (
      <img src={rendered.url} alt={tryOn.result.afterAlt} />
    );

  return (
    <div class={styles.result}>
      {returning ? (
        <div class={styles.solo} ref={soloFrame}>
          {afterImage}
          <span class={`label ${styles.soloLabel}`}>{tryOn.result.after}</span>
        </div>
      ) : (
        <BeforeAfter
          start={50}
          size="result"
          beforeLabel={tryOn.result.before}
          afterLabel={tryOn.result.after}
          sliderLabel={tryOn.result.sliderLabel}
          sliderValue={tryOn.result.sliderValue}
          before={<img src={props.photo ?? props.mockBefore} alt={tryOn.result.beforeAlt} />}
          after={afterImage}
        />
      )}
      <div>
        <div class={`caps ${styles.chosen}`}>{chosenLook?.label}</div>
        <Title heading={props.heading} className={styles.resultTitle}>
          {returning ? tryOn.result.returning.title : tryOn.result.title}
        </Title>
        {returning && <p class={styles.returningNote}>{tryOn.result.returning.note}</p>}
        <p class="visually-hidden" role="status">
          {rendered === null ? tryOn.result.pending : tryOn.gate.ready}
        </p>
        <div class={styles.disclaimer}>{tryOn.result.disclaimer}</div>
        <div class={styles.resultActions}>
          <a class="btn btn--lg btn--paper" href="/book">
            {tryOn.result.book}
          </a>
          <div class={styles.pair}>
            <button
              type="button"
              class={`btn btn--line-on-ink ${styles.half}`}
              aria-disabled={rendered === null}
              onClick={() => {
                if (file !== null) downloadFile(file.name, file.type, file);
              }}
            >
              <Icon path={ICONS.download} size={17} />
              {tryOn.result.download}
            </button>
            <button
              type="button"
              class={`btn btn--line-on-ink ${styles.half}`}
              aria-disabled={rendered === null}
              onClick={() => {
                if (rendered !== null) shareOnWhatsApp(file);
              }}
            >
              <Icon path={ICONS.whatsapp} size={17} />
              {tryOn.result.whatsapp}
            </button>
          </div>
        </div>
        {showCopyLine && (
          <div class={styles.copy}>
            {tryOn.result.copy.before}
            <span class={styles.number}>{`+91 ${props.mobile}`}</span>
            {tryOn.result.copy.after}
          </div>
        )}
      </div>
    </div>
  );
}
