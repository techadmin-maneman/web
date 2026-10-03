// The try-on, on the API. The look goes to WhatsApp only, never to this site
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md): the photograph is
// prepared in the browser (lib/photo.ts) and uploads while the visitor chooses
// a stage and a look; the gate then asks where to send the look, a WhatsApp
// code proves the number (useNumberCode.ts), the claim saves it, and only then
// is the look made. The sent screen says it is
// on its way, and watches the render until it is ready, in case it fails. A
// visitor who has had their look is told it was sent, and a visitor arriving
// while WhatsApp cannot send a look is told the try-on is not available.
//
// The screens and what moves between them are machine.ts, the render's watch
// hooks.ts, and each screen draws itself. This file does the work between: the
// photograph, the upload, the gate and the render.
//
// Outside production, ?state=<screen> opens a screen directly, with stand-ins
// and no API calls, for the fidelity screenshots and the browser tests
// (machine.ts lists the kinds each screen takes).

import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { turnstileWidget, type TurnstileWidget } from "@maneman/web-kit/turnstile";
import { looks, notices, stageOptions, tryOn, tryOnSendsCopy } from "../../content/site.ts";
import { track } from "../../lib/analytics.ts";
import { claimLook, jobStatus, type ErrorCode } from "../../lib/api.ts";
import { keyPerRequest } from "../../lib/idempotency.ts";
import { preparePhoto, type PreparedPhoto } from "../../lib/photo.ts";
import { onArrival, startRender, startUpload, type Arrival, type Outcome, type Uploaded } from "../../lib/tryon.ts";
import { jobProblem, type Failure } from "../../lib/tryon-errors.ts";
import { readAttribution } from "../../lib/visit.ts";
import { Icon } from "../Drawings.tsx";
import { Consent } from "./Consent.tsx";
import { Failed } from "./Failed.tsx";
import { useInvalidFocus } from "../useInvalidFocus.ts";
import { useNumberCode } from "../useNumberCode.ts";
import { Gate, type GateCode } from "./Gate.tsx";
import { useReleased, useRenderWatch } from "./hooks.ts";
import { Looks } from "./Looks.tsx";
import { backFrom, screenNamed, START, step } from "./machine.ts";
import { Sent } from "./Sent.tsx";
import { Stage } from "./Stage.tsx";
import styles from "./TryOn.module.css";
import { Upload } from "./Upload.tsx";

interface Props {
  turnstileSiteKey: string;
  /** Allow ?state= to open a screen directly (never in production). */
  allowStateSwitch: boolean;
  /** The look picker's pictures, in the looks' order, or null until every look has one. */
  lookThumbnails: readonly string[] | null;
}

/** The gate's line for each refusal of the claim the visitor can act on there. */
const GATE_REFUSALS: Partial<Record<ErrorCode | "network", string>> = {
  rate_limited: tryOn.gate.errors.rateLimited,
  job_not_claimable: tryOn.gate.errors.taken,
  number_not_proved: tryOn.gate.errors.notProved,
};

/** The gate's fields, which it marks when a refusal names them, by the API's names. */
const GATE_FIELDS: readonly string[] = ["name", "mobile"];

/** The gate's line for each refusal of a WhatsApp code to the number. */
const CODE_REFUSALS: Partial<Record<ErrorCode | "network", string>> = {
  rate_limited: tryOn.gate.errors.codes,
  turnstile_failed: tryOn.gate.errors.turnstile,
};

export default function TryOn(props: Props) {
  const [state, send] = useReducer(step, START);
  const { screen, demo, name, mobile } = state;
  const [gateTouched, setGateTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [gateFailure, setGateFailure] = useState<string | null>(null);
  // The gate's fields the last refusal named.
  const [gateRefused, setGateRefused] = useState<readonly string[]>([]);
  const gateForm = useRef<HTMLFormElement>(null);
  const showInvalid = useInvalidFocus(gateForm);
  const numberCode = useNumberCode();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstile = useRef<TurnstileWidget | null>(null);
  const keyFor = useMemo(keyPerRequest, []);
  // The current photograph's work. Each is replaced when a new photograph is chosen.
  const preparing = useRef<Promise<PreparedPhoto> | null>(null);
  const uploading = useRef<Promise<Outcome<Uploaded>> | null>(null);
  const jobId = useRef<string | null>(null);
  // The try-on whose claim analytics has counted.
  const claimCounted = useRef<string | null>(null);
  // What the API says on arrival. A photograph chosen before it answers drops it.
  const arriving = useRef<Promise<Arrival> | null>(null);

  function fail(failure: Failure) {
    send({ type: "failed", kind: failure.kind });
    if (!demo) track({ name: "try_on_failed", failure_code: failure.code });
  }

  /** A refused upload or render: a browser that has had its look is told it was sent; anything else is an error. */
  function refused(failure: Failure) {
    if (failure.code === "look_limit_reached") send({ type: "alreadySent" });
    else fail(failure);
  }

  // ?state= opens a screen with stand-ins, outside production. Otherwise Turnstile is readied, and the API asked
  // whether this browser has had its look and whether the try-on runs, so the visitor is not asked for a photograph
  // the API would refuse (CLI-29).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = screenNamed(props.allowStateSwitch ? params.get("state") : null);
    if (wanted !== undefined) {
      send({ type: "preview", screen: wanted, kind: params.get("kind") });
      return;
    }
    if (turnstileBox.current !== null) {
      turnstile.current = turnstileWidget(turnstileBox.current, props.turnstileSiteKey);
    }
    const asked = onArrival();
    arriving.current = asked;
    void asked.then((arrival) => {
      if (arriving.current !== asked) return;
      if (arrival === "hadLook") send({ type: "alreadySent" });
      if (arrival === "unavailable") send({ type: "failed", kind: "unavailable" });
    });
  }, [props.allowStateSwitch, props.turnstileSiteKey]);

  // Each new screen starts at the top, with its heading focused for screen readers.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, [screen]);

  useEffect(() => {
    if (screen === "gate" && !demo) track({ name: "try_on_gate_shown" });
  }, [screen, demo]);

  // Once the look is on its way, a render that fails sends the visitor to the error screen; its message is skipped.
  useRenderWatch(!demo && screen === "sent" && !state.returning, jobId, fail);

  // The photograph is shown from memory; its object URL is released when replaced.
  useReleased(state.photo);

  function choosePhoto(file: File) {
    const prepared = demo ? null : preparePhoto(file, tryOnSendsCopy);
    preparing.current = prepared;
    uploading.current = null;
    jobId.current = null;
    arriving.current = null;
    send({ type: "photoChosen", photo: URL.createObjectURL(file) });
    if (prepared === null) return;
    track({ name: "try_on_started" });
    // A file the browser cannot read, or one too small, is refused at once.
    prepared.catch(() => {
      if (preparing.current === prepared) fail({ kind: "photo", code: "photo_invalid_file" });
    });
  }

  function agree() {
    if (!state.consent) return;
    send({ type: "agreed" });
    const prepared = preparing.current;
    if (prepared === null || uploading.current !== null) return;
    const upload = startUpload(prepared, turnstile.current, notices.photo.version);
    uploading.current = upload;
    // A refusal shows at once, rather than after the visitor has chosen a look.
    void upload.then((outcome) => {
      if (!outcome.ok && uploading.current === upload) refused(outcome);
    });
  }

  function back() {
    if (backFrom(screen) === "home") location.assign("/");
    else send({ type: "back" });
  }

  /** A refusal that names the gate's fields marks them and focuses the first; false when it names none. */
  function markRefused(code: ErrorCode | "network", fields: readonly string[]): boolean {
    const marked = code === "invalid_request" ? fields.filter((field) => GATE_FIELDS.includes(field)) : [];
    setGateRefused(marked);
    if (marked.length === 0) return false;
    showInvalid();
    return true;
  }

  /** A field the API refused is no longer marked once it has been changed. */
  function unmark(field: string) {
    setGateRefused((refused) => refused.filter((named) => named !== field));
  }

  /** A claim refused: a line on the gate where the visitor can act on it, else the error screen. */
  async function claimRefused(code: ErrorCode | "network", fields: readonly string[], job: string) {
    if (code === "whatsapp_unavailable") {
      fail({ kind: "unavailable", code });
      return;
    }
    if (code === "look_limit_reached") {
      send({ type: "alreadySent" });
      return;
    }
    if (code === "job_not_claimable") {
      // The photograph may have expired while the gate was open, or the try-on is saved to another number.
      const status = await jobStatus(job);
      const problem = status.ok ? jobProblem(status.body) : null;
      if (problem !== null) {
        fail(problem);
        return;
      }
    }
    // A code entered more than 30 minutes ago no longer proves the number: the next press sends a new one.
    if (code === "number_not_proved") numberCode.forget();
    if (code === "invalid_request") setGateTouched(true);
    if (markRefused(code, fields)) return;
    setGateFailure(GATE_REFUSALS[code] ?? tryOn.gate.errors.other);
  }

  /**
   * The gate: the claim saves where the look goes, and then the look is asked for. Pressed again after an answer
   * was lost, the claim carries the same key, so the API answers it as the first, and the render is asked again.
   */
  async function claimAndRender(upload: Uploaded, digits: string, numberCodeId: string) {
    const stageId = stageOptions[state.stage]?.id;
    const preset = looks[state.look]?.id;
    if (stageId === undefined || preset === undefined) return;
    const attribution = readAttribution();
    const claim = {
      job_id: upload.jobId,
      name: name.trim(),
      mobile: digits,
      number_code_id: numberCodeId,
      stage: stageId,
      notice_version: notices.gate.version,
      ...(attribution === undefined ? {} : { attribution }),
    };
    const answer = await claimLook(claim, keyFor(claim));
    if (!answer.ok) {
      await claimRefused(answer.code, answer.fields, upload.jobId);
      return;
    }
    // A claim answered again is the same lead, and the same conversion.
    if (claimCounted.current !== upload.jobId) {
      claimCounted.current = upload.jobId;
      track({ name: "try_on_claimed" });
    }

    const render = await startRender(upload, preset);
    if (render.ok) {
      jobId.current = render.value;
      send({ type: "sent" });
      track({ name: "try_on_completed" });
      return;
    }
    if (render.code === "network") setGateFailure(tryOn.gate.errors.other);
    else refused(render);
  }

  const nameBad = (gateTouched && name.trim() === "") || gateRefused.includes("name");
  const mobileBad = (gateTouched && mobileDigits(mobile) === null) || gateRefused.includes("mobile");
  async function submitGate(event: Event) {
    event.preventDefault();
    if (sending || numberCode.checking) return;
    const digits = mobileDigits(mobile);
    if (name.trim() === "" || digits === null) {
      setGateTouched(true);
      setGateFailure(null);
      showInvalid();
      return;
    }
    if (demo) {
      send({ type: "sent" });
      return;
    }

    setGateFailure(null);
    setGateRefused([]);
    const numberCodeId = await provedNumber(digits);
    if (numberCodeId === null) return;
    setSending(true);
    // The gate may open before the upload has finished; the claim needs the photograph uploaded.
    const upload = (await uploading.current) ?? ({ ok: false, kind: "busy", code: "no_upload" } as const);
    if (upload.ok) await claimAndRender(upload.value, digits, numberCodeId);
    else refused(upload);
    setSending(false);
  }

  /** The code's ID once it has proved the number; until then, a code is sent, or the one typed is checked. */
  async function provedNumber(digits: string): Promise<string | null> {
    const proved = numberCode.proofFor(digits);
    if (proved !== null) return proved;
    if (numberCode.waitingFor(digits)) return numberCode.confirm();
    await askForCode(digits);
    return null;
  }

  /** A WhatsApp code to the number typed, under a fresh Turnstile token. */
  async function askForCode(digits: string) {
    setSending(true);
    setGateFailure(null);
    setGateRefused([]);
    const token = (await turnstile.current?.token()) ?? null;
    if (token === null) {
      setGateFailure(tryOn.gate.errors.turnstile);
      setSending(false);
      return;
    }
    const answer = await numberCode.ask(digits, name.trim(), token);
    void turnstile.current?.renew();
    setSending(false);
    if (answer.ok || markRefused(answer.code, answer.fields)) return;
    setGateFailure(CODE_REFUSALS[answer.code] ?? tryOn.gate.errors.other);
  }

  function askAgain(event: Event) {
    event.preventDefault();
    const digits = mobileDigits(mobile);
    if (sending || digits === null) return;
    void askForCode(digits);
  }

  const digitsTyped = mobileDigits(mobile);
  const codeWaiting = digitsTyped !== null && numberCode.waitingFor(digitsTyped);
  const gateCode: GateCode | null = codeWaiting
    ? {
        value: numberCode.code,
        failure: numberCode.failure,
        checking: numberCode.checking,
        onInput: numberCode.setCode,
        onAgain: askAgain,
      }
    : null;

  return (
    <div class={`${styles.flow} on-ink`} data-screen={screen}>
      <div class={styles.track}>
        <div class={`${styles.progress} ${styles[`progress-${screen}`]}`} />
      </div>
      <div class={styles.inner}>
        <div class={styles.topline}>
          <button type="button" class={styles.back} onClick={back}>
            <Icon path={ICONS.back} size={17} />
            {backFrom(screen) === "home" ? tryOn.backToSite : tryOn.back}
          </button>
          <span class={`caps ${styles.stepLabel}`}>
            {screen === "error" ? tryOn.error.kinds[state.errorKind].step : tryOn.stepLabels[screen]}
          </span>
        </div>

        {screen === "upload" && <Upload photo={state.photo} heading={heading} onChoose={choosePhoto} />}
        {screen === "consent" && (
          <Consent
            notice={notices.photo}
            consent={state.consent}
            heading={heading}
            onTick={(consent) => {
              send({ type: "consentTicked", consent });
            }}
            onAgree={agree}
          />
        )}
        {screen === "stage" && (
          <Stage
            stage={state.stage}
            heading={heading}
            onChoose={(chosen) => {
              send({ type: "stageChosen", stage: chosen });
            }}
            onDone={() => {
              send({ type: "stageDone" });
            }}
          />
        )}
        {screen === "looks" && (
          <Looks
            look={state.look}
            thumbnails={props.lookThumbnails}
            heading={heading}
            onChoose={(look) => {
              send({ type: "lookChosen", look });
            }}
            onContinue={() => {
              send({ type: "lookDone" });
            }}
          />
        )}
        {screen === "gate" && (
          <Gate
            notice={notices.gate}
            name={name}
            mobile={mobile}
            nameBad={nameBad}
            mobileBad={mobileBad}
            failure={gateFailure}
            sending={sending}
            code={gateCode}
            heading={heading}
            form={gateForm}
            onName={(typed) => {
              unmark("name");
              send({ type: "nameTyped", name: typed });
            }}
            onMobile={(typed) => {
              unmark("mobile");
              send({ type: "mobileTyped", mobile: typed });
            }}
            onSubmit={(event) => void submitGate(event)}
          />
        )}
        {screen === "sent" && <Sent mobile={mobile} returning={state.returning} heading={heading} />}
        {screen === "error" && (
          <Failed
            kind={state.errorKind}
            heading={heading}
            onAgain={() => {
              send({ type: "again" });
            }}
          />
        )}

        {/* Turnstile shows here only if Cloudflare needs the visitor to act. */}
        <div ref={turnstileBox} class={styles.turnstile} />
      </div>
    </div>
  );
}
