// Every word the technician app shows, from design/phase2/Technician App.dc.html
// and, for the sign-in it does not draw, the Prototype's technician screen. A
// component holds no copy of its own. Lines neither file writes are
// ours.

import type { Moved } from "@maneman/web-kit/api";
import { shortDate } from "@maneman/web-kit/dates";
import { amountOf } from "@maneman/web-kit/figures";
import type { Angle, FitSpec, History } from "./api.ts";
import { apiDate, clock, dayAfter, dayMonth, todayInIndia } from "./lib/when.ts";
import { localised, sayNow } from "./lang/words.ts";
import { languageNow } from "./lang/language.ts";

export const signIn = localised({
  title: "Sign in",
  prefix: "+91",
  mobileLabel: "Mobile number",
  mobilePlaceholder: "98110 00000",
  mobileError: "Enter your 10-digit mobile number.",
  codeLabel: "Code",
  submit: "Sign in",
  // The Prototype draws one screen and no errors.
  errors: {
    mismatch: "That code didn’t match.",
    code_expired: "That code no longer works. Get a new one.",
    invalid_request: "Check the number and the code.",
    rate_limited: "Too many codes for this number today. Ask ops.",
    sign_in_stopped: "Ops have stopped sign-in on your number. Ask them to let you back in.",
    busy: "Codes aren’t going out right now. Try again shortly.",
    turnstile_failed: "We couldn’t confirm you’re a person. Try again.",
    offline: "You’re offline. Reconnect, then sign in.",
    unknown: "That didn’t go through. Try again.",
  },
  attemptsLeft: (left: number) => `That code didn’t match. ${String(left)} ${left === 1 ? "try" : "tries"} left.`,
  sendCode: "Get code",
  // The brief: a disabled button always shows one helper line.
  numberHelper: "Type your number to continue",
  codeHelper: "Type the code to continue",
  /** "Code sent to +91 98110 00000", beneath the title once the code is out. */
  codeSent: (number: string) => `Code sent to ${number}`,
  // The Prototype draws no way back from a code sent to the wrong number, or one that never came.
  changeNumber: "Change number",
  resend: "Send a new code",
  /** "Resend in 0:24" */
  resendIn: (seconds: number) =>
    `Resend in ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`,
  // Neither file draws the app opened from the home screen. An
  // installed iPhone app has its own cookie jar, so the first sign-in inside it
  // is a second one and looks like the account has gone (ADR 0053's update).
  installed: "Sign in here once, then use the home-screen app. Anything waiting in the browser still sends.",
  notRegistered: "Number not registered?",
  callOps: "Call ops.",
} as const);

export const today = localised({
  /** The jobs today, before any has closed; then those still to do, as each closes. */
  jobs: (count: number) => `${String(count)} ${count === 1 ? "job" : "jobs"} today`,
  left: (count: number) => `${String(count)} ${count === 1 ? "job" : "jobs"} left`,
  allDone: "All done today",
  /** The day's own name: its title before its jobs load, and its list's head once none is left to do. */
  title: "Today",
  sync: {
    synced: "Synced",
    offline: (saved: number) => (saved > 0 ? `Offline · ${String(saved)} saved` : "Offline"),
    sending: (count: number) => `${String(count)} to upload`,
    /** Writes the API stopped: a job changed under the phone, or a step refused. */
    stopped: (count: number) => `${String(count)} ${count === 1 ? "upload" : "uploads"} failed`,
  },
  /** The next job's line above its time: where the technician is with it, or when to leave for it. */
  next: {
    next: "Next",
    leaveIn: (minutes: number) => `Next · leave in ${String(minutes)} min`,
    leaveBy: (time: string) => `Next · leave by ${time}`,
    leaveNow: "Next · leave now",
    atTheDoor: "At the door",
    inProgress: "In progress",
  },
  driveTo: (minutes: number) => `${String(minutes)} min drive`,
  driveAndLeave: (minutes: number, time: string) => `${String(minutes)} min drive · leave ${time}`,
  message: (first: string) => `Message ${first}`,
  call: (first: string) => `Call ${first}`,
  later: "Later today",
  dayView: "Day view",
  /** A job done with, by how it closed: under its time, and after its kind of visit. */
  closed: { done: "Done", partial: "Partly done", no_show: "No-show", other: "Closed" },
  closedAfter: { done: "done", partial: "partly done", no_show: "no-show", other: "closed" },
  /** A job under way that runs into the next: when to be done to reach it on time. */
  runsOver: (finishBy: string, next: string) => `Running over · finish by ${finishBy} for the ${next} job`,
  noMore: "No more jobs today.",
  noJobs: "No jobs today",
  tomorrow: "Tomorrow",
  tomorrowJobs: (count: number, time: string) => `${String(count)} ${count === 1 ? "job" : "jobs"} from ${time}`,
  /** Tomorrow's jobs before the evening's lock, which may give out more. */
  tomorrowSoFar: (count: number, time: string) =>
    `${String(count)} ${count === 1 ? "job" : "jobs"} so far, from ${time}`,
  nothingBooked: "Nothing booked",
  /** Tomorrow, before the evening's lock gives out its visits. */
  comeThisEvening: "Jobs come this evening",
  /** Yesterday's jobs not yet closed, as a card at the top: their work can still be finished and sent. */
  leftOpen: (time: string, who: string) => `Still open from yesterday · ${time} · ${who}`,
  leftOpenBody: "Finish it and send it.",
  /** A visit with steps ops sent back, from whatever day, until they are done again (docs/decisions/0246-closed-and-sent-back.md). */
  toFix: (count: number) => (count === 1 ? "Ops couldn’t accept a step" : `Ops couldn’t accept ${String(count)} steps`),
  toFixBody: (who: string, steps: readonly string[]) => `${who} · ${listed(steps)}. Tap to fix.`,
  /** A photo set the API stopped: "Rohit M. · before photos. Tap to retry.", which opens Pending uploads. */
  setFailed: "A photo set didn’t upload",
  setFailedBody: (who: string, set: string) => `${who} · ${set}. Tap to retry.`,
  toFixSteps: {
    before_photos: "before photos",
    checklist: "checklist",
    consumables: "consumables",
    after_photos: "after photos",
  },
  offline: {
    title: "No signal",
    body: "Today’s jobs and cards are on the phone.",
    /** On a job's step: what the technician does is kept, and goes once the signal is back. */
    step: "Saved on the phone. Sends when you’re back online.",
    /** At the top of every screen while there is no signal (../frame/Banners.tsx). */
    bar: "No signal · your work is saved on this phone",
  },
  failed: "The day’s jobs didn’t load.",
  retry: "Try again",
} as const);

/** The tab bar at the foot of the top-level screens. */
export const tabs = localised({
  label: "Sections",
  today: "Today",
  schedule: "Schedule",
  kit: "Kit",
  me: "Me",
} as const);

/** Me: the technician's own pages, what waits to send, ops, and signing out. */
export const me = localised({
  title: "Me",
  /** "Senior · Gurugram · +91 98100 00009"; "Technician" for one with no grade. */
  who: (grade: string | null, city: string | null, phone: string | null) =>
    [grade ?? "Technician", city, phone].filter((part) => part !== null).join(" · "),
  quality: {
    title: "Your quality",
    days: "Last 30 days",
    redo: "Hairline redo rate",
    /** "11% · 1 of 9 fits" */
    redone: (redone: number, fits: number) =>
      `${String(Math.round((redone / fits) * 100))}% · ${String(redone)} of ${counted(fits, "fit", "fits")}`,
    onTime: "On time",
    /** "94% of visits" */
    onTimeShare: (onTime: number, visits: number) => `${String(Math.round((onTime / visits) * 100))}% of visits`,
    /** Clients' stars over the days ops set: "Client rating, 90 days". */
    rating: (days: number) => `Client rating, ${String(days)} days`,
    /** "4.6 of 5" */
    rated: (average: number) => `${average.toFixed(1)} of 5`,
    none: "None yet",
    failed: "Your quality didn’t load.",
  },
  incentives: {
    /** "Incentives, November" */
    title: (month: string) => `Incentives, ${month}`,
    /** "to 10 Nov" */
    upTo: (date: string) => `to ${date}`,
    /** "Service visits · 14 · Rs. 450" */
    line: (kind: string, visits: number, rate: string | null) =>
      [kind, String(visits), rate].filter((part) => part !== null).join(" · "),
    noRate: "Rate not set",
    none: "No visits closed yet this month.",
    failed: "Your incentives didn’t load.",
  },
  account: "Account",
  loading: "Loading…",
  retry: "Try again",
  leave: "Leave",
  language: "Language",
  closeLanguage: "Close",
  pending: "Pending uploads",
  nothingPending: "None",
  contact: "Contact ops",
  /** The Contact sheet's title: ops in the technician's city. */
  contactTitle: (city: string) => `Ops, ${city}`,
  /** Leave's line on Me: the asks ops have still to answer. */
  withOps: (count: number) => `${String(count)} with ops`,
  signOut: "Sign out",
  /** The sheet before signing out, which wipes the phone. */
  sheet: {
    title: "Sign out?",
    uploaded: "Everything is uploaded.",
    /** Work on the phone not yet sent, which signing out would lose: "5 uploads will be lost." */
    lost: (count: number) => `${String(count)} ${count === 1 ? "upload" : "uploads"} will be lost.`,
    cancel: "Cancel",
  },
  closeContact: "Close",
} as const);

/** The way to ops from anywhere the app says to ask them (./components/ReachOps.tsx). */
export const ops = localised({
  call: "Call ops",
  whatsApp: "WhatsApp ops",
  /** Under a title that names ops already, as the Contact sheet's: "Call", "WhatsApp". */
  callShort: "Call",
  whatsAppShort: "WhatsApp",
} as const);

/** The Safety sheet, from the shield in a visit's header (docs/prompts/tech-redesign.md, "Safety"). */
export const safety = localised({
  open: "Safety",
  title: "Safety",
  sharing: "Ops can see your location until you close this visit.",
  sos: "Hold for SOS",
  sosSub: "Alerts ops and shares your location",
  /** Beneath SOS while it is held: under reduced motion, the only sign it is going. */
  keepHolding: "Keep holding",
  sending: "Sending your SOS…",
  hold: "Press and hold for 3 seconds. Let go to cancel.",
  /** "SOS sent 9:41 am" */
  sent: (time: string) => `SOS sent ${time}`,
  sentBody: "Ops will call you now. Your location is shared.",
  safe: "I’m safe",
  safeSaid: "Ops know you’re safe.",
  safeFailed: "That didn’t reach ops. Call them.",
  call112: "Call 112",
  close: "Close",
  failed: "SOS didn’t go through. Call ops or 112 now.",
} as const);

/** "1 photo set", "3 actions": a count and the word for it. */
const counted = (count: number, one: string, many: string) => `${String(count)} ${count === 1 ? one : many}`;
const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** "top", "top and left", "top, left and hair"; in Hindi, joined by "और". */
const listed = (words: readonly string[]) =>
  new Intl.ListFormat(languageNow() === "hi" ? "hi" : "en-IN", { type: "conjunction" }).format(words);

/**
 * Signing out wipes the phone, so it asks first when there is work on it that
 * has not reached us, and says so when there is no signal to sign out with.
 */
export const leaving = localised({
  // The prototype draws no sign-out with no signal.
  stayed: "No signal. You’re still signed in. Try again with signal.",
} as const);

/** When the phone has no room left for what the app must keep: a photograph, a step. */
export const storage = localised({
  /** Above every screen but the camera, which says it in its own words (the prototype's red line). */
  bar: "Phone storage full. Free up space to keep saving your work.",
  // The prototype says "Free 200 MB": the phone cannot know how much it needs.
  camera: "Phone storage full. Free up space to keep taking photos.",
} as const);

/** A new version of the app, waiting to be taken (packages/web-kit/sw-update.ts). */
export const update = localised({
  // Neither file draws a new version.
  line: "A new version is ready.",
  action: "Update",
} as const);

/** A screen that failed to draw, which React would otherwise leave blank. */
export const broken = localised({
  // Neither file draws a screen that failed.
  message: "Couldn’t open this screen.",
  reload: "Reload",
} as const);

/** A failed call's reference, to quote to ops. */
export const reference = localised({ label: "Ref", copy: "Copy", copied: "Copied" } as const);

/**
 * When the phone would not promise to keep what the outbox holds: a warning,
 * not an error. Nothing is lost yet, and getting to signal is what saves it
 * (apps/tech/src/store/persist.ts).
 */
export const atRisk = localised({
  // Neither file draws a phone that will not promise to keep its store.
  title: "Unsent work could be lost",
  body: "Get to signal today so everything sends.",
} as const);

export const queue = localised({
  retry: "Retry",
  states: {
    uploading: "Uploading…",
    waiting: "No signal",
    failed: "Failed",
  },
  /** Beneath the title: how many jobs still have work on the phone. */
  jobsWaiting: (count: number) => `${String(count)} waiting`,
  noneWaiting: "None waiting",
  /** A set's row, as the prototype heads it: whose, and which, "Rohit M. · before photos". */
  setOf: (who: string, phase: string) => `${who} · ${phase}`,
  phasesAfter: { before: "before photos", after: "after photos" },
  /** Beneath it: how many, or, still being taken, how many so far. */
  photos: (count: number) => counted(count, "photo", "photos"),
  taken: (taken: number, total: number) => `${String(taken)} of ${String(total)} taken`,
  /** How far a set has gone: said beside a stopped one, which has no line, and to a screen reader beside the line. */
  sentOf: (sent: number, total: number) => `${String(sent)} of ${String(total)} sent`,
  // The board draws the photo sets; these name the writes beside them.
  title: "Pending uploads",
  nothing: "Everything is uploaded.",
  /** "Last sync 9:01 am", or "12 Nov, 9:01 am" on an earlier day. */
  lastSync: (when: string) => `Last sync ${when}`,
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
} as const);

/**
 * What a job's queue stopped for. The API answers a stable code and, on a 409
 * or a 400, the fields that moved under the phone or that it refused — never a
 * sentence — so these are the app's words for each it can meet
 * (docs/api-tech.md). A field is named in preference to the code.
 */
const stopped: Readonly<Record<string, string>> = {
  // The 409 names the fields that moved and never their values. The new time, once the card read again
  // carries it, and whom a job went to are named by whatStopped below.
  superseded: "Ops changed this job.",
  technician: "This job is someone else’s now.",
  time: "Ops moved this job to another time.",
  status: "Ops cancelled this job.",
  out_of_order: "Steps arrived out of order. Open the job again.",
  not_today: "This job is on another day. Arrive and start it on the day.",
  too_early_to_arrive: "Too early for this job. Tap again from the time on its card.",
  already_started: "This job was started, so it can’t close as a no-show.",
  photo_rejected: "The photos wouldn’t upload.",
  // Failed at our end after several tries: nothing is wrong with what was done.
  stuck: "This couldn’t reach us after several tries. Send it again.",
  not_found: "This job is no longer on your list.",
  already_closed: "This job is closed.",
  piece_code: "The hair system’s label wasn’t accepted.",
  old_piece: "The label of the hair system that came off wasn’t accepted.",
  // A one visit's product, no longer offered when the step reached us (ADR 0105).
  product: "That product isn’t offered that day.",
  done: "This job’s checklist changed. Open the job again.",
  reason: "That reason wasn’t accepted.",
  invalid_request: "We couldn’t record this. Tap Retry, or call ops.",
  unknown: "We couldn’t record this. Tap Retry, or call ops.",
} as const;

/**
 * The prompt's words for a job given to another technician, "Ops moved this job
 * to Sandeep at 10:40": their first name, and when, as the API said (open
 * point 92). A move made on another day names the day, and one with no time
 * recorded has none.
 */
function movedTo(moved: Moved, now: Date): string {
  // The prompt's example has a time on the day; the line without one, and the one with a day, are ours. A name that
  // ends in a full stop, "Imran K.", ends the sentence itself.
  if (moved.at === null)
    return `Ops moved this job to ${moved.technician}${/[.!?]$/.test(moved.technician) ? "" : "."}`;
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
function whatStoppedEn(why: Why, now: Date = apiDate(), startsNow: string | null = null): string {
  const field = why.fields.find((each) => stopped[each] !== undefined);
  const moved = why.moved ?? null;
  if (field === "technician" && moved !== null) return movedTo(moved, now);
  // The prompt words a move to another technician; this one, to another time, is ours.
  if (field === "time" && startMoved(why, startsNow)) return `Ops moved this job to ${timeAndDay(startsNow, now)}.`;
  return stopped[field ?? why.note ?? ""] ?? stopped.unknown ?? "";
}

/**
 * A job ops cancelled, gave to another technician, or closed, while the phone held it: said once over the screen
 * showing. What was recorded stays in Pending uploads.
 */
export const interrupted = localised({
  /** Whose visit, as the prototype says it, where the phone knows the client; else the job by its time and kind. */
  cancelledOf: (name: string) => `${name}’s visit was cancelled`,
  cancelled: (job: string) => `${job}: cancelled`,
  closedOf: (name: string) => `${name}’s visit was closed`,
  closed: (job: string) => `${job}: closed`,
  movedOf: (name: string, to: string) => `${name}’s visit moved to ${to}`,
  moved: (job: string, to: string) => `${job}: moved to ${to}`,
  /** From a push, which names no one: given to another technician, or called off. */
  reassignedOf: (name: string) => `${name}’s visit was given to another technician`,
  reassigned: (job: string) => `${job}: given to another technician`,
  /** When ops did it, where the API says; and, where the phone recorded any of it, that it is kept. */
  cancelledAt: (time: string | null) => (time === null ? "Ops cancelled this visit." : `Ops cancelled it at ${time}.`),
  reassignedAt: (time: string | null) =>
    time === null ? "Ops gave this visit to another technician." : `Ops reassigned it at ${time}.`,
  closedBody: "This visit was closed.",
  kept: "What you recorded is kept on this phone, in Pending uploads.",
  today: "Back to Today",
} as const);

/** The banner above every screen while a job's queue is stopped. */
export const changed = localised({
  // The board draws what changed on the queue alone.
  line: (job: string, what: string) => `${job}: ${what}`,
  // A job the phone holds nothing of, not even its time.
  someJob: "A job",
  open: "See what is waiting",
} as const);

/** Each screen's name in the browser's title, after which the app's own. */
export const titles = localised({
  app: "Mane Man technician",
  today: "Today",
  closeOut: "Closed out",
  of: (screen: string) => `${screen} · Mane Man technician`,
} as const);

/** When a locked card opens. One that opened while the screen was up says to open the job again. */
function opensAt(unlocksAt: string, now: Date = apiDate()): string {
  if (Date.parse(unlocksAt) > now.getTime()) return `Opens at ${timeAndDay(unlocksAt, now)}.`;
  return `Open since ${timeAndDay(unlocksAt, now)}. Go back and open the job again.`;
}

/** A length as the board writes it, the visit's booked length and the time a job took alike: "45 min", "3 h", "1 h 30 min". */
function lengthOf(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return minutes === 0 ? "Under 1 min" : `${String(minutes)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** A client's record, which belongs to them and not the job (docs/decisions/0242-client-record.md). */
export const clientRecord = localised({
  alerts: "Before you start",
  /** A task's run-in label for the client's alerts. */
  alertLabel: "Client alert:",
  handoff: "Handoff",
  /** "Imran · 1 Sep" */
  handoffBy: (who: string | null, date: string) => (who === null ? date : `${who} · ${date}`),
  history: "Client history",
  /** "5 visits since Jul", beneath the history's row. */
  since: (count: number, month: string) => `${counted(count, "visit", "visits")} since ${month}`,
  /** Beneath the handoff's photographs: which they are, and when. */
  afterPhotos: (date: string) => `After photos, ${date}`,
  /** The history screen. */
  title: "Client history",
  none: "No earlier visits.",
  failed: "The client’s history didn’t load.",
  retry: "Try again",
  /** The history's two heads, as the prototype has them. */
  clientAlerts: "Client alerts",
  visits: "Visits",
  results: { done: "Done", partial: "Partly done", no_show: "No-show", other: "Closed" },
  /** Who did a visit the technician reading did. */
  you: "You",
  /** "Imran · Done" */
  byAndResult: (who: string | null, result: string) => (who === null ? result : `${who} · ${result}`),
  photo: (angle: string) => `After, ${angle}`,
  piece: (label: string) => `Fitted ${label}`,
} as const);

export const job = localised({
  back: "Back",
  /** "9:30 am · service · 1 h 30 min", and "Tomorrow · …" for a job on another day. */
  when: (parts: readonly string[]) => parts.join(" · "),
  tomorrow: "Tomorrow",
  /** The client's arrival window, named as the client app names it: "Arrive 9:30 to 10 am". */
  arrive: (range: string) => `Arrive ${range}`,
  // The board writes "1 slot"; the visit's length says more.
  minutes: lengthOf,
  /** The map's place at the top: the drive there when the day's list knows it; an address with no pin says so. */
  map: {
    label: "Map with a pin at the client’s address",
    noPin: "No map pin for this address",
    /** "Map · 6.2 km, 18 min"; the minutes alone where the km are not known. */
    line: (drive: number | null, km: number | null) => {
      if (drive === null) return "Map";
      return km === null ? `Map · ${String(drive)} min drive` : `Map · ${km.toFixed(1)} km, ${String(drive)} min`;
    },
  },
  navigate: "Navigate",
  /** The way in, from the access notes: copied whole, for a gate's keypad. */
  copyWayIn: "Copy the way in",
  copied: "Copied",
  noteFrom: (who: string) => `Note from ${who}: `,
  // The buttons say the act; a screen reader hears whom.
  callShort: "Call",
  call: (who: string) => `Call ${who}`,
  messageShort: "Message",
  message: (who: string) => `Message ${who}`,
  /** A word to the client from our number (docs/decisions/0145-technician-presets.md). */
  tell: {
    title: (who: string) => `Message ${who}`,
    close: "Close",
    minutes: "Minutes",
    minute: (minutes: number) => `${String(minutes)} min`,
    onTheWay: (minutes: number) => `On my way, ${String(minutes)} min`,
    late: (minutes: number) => `Running ${String(minutes)} min late`,
    sentAt: (time: string) => `Sent at ${time}`,
    /** "Sent: on my way, 20 min", under the actions. */
    sent: (what: string) => `Sent: ${what.charAt(0).toLowerCase()}${what.slice(1)}`,
    noWhatsApp: (who: string) => `${who} doesn’t take WhatsApp updates. Call instead.`,
  },
  checkIn: "Check in",
  atTheDoor: "At the door",
  start: "Start visit",
  continueJob: "Continue",
  viewSummary: "View summary",
  /** A closed visit with a step ops sent back: the way to it. */
  putRight: "Put it right",
  // The board draws no job's state on its card or its row.
  states: { inProgress: "In progress", closed: "Closed out", atTheDoor: "At the door" },
  notToday: {
    tomorrow: "This job is tomorrow. Arrive and start it on the day.",
    other: "This job isn’t today’s. Arrive and start it on its day.",
  },
  // The board draws what changed on the queue alone.
  changed: {
    title: "This job changed",
    body: "Nothing more can be sent for it.",
  },
  locked: {
    title: "Not yet",
    // The board draws no locked card. The hour is the API's unlocks_at.
    opens: opensAt,
    /** A past visit's card, locked again the day after it: a step ops sent back is still put right from it. */
    pastTitle: "Details closed",
    past: "A visit’s client details close the day after it.",
  },
  // The client block, headed as the prototype heads it for each kind of visit.
  profileTitle: "Hair profile",
  /** "Last visit 12 Oct", at the hair profile's head. */
  lastVisitOn: (date: string) => `Last visit ${date}`,
  fromConsultation: "From the consultation",
  booking: {
    title: "Booking",
    bookedVia: "Booked via",
    via: { app: "App", site: "Website", ops: "Ops" },
    payment: "Payment",
  },
  // What the hair system step says of the piece paid for.
  piece: {
    mismatch: (inProfile: string) => `The hair profile says ${inProfile}. Check with ops before you fit.`,
    rows: {
      paidFor: "Paid for",
      // A fit paid by UPI at the visit: nothing is paid yet, and the technician never handles the money.
      bookedAs: "Booked as",
    },
  },
  // The board draws no failure for a job's card.
  failed: "This job’s card didn’t load.",
  retry: "Try again",
  gone: "This job isn’t on your list.",
  backToToday: "Back to today",
} as const);

/** Checking in at the door, and the no-show's evidence while the client does not answer. */
export const notHome = localised({
  arrived: {
    // The radius is ops' to set, and a card kept by an earlier build has none.
    body: (radiusM: number | null) =>
      radiusM === null ? "Check in at the door." : `Check in within ${String(radiusM)} m of the door.`,
    action: "Check in",
    opensAt: (time: string) => `Check-in opens at ${time}.`,
    noPosition: "This phone won’t give its position. Check its permissions, then tap again.",
    // An address Google could not place at all has no pin: the check-in records the time alone.
    noPin: "No map pin: the check-in records the time only.",
  },
  failed: {
    title: "Check-in failed",
    away: (km: string) => `You are ${km} from the address.`,
    // An address with no coordinates has none (ADR 0036).
    unmeasured: "We couldn’t measure how far you are from the address.",
    body: "Go to the door and tap again. Still refused? Call ops.",
    action: "Try again",
  },
  /** At the door, after the check-in. */
  door: {
    title: "At the door",
    checkedIn: (who: string, time: string) => `${who} · checked in ${time}`,
    /** Over the door just after a check-in that passed: "Checked in · 40 m away", or alone where none was measured. */
    arrived: (distance: string | null) => (distance === null ? "Checked in" : `Checked in · ${distance} away`),
    waitingFor: (who: string) => `Waiting for ${who}`,
    of: (minutes: number) => `of ${String(minutes)} min`,
    booked: (time: string) => `Booked for ${time}`,
    over: "The wait is over.",
    // The API counts the wait from when the check-in reaches it as well as from the tap (ADR 0065), so a no-show
    // cannot close before it has.
    fromTap: "No signal. The wait counts from your tap; closing needs signal.",
    early: "The wait isn’t over yet. Try again in a minute.",
    needed: "Needed for a no-show",
    whatsApp: (who: string) => `WhatsApp to ${who}`,
    delivered: (time: string) => `Delivered ${time}`,
    notDelivered: "Sent, not delivered",
    onItsWay: "Sending now",
    noneSent: "Not sent",
    call: (who: string) => `Call ${who}`,
    callAction: "Call",
    // The phone knows only that the call was made from here: one made at the door is one the client did not answer.
    called: "Called · no answer",
    notCalled: "Not called",
    photo: "Photo of the door",
    /** "Taken 9:32 am" */
    taken: (time: string) => `Taken ${time}`,
    notTaken: "Not taken",
    take: "Take",
    note: "Note for ops (optional)",
    waitFirst: "Available when the wait ends",
    evidenceFirst: "Call and take the door photo first",
    /** Beside Close as no-show once it can. */
    ready: "The wait is over",
    close: "Close as no-show",
    theClient: "the client",
  },
  /** The single-shot camera for the door. */
  camera: {
    title: "Door photo",
    prompt: "Door and flat number in the frame",
    shutter: "Take photo",
    cancel: "Cancel",
    view: "The camera’s view of the door",
    noCamera: "The camera wouldn’t open.",
    again: "Try again",
    missed: "That didn’t take. Try again.",
  },
  // Closing as a no-show can bring the client a charge.
  confirm: {
    title: "Close as a no-show?",
    prepaid: (who: string) => `${who} is prepaid. Ops decide on the charge.`,
    // Nothing was paid ahead, so there is nothing to keep: free, or paid at the visit.
    bodyNothingPaid: "Ops are told nobody was home. Close only if no one has answered.",
    yes: "Close as no-show",
    no: "Not yet",
  },
} as const);

/** The visit engine's screens and plan (docs/decisions/0244-the-visit-engine.md). */
export const visit = localised({
  screens: {
    before_photos: "Before photos",
    service: "Service",
    fitting: "Fitting",
    scalp: "Scalp and hairline",
    hair_profile: "Hair profile",
    hair_system: "Hair system",
    consumables: "Consumables",
    after_photos: "After photos",
    sign_off: "Client sign-off",
    outcome: "Outcome",
  },
  /** "Rohit M. · service visit", beneath a step's name. */
  whoAndWhat: (who: string, kind: string) => `${who} · ${kind}`,
  step: (at: number, total: number) => `Step ${String(at)} of ${String(total)}`,
  allSteps: "All steps",
  next: (title: string) => `Next: ${title.toLowerCase()}`,
  close: "Close visit",
  /** A step ops sent back with nothing after it to do: it sends the step, and closes nothing. */
  sendFix: "Send",
  /** A guided task (./visit/tasks.ts): one a screen. */
  task: (at: number, total: number) => `Task ${String(at)} of ${String(total)}`,
  nextTask: "Next task",
  watchFor: "Watch for",
  taskDone: (title: string) => `Done: ${title}`,
  plan: {
    /** The plan's list, as a screen reader hears it; the head names the client and the visit. */
    title: "Visit plan",
    /** "Started 9:38 am", under the client and the visit. */
    started: (time: string) => `Started ${time}`,
    done: (done: number, total: number) => `${String(done)} of ${String(total)} done`,
    finishBy: (time: string) => `Finish by ${time}`,
    /** A step's line once done; before, what it is (../guides), or its tasks counted. */
    stepDone: "Done",
    tasks: (count: number) => counted(count, "task", "tasks"),
    needsFix: "Needs a fix",
    /** Over a step ops sent back, as the prototype words it: "Ops couldn’t accept consumables", then their reason. */
    couldNotAccept: (step: string) => `Ops couldn’t accept ${step}`,
    /** Opens the step under way. */
    continue: "Continue",
  },
  /** Above a step ops sent back: what they said to fix, as they wrote it. */
  sentBack: (reason: string) => `Ops sent this back: ${reason}`,
  /** The same at the head of the step, as the prototype words it: that ops refused it, their reason, and the way on. */
  refused: "Ops couldn’t accept this step",
  fixIt: (reason: string) => `${reason} Fix it and tap Next.`,
} as const);

export const capture = localised({
  back: "Back",
  before: "Before photos",
  after: "After photos",
  retake: "Retake",
  /** Not drawn: what a screen reader calls a tile, a tap on which takes that angle again. */
  retakeAngle: (angle: string) => `Take ${angle} again`,
  take: "Take photo",
  /** "5 of 5", beneath the step's name once every angle is taken. */
  of: (taken: number) => `${String(taken)} of 5`,
  /** "1 of 5 · front": the shot being taken, its angle in lower case as the prototype writes it. */
  taking: (shot: number, angle: string) => `${String(shot)} of 5 · ${angle}`,
  close: "Close",
  saved: "Saved on phone",
  /** Compare: the last visit's after photograph before the visit, this visit's before one after it. */
  compareWith: { before: "Compare with last visit", after: "Compare with today’s before" },
  /** "Compare with 12 Oct, Imran": the visit before photographs are set beside. */
  compareWithVisit: (date: string, who: string | null) =>
    who === null ? `Compare with ${date}` : `Compare with ${date}, ${who}`,
  compareImage: { before: (angle: string) => `Last visit, ${angle}`, after: (angle: string) => `Before, ${angle}` },
  /** Over the photograph compared with, as the prototype labels it: "12 Oct, Imran K. · top", "today’s before · top". */
  compared: (whose: string, angle: string) => `${whose} · ${angle}`,
  /** Whose that photograph is, where the last visit's day is not known, and after the visit. */
  comparedWith: { before: "last visit", after: "today’s before" },
  /** The last visit, by its day and who did it: "12 Oct, Imran K." */
  visitOf: (date: string, who: string | null) => (who === null ? date : `${date}, ${who}`),
  /** Under the line, what the camera sees now. */
  now: "Now",
  torch: "Torch",
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
  unavailableTitle: "Camera access is off",
  unavailable: "Turn on camera access for Mane Man in the phone’s settings, then try again.",
  retry: "Try again",
  // The board draws no capture that failed.
  missed: "That photo didn’t save. Take it again.",
  blank: "That photo came out blank. Take it again.",
  // A camera that will not open does not stop the job: the set goes without its photographs, and ops look at it.
  withoutPhotos: "Continue without photos",
  opsTold: "Ops are told the photos are missing.",
  done: "All five are on the phone.",
  finish: "Done",
  // The board draws no set the API refused.
  refusedPhotos: (angles: readonly string[]) =>
    angles.length === 1
      ? `The ${listed(angles)} photo wouldn’t upload. Take it again.`
      : `The ${listed(angles)} photos wouldn’t upload. Take them again.`,
  refusedSet: "We couldn’t record this set. Tap Done to send it again.",
} as const);

/** The six in-job steps (board B), and the hair profile no board draws, in the order the API runs them. */
export const steps = localised({
  back: "Back",
  of: (done: number, total: number) => `${String(done)} of ${String(total)}`,
  place: (at: number, total: number) => `Step ${String(at)} of ${String(total)}`,
  // Each step named as the plan names it (../visit/engine.ts), as the prototype heads them.
  titles: {
    before_photos: "Before photos",
    checklist: "Service",
    consumables: "Consumables",
    piece: "Hair system",
    // No board draws the hair profile (ADR 0106).
    profile: "Hair profile",
    after_photos: "After photos",
    outcome: "Outcome",
  },
  // The guided tasks, as the plan names them: a service's, a fitting's, and a consultation's look at the scalp.
  checklistTitles: {
    service: "Service",
    replacement: "Fitting",
    first_fit: "Fitting",
    consultation: "Scalp and hairline",
  },
  // The board names no step but the one it draws.
  next: "Next",
  // The board draws no step the API refused.
  corrected: {
    piece: "We couldn’t record the label you gave. Correct it and tap Next.",
    other: "We couldn’t record this step as it was. Correct it and tap Next.",
    // Our words: a hair system picked with no label, none of whose pieces the kit may give.
    noneToFit: "That hair system can’t be fitted from your kit. Pick another.",
    // Our words: as above, with nothing left in the kit to pick without a label.
    noneLeft: "Nothing in your kit can be fitted without a label now. Scan the piece’s label.",
  },
  consumables: {
    less: (name: string, step: number, unit: string) =>
      step === 1 ? `One fewer ${name.toLowerCase()}` : `${amountOf(step, unit)} less ${name.toLowerCase()}`,
    more: (name: string, step: number, unit: string) =>
      step === 1 ? `One more ${name.toLowerCase()}` : `${amountOf(step, unit)} more ${name.toLowerCase()}`,
    type: (name: string) => `Type the ${name.toLowerCase()} used`,
    count: (name: string, count: number) => `${name}: ${String(count)}`,
    // The board draws the name alone; what one is counted in, and what the visit's service expects.
    unit: (unit: string, expected: number) => (expected === 0 ? unit : `${amountOf(expected, unit)} expected`),
    /** What the kit holds beside it, "12 strips in your kit", and when more is counted than that, so ops send more. */
    inKit: (held: number, unit: string, over: boolean) => {
      const kit = held <= 0 ? "None in your kit" : `${amountOf(held, unit)} in your kit`;
      return over ? `${kit}. Ops will send more.` : kit;
    },
    // The board draws four steppers and no way to record a fifth consumable.
    add: "Add item",
    addOne: (name: string) => `Add ${name}`,
    none: "None used",
    // The console holds no consumables yet (docs/decisions/0087-consumables-and-stock.md).
    nothingOffered: "No consumables to record. Tell ops if you used any.",
    /** Less than the service expects, or nothing at all on a visit that always uses something: why, for ops. */
    whyShort: "Less than expected. Why?",
    whyNone: "Nothing used. Why?",
    pickWhy: "Pick why to continue",
    shortReasons: {
      client_supplies: "Client’s own supplies",
      ran_out: "Ran out",
      not_needed: "Not needed",
      other: "Other",
    },
  },
  piece: {
    // Scan-first, as the prototype draws it (docs/decisions/0270-the-design-checks-api-side.md): a label is read by its
    // QR code, or typed (docs/decisions/0163-pieces-scanned-from-the-kit.md).
    scanTitle: "Scan the hair system",
    expected: { chosen: "Chosen", newPiece: "New piece", spec: "Spec", replacing: "Replacing" },
    /** "120% density", the last of the spec. */
    density: (percent: number) => `${String(percent)}% density`,
    pointAt: "Point at the label",
    typeCode: "Type the code",
    // Our words: the prototype draws no piece without a label.
    noLabel: "No label on it",
    pickTitle: "Pick the hair system",
    scanInstead: "Scan the label instead",
    pickFromKit: "Pick the hair system from your kit",
    typedLabel: "Code on the label",
    cannotFit: {
      action: "Can’t fit today",
      title: "Can’t fit today",
      why: "Why?",
      body: "The visit closes as not fitted. Ops rebook it.",
      close: "Close and tell ops",
      /** Above the close while it waits for a reason, as a step's foot says what is missing. */
      pickFirst: "Pick a reason",
      dismiss: "Close",
    },
    /**
     * On a replacement whose piece came off before it was due: why, from the reasons ops keep, one tap and never asked
     * for (docs/decisions/0273-why-a-hair-system-failed.md). Our words: the prototype draws no such line.
     */
    cameOffEarly: {
      action: "Came off early? Say why",
      title: "Why did it come off early?",
      done: "Done",
      dismiss: "Close",
      /** The reason picked: "Came off early · Edges lifting". */
      said: (reason: string) => `Came off early · ${reason}`,
      change: "Change",
    },
    confirmed: {
      profile: "Profile",
      match: "Match",
      kit: "Kit",
      left: (count: number) => `${String(count)} left after this`,
      rescan: "Rescan",
    },
    camera: { opening: "Opening the camera…", refused: "No camera. Type the code instead." },
    expired: "This hair system has expired. Hand it in and use another.",
    otherThanFitted: "Not the hair system this fit is for. Check with ops before you fit.",
    expiredAction: "That hair system has expired",
    placeholder: "MM-ESS-0000000-X",
    // The board draws no label typed wrong.
    malformed: "Type it as on the label, like MM-ESS-0000123-K.",
    checkFirst: "Scan or type the code to continue",
    /** A label is checked as soon as it reads; again only once there is signal (docs/prompts/tech-redesign.md). */
    checking: "Checking the label…",
    checkAgain: "Check again",
    unknown: "Not in your kit. Check the label, or close with Can’t fit today.",
    notInKitAction: "That label isn’t in your kit",
    uncheckedAction: "Waiting for the label check",
    // The board draws no lookup with no signal.
    offline: "No signal, so it isn’t checked. It’s saved as you typed it.",
    notThisClient: "That hair system isn’t this client’s.",
    notThisClientAction: "That hair system isn’t this client’s",
    // "MM-ESS-0000451-D · fitted 10 May": the piece a replacement takes off.
    listed: (code: string, fitted: string | null) => (fitted === null ? code : `${code} · fitted ${fitted}`),
    // The board draws no kit stock without labels: a hair system the kit took in before its pieces carried labels is
    // picked from the kit, and the label on the piece typed (docs/decisions/0156-hair-systems-in-stock.md).
    kit: {
      title: "From your kit",
      held: (count: number) => `${String(count)} in kit`,
      matches: "Matches the profile",
    },
  },
  outcome: {
    /** What the close leaves on the client's record, for whoever takes their next visit. */
    nextNote: "Note for the next technician",
    /** Under the note: where it shows. */
    nextNoteWhere: "Shown on this client’s next job, whoever takes it.",
    alert: "Alert for every visit",
    notePlaceholder: "What should the next technician know?",
    result: "Result",
    summary: "Summary",
    client: "Client",
    payment: "Payment",
    photos: "Photos",
    /** "10 · uploading": the visit's photographs, some still on the phone. */
    uploading: (count: number) => `${String(count)} · uploading`,
    /** "10 sent" */
    photosSent: (count: number) => `${String(count)} sent`,
    /** A one visit closed as done texts the client the payment link. */
    sendLinkAndClose: "Send link and close",
    // The board draws Done chosen already; nothing is chosen for the technician here. What the dim Next waits on, as
    // the prototype words it.
    choose: "Pick a result",
    pickReason: "Pick a reason",
    done: "Done",
    partial: "Partly done",
    // After a consultation: whether the client is going ahead with a fit, and why not (docs/decisions/0149-lost-reasons.md).
    goingAhead: "Going ahead with a fit?",
    yes: "Yes",
    notNow: "Not now",
    /** The product the client picked on Options, which goes with a yes. */
    picked: (name: string) => `Their pick: ${name}.`,
    /** The head over a choice's reasons, a partly done's or a not now's. */
    reason: "Reason",
    pickWhy: "Pick a reason",
    answerFirst: "Pick yes or not now",
  },
} as const);

/** The close-out, once the outcome is taken. */
export const closeOut = localised({
  /** The heading, by how the visit closed. */
  titles: { closed: "Visit closed", no_show: "Closed as no-show", not_fitted: "Closed, not fitted" },
  /** "Rohit M. · service visit · done", beneath the heading. */
  sub: (who: string, kind: string, result: string) => `${who} · ${kind} · ${result}`,
  outcomes: { done: "done", partial: "partly done", no_show: "no-show" },
  notFitted: "not fitted",
  /** A fit closed with "Can't fit today": "Not fitted · Piece damaged", and what follows. */
  result: "Result",
  notFittedWhy: (why: string | null) => (why === null ? "Not fitted" : `Not fitted · ${why}`),
  nextStep: "Next step",
  opsRebook: "Ops rebook the fit",
  // No board draws a consultation and fit in one visit closed as done once the client declined.
  freeConsultation: "free consultation",
  /** A one visit whose fit the client booked for another day. */
  fitToBook: "fit to book",
  duration: "Duration",
  paymentRow: "Payment",
  why: "Why",
  fit: "Fit",
  /** A consultation's yes, as the prototype writes it: "Mane Man Natural · ops to book"; ops book the fit. */
  goingAhead: (product: string | null) => `${product ?? "Going ahead"} · ops to book`,
  /** "Not now · the price": ops' reason, as it reads mid-line. */
  notNow: (why: string | null) => (why === null ? "Not now" : `Not now · ${why}`),
  // The board writes "1 h 22 m"; the phone times it from Start job (open point 60).
  length: (hours: number, minutes: number) => lengthOf(hours * 60 + minutes),
  photos: "Photos",
  queued: (count: number) => `${String(count)} queued`,
  sent: (count: number) => `${String(count)} sent`,
  /** Fit today, after a plain consultation, where the kit holds the client's piece (ADR 0299). */
  fitToday: {
    title: "Fit today",
    /** "Mane Man Natural 8×10 1B is in your kit. Fit from 2:30 pm." */
    line: (piece: string, time: string) => `${piece} is in your kit. Fit from ${time}.`,
    pays: "Nothing to pay now. The client pays by link once fitted.",
    action: "Book the fit",
    booking: "Booking…",
    failed: {
      offline: "No signal. Try again once there is.",
      taken: "Your day has no room for it now.",
      unknown: "The fit wasn’t booked. Try again.",
    },
  },
  /** A one visit's link: whether it is paid, and texting it again. */
  payment: {
    title: "Payment link",
    paid: "Paid",
    notPaid: "Sent · not paid",
    resend: "Resend",
    sending: "Sending…",
    said: {
      resent: "Sent again.",
      sent: "Sent.",
      not_texted: "This number can’t be texted. Ops will send it.",
      paid: "Paid already.",
      refused: "Razorpay refused it. Ops are told.",
    },
    failed: {
      rate_limited: "Sent as often as today allows. Ops can send it.",
      offline: "No signal. Try again.",
      unknown: "Couldn’t send. Try again.",
    },
  },
  /** A visit left partly done, or not fitted: how the technician suggests finishing it. */
  finish: {
    title: "Finish the work",
    ask: "Suggest a time to ops",
    asks: {
      tomorrow_morning: "Tomorrow morning",
      tomorrow_evening: "Tomorrow evening",
      ops_call: "Ops to call the client",
    },
    sent: "Sent to ops. They’ll confirm with the client.",
    saved: "Saved. It goes to ops with the visit’s close.",
    failed: "Couldn’t send. Try again.",
  },
  next: {
    title: "Next",
    leaveBy: (time: string) => `Leave by ${time}`,
    /** "25 min drive", after the next job's kind and place. */
    drive: (minutes: number) => `${String(minutes)} min drive`,
    today: "Today",
    /** After the day's last job: nothing more today, then tomorrow's first, "Tomorrow · 9:30 am". */
    doneForToday: "Done for today",
    tomorrow: (time: string) => `Tomorrow · ${time}`,
  },
  /** The piece fitted at the visit, by its label. */
  hairSystem: "Hair system",
  // The board draws the next job; the day ends without one.
  lastJob: "Back to today",
  // The evidence chain's close: the evidence summary, and what happens to it.
  noShow: {
    ops: "This goes to ops.",
    checkedIn: "Checked in",
    /** "9:27 am · 40 m away", or the time alone where nothing was measured. */
    checkedInAt: (time: string, distance: string | null) => (distance === null ? time : `${time} · ${distance} away`),
    waited: "Waited",
    whatsApp: "WhatsApp",
    delivered: (time: string) => `Delivered ${time}`,
    // The board draws the receipt delivered.
    notDelivered: "Sent, not delivered",
    noneSent: "None sent",
    call: "Call",
    // A call from the door is one the client did not answer: had they, they would have come to it.
    noAnswer: "No answer",
    notCalled: "Not called",
    doorPhoto: "Door photo",
    /** "Taken 9:32 am"; "Taken" alone where the phone that took it is not this one. */
    taken: (time: string | null) => (time === null ? "Taken" : `Taken ${time}`),
  },
  // The board draws no close-out opened before the job closed.
  notClosed: "This job isn’t closed yet.",
  backToJob: "Back to the job",
} as const);

/** The badge, and nothing else about money, anywhere in this app. */
export const badges = localised({
  prepaid: "Prepaid",
  credit: "Free visit",
  free: "No charge",
  // No board draws a consultation and fit in one visit, paid for once the client is fitted.
  at_visit: "Pays at the visit",
} as const);

/** The badges in a line, after the visit's kind: "Service visit · prepaid". */
export const badgesLower = localised({
  prepaid: "prepaid",
  credit: "free visit",
  free: "no charge",
  at_visit: "pays at the visit",
} as const satisfies Record<keyof typeof badges, string>);

/** The discount code's refusals, by the code the API answers; any it sends, looked up. */
const CODE_ERRORS: Readonly<Record<string, string>> = {
  code_not_applicable: "That code doesn’t apply to this visit.",
  already_discounted: "This visit already has a code.",
  price_settled: "The payment link has gone, so the code can no longer change.",
  rate_limited: "Too many codes tried. Try again tomorrow.",
  offline: "You’re offline. Codes need signal.",
  unknown: "That didn’t go through. Try again.",
};

/**
 * No board draws a consultation and fit in one visit
 *. The client chooses the product with the technician
 * at the piece step, before the checklist, or decides against it; closing the visit as done then texts them a payment
 * link, or ends it as a free consultation. Never an amount.
 */
export const oneVisit = localised({
  name: "Consultation and fit",
  nameLower: "consultation and fit",
  checklist: "Consultation and fit checklist",
  choice: "The client’s choice",
  declined: "Decided against it",
  // Ops offer no hair system for the visit's day, so there is nothing to choose from.
  noProducts: "No hair system is offered for this visit. Speak to ops before you fit anything.",
  chooseFirst: "Choose the hair system, or mark it declined",
  declinedNote: "Nothing is fitted. The visit ends as a free consultation.",
  /** When the chosen hair system is fitted: today, or another day ops book (docs/decisions/0247-the-steps-left.md). */
  when: "When",
  fitToday: "Fit today",
  bookLater: "Book the first fit",
  bookLaterSub: "Ops will call to book it",
  /** Fit today's line: whether the technician's kit holds the hair system chosen, which a fit today needs. */
  inKit: (product: string) => `${product} is in your kit`,
  notInKit: (product: string) => `${product} isn’t in your kit`,
  notInKitAction: "Not in your kit: book the first fit",
  laterNote: "Nothing is fitted today. Nothing to pay now.",
  /** Closing as done, once the client booked the fit for another day: by the hair system's name. */
  endsGoingAhead: (product: string) =>
    `Ends as a consultation. Ops will call to book ${product}; it’s paid at that visit.`,
  /** Closing as done, once the client decided against the fit. */
  endsAsConsultation: "Ends as a free consultation. Nothing to pay.",
  /** Closing as done, once the client chose a hair system: by its name in the console. */
  linkFor: (product: string) => `Closing sends the client a payment link for ${product}.`,
  /** A product the card no longer names, for linkFor. */
  chosenProduct: "the hair system they chose",
  /** Closing as done on a phone that does not know the client's choice, from a card kept by an earlier build. */
  closeNote: "Closing sends the payment link, or ends a declined visit as a free consultation.",
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
    applying: "Checking…",
    /** Said once it applies: the link carries it, and nothing else is shown. */
    applied: (code: string) => `Code ${code} applied. The payment link will take it off.`,
    /** A code the client gave as they booked, or ops on the booking: there is no box to type another in. */
    appliedAtBooking: (code: string) => `Code ${code} applied at booking. The payment link will take it off.`,
    errors: CODE_ERRORS,
  },
} as const);

/** Words for every code of one of the fit spec's lists, as the API names them. */
type Words<Field extends keyof FitSpec> = Record<NonNullable<FitSpec[Field]>, string>;

/**
 * No board draws the client's hair profile. The codes are the
 * API's.
 */
export const profile = localised({
  sections: {
    stage: "Norwood stage",
    head: "Head, inches",
    base: "Base, inches",
    // Which way each runs, as a stock code reads them, width by length: 8×10 is 8 side to side and 10 front to back.
    baseHow: "Width runs side to side, length front to back.",
    colour: "Colour",
    grey: "Grey (%)",
    density: "Density",
    wave: "Wave",
    hairline: "Hairline",
    product: "Product",
    attachment: "Fixing",
  },
  measurements: {
    head_circumference_in: "Circumference",
    front_to_nape_in: "Front to nape",
    ear_to_ear_in: "Ear to ear",
    temple_to_temple_in: "Temple to temple",
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
  densities: { 80: "80%", 100: "100%", 120: "120%", 130: "130%", 140: "140%" } satisfies Words<"density_percent">,
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
  /** "15.5–28 in" */
  range: (min: number, max: number) => `${String(min)}–${String(max)} in`,
  greyRange: (min: number, max: number) => `${String(min)}–${String(max)}%`,
  yearRange: (first: number, last: number) => `${String(first)}–${String(last)}`,
  checkFigures: "Check the figures to continue",
  /** Next, held back until the Norwood stage is chosen. */
  chooseStage: "Choose the stage to continue",
  /** Next, held back by a figure outside its range: which one. */
  checkFigure: (figure: string) => `${figure.replace(/ \(.*\)$/, "")} is out of range`,
  // The fit spec's second page: what the hair system is matched to.
  match: { title: "Colour and style" },
  /** Each page's head, as the prototype draws them, the measure's with where the profile came from at its end. */
  measureHead: "Measure",
  matchHead: "Match",
  newClient: "New client",
  fromConsultation: (date: string) => `From consultation, ${date}`,
  history: {
    title: "History",
    remedies: "Remedies tried",
    year: "The transplant’s year",
    skin: "Skin conditions and allergies",
  },
  // The card's rows from the profile, as the prototype names them.
  card: {
    tier: "Hair system",
    chose: "Chose",
    norwood: "Norwood stage",
    base: "Base",
    colour: "Colour",
    fixing: "Fixing",
    scalp: "Scalp",
    size: (width: number, length: number) => `${String(width)} × ${String(length)} in`,
    shade: (colour: string, grey: number | null) => (grey === null ? colour : `${colour} · ${String(grey)}% grey`),
  },
} as const);

export const types = localised({
  consultation: "Consultation",
  service: "Service visit",
  replacement: "Replacement",
  first_fit: "First fit",
} as const);

/** The job card writes the type in lower case, in its line: "9:30 am · service". */
export const typesLower = localised({
  consultation: "consultation",
  service: "service visit",
  replacement: "replacement",
  first_fit: "first fit",
} as const);

export const session = localised({
  // Neither file draws a revoked device.
  revoked: "This phone is no longer signed in. Ask ops, then sign in again.",
  // No board draws a technician ops switched off.
  switchedOff: "Your account is switched off. Ask ops to switch it back on, then sign in.",
  workKept:
    "Your account is switched off. Unsent work stays on this phone for 7 days and sends once you’re switched back on and sign in.",
  checking: "Loading…",
} as const);

// The kit (docs/decisions/0164-the-kit-screen.md). No board draws it; every line is ours.
/** Schedule: today and the six days after it, a day at a time down the hours; and a later job's preview. */
export const schedule = localised({
  title: "Schedule",
  /** "12 to 18 Nov · 12 jobs" */
  range: (from: string, to: string, jobs: number) => `${from} to ${to} · ${counted(jobs, "job", "jobs")}`,
  /** "12 to 18 Nov": the week while its jobs are still being read. */
  span: (from: string, to: string) => `${from} to ${to}`,
  /** What a screen reader hears for a day in the strip: "Thursday 12 Nov, 4 jobs"; null for a day that did not load. */
  dayLabel: (weekday: string, date: string, jobs: number | null, settled: boolean) => {
    if (jobs === null) return `${weekday} ${date}, didn’t load`;
    if (jobs === 0) return `${weekday} ${date}, ${settled ? "nothing booked" : "jobs come the evening before"}`;
    return `${weekday} ${date}, ${counted(jobs, "job", "jobs")}${settled ? "" : " so far"}`;
  },
  /** What a screen reader hears for a past day in the strip: "Monday 16 Nov, no jobs". */
  pastDayLabel: (weekday: string, date: string, jobs: number) =>
    `${weekday} ${date}, ${jobs === 0 ? "no jobs" : counted(jobs, "job", "jobs")}`,
  dayFailed: "This day didn’t load. It shows once there’s signal.",
  dayNotLoaded: "This day didn’t load.",
  noJobs: "–",
  /** "Thu, 12 Nov" */
  day: (weekday: string, date: string) => `${weekday}, ${date}`,
  /** "Today, Thu 12 Nov": only today is named, as the prototype writes it; every other day as `day`. */
  today: (weekday: string, date: string) => `Today, ${weekday} ${date}`,
  jobs: (count: number) => counted(count, "job", "jobs"),
  /** A day whose visits the evening before gives out: what is on it so far. */
  jobsSoFar: (count: number) => `${counted(count, "job", "jobs")} so far`,
  nothing: "Nothing booked",
  comeEveningBefore: "Jobs come the evening before",
  dayView: "The day, by the hour",
  now: "Now",
  /** "18 min · leave 9:12 am" */
  drive: (minutes: number, leave: string) => `${String(minutes)} min · leave ${leave}`,
  failed: "Your week didn’t load.",
  retry: "Try again",
  earlier: "Earlier week",
  later: "Later week",
  /** A past day with no job on it. */
  noneThen: "No jobs",
  /** A past job nobody closed. */
  notClosed: "Not closed",
  preview: {
    back: "Back to Schedule",
    /** "Thu, 12 Nov · 11:30 am" */
    sub: (day: string, time: string) => `${day} · ${time}`,
    time: "Time",
    area: "Area",
    payment: "Payment",
    /** "11:30 am · 1 h 30 min" */
    when: (time: string, length: string) => `${time} · ${length}`,
    /** "Name and address from 6 pm tomorrow.": when the card opens, by the hour ops set. */
    locked: (unlocksAt: string) => `Name and address from ${timeAndDay(unlocksAt, apiDate())}.`,
    gone: "This job is no longer on your schedule.",
  },
});

/**
 * Alerts, from Today's bell and from Me (./alerts/AlertsScreen.tsx): the inbox, newest first, and which kinds are sent.
 * Each alert's words in the inbox; on the lock screen, the worker's own (../sw/notice.ts).
 */
export const alerts = localised({
  title: "Alerts",
  /** The bell's name, with how many are new. */
  bell: (unread: number) => (unread === 0 ? "Alerts" : `Alerts, ${String(unread)} new`),
  none: "No alerts in the last 7 days.",
  failed: "Alerts didn’t load.",
  retry: "Try again",
  sendMe: "Send me",
  /** Me's row: "4 on" */
  on: (count: number) => `${String(count)} on`,
  /** "10 min before you need to set off", by the minutes ops set. */
  leaveSub: (minutes: number) => `${String(minutes)} min before you need to set off`,
  /** "At 8 pm, the next day’s jobs", by the hour of India's day ops set. */
  dayAheadSub: (hour: number) =>
    `At ${String(hour % 12 === 0 ? 12 : hour % 12)} ${hour < 12 ? "am" : "pm"}, the next day’s jobs`,
  kinds: {
    time_to_leave: { label: "Time to leave", sub: null },
    day_ahead: { label: "Day ahead", sub: null },
    job_changes: { label: "Job changes", sub: "Moved, cancelled or reassigned" },
    running_over: { label: "Running over", sub: "When a visit will make you late for the next" },
  },
  settingFailed: "Not saved. Try again with signal.",
  /** Notifications on this phone, beneath Send me: asked for once the technician taps. */
  phoneOff: "Alerts don’t show on this phone yet.",
  turnOn: "Turn on",
  turnOnFailed: "Alerts weren’t turned on. Try again with signal.",
  blocked: "Notifications are blocked for this app in the phone’s settings.",
  /** "the 2 pm service visit": a job whose client the phone may not name. */
  job: (time: string, kind: string) => `the ${time} ${kind}`,
  /** "Leave in 8 min for Rohit M." */
  leave: (minutes: number, who: string) => `Leave in ${String(minutes)} min for ${who}`,
  /** "18 min drive to Sector 65" */
  drive: (minutes: number, sector: string) => `${String(minutes)} min drive to ${sector}`,
  /** "Sameer J. moved to 4:15 pm" */
  moved: (who: string, time: string) => `${capital(who)} moved to ${time}`,
  cancelled: (client: string | null, job: string) =>
    client === null ? `${capital(job)} was cancelled` : `${client}’s visit was cancelled`,
  reassigned: (who: string) => `${capital(who)} went to another technician`,
  /** "First fit · Sector 43 · was 2 pm" */
  was: (parts: readonly (string | null)[], time: string) =>
    [...parts.filter((part) => part !== null && part !== ""), `was ${time}`].join(" · "),
  /** "Running over · finish by 11:10 am" */
  over: (finishBy: string) => `Running over · finish by ${finishBy}`,
  /** "for the 11:30 am job, Sector 65" */
  overNext: (next: string, sector: string | null) =>
    sector === null ? `for the ${next} job` : `for the ${next} job, ${sector}`,
  /** "Tomorrow: 4 jobs from 9:30 am" */
  dayAhead: (jobs: number, first: string) => `Tomorrow: ${counted(jobs, "job", "jobs")} from ${first}`,
  /** "First: Rohit M., Sector 65" */
  first: (client: string | null, sector: string | null) =>
    `First: ${[client, sector].filter((part) => part !== null).join(", ")}`,
  /** When it came: "9:02 am", "Yesterday, 8 pm", "Mon 9 Nov, 8 pm" */
  yesterday: (time: string) => `Yesterday, ${time}`,
  earlier: (day: string, time: string) => `${day}, ${time}`,
  /** "tomorrow 4 pm": a job's time on the next day. */
  tomorrowAt: (time: string) => `tomorrow ${time}`,
} as const);

/** Guides, from Me: each kind of visit's steps, and each task read alone (./guides/GuidesScreen.tsx). */
export const guides = localised({
  title: "Guides",
  kinds: "4 visit types",
  /** "6 steps" */
  steps: (count: number) => counted(count, "step", "steps"),
  /** What each step is, beneath its name; a step of tasks lists them instead. */
  what: {
    before_photos: "Front, top, left, right, hair",
    tasks: "",
    hair_profile: "Norwood stage, head and base",
    hair_system: "Scan the new piece",
    consumables: "Record what you used",
    after_photos: "Same 5 shots",
    sign_off: "The client checks the fit and signs",
    outcome: "Result and close",
  },
  /** A consultation's outcome, which asks whether the client goes ahead with a fit, and sends no link of its own. */
  consultationOutcome: "Going ahead or not",
  /** "Service visit · Service", beneath a task's name. */
  where: (kind: string, step: string) => `${kind} · ${step}`,
  gone: "This task isn’t in the guide any more.",
  /** The way to a kind of visit's guide, from a later job's preview. */
  howDone: "How this visit is done",
} as const);

/** The client's sign-off of a fit (docs/decisions/0254-client-signs-off-the-fit.md), its step and the decline's sheet. */
export const signOff = localised({
  intro: "The client checks the hairline, the colour and blend, and that it feels secure, then signs in their app.",
  ask: "Ask for sign-off",
  askAgain: "Fixed. Ask again",
  waiting: "Waiting for the client’s sign-off",
  waitingLine: "They answer in the Mane Man app.",
  flagged: "The client says something isn’t right",
  /** "Signed off · 1:42 pm". */
  signed: "Signed off",
  /** "Closed without sign-off: Client in a hurry". */
  declined: (reason: string) => `Closed without sign-off: ${reason}`,
  declineOpen: "Client declined to sign",
  unfinished: "Waiting for sign-off",
  decline: {
    title: "Client declined to sign",
    why: "Why didn’t they sign?",
    record: "Record and go on",
    close: "Close",
  },
} as const);

/** Ask ops to reschedule, from the job (./job/Reschedule.tsx). */
export const reschedule = localised({
  open: "Ask ops to reschedule",
  why: "Why",
  reasons: { client_asked: "Client asked", running_late: "I’m running late", kit_problem: "Kit problem" },
  /** The reason inside the note once asked, mid-sentence: "· client asked ·". */
  reasonsAfter: { client_asked: "client asked", running_late: "running late", kit_problem: "kit problem" },
  send: "Send to ops",
  close: "Close",
  needsSignal: "Needs signal",
  failed: "That didn’t reach ops. Try again.",
  closed: "This visit is closed or called off.",
  gone: "This visit isn’t yours any more.",
  /** "Reschedule asked 9:05 am · client asked · ops will confirm with the client" */
  asked: (time: string, reason: string) => `Reschedule asked ${time} · ${reason} · ops will confirm with the client`,
} as const);

/** Each kind of visit as Me's incentives name it (./me/Standing.tsx). */
export const month = localised({
  kinds: {
    consultation: "Consultations",
    one_visit: "Consultation and fit",
    first_fit: "First fits",
    service: "Service visits",
    replacement: "Replacements",
    no_show: "Not home",
  },
});

/** A consultation's Options: each package and what it costs the client, and the looks they made with the try-on. */
export const options = localised({
  title: "Options",
  link: "Options and prices",
  back: "Back to the job",
  failed: "Options didn’t load.",
  retry: "Try again",
  none: "Nothing on sale yet.",
  firstFit: "First fit",
  /** "Service visit, every 30 days" */
  service: (days: number) => `Service visit, every ${String(days)} days`,
  /** "Replacement, every 6 months" */
  replacement: (months: number) => `Replacement, every ${String(months)} months`,
  noPrice: "Price not set",
  /** The consultation's Options step: the products with their prices, and the client's pick marked. */
  prices: "Products and prices",
  inclGst: "Incl. GST",
  markPick: "Mark the client’s pick.",
  pricesFailed: "Prices didn’t load.",
  looksTitle: "Their looks",
  /** A look's description for a screen reader: "Look made 20 Sep". */
  look: (date: string) => `Look made ${date}`,
});

/** The technician's asks for leave: a new one, and where each stands once ops decide it. */
export const leave = localised({
  title: "Leave",
  failed: "Your leave didn’t load.",
  retry: "Try again",
  askTitle: "Ask for leave",
  from: "From",
  to: "To",
  note: "Reason",
  ask: "Ask",
  needsSignal: "Needs signal",
  badDates: "Pick days from today on, the last no earlier than the first.",
  notDone: "That didn’t go through. Try again.",
  askedTitle: "Your requests",
  none: "Nothing asked for.",
  states: { asked: "With ops", approved: "Approved", declined: "Declined" },
  /** "20 to 22 Nov", or "28 Nov to 4 Dec" across a month. */
  days: (from: string, to: string) => `${from} to ${to}`,
});

export const kit = localised({
  title: "Kit",
  /** "Updated 8:40 am": when the kit was last read. */
  updated: (time: string) => `Updated ${time}`,
  failed: "Your kit didn’t load.",
  retry: "Try again",
  needsSignal: "Needs signal",
  notDone: "That didn’t go through. Try again.",
  forecast: {
    title: "Next 7 days",
    /** "11 bookings": the visits the forecast is taken from. */
    bookings: (count: number) => counted(count, "booking", "bookings"),
    /** A product's pieces, as the forecast lists them: "Mane Man Essential pieces". */
    pieces: (product: string) => `${product} pieces`,
    request: "Request what’s short",
    /** "Request 6 shampoo sachets": the one thing short, named. */
    requestOne: (what: string) => `Request ${what}`,
    /** "Requested 9:05 am · ops will add it to your next transfer" */
    requested: (time: string) => `Requested ${time} · ops will add it to your next transfer`,
    requestFailed: "That didn’t reach ops. Try again.",
    nothingShort: "Nothing’s short now.",
    none: "Nothing booked needs consumables.",
    item: "Item",
    need: "Need",
    have: "Have",
    status: "Status",
    short: (count: number) => `Short ${String(count)}`,
    enough: "Enough",
  },
  coming: {
    title: "Arriving",
    /** "Mane Man Essential · 2 pieces" */
    line: (name: string, amount: string) => `${name} · ${amount}`,
    receive: "Receive",
    /** "Sent 9 Nov" */
    sent: (date: string) => `Sent ${date}`,
    reportMissing: "Report missing",
    /** Part of a hair system's pieces in hand, the rest still on the way. */
    restToCome: (count: number) => `Receive ${String(count)} scanned · the rest to come`,
    scanned: (count: number, of: number) => `${String(count)} of ${String(of)} scanned`,
    /** Labels lost or unreadable never hold a top-up back. */
    receiveAll: "No labels? Receive all",
    notOnIt: "That label isn’t on this transfer.",
    settled: "Already received or sent back.",
  },
  scan: {
    label: "Scan or type each label",
    add: "Add",
    camera: "Scan",
    stop: "Stop scanning",
    type: "Type it instead",
  },
  held: {
    title: "In kit",
    none: "Your kit is empty.",
    /**
     * A count the kit's ledger has at nought or below, more used than it held where it is below; and who knows, as low
     * says it.
     */
    out: (short: string | null, coming: boolean) =>
      `${short === null ? "Out" : `Out, ${short} short`} · ${coming ? "more on its way" : "ops notified"}`,
    outUntilBack: (short: string | null) =>
      `${short === null ? "Out" : `Out, ${short} short`} · hand back the expired stock and ops are told`,
    /** Out, with ops' count not told of it: no stock to hand back, or a hair system, which that count does not watch. */
    outAlone: (short: string | null) => (short === null ? "Out" : `Out, ${short} short`),
    /** A lot and when it expires, as the prototype writes it: "TS-2611 · expires 31 May 2027". */
    expires: (lot: string, date: string) => `${lot} · expires ${date}`,
    /** A lot inside the days ops are warned before it expires. */
    useFirst: (lot: string, date: string) => `Use ${lot} first, expires ${date}`,
    expired: (date: string) => `Expired ${date}`,
    recalled: "In a recall: not to be used",
    pieces: (count: number) => `${String(count)} labelled`,
    /** At or below the level ops keep a kit at: ops are alerted on their own, and send more. */
    low: (coming: boolean) => (coming ? "Low · more on its way" : "Low · ops notified"),
    /** Low only for stock that goes back: ops' count sees it until it does. */
    lowUntilBack: "Low · hand back the expired stock and ops are told",
    lowAlone: "Low",
  },
  returned: {
    title: "Return to ops",
    /** "Old hair system, removed 7 Nov" */
    line: (date: string) => `Old hair system, removed ${date}`,
    handBack: (count: number) => `Hand back ${String(count)} ${count === 1 ? "hair system" : "hair systems"}`,
  },
  expired: { handBack: "Hand back expired stock", word: "Expired", recalledWord: "Recalled" },
  handedBack: "Handed back. Ops receive it from you.",
} as const);

/** What stopped the visit, in the language now. */
export const whatStopped = (why: Why, now: Date = apiDate(), startsNow: string | null = null): string =>
  sayNow(whatStoppedEn(why, now, startsNow));

/** Each language by its own name, never said in the other (./lang/Language.tsx). */
export const languageNames = { en: "English", hi: "हिन्दी" } as const;
