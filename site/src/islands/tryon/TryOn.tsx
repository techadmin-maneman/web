// The try-on, v2's eight screens, on the API. The photograph is prepared in
// the browser (lib/photo.ts) and uploads while the visitor chooses a stage and
// a look; the render starts at Generate. The gate opens after 20 seconds, as
// in v2, whether or not the render has finished. The number there is
// optional, as its copy says: given, it saves the lead and sends a WhatsApp
// copy; either way the result opens next. A visitor who has had their look
// is shown it again, on arrival if the API knows them by then.
//
// The screens and what moves between them are machine.ts, the timers and polls
// hooks.ts, and each screen draws itself. This file does the work between: the
// photograph, the upload, the render and the gate.
//
// Outside production, ?state=<screen> opens a screen directly, with stand-in
// images and no API calls, for the fidelity screenshots and the browser tests
// (machine.ts lists the kinds each screen takes).

import { useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import { looks, notices, stageOptions, tryOn } from "../../content/site.ts";
import { track } from "../../lib/analytics.ts";
import { claimResult, fetchLook, jobStatus, type Answer, type Look } from "../../lib/api.ts";
import { keyPerRequest } from "../../lib/idempotency.ts";
import { isCompleteMobile } from "../../lib/phone.ts";
import { preparePhoto, type PreparedPhoto } from "../../lib/photo.ts";
import { startRender, startUpload, type Outcome, type Uploaded } from "../../lib/tryon.ts";
import { jobProblem, type Failure } from "../../lib/tryon-errors.ts";
import { turnstileWidget } from "../../lib/turnstile.ts";
import { readAttribution } from "../../lib/visit.ts";
import { Icon } from "../Drawings.tsx";
import { Consent } from "./Consent.tsx";
import { Failed } from "./Failed.tsx";
import { Gate } from "./Gate.tsx";
import { useReleased, useRenderWatch, useResult } from "./hooks.ts";
import { Looks } from "./Looks.tsx";
import { backFrom, screenNamed, START, step } from "./machine.ts";
import { Processing } from "./Processing.tsx";
import { Result } from "./Result.tsx";
import { Stage } from "./Stage.tsx";
import styles from "./TryOn.module.css";
import { Upload } from "./Upload.tsx";

interface Props {
  turnstileSiteKey: string;
  /** Stand-in images for ?state=result. Empty in production. */
  mockBefore: string;
  mockAfter: string;
  /** Allow ?state= to open a screen directly (never in production). */
  allowStateSwitch: boolean;
}

export default function TryOn(props: Props) {
  const [state, send] = useReducer(step, START);
  const { screen, demo } = state;
  const [gateTouched, setGateTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [gateFailure, setGateFailure] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const turnstileBox = useRef<HTMLDivElement>(null);
  const turnstile = useRef<ReturnType<typeof turnstileWidget> | null>(null);
  const keyFor = useMemo(keyPerRequest, []);
  // The current photograph's work. Each is replaced when a new photograph is chosen.
  const preparing = useRef<Promise<PreparedPhoto> | null>(null);
  const uploading = useRef<Promise<Outcome<Uploaded>> | null>(null);
  const rendering = useRef<Promise<Outcome<string>> | null>(null);
  const jobId = useRef<string | null>(null);
  // The look asked for on arrival. A photograph chosen before it answers drops it.
  const arriving = useRef<Promise<Answer<Look>> | null>(null);

  function fail(failure: Failure) {
    send({ type: "failed", kind: failure.kind });
    if (!demo) track({ name: "try_on_failed", failure_code: failure.code });
  }

  /** A browser that has had its look is shown it again, and its render is the one the gate claims. */
  function showLook(own: Look) {
    jobId.current = own.job_id;
    rendering.current = Promise.resolve({ ok: true, value: own.job_id } as const);
    send({ type: "ownLook", look: { jobId: own.job_id, stage: own.stage, preset: own.preset } });
  }

  // ?state= opens a screen with stand-ins, outside production. Otherwise Turnstile is readied, and the API asked
  // whether this browser has had its look, so it is not asked for a photograph it cannot use (CLI-29).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = screenNamed(props.allowStateSwitch ? params.get("state") : null);
    if (wanted !== undefined) {
      send({ type: "preview", screen: wanted, kind: params.get("kind"), mockAfter: props.mockAfter });
      return;
    }
    if (turnstileBox.current !== null) {
      turnstile.current = turnstileWidget(turnstileBox.current, props.turnstileSiteKey);
    }
    const asked = fetchLook();
    arriving.current = asked;
    void asked.then((answer) => {
      if (arriving.current === asked && answer.ok && answer.body.state !== "failed") showLook(answer.body);
    });
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

  useEffect(() => {
    if (screen === "gate" && !demo) track({ name: "try_on_gate_shown" });
  }, [screen, demo]);

  // Until the gate is submitted, a render that fails sends the visitor to the error screen.
  useRenderWatch(!demo && (screen === "processing" || screen === "gate"), jobId, fail);

  // After the gate: the result, once it is ready.
  const awaited = !demo && screen === "result" && state.rendered === null ? state.showing : null;
  useResult(
    awaited,
    (rendered, showing) => {
      send({ type: "rendered", rendered });
      if (!showing.returning) track({ name: "try_on_completed" });
    },
    fail,
  );

  // Photographs and results are shown from memory; each object URL is released when replaced.
  const { photo, rendered } = state;
  useReleased(photo);
  // The stand-in result is a file of the site's, not one made here.
  useReleased(rendered !== null && rendered.file !== null ? rendered.url : null);

  function choosePhoto(file: File) {
    const prepared = demo ? null : preparePhoto(file);
    preparing.current = prepared;
    uploading.current = null;
    rendering.current = null;
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
      if (outcome.ok || uploading.current !== upload) return;
      if (outcome.kind === "lookLimit") void showOwnLook(outcome);
      else fail(outcome);
    });
  }

  /** Refused for having had a look: it is shown again. Only if it is gone does the error screen say so. */
  async function showOwnLook(refusal: Failure) {
    const answer = await fetchLook();
    if (answer.ok && answer.body.state !== "failed") showLook(answer.body);
    else fail(refusal);
  }

  function generate() {
    if (state.look < 0) return;
    send({ type: "generate" });
    // Back from the gate: the render already runs, and Continue only returns to the gate.
    if (state.lookFixed) return;
    const upload = uploading.current;
    const stageId = stageOptions[state.stage]?.id;
    const preset = looks[state.look]?.id;
    if (upload === null || stageId === undefined || preset === undefined) return;
    const render = startRender(upload, { stage: stageId, preset });
    rendering.current = render;
    void render.then((outcome) => {
      if (rendering.current !== render) return;
      if (outcome.ok) jobId.current = outcome.value;
      else if (outcome.kind === "lookLimit") void showOwnLook(outcome);
      else fail(outcome);
    });
  }

  function back() {
    if (backFrom(screen) === "home") location.assign("/");
    else send({ type: "back" });
  }

  // Both fields empty skips the gate; either one filled needs both.
  const { name, mobile } = state;
  const skipping = name.trim() === "" && mobile === "";
  const nameBad = gateTouched && !skipping && name.trim() === "";
  const mobileBad = gateTouched && !skipping && !isCompleteMobile(mobile);
  async function submitGate(event: Event) {
    event.preventDefault();
    if (sending) return;
    if (!skipping && (name.trim() === "" || !isCompleteMobile(mobile))) {
      setGateTouched(true);
      return;
    }
    if (demo) {
      send({ type: "shown", showing: state.showing, rendered: { url: props.mockAfter, file: null } });
      return;
    }

    setSending(true);
    setGateFailure(null);
    // The gate may open before the upload has finished; the claim needs the render started.
    const render = (await rendering.current) ?? ({ ok: false, kind: "busy", code: "no_render" } as const);
    if (!render.ok) {
      setSending(false);
      fail(render);
      return;
    }
    const returning = state.showing?.returning ?? false;
    if (skipping) {
      setSending(false);
      send({ type: "shown", showing: { jobId: render.value, claim: null, returning } });
      return;
    }
    const attribution = readAttribution();
    const claim = {
      job_id: render.value,
      name: name.trim(),
      mobile,
      ...(attribution === undefined ? {} : { attribution }),
    };
    const answer = await claimResult(claim, keyFor(claim));
    setSending(false);
    if (answer.ok) {
      send({ type: "shown", showing: { jobId: render.value, claim: answer.body, returning } });
      track({ name: "try_on_claimed" });
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
          <span class={`caps ${styles.stepLabel}`}>
            {screen === "error" ? tryOn.error.kinds[state.errorKind].step : tryOn.stepLabels[screen]}
          </span>
        </div>

        {screen === "upload" && <Upload photo={state.photo} heading={heading} onChoose={choosePhoto} />}
        {screen === "consent" && (
          <Consent
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
            fixed={state.lookFixed}
            heading={heading}
            onChoose={(look) => {
              send({ type: "lookChosen", look });
            }}
            onGenerate={generate}
          />
        )}
        {screen === "processing" && (
          <Processing
            heading={heading}
            onDone={() => {
              send({ type: "processed" });
            }}
          />
        )}
        {screen === "gate" && (
          <Gate
            name={name}
            mobile={mobile}
            nameBad={nameBad}
            mobileBad={mobileBad}
            failure={gateFailure}
            sending={sending}
            heading={heading}
            onName={(typed) => {
              send({ type: "nameTyped", name: typed });
            }}
            onMobile={(typed) => {
              send({ type: "mobileTyped", mobile: typed });
            }}
            onSubmit={(event) => void submitGate(event)}
          />
        )}
        {screen === "result" && (
          <Result
            photo={state.photo}
            mockBefore={props.mockBefore}
            look={state.look}
            showing={state.showing}
            rendered={state.rendered}
            demo={demo}
            mobile={mobile}
            heading={heading}
          />
        )}
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
