// The try-on, v2's eight screens. F1 is the shell: every screen, control and
// transition from the design, with no API calls yet (F3 adds them). The
// photograph never leaves the browser here; it is shown from memory only.
//
// Outside production, ?state=<screen> opens a screen directly, for the
// fidelity screenshots and the browser tests.

import { useEffect, useRef, useState } from "preact/hooks";
import { looks, stageOptions, tryOn } from "../content/site.ts";
import { ICONS } from "../lib/icons.ts";
import { formatMobile, isCompleteMobile } from "../lib/phone.ts";
import BeforeAfter from "./BeforeAfter.tsx";
import { Icon, StageDrawing } from "./Drawings.tsx";
import styles from "./TryOn.module.css";

const SCREENS = ["upload", "consent", "stage", "looks", "processing", "gate", "result", "error"] as const;
type Screen = (typeof SCREENS)[number];

interface Props {
  /** Stand-in images for the result screen until F3 renders real ones. */
  mockBefore: string;
  mockAfter: string;
  /** Allow ?state= to open a screen directly (never in production). */
  allowStateSwitch: boolean;
}

/** v2's back control: upload → home, error → upload, result → gate, gate → looks, else the previous screen. */
function backFrom(screen: Screen): Screen | "home" {
  switch (screen) {
    case "upload":
      return "home";
    case "consent":
      return "upload";
    case "stage":
      return "consent";
    case "looks":
      return "stage";
    case "processing":
      return "looks";
    case "gate":
      return "looks";
    case "result":
      return "gate";
    case "error":
      return "upload";
  }
}

export default function TryOn(props: Props) {
  const [screen, setScreen] = useState<Screen>("upload");
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState(0);
  const [look, setLook] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [gateTouched, setGateTouched] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // Open a screen from ?state=, outside production.
  useEffect(() => {
    if (!props.allowStateSwitch) return;
    const wanted = new URLSearchParams(location.search).get("state");
    const found = SCREENS.find((candidate) => candidate === wanted);
    if (found === undefined) return;
    if (found === "result" || found === "gate") setLook(0);
    if (found === "result") setMobile("98100 00000");
    setScreen(found);
  }, [props.allowStateSwitch]);

  // Each new screen starts at the top, with its heading focused for screen readers.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, [screen]);

  // The processing countdown: presentational, 20 seconds, then the gate.
  useEffect(() => {
    if (screen !== "processing") return;
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed((seconds) => Math.min(seconds + 1, tryOn.processing.seconds));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [screen]);
  useEffect(() => {
    if (screen === "processing" && elapsed >= tryOn.processing.seconds) setScreen("gate");
  }, [screen, elapsed]);

  // The photograph is shown from memory; the object URL is released when replaced.
  useEffect(
    () => () => {
      if (photo !== null) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  function choosePhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    setPhoto(URL.createObjectURL(file));
    setScreen("consent");
  }

  function back() {
    const target = backFrom(screen);
    if (target === "home") location.assign("/");
    else setScreen(target);
  }

  const nameBad = gateTouched && name.trim() === "";
  const mobileBad = gateTouched && !isCompleteMobile(mobile);
  function submitGate(event: Event) {
    event.preventDefault();
    if (name.trim() === "" || !isCompleteMobile(mobile)) {
      setGateTouched(true);
      return;
    }
    setScreen("result");
  }

  const chosenLook = looks[look] ?? looks[2];
  const title = (text: string, className = styles.title) => (
    <h1 ref={heading} tabIndex={-1} class={className}>
      {text}
    </h1>
  );

  return (
    <div class={`${styles.flow} on-ink`} data-screen={screen}>
      <div class={styles.track}>
        <div class={`${styles.progress} ${styles[`progress-${screen}`]}`} />
      </div>
      <div class={styles.inner}>
        <div class={styles.topline}>
          <button type="button" class={styles.back} onClick={back}>
            <Icon path={ICONS.back} size={17} />
            {screen === "upload" ? tryOn.backToSite : tryOn.back}
          </button>
          <span class={`caps ${styles.stepLabel}`}>{tryOn.stepLabels[screen]}</span>
        </div>

        {screen === "upload" && (
          <div class={styles.split}>
            <div>
              {title(tryOn.upload.title, styles.titleLarge)}
              <p class={styles.body}>{tryOn.upload.body}</p>
              <ol class={styles.guidelines}>
                {tryOn.upload.guidelines.map((guideline) => (
                  <li key={guideline.n} class={styles.guideline}>
                    <span class={styles.guidelineNumber}>{guideline.n}</span>
                    <div>
                      <div class={styles.guidelineTitle}>{guideline.title}</div>
                      <div class={styles.guidelineBody}>{guideline.body}</div>
                    </div>
                  </li>
                ))}
              </ol>
              <div class={styles.actions}>
                <button
                  type="button"
                  class="btn btn--lg btn--paper"
                  onClick={() => {
                    fileInput.current?.click();
                  }}
                >
                  {tryOn.upload.choose}
                </button>
                <button
                  type="button"
                  class="btn btn--lg btn--line-on-ink"
                  onClick={() => {
                    cameraInput.current?.click();
                  }}
                >
                  {tryOn.upload.camera}
                </button>
              </div>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden onChange={choosePhoto} />
              <input ref={cameraInput} type="file" accept="image/*" capture="user" hidden onChange={choosePhoto} />
            </div>
            <div class={styles.preview}>
              {photo === null ? (
                <>
                  <svg viewBox="0 0 320 400" class={styles.oval} aria-hidden="true">
                    <use href="#oval" />
                  </svg>
                  <div class={styles.previewCaption}>{tryOn.upload.previewCaption}</div>
                </>
              ) : (
                <img class={styles.previewPhoto} src={photo} alt={tryOn.upload.previewAlt} />
              )}
            </div>
          </div>
        )}

        {screen === "consent" && (
          <div class={styles.narrow}>
            {title(tryOn.consent.title)}
            <dl class={styles.rows}>
              {tryOn.consent.rows.map((row) => (
                <div key={row.k} class={styles.row}>
                  <dt class={`caps ${styles.rowKey}`}>{row.k}</dt>
                  <dd class={styles.rowValue}>{row.v}</dd>
                </div>
              ))}
            </dl>
            <label class={styles.agree}>
              <input
                type="checkbox"
                class="visually-hidden"
                checked={consent}
                onChange={(event) => {
                  setConsent(event.currentTarget.checked);
                }}
              />
              <span class={`${styles.box} ${consent ? styles.boxOn : ""}`} aria-hidden="true">
                {consent && <Icon path={ICONS.tick} size={14} stroke={1.7} />}
              </span>
              <span>{tryOn.consent.agreement}</span>
            </label>
            <button
              type="button"
              class={`${styles.next} ${consent ? styles.nextOn : styles.nextOff}`}
              aria-disabled={!consent}
              onClick={() => {
                if (consent) setScreen("stage");
              }}
            >
              {tryOn.consent.continue}
            </button>
            <p class={styles.small}>
              {tryOn.consent.privacy.before}
              <a class={styles.inlineLink} href="/privacy">
                {tryOn.consent.privacy.link}
              </a>
              {tryOn.consent.privacy.after}
            </p>
          </div>
        )}

        {screen === "stage" && (
          <div class={styles.medium}>
            {title(tryOn.stage.title)}
            <p class={styles.body}>{tryOn.stage.body}</p>
            <fieldset class={`${styles.choices} ${styles.stageGrid}`}>
              <legend class="visually-hidden">{tryOn.stage.title}</legend>
              {stageOptions.map((option, index) => (
                <label key={option.id} class={`${styles.stage} ${stage === index ? styles.picked : ""}`}>
                  <input
                    type="radio"
                    name="stage"
                    class="visually-hidden"
                    checked={stage === index}
                    onChange={() => {
                      setStage(index);
                    }}
                  />
                  <StageDrawing hair={option.hair} zone={option.zone} size="large" />
                  <span>
                    <span class={styles.stageTitle}>{option.title}</span>
                    <span class={styles.stageSub}>{option.sub}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              class={`${styles.next} ${styles.nextOn} ${styles.nextSpaced}`}
              onClick={() => {
                setScreen("looks");
              }}
            >
              {tryOn.stage.continue}
            </button>
          </div>
        )}

        {screen === "looks" && (
          <div>
            {title(tryOn.looks.title)}
            <p class={styles.body}>{tryOn.looks.body}</p>
            <fieldset class={`${styles.choices} ${styles.lookGrid}`}>
              <legend class="visually-hidden">{tryOn.looks.title}</legend>
              {looks.map((option, index) => (
                <label key={option.id} class={`${styles.look} ${look === index ? styles.picked : ""}`}>
                  <input
                    type="radio"
                    name="look"
                    class="visually-hidden"
                    checked={look === index}
                    onChange={() => {
                      setLook(index);
                    }}
                  />
                  <span class={styles.thumb}>
                    <span class={styles.thumbLabel}>{tryOn.looks.preview}</span>
                  </span>
                  <span class={styles.lookText}>
                    <span class={styles.lookDensity}>{option.density}</span>
                    <span class={styles.lookDetail}>{option.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              class={`${styles.next} ${styles.nextSpaced} ${look >= 0 ? styles.nextOn : styles.nextOff}`}
              aria-disabled={look < 0}
              onClick={() => {
                if (look >= 0) setScreen("processing");
              }}
            >
              {look >= 0 ? tryOn.looks.generate : tryOn.looks.choose}
            </button>
          </div>
        )}

        {screen === "processing" && (
          <div class={styles.processing}>
            {title(tryOn.processing.title)}
            <ul class={styles.ticks}>
              {tryOn.processing.steps.map((step) => (
                <li key={step.label} class={`${styles.tick} ${elapsed >= step.at ? styles.tickDone : ""}`}>
                  <Icon path={ICONS.tick} size={18} stroke={1.7} />
                  <span>{step.label}</span>
                </li>
              ))}
            </ul>
            {/* Seconds tick visually; screen readers hear only each finished step. */}
            <div class={styles.countdown} aria-hidden="true">
              {`${String(Math.max(0, tryOn.processing.seconds - elapsed))}s`}
            </div>
            <p class="visually-hidden" role="status">
              {tryOn.processing.steps.filter((step) => elapsed >= step.at).at(-1)?.label ?? ""}
            </p>
          </div>
        )}

        {screen === "gate" && (
          <div class={styles.gate}>
            <div class={styles.gateImage}>
              <div class={styles.gateFrame}>
                <div class={styles.gateLeft} />
                <div class={styles.gateRight} />
                <span class={`caps ${styles.gateReady}`}>{tryOn.gate.ready}</span>
              </div>
              <p class={styles.gateCaption}>{tryOn.gate.caption}</p>
            </div>
            <form onSubmit={submitGate} noValidate>
              {title(tryOn.gate.title)}
              <p class={styles.body}>{tryOn.gate.body}</p>
              <div class={styles.fields}>
                <div>
                  <label class={styles.fieldLabel} for="gate-name">
                    {tryOn.gate.name}
                  </label>
                  <input
                    id="gate-name"
                    class={`${styles.input} ${nameBad ? styles.inputBad : ""}`}
                    value={name}
                    placeholder={tryOn.gate.namePlaceholder}
                    autocomplete="name"
                    aria-invalid={nameBad}
                    aria-describedby={nameBad ? "gate-name-error" : undefined}
                    onInput={(event) => {
                      setName(event.currentTarget.value);
                    }}
                  />
                  <div aria-live="polite">
                    {nameBad && (
                      <div id="gate-name-error" class={styles.error}>
                        {tryOn.gate.nameError}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label class={styles.fieldLabel} for="gate-mobile">
                    {tryOn.gate.mobile}
                  </label>
                  <div class={`${styles.mobile} ${mobileBad ? styles.inputBad : ""}`}>
                    <span class={styles.prefix}>+91</span>
                    <input
                      id="gate-mobile"
                      class={styles.mobileInput}
                      value={mobile}
                      placeholder={tryOn.gate.mobilePlaceholder}
                      inputMode="numeric"
                      autocomplete="tel-national"
                      aria-invalid={mobileBad}
                      aria-describedby={mobileBad ? "gate-mobile-error" : undefined}
                      onInput={(event) => {
                        setMobile(formatMobile(event.currentTarget.value));
                      }}
                    />
                  </div>
                  <div aria-live="polite">
                    {mobileBad && (
                      <div id="gate-mobile-error" class={styles.error}>
                        {tryOn.gate.mobileError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button type="submit" class={`btn btn--lg btn--paper ${styles.gateSubmit}`}>
                {tryOn.gate.submit}
              </button>
              <div class={styles.reassurance}>{tryOn.gate.reassurance}</div>
            </form>
          </div>
        )}

        {screen === "result" && (
          <div class={styles.result}>
            <BeforeAfter
              start={50}
              size="result"
              beforeLabel={tryOn.result.before}
              afterLabel={tryOn.result.after}
              sliderLabel={tryOn.result.sliderLabel}
              before={<img src={photo ?? props.mockBefore} alt={tryOn.result.beforeAlt} />}
              after={<img src={props.mockAfter} alt={tryOn.result.afterAlt} />}
            />
            <div>
              <div class={`caps ${styles.chosen}`}>{chosenLook?.label}</div>
              {title(tryOn.result.title, styles.resultTitle)}
              <div class={styles.disclaimer}>{tryOn.result.disclaimer}</div>
              <div class={styles.resultActions}>
                <a class="btn btn--lg btn--paper" href="/book">
                  {tryOn.result.book}
                </a>
                <div class={styles.pair}>
                  <button type="button" class={`btn btn--line-on-ink ${styles.half}`}>
                    <Icon path={ICONS.download} size={17} />
                    {tryOn.result.download}
                  </button>
                  <button type="button" class={`btn btn--line-on-ink ${styles.half}`}>
                    <Icon path={ICONS.whatsapp} size={17} />
                    {tryOn.result.whatsapp}
                  </button>
                </div>
                <button
                  type="button"
                  class={styles.another}
                  onClick={() => {
                    setScreen("looks");
                  }}
                >
                  {tryOn.result.another}
                </button>
              </div>
              <div class={styles.copy}>
                {tryOn.result.copy.before}
                <span class={styles.number}>{`+91 ${mobile === "" ? tryOn.gate.mobilePlaceholder : mobile}`}</span>
                {tryOn.result.copy.after}
              </div>
            </div>
          </div>
        )}

        {screen === "error" && (
          <div class={styles.errorScreen}>
            <div class={styles.errorFrame}>
              <Icon path={ICONS.noPhoto} size={28} stroke={1.5} />
              <div class="caps">{tryOn.error.frame}</div>
            </div>
            {title(tryOn.error.title, styles.errorTitle)}
            <p class={styles.errorBody}>{tryOn.error.body}</p>
            <div class={styles.errorActions}>
              <button
                type="button"
                class="btn btn--lg btn--paper"
                onClick={() => {
                  setScreen("upload");
                }}
              >
                {tryOn.error.another}
              </button>
              <a class="btn btn--lg btn--line-on-ink" href="/book">
                {tryOn.error.book}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
