// The try-on, on the API. The photograph is taken or chosen, and looked at
// before it is used (Upload.tsx), which agrees to the photo notice in its one
// line (ADR 0219); it is prepared in the browser (lib/photo.ts) and uploads
// while the visitor chooses a look. The gate then asks where to send
// the look, a WhatsApp code proves the number (useNumberCode.ts), the claim saves
// it, and only then is the look made. The sent screen says it is on its way, and
// watches the render until it is ready, to show it here too (ADR 0214), or in
// case it fails. A visitor who has had their look is shown it while it is kept,
// and a visitor arriving while WhatsApp cannot send a look is told the try-on is
// not available.
//
// The screens and what moves between them are machine.ts, the render's watch
// hooks.ts, the gate's claim and render useGate.ts, and each screen draws
// itself. This file does the work between: the photograph and the upload.
//
// Outside production, ?state=<screen> opens a screen directly, with stand-ins
// and no API calls, for the fidelity screenshots and the browser tests
// (machine.ts lists the kinds each screen takes).

import { capsLook } from "@maneman/ui/Caps";
import { TextButton } from "@maneman/ui/TextLink";
import { useEffect, useReducer, useRef } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import { turnstileWidget, type TurnstileWidget } from "@maneman/web-kit/turnstile";
import { notices, tryOn, tryOnSendsCopy } from "../../content/site.ts";
import { track } from "../../lib/analytics.ts";
import { preparePhoto, type PreparedPhoto } from "../../lib/photo.ts";
import { onArrival, startUpload, type Arrival, type Outcome, type Uploaded } from "../../lib/tryon.ts";
import type { Failure } from "../../lib/tryon-errors.ts";
import { Icon } from "@maneman/ui/Icon";
import { Failed } from "./Failed.tsx";
import { Gate } from "./Gate.tsx";
import { useReleased, useRenderWatch, useScreenHistory } from "./hooks.ts";
import { Looks } from "./Looks.tsx";
import { backFrom, screenNamed, START, step, type Screen } from "./machine.ts";
import { Sent } from "./Sent.tsx";
import styles from "./TryOn.module.css";
import { Upload } from "./Upload.tsx";
import { useGate } from "./useGate.ts";
import { IslandBoundary } from "../IslandBoundary.tsx";

interface Props {
  turnstileSiteKey: string;
  /** Allow ?state= to open a screen directly (never in production). */
  allowStateSwitch: boolean;
  /** The look picker's pictures, in the looks' order, or null until every look has one. */
  lookThumbnails: readonly string[] | null;
}

/**
 * The page's Turnstile widget: made once a photograph is used, not as the page loads, so no challenge runs for a page
 * only looked at; it goes with the page.
 */
function usePhotoWidget(screen: Screen, siteKey: string) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<TurnstileWidget | null>(null);
  useEffect(() => {
    if (screen === "upload" || widget.current !== null || box.current === null) return;
    widget.current = turnstileWidget(box.current, siteKey, "dark");
  }, [screen, siteKey]);
  useEffect(
    () => () => {
      void widget.current?.remove();
    },
    [],
  );
  return { box, widget };
}

function TryOnFlow(props: Props) {
  const [state, send] = useReducer(step, START);
  const { screen, demo } = state;
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const { box: turnstileBox, widget: turnstile } = usePhotoWidget(screen, props.turnstileSiteKey);
  // The current photograph's work. Each is replaced when a new photograph is chosen.
  const preparing = useRef<Promise<PreparedPhoto> | null>(null);
  const uploading = useRef<Promise<Outcome<Uploaded>> | null>(null);
  const jobId = useRef<string | null>(null);
  // What the API says on arrival. A photograph chosen before it answers drops it.
  const arriving = useRef<Promise<Arrival> | null>(null);

  function fail(failure: Failure) {
    send({ type: "failed", kind: failure.kind });
    if (!demo) track({ name: "try_on_failed", failure_code: failure.code });
  }

  /** A refused upload or render: a browser that has had its look is told it was sent; anything else is an error. */
  function refused(failure: Failure) {
    if (failure.code === "look_limit_reached") send({ type: "alreadySent", look: null });
    else fail(failure);
  }

  const gate = useGate({ state, send, uploading, jobId, turnstile, fail, refused });

  // ?state= opens a screen with stand-ins, outside production. Otherwise the API is asked whether this browser has
  // had its look and whether the try-on runs, so the visitor is not asked for a photograph the API would refuse.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = screenNamed(props.allowStateSwitch ? params.get("state") : null);
    if (wanted !== undefined) {
      send({ type: "preview", screen: wanted, kind: params.get("kind") });
      return;
    }
    const asked = onArrival();
    arriving.current = asked;
    void asked.then((arrival) => {
      if (arriving.current !== asked) return;
      if (arrival.kind === "hadLook") send({ type: "alreadySent", look: arrival.look });
      if (arrival.kind === "unavailable") send({ type: "failed", kind: "unavailable" });
    });
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

  useEffect(() => {
    if (screen === "gate" && !demo) track({ name: "try_on_gate_shown" });
  }, [screen, demo]);

  // Once the look is on its way, a render that fails sends the visitor to the error screen; one ready is shown.
  const look = useRenderWatch(!demo && screen === "sent" && !state.returning, jobId, fail);
  const wroteHistory = useScreenHistory(screen, send, !demo);

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

  // The photograph used goes up as the looks open, once the widget it needs is made (usePhotoWidget, above).
  useEffect(() => {
    const prepared = preparing.current;
    if (screen !== "looks" || prepared === null || uploading.current !== null) return;
    const upload = startUpload(prepared, turnstile.current, notices.photo.version);
    uploading.current = upload;
    // A refusal shows at once, rather than after the visitor has chosen a look.
    void upload.then((outcome) => {
      if (!outcome.ok && uploading.current === upload) refused(outcome);
    });
  });

  function back() {
    if (backFrom(screen) === "home") location.assign("/");
    else if (wroteHistory()) history.back();
    else send({ type: "back" });
  }

  return (
    <div class={`${styles.flow} on-ink`} data-screen={screen}>
      <div class={styles.track}>
        <div class={`${styles.progress} ${styles[`progress-${screen}`]}`} />
      </div>
      <div class={styles.inner}>
        <div class={styles.topline}>
          <TextButton tone="ink" className={styles.back} onClick={back}>
            <Icon d={ICONS.back} size="sm" />
            {backFrom(screen) === "home" ? tryOn.backToSite : tryOn.back}
          </TextButton>
          <span class={capsLook(styles.stepLabel)}>
            {screen === "error" ? tryOn.error.kinds[state.errorKind].step : tryOn.stepLabels[screen]}
          </span>
        </div>

        {/* Turnstile shows here only if Cloudflare needs the visitor to act: above the step, before its button. */}
        <div ref={turnstileBox} class={styles.turnstile} />

        {screen === "upload" && <Upload photo={state.photo} heading={heading} onChoose={choosePhoto} />}
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
        {screen === "gate" && <Gate notice={notices.gate} heading={heading} {...gate} />}
        {screen === "sent" && <Sent state={state} look={look ?? state.returnedLook} heading={heading} />}
        {screen === "error" && (
          <Failed
            kind={state.errorKind}
            heading={heading}
            onAgain={() => {
              send({ type: "again" });
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The island as the page mounts it: a throw while it draws is reported, and the way to us shown in its place. */
export default function TryOn(props: Props) {
  return (
    <IslandBoundary>
      <TryOnFlow {...props} />
    </IslandBoundary>
  );
}
