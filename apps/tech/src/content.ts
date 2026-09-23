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
    not_recognised: "This number is not a technician's. Ask ops to set you up.",
    rate_limited: "Too many codes for this number today. Ask ops.",
    offline: "You are offline. Connect, then sign in.",
    unknown: "That did not go through. Try again.",
  },
  sendCode: "Send the code",
  // PLACEHOLDER: the Prototype shows the code field from the start.
  codeSent: "A six-digit code is on its way.",
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
  superseded: "This job changed while the phone was offline.",
  refused: "We could not record this.",
  read: "Got it",
  back: "Back",
} as const;

export const job = {
  back: "Back",
  when: (time: string, type: string, slots: string) => `${time} · ${type} · ${slots}`,
  slots: (slots: number) => `${String(slots)} ${slots === 1 ? "slot" : "slots"}`,
  navigate: "Navigate",
  piece: "The piece",
  lastVisit: (on: string, technician: string) => `Last visit, after. ${on}, ${technician}.`,
  start: "Start job",
  locked: {
    title: "Not yet",
    body: "The address and the client's card open the day before.",
  },
  // PLACEHOLDER: the board draws no failure for a job's card.
  failed: "This job's card did not load.",
  retry: "Try again",
} as const;

export const capture = {
  back: "Back",
  before: "Before photos",
  after: "After photos",
  progress: (done: number, total: number) => `${String(done)} of ${String(total)}`,
  retake: "Retake",
  take: "Capture",
  angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hair" },
  // The design writes this line for Top; it stands for each angle until the owner writes the other four.
  guide: (angle: string) => `${angle} · line up the hairline`,
  // PLACEHOLDER: the board draws neither a refused camera nor the finished set.
  unavailable: "This phone will not open its camera. Check its permissions, then try again.",
  done: "All five are on the phone. They go up when there is signal.",
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

/** The job card writes the type in lower case, in its line: "9:30 am · service · 1 slot" (board A3). */
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
