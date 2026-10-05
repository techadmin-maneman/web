// The work behind the try-on's gate (./Gate.tsx): the name and number checked, a WhatsApp code to prove the number
// (../useNumberCode.ts), the claim that saves where the look goes, and only then the look asked for. A refusal the
// visitor can act on is a line on the gate, or marks the field it names; any other goes to the error screen.

import { useMemo, useRef, useState } from "preact/hooks";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { isPersonName } from "@maneman/web-kit/names";
import type { TurnstileWidget } from "@maneman/web-kit/turnstile";
import { looks, notices, stageOptions, tryOn } from "../../content/site.ts";
import { track } from "../../lib/analytics.ts";
import { claimLook, jobStatus, type ErrorCode } from "../../lib/api.ts";
import { keyPerRequest } from "../../lib/idempotency.ts";
import { startRender, type Outcome, type Uploaded } from "../../lib/tryon.ts";
import { jobProblem, type Failure } from "../../lib/tryon-errors.ts";
import { readAttribution } from "../../lib/visit.ts";
import { useInvalidFocus } from "../useInvalidFocus.ts";
import { useNumberCode } from "../useNumberCode.ts";
import type { GateCode } from "./Gate.tsx";
import type { TryOnEvent, TryOnState } from "./machine.ts";

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

/** What the gate needs from the rest of the try-on. */
interface TryOnWork {
  readonly state: TryOnState;
  readonly send: (event: TryOnEvent) => void;
  /** The current photograph's upload, which the claim waits for. */
  readonly uploading: { readonly current: Promise<Outcome<Uploaded>> | null };
  /** The render's job, which the sent screen watches. */
  readonly jobId: { current: string | null };
  readonly turnstile: { readonly current: TurnstileWidget | null };
  readonly fail: (failure: Failure) => void;
  /** A refused upload or render. */
  readonly refused: (failure: Failure) => void;
}

export function useGate({ state, send, uploading, jobId, turnstile, fail, refused }: TryOnWork) {
  const { demo, name, mobile } = state;
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The gate's fields the last refusal named.
  const [named, setNamed] = useState<readonly string[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const showInvalid = useInvalidFocus(form);
  const numberCode = useNumberCode();
  const keyFor = useMemo(keyPerRequest, []);
  // The try-on whose claim analytics has counted.
  const claimCounted = useRef<string | null>(null);

  /** A refusal that names the gate's fields marks them and focuses the first; false when it names none. */
  function markRefused(code: ErrorCode | "network", fields: readonly string[]): boolean {
    const marked = code === "invalid_request" ? fields.filter((field) => GATE_FIELDS.includes(field)) : [];
    setNamed(marked);
    if (marked.length === 0) return false;
    showInvalid();
    return true;
  }

  /** A field the API refused is no longer marked once it has been changed. */
  function unmark(field: string) {
    setNamed((marked) => marked.filter((each) => each !== field));
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
    if (code === "invalid_request") setTouched(true);
    if (markRefused(code, fields)) return;
    setFailure(GATE_REFUSALS[code] ?? tryOn.gate.errors.other);
  }

  /**
   * The claim saves where the look goes, and then the look is asked for. Pressed again after an answer was lost, the
   * claim carries the same key, so the API answers it as the first, and the render is asked again.
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
    if (render.code === "network") setFailure(tryOn.gate.errors.other);
    else refused(render);
  }

  /** A WhatsApp code to the number typed, under a fresh Turnstile token. */
  async function askForCode(digits: string) {
    setSending(true);
    setFailure(null);
    setNamed([]);
    const token = (await turnstile.current?.token()) ?? null;
    if (token === null) {
      setFailure(tryOn.gate.errors.turnstile);
      setSending(false);
      return;
    }
    const answer = await numberCode.ask(digits, name.trim(), token);
    void turnstile.current?.renew();
    setSending(false);
    if (answer.ok || markRefused(answer.code, answer.fields)) return;
    setFailure(CODE_REFUSALS[answer.code] ?? tryOn.gate.errors.other);
  }

  /** The code's ID once it has proved the number; until then, a code is sent, or the one typed is checked. */
  async function provedNumber(digits: string): Promise<string | null> {
    const proved = numberCode.proofFor(digits);
    if (proved !== null) return proved;
    if (numberCode.waitingFor(digits)) return numberCode.confirm();
    await askForCode(digits);
    return null;
  }

  async function submit(event: Event) {
    event.preventDefault();
    if (sending || numberCode.checking) return;
    const digits = mobileDigits(mobile);
    if (!isPersonName(name) || digits === null) {
      setTouched(true);
      setFailure(null);
      showInvalid();
      return;
    }
    if (demo) {
      send({ type: "sent" });
      return;
    }

    setFailure(null);
    setNamed([]);
    const numberCodeId = await provedNumber(digits);
    if (numberCodeId === null) return;
    setSending(true);
    // The gate may open before the upload has finished; the claim needs the photograph uploaded.
    const upload = (await uploading.current) ?? ({ ok: false, kind: "busy", code: "no_upload" } as const);
    if (upload.ok) await claimAndRender(upload.value, digits, numberCodeId);
    else refused(upload);
    setSending(false);
  }

  function askAgain(event: Event) {
    event.preventDefault();
    const digits = mobileDigits(mobile);
    if (sending || digits === null) return;
    void askForCode(digits);
  }

  const digitsTyped = mobileDigits(mobile);
  const codeWaiting = digitsTyped !== null && numberCode.waitingFor(digitsTyped);
  const code: GateCode | null = codeWaiting
    ? {
        value: numberCode.code,
        failure: numberCode.failure,
        checking: numberCode.checking,
        onInput: numberCode.setCode,
        onAgain: askAgain,
      }
    : null;

  return {
    name,
    mobile,
    nameBad: (touched && !isPersonName(name)) || named.includes("name"),
    mobileBad: (touched && mobileDigits(mobile) === null) || named.includes("mobile"),
    failure,
    sending,
    code,
    form,
    onName: (typed: string) => {
      unmark("name");
      send({ type: "nameTyped", name: typed });
    },
    onMobile: (typed: string) => {
      unmark("mobile");
      send({ type: "mobileTyped", mobile: typed });
    },
    onSubmit: (event: Event) => void submit(event),
  };
}
