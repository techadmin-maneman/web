// Every word the technician app shows, from design/phase2/Technician App.dc.html
// and, for the sign-in it does not draw, the Prototype's technician screen. A
// component holds no copy of its own. Lines neither file writes are
// ours.

import type { Moved } from "@maneman/web-kit/api";
import { shortDate } from "@maneman/web-kit/dates";
import type { Angle, FitSpec, History } from "./api.ts";
import { clock, dayAfter, dayMonth, todayInIndia } from "./lib/when.ts";

export const signIn = {
  title: "Technician sign in",
  prefix: "+91",
  mobileLabel: "Mobile number",
  mobilePlaceholder: "98110 00000",
  mobileError: "Enter your ten-digit mobile number.",
  codeLabel: "Code",
  submit: "Sign in",
  // The Prototype draws one screen and no errors.
  errors: {
    mismatch: "That code didn’t match.",
    code_expired: "That code no longer works. Send the code again.",
    invalid_request: "Check the number and the code.",
    rate_limited: "Too many codes for this number today. Ask ops.",
    sign_in_stopped: "Ops have stopped sign-in on your number. Ask them to let you back in.",
    busy: "Codes aren’t going out right now. Try again shortly.",
    offline: "You’re offline. Reconnect, then sign in.",
    unknown: "That didn’t go through. Try again.",
  },
  attemptsLeft: (left: number) => `That code didn’t match. ${String(left)} ${left === 1 ? "try" : "tries"} left.`,
  sendCode: "Send the code",
  // The Prototype shows the code field from the start.
  codeSent: "A six-digit code is on its way.",
  // The Prototype draws no way back from a code sent to the wrong number, or one that never came.
  changeNumber: "Change number",
  resend: "Send a new code",
  resendIn: (seconds: number) => `New code in ${String(seconds)} s`,
  // Neither file draws the app opened from the home screen. An
  // installed iPhone app has its own cookie jar, so the first sign-in inside it
  // is a second one and looks like the account has gone (ADR 0053's update).
  installed: "Sign in here once, then use the home-screen app. Anything waiting in the browser still sends.",
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
    // The board draws the line with a job tomorrow only.
    none: "Nothing tomorrow either.",
  },
  offline: {
    title: "No signal · working offline",
    body: "Today’s jobs and cards are on the phone. Photos go up when signal returns.",
  },
  // The board draws no failure for the day's list.
  failed: "The day’s jobs didn’t load.",
  retry: "Try again",
} as const;

/** "1 photo set", "3 actions": a count and the word for it. */
const counted = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;

/** "top", "top and left", "top, left and hair". */
const listed = (words: readonly string[]) => new Intl.ListFormat("en-IN", { type: "conjunction" }).format(words);

/**
 * Signing out wipes the phone, so it asks first when there is work on it that
 * has not reached us, and says so when there is no signal to sign out with.
 */
export const leaving = {
  // Neither file draws a sign-out with work still on the phone, or with no signal.
  unsent: (sets: number, actions: number) => {
    const held: string[] = [];
    if (sets > 0) held.push(counted(sets, "photo set", "photo sets"));
    if (actions > 0) held.push(counted(actions, "action", "actions"));
    return `${held.join(" and ")} not sent yet`;
  },
  body: "Signing out deletes them from this phone, and they never reach us.",
  send: "Send first",
  anyway: "Sign out anyway",
  stayed: "No signal. You’re still signed in and nothing was deleted. Try again with signal.",
} as const;

/** When the phone has no room left for what the app must keep: a photograph, a step. */
export const storage = {
  // Neither file draws a phone that is full.
  title: "This phone’s storage is full",
  body: "Free up space by deleting photos or apps you don’t need, then try again.",
} as const;

/** A screen that failed to draw, which React would otherwise leave blank. */
export const broken = {
  // Neither file draws a screen that failed.
  message: "This screen didn’t open. Nothing you recorded is lost.",
  reload: "Reload",
} as const;

/** A failed call's reference, to quote to ops. */
export const reference = { label: "Ref", copy: "Copy", copied: "Copied" } as const;

/**
 * When the phone would not promise to keep what the outbox holds: a warning,
 * not an error. Nothing is lost yet, and getting to signal is what saves it
 * (apps/tech/src/store/persist.ts).
 */
export const atRisk = {
  // Neither file draws a phone that will not promise to keep its store.
  title: "Unsent work could be lost",
  body: "Get to signal today so everything sends.",
} as const;

export const queue = {
  waiting: (count: number) => `${String(count)} photo ${count === 1 ? "set" : "sets"} waiting`,
  never: "Never saved to this phone’s gallery.",
  retry: "Retry",
  states: {
    uploading: "Uploading",
    waiting: "Waiting",
    failed: "Failed",
  },
  // The board writes "7 of 10"; each set is counted on its own, by the photographs the API confirmed.
  phases: { before: "Before photos", after: "After photos" },
  sent: (phase: string, done: number, total: number) => `${phase} · ${String(done)} of ${String(total)} sent`,
  taking: (phase: string, taken: number, total: number) => `${phase} · ${String(taken)} of ${String(total)} taken`,
  // The board draws the photo sets; these name the writes beside them.
  title: "Waiting to reach us",
  nothing: "Everything has reached us.",
  events: (count: number) => `${String(count)} ${count === 1 ? "action" : "actions"} waiting`,
  // The board draws no step the API refused, and no way to put one right.
  correct: "Correct it",
  retake: "Retake photos",
  back: "Back",
  // The board draws the sets, not how long they have been waiting.
  since: (time: string) => `Waiting since ${time}`,
  // The board draws no deletion. It lets go of work, so it asks first.
  forget: {
    open: "Delete this job’s work",
    title: "Delete this job’s work?",
    what: (photos: number, actions: number) => {
      const held: string[] = [];
      if (photos > 0) held.push(counted(photos, "photo", "photos"));
      if (actions > 0) held.push(counted(actions, "action", "actions"));
      return `This deletes ${held.join(" and ")} from this phone.`;
    },
    body: "They never reach us. Tell ops if the client should hear about it.",
    keep: "Keep them",
    delete: "Delete them",
  },
} as const;

/**
 * What a job's queue stopped for. The API answers a stable code and, on a 409
 * or a 400, the fields that moved under the phone or that it refused — never a
 * sentence — so these are the app's words for each it can meet
 * (docs/api-tech.md). A field is named in preference to the code.
 */
const stopped: Readonly<Record<string, string>> = {
  // The 409 names the fields that moved and never their values. The new time, once the card read again
  // carries it, and whom a job went to are named by whatStopped below.
  superseded: "This job changed while the phone was offline.",
  technician: "This job is someone else’s now.",
  time: "Ops moved this job to another time.",
  status: "This job was cancelled while the phone was offline.",
  out_of_order: "A step arrived out of order.",
  not_today: "This job is on another day. Arrive and start it on the day.",
  too_early_to_arrive: "Too early for this job. Tap again from the time on its card.",
  already_started: "This job was started, so it can’t close as a no-show.",
  photo_rejected: "The photos wouldn’t upload.",
  not_found: "This job is no longer on your list, so what it holds can’t reach us.",
  already_closed: "This job is closed, so what it holds can’t reach us.",
  piece_code: "The piece’s label wasn’t accepted.",
  old_piece: "The label of the piece that came off wasn’t accepted.",
  // A one visit's product, no longer offered when the step reached us (ADR 0105).
  product: "That product isn’t offered that day.",
  done: "A checklist item wasn’t recognised.",
  reason: "That reason wasn’t accepted.",
  invalid_request: "We couldn’t record this.",
  unknown: "We couldn’t record this.",
} as const;

/**
 * The prompt's words for a job given to another technician, "Ops moved this job
 * to Sandeep at 10:40": their first name, and when, as the API said (open
 * point 92). A move made on another day names the day, and one with no time
 * recorded has none.
 */
function movedTo(moved: Moved, now: Date): string {
  // The prompt's example has a time on the day; the line without one, and the one with a day, are ours.
  if (moved.at === null) return `Ops moved this job to ${moved.technician}.`;
  const day = todayInIndia(new Date(moved.at));
  const time = clock(moved.at);
  if (day === todayInIndia(now)) return `Ops moved this job to ${moved.technician} at ${time}.`;
  return `Ops moved this job to ${moved.technician} on ${dayMonth(day)} at ${time}.`;
}

/** "6 pm today", "9 am tomorrow", "9 am on Mon 5 Oct". */
function timeAndDay(isoInstant: string, now: Date): string {
  const time = clock(isoInstant);
  const date = todayInIndia(new Date(isoInstant));
  const today = todayInIndia(now);
  if (date === today) return `${time} today`;
  if (date === dayAfter(today)) return `${time} tomorrow`;
  return `${time} on ${shortDate(date)}`;
}

interface Why {
  readonly note: string | null;
  readonly fields: readonly string[];
  readonly moved?: Moved | null;
  /** The job's start as the phone held it when the stopped write was queued. */
  readonly startsAt?: string | null;
}

/** Whether the card the phone now holds starts at another time than the stopped write was sent with. */
function startMoved(why: Why, startsNow: string | null): startsNow is string {
  const startsAt = why.startsAt ?? null;
  return startsAt !== null && startsNow !== null && startsAt !== startsNow;
}

/**
 * What stopped a job's queue, in the app's words: the fields named if the API
 * named any, else the code. A job the API says went to another technician names
 * them; a job moved to another time names the new one once `startsNow`, the
 * start on the card the phone holds, differs; a cancellation is named first.
 */
export function whatStopped(why: Why, now: Date = new Date(), startsNow: string | null = null): string {
  const field = why.fields.find((each) => stopped[each] !== undefined);
  const moved = why.moved ?? null;
  if (field === "technician" && moved !== null) return movedTo(moved, now);
  // The prompt words a move to another technician; this one, to another time, is ours.
  if (field === "time" && startMoved(why, startsNow)) return `Ops moved this job to ${timeAndDay(startsNow, now)}.`;
  return stopped[field ?? why.note ?? ""] ?? stopped.unknown ?? "";
}

/** The banner above every screen while a job's queue is stopped. */
export const changed = {
  // The board draws what changed on the queue alone.
  line: (job: string, what: string) => `${job}: ${what}`,
  // A job the phone holds nothing of, not even its time.
  someJob: "A job",
  open: "See what is waiting",
} as const;

/** Each screen's name in the browser's title, after which the app's own. */
export const titles = {
  app: "Mane Man technician",
  today: "Today",
  closeOut: "Closed out",
  of: (screen: string) => `${screen} · Mane Man technician`,
} as const;

/** When a locked card opens. One that opened while the screen was up says to open the job again. */
function opensAt(unlocksAt: string, now: Date = new Date()): string {
  if (Date.parse(unlocksAt) > now.getTime()) return `Opens at ${timeAndDay(unlocksAt, now)}.`;
  return `Open since ${timeAndDay(unlocksAt, now)}. Go back and open the job again.`;
}

export const job = {
  back: "Back",
  /** "9:30 am · service · 90 min", and "Tomorrow · …" for a job on another day. */
  when: (parts: readonly string[]) => parts.join(" · "),
  tomorrow: "Tomorrow",
  // The board writes "1 slot"; the visit's length says more.
  minutes: (count: number) => `${String(count)} min`,
  navigate: "Navigate",
  // The design draws no landmark; the client types it as they like, so it shows as typed.
  landmark: "Landmark",
  // The design draws no client's note; the client leaves one in their app.
  clientNote: (who: string, note: string) => `${who}’s note: ${note}`,
  // The board draws no way to reach the client from the card.
  call: (who: string) => `Call ${who}`,
  whatsApp: (who: string) => `WhatsApp ${who}`,
  start: "Start job",
  continueJob: "Continue",
  // The board draws no job's state on its card or its row.
  states: { inProgress: "In progress", closed: "Closed out" },
  closedAs: (outcome: string) => `Closed out · ${outcome}`,
  seeCloseOut: "See the close-out",
  notToday: {
    tomorrow: "This job is tomorrow. Arrive and start it on the day.",
    other: "This job isn’t today’s. Arrive and start it on its day.",
  },
  // The board draws what changed on the queue alone.
  changed: {
    title: "This job changed",
    body: "This phone can send nothing more for it. Waiting to reach us shows what it still holds.",
  },
  locked: {
    title: "Not yet",
    // The board draws no locked card. The hour is the API's unlocks_at.
    opens: opensAt,
  },
  // The board draws the profile's rows inside the piece card; they are a section of their own.
  profileTitle: "Hair profile",
  piece: {
    title: "The piece",
    // The board's piece card reads tier, colour, adhesive, template and scalp, which nothing records.
    // The board draws no "Paid for" row, nor a warning when the hair profile names another product.
    mismatch: (inProfile: string) => `The hair profile says ${inProfile}. Check with ops before you fit.`,
    rows: {
      paidFor: "Paid for",
      piece: "Piece",
      base: "Base",
      lot: "Supplier lot",
      fitted: "Fitted",
      due: "Replacement due",
    },
    none: "No piece recorded for this client yet.",
    lastVisit: (date: string, who: string | null) =>
      who === null ? `Last visit, after. ${date}.` : `Last visit, after. ${date}, ${who}.`,
    lastVisitImage: "Last visit, after",
  },
  // The board draws no failure for a job's card.
  failed: "This job’s card didn’t load.",
  retry: "Try again",
} as const;

/** The evidence chain when the client is not home. */
export const notHome = {
  arrived: {
    step: "1 · Arrived",
    // The board writes 200 m; the radius is ops' to set, and a card kept by an earlier build has none.
    body: (radiusM: number | null) =>
      radiusM === null
        ? "Tap at the door. We record the time and check you are at the address."
        : `Tap at the door. We record the time and check you are within ${String(radiusM)} m.`,
    action: "I have arrived",
    // The board draws no check-in before its time.
    opensAt: (time: string) => `Check-in opens at ${time}.`,
    // The board draws no screen for a phone that will not give its position.
    noPosition: "This phone won’t give its position. Check its permissions, then tap again.",
  },
  failed: {
    title: "Check-in failed",
    away: (km: string) => `You are ${km} from the address.`,
    // The board draws a distance; an address with no coordinates has none (ADR 0036).
    unmeasured: "We couldn’t measure how far you are from the address.",
    body: "Go to the door and tap again. Still refused? Ask ops to let you check in. A no-show needs a check-in.",
    action: "Try again",
  },
  waiting: {
    step: "2 · Waiting",
    left: (minutes: number) => `left of ${String(minutes)} minutes`,
    // The board draws no arrival before the booked start.
    fromStart: (time: string) => `The wait starts at ${time}, the booked start.`,
    // The board draws the wait running, not the moment it ends.
    over: "The wait is over.",
    // The board draws the check running, not one waiting for signal. The API counts the wait from when
    // the check-in reaches it as well as from the tap (ADR 0065), so a no-show cannot close before it has.
    fromTap: "No signal. The wait counts from your tap, but closing as a no-show needs signal.",
    // The board draws no no-show refused.
    early: "Our clock says the wait hasn’t run out yet. Try again in a minute.",
    close: "Close as no-show",
    // The board's "Rohit messaged on WhatsApp" reads as if the client wrote, so the receipt names them
    // as who it went to. The board draws only the delivered one.
    delivered: (who: string, time: string) => `WhatsApp to ${who}: delivered ${time}.`,
    notDelivered: (who: string) => `WhatsApp to ${who}: sent, not delivered.`,
    noneSent: (who: string) => `No WhatsApp went to ${who}.`,
    theClient: "the client",
  },
  // The board draws no confirmation. Closing as a no-show can bring the client a charge.
  confirm: {
    title: "Close as a no-show?",
    body: "The client may be charged. Close only if no one has answered.",
    yes: "Close as no-show",
    no: "Not yet",
  },
  appears: {
    // The board writes "He appears".
    title: "Client’s here",
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
  // The board writes Top's guide alone; the other four are ours.
  guides: {
    front: "Front · face the camera, eyes level",
    top: "Top · line up the hairline",
    left: "Left · ear in the centre",
    right: "Right · ear in the centre",
    hair: "Hair · close in, sharp focus",
  } satisfies Record<Angle, string>,
  // The board draws neither a refused camera nor the finished set.
  unavailable: "This phone won’t open its camera. Check its permissions, then try again.",
  retry: "Try again",
  // The board draws no capture that failed.
  missed: "That photo didn’t save. Take it again.",
  done: "All five are on the phone. They go up when there is signal.",
  finish: "Done",
  // The board draws no set the API refused.
  refusedPhotos: (angles: readonly string[]) =>
    angles.length === 1
      ? `The ${listed(angles)} photo wouldn’t upload. Take it again.`
      : `The ${listed(angles)} photos wouldn’t upload. Take them again.`,
  refusedSet: "We couldn’t record this set. Tap Done to send it again.",
} as const;

/** The six in-job steps (board B), and the hair profile no board draws, in the order the API runs them. */
export const steps = {
  back: "Back",
  of: (done: number, total: number) => `${String(done)} of ${String(total)}`,
  titles: {
    before_photos: "Before photos",
    checklist: "Service checklist",
    consumables: "Consumables used",
    piece: "The piece",
    // No board draws the hair profile (ADR 0106).
    profile: "Hair profile",
    after_photos: "After photos",
    outcome: "Outcome",
  },
  // The board titles a service visit's list; the other types' are named the same way.
  checklistTitles: {
    service: "Service checklist",
    replacement: "Replacement checklist",
    first_fit: "First fit checklist",
    consultation: "Consultation checklist",
  },
  // The board names no step but the one it draws.
  next: "Next",
  // The board draws no step the API refused.
  corrected: {
    piece: "We couldn’t record the label you gave. Correct it and tap Next.",
    other: "We couldn’t record this step as it was. Correct it and tap Next.",
  },
  checklist: {
    // The board's dim bar while the list is unfinished.
    unfinished: "Finish the list to continue",
  },
  consumables: {
    less: (name: string) => `One fewer ${name.toLowerCase()}`,
    more: (name: string) => `One more ${name.toLowerCase()}`,
    count: (name: string, count: number) => `${name}: ${String(count)}`,
    // The board draws the name alone; what one is counted in, and what the visit's service expects.
    unit: (unit: string, expected: number) => (expected === 0 ? unit : `${unit} · ${String(expected)} expected`),
    // The board draws four steppers and no way to record a fifth consumable.
    add: "Add another",
    addOne: (name: string) => `Add ${name}`,
    none: "None used",
    // The console holds no consumables yet (docs/decisions/0087-consumables-and-stock.md).
    nothingOffered: "No consumables listed yet. Ops add them in the console.",
  },
  piece: {
    // A label carries no barcode or QR code, so the code is typed, never scanned.
    label: "The new piece’s label",
    placeholder: "MM-STD-4417-B",
    // The board draws no label typed wrong.
    malformed: "Type it as on the tag, like MM-STD-4417-B.",
    checkFirst: "Check the label to continue",
    look: "Check the label",
    unknown: "Unknown label. It’s saved as you typed it.",
    // The board draws no lookup with no signal.
    offline: "No signal, so it isn’t checked. It’s saved as you typed it.",
    notThisClient: "That piece isn’t this client’s.",
    notThisClientAction: "That piece isn’t this client’s",
    rows: { piece: "Piece", base: "Base", lot: "Supplier lot" },
    // The board draws the base as read, not typed; the pieces tab needs it and the lot (open point 28).
    base: "Base",
    lot: "Supplier lot",
    pick: "Pick from the list",
    // "Mono · fitted 2 Jul" beside a piece in the client's list.
    listed: (code: string, fitted: string | null) => (fitted === null ? code : `${code} · fitted ${fitted}`),
    // The board draws no piece coming off. The pieces tab keeps why it failed.
    old: {
      title: "The piece that came off",
      label: "The label of the piece that came off",
      reason: "Why it failed",
      needsReason: "Say why it failed to continue",
    },
    // The board draws no empty base; the piece may not be in the mirror yet.
    unnamed: "Not recorded",
  },
  outcome: {
    // The board draws Done chosen already; nothing is chosen for the technician here.
    choose: "Choose Done or Partial",
    pickReason: "Pick a reason to continue",
    done: "Done",
    partial: "Partial · pick a reason",
  },
} as const;

/** The close-out, once the outcome is taken. */
export const closeOut = {
  label: "Closed out",
  who: (name: string, outcome: string) => `${name} · ${outcome}`,
  outcomes: { done: "done", partial: "partial", no_show: "no-show" },
  // No board draws a consultation and fit in one visit closed as done once the client declined.
  freeConsultation: "free consultation",
  duration: "Duration",
  // The board writes "1 h 22 m"; the phone times it from Start job (open point 60).
  length: (hours: number, minutes: number) =>
    hours === 0 ? `${String(minutes)} m` : `${String(hours)} h ${String(minutes)} m`,
  photos: "Photos",
  queued: (count: number) => `${String(count)} queued`,
  sent: (count: number) => `${String(count)} sent`,
  nextJob: (time: string, who: string) => `Next job · ${time}, ${who}`,
  // The board draws the next job; the day ends without one.
  lastJob: "Back to today",
  // The evidence chain's close: the evidence summary, and what happens to it.
  noShow: {
    ops: "This goes to ops with the charge.",
    checkedIn: "Checked in",
    distance: "Distance",
    whatsApp: "WhatsApp",
    delivered: (time: string) => `Delivered ${time}`,
    // The board draws the receipt delivered.
    notDelivered: "Sent, not delivered",
    noneSent: "None sent",
    unmeasured: "Not measured",
  },
  // The board draws no close-out opened before the job closed.
  notClosed: "This job isn’t closed yet.",
  backToJob: "Back to the job",
} as const;

/** The badge, and nothing else about money, anywhere in this app. */
export const badges = {
  prepaid: "Prepaid",
  credit: "Credit",
  free: "Free",
  // No board draws a consultation and fit in one visit, paid for once the client is fitted (ADR 0105).
  at_visit: "Pays once fitted",
} as const;

/**
 * No board draws a consultation and fit in one visit
 * (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). The client chooses the product with the technician
 * at the piece step, before the checklist, or decides against it; closing the visit as done then texts them a payment
 * link, or ends it as a free consultation. Never an amount.
 */
export const oneVisit = {
  name: "Consultation and fit",
  nameLower: "consultation and fit",
  checklist: "Consultation and fit checklist",
  choice: "The client’s choice",
  declined: "Decided against it",
  // Ops offer no hair system for the visit's day, so there is nothing to choose from.
  noProducts: "No hair system is offered for this visit. Speak to ops before you fit anything.",
  chooseFirst: "Choose the hair system, or mark it declined",
  declinedNote: "Nothing is fitted. The visit ends as a free consultation.",
  /** Closing as done, once the client decided against the fit. */
  endsAsConsultation: "Ends as a free consultation. Nothing to pay.",
  /** Closing as done, once the client chose a hair system: by its name in the console. */
  linkFor: (product: string) => `Closing texts the client a payment link for ${product}.`,
  /** A product the card no longer names, for linkFor. */
  chosenProduct: "the hair system they chose",
  /** Closing as done on a phone that does not know the client's choice, from a card kept by an earlier build. */
  closeNote:
    "Closing texts the client a payment link for their hair system, or ends a declined visit as a free consultation.",
  payment: "Payment",
  linkSent: "Link texted to the client",
  linkPaid: "Paid",
  /**
   * A discount code the client gives the technician before the link goes (docs/decisions/0108-discount-codes.md).
   * It comes off the product's price in the link; no amount is shown here.
   */
  code: {
    label: "Discount code, if the client has one",
    apply: "Apply code",
    applying: "Checking",
    /** Said once it applies: the link carries it, and nothing else is shown. */
    applied: (code: string) => `Code ${code} applied. The payment link will take it off.`,
    /** A code the client gave as they booked, or ops on the booking: there is no box to type another in. */
    appliedAtBooking: (code: string) => `Code ${code} applied at booking. The payment link will take it off.`,
    errors: {
      code_not_applicable: "That code doesn’t apply to this visit.",
      already_discounted: "This visit already has a code.",
      price_settled: "The payment link has gone, so the code can no longer change.",
      rate_limited: "Too many codes tried. Try again tomorrow.",
      offline: "You’re offline. Codes need signal.",
      unknown: "That didn’t go through. Try again.",
    } as Readonly<Record<string, string>>,
  },
} as const;

/** Words for every code of one of the fit spec's lists, as the API names them. */
type Words<Field extends keyof FitSpec> = Record<NonNullable<FitSpec[Field]>, string>;

/**
 * No board draws the client's hair profile (docs/decisions/0106-a-clients-hair-profile.md). The codes are the
 * API's.
 */
export const profile = {
  sections: {
    stage: "Norwood stage",
    head: "The head, in centimetres",
    base: "Base size, in inches",
    colour: "Colour",
    grey: "Grey, in per cent",
    density: "Density",
    wave: "Wave",
    hairline: "Hairline",
    product: "Product",
    attachment: "Tape or glue",
  },
  measurements: {
    head_circumference_cm: "Circumference",
    front_to_nape_cm: "Front to nape",
    ear_to_ear_cm: "Ear to ear, over the top",
    temple_to_temple_cm: "Temple to temple",
    base_width_in: "Width",
    base_length_in: "Length",
  },
  stages: { I: "I", II: "II", III: "III", IV: "IV", V: "V", VI: "VI", VII: "VII" } satisfies Words<"norwood_stage">,
  colours: {
    "1": "#1",
    "1B": "#1B",
    "2": "#2",
    "3": "#3",
    "4": "#4",
    "5": "#5",
    "6": "#6",
    "7": "#7",
    "8": "#8",
  } satisfies Words<"colour">,
  densities: { 80: "80%", 100: "100%", 120: "120%", 140: "140%" } satisfies Words<"density_percent">,
  waves: { straight: "Straight", slight_wave: "Slight wave", wavy: "Wavy", curly: "Curly" } satisfies Words<"wave">,
  hairlines: {
    natural: "Natural",
    receded: "Receded",
    straight: "Straight",
    widows_peak: "Widow’s peak",
  } satisfies Words<"hairline">,
  attachments: { tape: "Tape", glue: "Glue", both: "Tape and glue" } satisfies Words<"attachment">,
  remedies: {
    none: "None",
    minoxidil: "Minoxidil",
    finasteride: "Finasteride",
    transplant: "Transplant",
    other_systems: "Other hair systems",
    other: "Other",
  } satisfies Record<History["remedies"][number], string>,
  range: (min: number, max: number) => `${String(min)}–${String(max)}, to one decimal.`,
  greyRange: (min: number, max: number) => `${String(min)}–${String(max)}.`,
  yearRange: (first: number, last: number) => `A year from ${String(first)} to ${String(last)}.`,
  checkFigures: "Check the figures to continue",
  history: {
    title: "History",
    remedies: "Remedies tried",
    year: "The transplant’s year",
    skin: "Skin conditions and allergies",
  },
  // The card's rows from the profile: the board's Tier, as the hair system, Colour, Adhesive and Scalp, and the base's size.
  card: {
    tier: "Hair system",
    baseSize: "Base size",
    colour: "Colour",
    adhesive: "Adhesive",
    scalp: "Scalp",
    size: (width: number, length: number) => `${String(width)} × ${String(length)} in`,
    shade: (colour: string, grey: number | null) => (grey === null ? colour : `${colour} / ${String(grey)}% grey`),
  },
} as const;

export const types = {
  consultation: "Consultation",
  service: "Service visit",
  replacement: "Replacement",
  first_fit: "First fit",
} as const;

/** The job card writes the type in lower case, in its line: "9:30 am · service". */
export const typesLower = {
  consultation: "consultation",
  service: "service visit",
  replacement: "replacement",
  first_fit: "first fit",
} as const;

export const session = {
  // Neither file draws a revoked device.
  revoked: "This phone is no longer signed in. Ask ops, then sign in again.",
  // No board draws a technician ops switched off.
  switchedOff: "Your account is switched off. Ask ops to switch it back on, then sign in.",
  workKept:
    "Your account is switched off. Unsent work stays on this phone for 7 days and sends once you’re switched back on and sign in.",
  checking: "Loading",
} as const;
