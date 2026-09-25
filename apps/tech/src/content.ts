// Every word the technician app shows, from design/phase2/Technician App.dc.html
// and, for the sign-in it does not draw, the Prototype's technician screen. A
// component holds no copy of its own. Lines neither file writes are marked
// PLACEHOLDER, pending the owner's wording.

export const signIn = {
  title: "Technician sign in",
  prefix: "+91",
  mobileLabel: "Mobile number",
  mobilePlaceholder: "98110 00000",
  mobileError: "Ten digits.",
  codeLabel: "Code",
  submit: "Sign in",
  // PLACEHOLDER: the Prototype draws one screen and no error but "Ten digits."
  errors: {
    mismatch: "That code did not match.",
    code_expired: "That code no longer works. Send the code again.",
    invalid_request: "Check the number and the code.",
    rate_limited: "Too many codes for this number today. Ask ops.",
    busy: "Codes are not going out just now. Try again shortly.",
    offline: "You are offline. Connect, then sign in.",
    unknown: "That did not go through. Try again.",
  },
  attemptsLeft: (left: number) => `That code did not match. ${String(left)} ${left === 1 ? "try" : "tries"} left.`,
  sendCode: "Send the code",
  // PLACEHOLDER: the Prototype shows the code field from the start.
  codeSent: "A six-digit code is on its way.",
  // PLACEHOLDER: the Prototype draws no way back from a code sent to the wrong number, or one that never came.
  changeNumber: "Change number",
  resend: "Send a new code",
  resendIn: (seconds: number) => `New code in ${String(seconds)} s`,
  // PLACEHOLDER: neither file draws the app opened from the home screen. An
  // installed iPhone app has its own cookie jar, so the first sign-in inside it
  // is a second one and looks like the account has gone (ADR 0053's update).
  installed:
    "This is the app on your home screen, and it signs in separately from the browser. Sign in once more here and use this one from now on. Anything the browser was still sending goes up from the browser.",
} as const;

export const today = {
  jobs: (count: number) => `${String(count)} ${count === 1 ? "job" : "jobs"} today`,
  first: (time: string, sector: string) => `First at ${time} · ${sector}`,
  tomorrow: (count: number) => `Tomorrow · ${String(count)} ${count === 1 ? "job" : "jobs"}`,
  signOut: "Sign out",
  empty: {
    label: "No jobs",
    title: "Nothing booked for today",
    tomorrow: (count: number, time: string) =>
      `Tomorrow you have ${String(count)} ${count === 1 ? "job" : "jobs"}, first at ${time}.`,
    // PLACEHOLDER: the board draws the line with a job tomorrow only.
    none: "Nothing tomorrow either.",
  },
  offline: {
    title: "No signal · working offline",
    body: "Today's jobs and cards are on the phone. Photos go up when signal returns.",
  },
  // PLACEHOLDER: the board draws no failure for the day's list.
  failed: "The day's jobs did not load.",
  retry: "Try again",
} as const;

/** "1 photo set", "3 actions": a count and the word for it. */
const counted = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/**
 * Signing out wipes the phone, so it asks first when there is work on it that
 * has not reached us, and says so when there is no signal to sign out with.
 */
export const leaving = {
  // PLACEHOLDER: neither file draws a sign-out with work still on the phone, or with no signal.
  unsent: (sets: number, actions: number) => {
    const held: string[] = [];
    if (sets > 0) held.push(counted(sets, "photo set", "photo sets"));
    if (actions > 0) held.push(counted(actions, "action", "actions"));
    return `${held.join(" and ")} not sent yet`;
  },
  body: "Signing out deletes them from this phone, and they never reach us.",
  send: "Send first",
  anyway: "Sign out anyway",
  stayed: "No signal, so you are still signed in and nothing was deleted. Sign out again once there is signal.",
} as const;

/** When the phone has no room left for what the app must keep: a photograph, a step. */
export const storage = {
  // PLACEHOLDER: neither file draws a phone that is full.
  title: "This phone's storage is full",
  body: "Nothing more can be kept on it until there is room. Delete photos or apps you do not need, then try again.",
} as const;

/** A screen that failed to draw, which React would otherwise leave blank. */
export const broken = {
  // PLACEHOLDER: neither file draws a screen that failed.
  message: "This screen did not open. Nothing you recorded is lost.",
  reload: "Reload",
} as const;

/**
 * When the phone would not promise to keep what the outbox holds: a warning,
 * not an error. Nothing is lost yet, and getting to signal is what saves it
 * (apps/tech/src/store/persist.ts).
 */
export const atRisk = {
  // PLACEHOLDER: neither file draws a phone that will not promise to keep its store.
  title: "This phone has not promised to keep unsent work",
  body: "Get to signal today and let the queue empty. A phone left unused for weeks can clear it.",
} as const;

export const queue = {
  waiting: (count: number) => `${String(count)} photo ${count === 1 ? "set" : "sets"} waiting`,
  never: "Never written to this phone's gallery.",
  retry: "Retry",
  states: {
    uploading: "Uploading",
    waiting: "Waiting",
    failed: "Failed",
  },
  count: (done: number, total: number) => `${String(done)} of ${String(total)}`,
  // PLACEHOLDER: the board draws the photo sets; these name the writes beside them.
  title: "Waiting to reach us",
  nothing: "Everything has reached us.",
  events: (count: number) => `${String(count)} ${count === 1 ? "action" : "actions"} waiting`,
  read: "Got it",
  back: "Back",
  // PLACEHOLDER: the board draws the sets, not how long they have been waiting.
  since: (time: string) => `Waiting since ${time}`,
} as const;

/**
 * What a job's queue stopped for. The API answers a stable code and, on a 409,
 * the fields that moved under the phone — never a sentence — so these are the
 * app's words for each code it can meet (docs/api-tech.md).
 */
export const stopped: Readonly<Record<string, string>> = {
  // PLACEHOLDER: the design writes "Ops moved this job to Sandeep at 10:40", which needs a name and a time nothing gives.
  superseded: "This job changed while the phone was offline.",
  technician: "This job is someone else's now.",
  status: "This job was cancelled while the phone was offline.",
  out_of_order: "A step reached us before the one ahead of it.",
  photo_rejected: "The photographs would not upload.",
  not_found: "We no longer have this job.",
  invalid_request: "We could not record this.",
  unknown: "We could not record this.",
} as const;

export const job = {
  back: "Back",
  when: (time: string, type: string) => `${time} · ${type}`,
  navigate: "Navigate",
  start: "Start job",
  continueJob: "Continue",
  locked: {
    title: "Not yet",
    body: "The address and the client's card open the day before.",
  },
  // PLACEHOLDER: the board draws no failure for a job's card.
  failed: "This job's card did not load.",
  retry: "Try again",
} as const;

/** Board B5: the evidence chain when the client is not home. */
export const notHome = {
  arrived: {
    step: "1 · Arrived",
    body: "Tap at the door. We record the time and check you are within 200 m.",
    action: "I have arrived",
    // PLACEHOLDER: the board draws no screen for a phone that will not give its position.
    noPosition: "This phone will not give its position. Check its permissions, then tap again.",
    // PLACEHOLDER: the board draws the check running, not one waiting for signal.
    queued: "No signal. The time is on the phone and the check runs when signal returns.",
  },
  failed: {
    title: "Check-in failed",
    away: (km: string) => `You are ${km} from the address.`,
    // PLACEHOLDER: the board draws a distance; an address with no coordinates has none (ADR 0036).
    unmeasured: "We could not measure how far you are from the address.",
    body: "Get to the door and tap again. No-show cannot be recorded from here.",
    action: "Try again",
  },
  waiting: {
    step: "2 · Waiting",
    left: (minutes: number) => `left of ${String(minutes)} minutes`,
    close: "Close as no-show",
    // PLACEHOLDER: the board shows the day-before WhatsApp's delivery receipt, which no route gives a technician.
    evidence: "Ops get the check-in time and the distance.",
  },
  appears: {
    title: "He appears",
    atTheDoor: (who: string) => `${who} is at the door`,
    body: "The timer stops. Nothing is charged.",
  },
} as const;

export const capture = {
  back: "Back",
  before: "Before photos",
  after: "After photos",
  retake: "Retake",
  take: "Capture",
  angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hair" },
  // The design writes this line for Top; it stands for each angle until the owner writes the other four.
  guide: (angle: string) => `${angle} · line up the hairline`,
  // PLACEHOLDER: the board draws neither a refused camera nor the finished set.
  unavailable: "This phone will not open its camera. Check its permissions, then try again.",
  retry: "Try again",
  // PLACEHOLDER: the board draws no capture that failed.
  missed: "That photograph did not keep. Capture it again.",
  done: "All five are on the phone. They go up when there is signal.",
  finish: "Done",
} as const;

/** The six in-job steps (board B), in the order the API runs them. */
export const steps = {
  back: "Back",
  of: (done: number, total: number) => `${String(done)} of ${String(total)}`,
  titles: {
    before_photos: "Before photos",
    checklist: "Service checklist",
    consumables: "Consumables used",
    piece: "The piece",
    after_photos: "After photos",
    outcome: "Outcome",
  },
  // PLACEHOLDER: the board names no step but the one it draws.
  next: "Next",
  checklist: {
    // The board's dim bar while the list is unfinished.
    unfinished: "Finish the list to continue",
  },
  consumables: {
    less: (name: string) => `One fewer ${name.toLowerCase()}`,
    more: (name: string) => `One more ${name.toLowerCase()}`,
    // PLACEHOLDER: FSM holds no consumables catalogue, so the board's four stand in (open point 13).
    items: ["Tape strips", "Bonding glue", "Solvent", "Shampoo sachet"],
    none: "None used",
  },
  piece: {
    // The owner ruled out a barcode and a QR code on 24 September 2026, so the code is typed, never scanned.
    label: "The label code",
    placeholder: "MM-STD-4417-B",
    look: "Check the label",
    unknown: "We do not know that label. It goes on the job as you typed it.",
    notThisClient: "That piece is not this client's.",
    rows: { piece: "Piece", base: "Base", lot: "Supplier lot" },
    // PLACEHOLDER: the board draws no empty base; the piece may not be in the mirror yet.
    unnamed: "Not recorded",
  },
  outcome: {
    done: "Done",
    partial: "Partial · pick a reason",
    // PLACEHOLDER: the design lists four other reasons; these are the four the API takes (src/config/job-sheet.ts).
    reasons: {
      client_stopped_it: "Client stopped it partway",
      piece_not_ready: "The piece was not ready",
      client_unwell: "Client unwell",
      more_time_needed: "More time needed",
    },
  },
} as const;

/** Board B4's close-out, once the outcome is taken. */
export const closeOut = {
  label: "Closed out",
  who: (name: string, outcome: string) => `${name} · ${outcome}`,
  outcomes: { done: "done", partial: "partial", no_show: "no-show" },
  duration: "Duration",
  // PLACEHOLDER: the board writes "1 h 22 m"; the phone times it from Start job (open point 57).
  length: (hours: number, minutes: number) =>
    hours === 0 ? `${String(minutes)} m` : `${String(hours)} h ${String(minutes)} m`,
  photos: "Photos",
  queued: (count: number) => `${String(count)} queued`,
  sent: (count: number) => `${String(count)} sent`,
  nextJob: (time: string, who: string) => `Next job · ${time}, ${who}`,
  // PLACEHOLDER: the board draws the next job; the day ends without one.
  lastJob: "Back to today",
} as const;

/** The badge, and nothing else about money, anywhere in this app. */
export const badges = {
  prepaid: "Prepaid",
  credit: "Credit",
  free: "Free",
} as const;

export const types = {
  consultation: "Consultation",
  service: "Service",
  replacement: "Replacement",
  first_fit: "First fit",
} as const;

/** The job card writes the type in lower case, in its line: "9:30 am · service" (board A3). */
export const typesLower = {
  consultation: "consultation",
  service: "service",
  replacement: "replacement",
  first_fit: "first fit",
} as const;

export const session = {
  // PLACEHOLDER: neither file draws a revoked device.
  revoked: "This phone is no longer signed in. Ask ops, then sign in again.",
  checking: "Loading",
} as const;
