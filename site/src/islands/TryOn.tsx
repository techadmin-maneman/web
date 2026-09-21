// The try-on, v2's eight screens, on the API. The photograph is prepared in
// the browser (lib/photo.ts) and uploads while the visitor chooses a stage and
// a look; the render starts at Generate. The gate opens after 20 seconds, as
// in v2, whether or not the render has finished: submitting it saves the lead
// and starts the session that shows the result.
//
// Outside production, ?state=<screen> opens a screen directly, with stand-in
// images and no API calls, for the fidelity screenshots and the browser tests.
// ?state=error&kind=<busy|renderFailed|lookLimit> opens the other error copy.

import { useEffect, useRef, useState } from "preact/hooks";
import { looks, notices, stageOptions, tryOn } from "../content/site.ts";
import { claimResult, fetchResult, jobStatus, type ClaimResponse } from "../lib/api.ts";
import { downloadFile } from "../lib/download.ts";
import { ICONS } from "../lib/icons.ts";
import { formatMobile, isCompleteMobile } from "../lib/phone.ts";
import { preparePhoto, type PreparedPhoto } from "../lib/photo.ts";
import { startRender, startUpload, type Outcome, type Uploaded } from "../lib/tryon.ts";
import { failureKindOf, jobProblem, type ErrorKind } from "../lib/tryon-errors.ts";
import { turnstileWidget } from "../lib/turnstile.ts";
import { readAttribution } from "../lib/visit.ts";
import BeforeAfter from "./BeforeAfter.tsx";
import { Icon, StageDrawing } from "./Drawings.tsx";
import styles from "./TryOn.module.css";

const SCREENS = ["upload", "consent", "stage", "looks", "processing", "gate", "result", "error"] as const;
type Screen = (typeof SCREENS)[number];
const ERROR_KINDS = Object.keys(tryOn.error.kinds) as ErrorKind[];

/** How often the page asks how the render is going. */
const POLL_MS = 3_000;
/** Renders take 30 to 180 seconds; after this long on the result screen, the page gives up. */
const RESULT_WAIT_MS = 5 * 60_000;

interface Props {
  turnstileSiteKey: string;
  /** Stand-in images for ?state=result. Empty in production. */
  mockBefore: string;
  mockAfter: string;
  /** Allow ?state= to open a screen directly (never in production). */
  allowStateSwitch: boolean;
}

/** The finished render: shown from memory, and the same file for Download and WhatsApp. */
interface Rendered {
  readonly url: string;
  readonly file: File | null;
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

/** Fetches the result image once, for the page and for sharing. */
async function loadRendered(url: string): Promise<Rendered | null> {
  const response = await fetch(url).catch(() => null);
  if (response?.ok !== true) return null;
  const blob = await response.blob();
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return {
    url: URL.createObjectURL(blob),
    file: new File([blob], `${tryOn.result.fileName}.${extension}`, { type: blob.type }),
  };
}

export default function TryOn(props: Props) {
  const [screen, setScreen] = useState<Screen>("upload");
  const [demo, setDemo] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState(0);
  const [look, setLook] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [gateTouched, setGateTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [gateFailure, setGateFailure] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ jobId: string; answer: ClaimResponse } | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("photo");
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstile = useRef<ReturnType<typeof turnstileWidget> | null>(null);
  // The current photograph's work. Each is replaced when a new photograph is chosen.
  const preparing = useRef<Promise<PreparedPhoto> | null>(null);
  const uploading = useRef<Promise<Outcome<Uploaded>> | null>(null);
  const rendering = useRef<Promise<Outcome<string>> | null>(null);
  const jobId = useRef<string | null>(null);

  function fail(kind: ErrorKind) {
    setErrorKind(kind);
    setScreen("error");
  }

  // ?state= opens a screen with stand-ins, outside production. Otherwise, Turnstile is readied.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = props.allowStateSwitch ? params.get("state") : null;
    const found = SCREENS.find((candidate) => candidate === wanted);
    if (found === undefined) {
      if (turnstileBox.current !== null) {
        turnstile.current = turnstileWidget(turnstileBox.current, props.turnstileSiteKey);
      }
      return;
    }
    setDemo(true);
    if (found === "result" || found === "gate") setLook(0);
    if (found === "result") {
      setMobile(tryOn.gate.mobilePlaceholder);
      setRendered({ url: props.mockAfter, file: null });
    }
    if (found === "error") setErrorKind(ERROR_KINDS.find((kind) => kind === params.get("kind")) ?? "photo");
    setScreen(found);
  }, [props.allowStateSwitch, props.turnstileSiteKey, props.mockAfter]);

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

  // Until the gate is submitted, a render that fails sends the visitor to the error screen.
  useEffect(() => {
    if (demo || (screen !== "processing" && screen !== "gate")) return;
    const timer = setInterval(() => {
      const id = jobId.current;
      if (id === null) return;
      void jobStatus(id).then((answer) => {
        const problem = answer.ok ? jobProblem(answer.body) : null;
        if (problem !== null && jobId.current === id) fail(problem);
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [demo, screen]);

  // After the gate: ask for the result until it is ready, then fetch it once.
  useEffect(() => {
    if (demo || screen !== "result" || claimed === null || rendered !== null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const check = async () => {
      const answer = await fetchResult(claimed.jobId);
      if (stopped) return;
      if (answer.kind === "ready") {
        void loadRendered(answer.url).then((image) => {
          if (stopped) return;
          if (image === null) fail("busy");
          else setRendered(image);
        });
        return;
      }
      if (answer.kind === "failed") {
        fail(failureKindOf(answer.failureCode));
        return;
      }
      const gaveUp = Date.now() - started > RESULT_WAIT_MS;
      const refused = answer.kind === "error" && answer.code !== "network";
      if (gaveUp || refused) {
        fail("busy");
        return;
      }
      timer = setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [demo, screen, claimed, rendered]);

  // Photographs and results are shown from memory; each object URL is released when replaced.
  useEffect(
    () => () => {
      if (photo !== null) URL.revokeObjectURL(photo);
    },
    [photo],
  );
  useEffect(
    () => () => {
      if (rendered !== null && rendered.file !== null) URL.revokeObjectURL(rendered.url);
    },
    [rendered],
  );

  function choosePhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;

    const prepared = demo ? null : preparePhoto(file);
    preparing.current = prepared;
    uploading.current = null;
    rendering.current = null;
    jobId.current = null;
    setClaimed(null);
    setRendered(null);
    setPhoto(URL.createObjectURL(file));
    setScreen("consent");
    // A file the browser cannot read, or one too small, is refused at once.
    prepared?.catch(() => {
      if (preparing.current === prepared) fail("photo");
    });
  }

  function agree() {
    if (!consent) return;
    setScreen("stage");
    const prepared = preparing.current;
    if (prepared === null || uploading.current !== null) return;
    const upload = startUpload(prepared, turnstile.current, notices.photo.version);
    uploading.current = upload;
    // A refusal shows at once, rather than after the visitor has chosen a look.
    void upload.then((outcome) => {
      if (!outcome.ok && uploading.current === upload) fail(outcome.error);
    });
  }

  function generate() {
    if (look < 0) return;
    setScreen("processing");
    const upload = uploading.current;
    const stageId = stageOptions[stage]?.id;
    const preset = looks[look]?.id;
    if (upload === null || stageId === undefined || preset === undefined) return;
    const render = startRender(upload, { stage: stageId, preset });
    rendering.current = render;
    void render.then((outcome) => {
      if (rendering.current !== render) return;
      if (outcome.ok) jobId.current = outcome.value;
      else fail(outcome.error);
    });
  }

  function back() {
    const target = backFrom(screen);
    if (target === "home") location.assign("/");
    else setScreen(target);
  }

  const nameBad = gateTouched && name.trim() === "";
  const mobileBad = gateTouched && !isCompleteMobile(mobile);
  async function submitGate(event: Event) {
    event.preventDefault();
    if (sending) return;
    if (name.trim() === "" || !isCompleteMobile(mobile)) {
      setGateTouched(true);
      return;
    }
    if (demo) {
      setRendered({ url: props.mockAfter, file: null });
      setScreen("result");
      return;
    }

    setSending(true);
    setGateFailure(null);
    // The gate may open before the upload has finished; the claim needs the render started.
    const render = (await rendering.current) ?? ({ ok: false, error: "busy" } as const);
    if (!render.ok) {
      setSending(false);
      fail(render.error);
      return;
    }
    const attribution = readAttribution();
    const answer = await claimResult(
      { job_id: render.value, name: name.trim(), mobile, ...(attribution === undefined ? {} : { attribution }) },
      crypto.randomUUID(),
    );
    setSending(false);
    if (answer.ok) {
      setClaimed({ jobId: render.value, answer: answer.body });
      setScreen("result");
      return;
    }
    if (answer.code === "job_not_claimable") {
      // Either the render has failed since, or the job is saved to another number.
      const status = await jobStatus(render.value);
      const problem = status.ok ? jobProblem(status.body) : null;
      if (problem !== null) fail(problem);
      else setGateFailure(tryOn.gate.errors.taken);
      return;
    }
    if (answer.code === "invalid_request") setGateTouched(true);
    setGateFailure(answer.code === "rate_limited" ? tryOn.gate.errors.rateLimited : tryOn.gate.errors.other);
  }

  function download() {
    const file = rendered?.file;
    if (file !== null && file !== undefined) downloadFile(file.name, file.type, file);
  }

  function shareOnWhatsApp() {
    const file = rendered?.file;
    const text = tryOn.result.share;
    if (file !== null && file !== undefined && "canShare" in navigator && navigator.canShare({ files: [file] })) {
      void navigator.share({ files: [file], text }).catch(() => undefined);
      return;
    }
    // Without file sharing, WhatsApp gets the words only; the image is never put in a link.
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  const chosenLook = looks[look] ?? looks[2];
  const errorCopy = tryOn.error.kinds[errorKind];
  const showCopyLine = demo || claimed?.answer.whatsapp_copy === true;
  const resultReady = rendered !== null;
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
              onClick={agree}
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
              onClick={generate}
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
            <form onSubmit={(event) => void submitGate(event)} noValidate>
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
                    maxLength={60}
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
              <div aria-live="polite">
                {gateFailure !== null && <div class={`${styles.error} ${styles.gateFailure}`}>{gateFailure}</div>}
              </div>
              <button type="submit" class={`btn btn--lg btn--paper ${styles.gateSubmit}`} aria-disabled={sending}>
                {sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
                {sending ? tryOn.gate.sending : tryOn.gate.submit}
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
              after={
                resultReady ? (
                  <img src={rendered.url} alt={tryOn.result.afterAlt} />
                ) : (
                  <div class={styles.pending}>
                    <Icon path={ICONS.sending} size={20} stroke={1.5} />
                    <span class="caps">{tryOn.result.pending}</span>
                  </div>
                )
              }
            />
            <div>
              <div class={`caps ${styles.chosen}`}>{chosenLook?.label}</div>
              {title(tryOn.result.title, styles.resultTitle)}
              <p class="visually-hidden" role="status">
                {resultReady ? tryOn.gate.ready : tryOn.result.pending}
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
                    aria-disabled={!resultReady}
                    onClick={download}
                  >
                    <Icon path={ICONS.download} size={17} />
                    {tryOn.result.download}
                  </button>
                  <button
                    type="button"
                    class={`btn btn--line-on-ink ${styles.half}`}
                    aria-disabled={!resultReady}
                    onClick={() => {
                      if (resultReady) shareOnWhatsApp();
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
                  <span class={styles.number}>{`+91 ${mobile}`}</span>
                  {tryOn.result.copy.after}
                </div>
              )}
            </div>
          </div>
        )}

        {screen === "error" && (
          <div class={styles.errorScreen}>
            <div class={styles.errorFrame}>
              <Icon path={ICONS.noPhoto} size={28} stroke={1.5} />
              <div class="caps">{tryOn.error.frame}</div>
            </div>
            {title(errorCopy.title, styles.errorTitle)}
            <p class={styles.errorBody}>{errorCopy.body}</p>
            <div class={styles.errorActions}>
              {/* One look per visitor: once it has been had, there is no other photograph to choose. */}
              {errorKind !== "lookLimit" && (
                <button
                  type="button"
                  class="btn btn--lg btn--paper"
                  onClick={() => {
                    setScreen("upload");
                  }}
                >
                  {tryOn.error.another}
                </button>
              )}
              <a class="btn btn--lg btn--line-on-ink" href="/book">
                {tryOn.error.book}
              </a>
            </div>
          </div>
        )}

        {/* Turnstile shows here only if Cloudflare needs the visitor to act. */}
        <div ref={turnstileBox} class={styles.turnstile} />
      </div>
    </div>
  );
}
