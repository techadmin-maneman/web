// The parts page's words (./PartsScreen.tsx): samples, most from the redesign's prototype and the Hindi from
// design/tech-redesign/strings-hi.json, to show each part as a screen will use it. Built into local builds alone, so
// no technician reads them.

export const parts = {
  title: "Parts",
  intro: "Every part of the new look, in each of its states.",
  type: {
    head: "Type",
    screen: "Today",
    section: "Section title",
    list: "List title",
    body: "Body text, as a step’s instructions read.",
    meta: "Meta: 2:30 pm · 45 min · Sector 54",
  },
  buttons: {
    head: "Buttons",
    primary: "Check in",
    secondary: "Message",
    outline: "View summary",
    danger: "Close as no-show",
    destructive: "Sign out",
    disabled: "Next: Consumables",
    busy: "Sending",
  },
  fields: {
    head: "Fields",
    number: "Mobile number",
    numberHint: "Number not registered? Call ops.",
    note: "Note for the next technician",
    error: "Enter 10 digits.",
  },
  choices: {
    head: "Choices",
    legend: "Going ahead with a fit?",
    yes: "Yes",
    yesDetail: "Ops book the fit",
    no: "Not now",
    tick: "Scalp cleaned",
    reasons: "Why fewer?",
    reason: ["Client’s own", "Ran out", "Not needed", "Other"],
  },
  stepper: {
    head: "Stepper",
    name: "Tape strips",
    usual: "Usually 12 · 46 in kit",
    less: "One less tape strip",
    more: "One more tape strip",
    said: (count: number) => `Tape strips, ${String(count)}`,
  },
  progress: {
    head: "Progress",
    steps: (at: number, of: number) => `Step ${String(at)} of ${String(of)}`,
    all: "All steps",
    scanned: "1 of 2 scanned",
    wait: "Waiting 6 min",
  },
  problems: {
    head: "Problems",
    unsent: "2 photos not sent",
    unsentBody: "Open Waiting to send them.",
    rejected: "Ops couldn’t accept this step",
    rejectedBody: "Before photos are blurred. Fix it and tap Next.",
  },
  hindi: {
    head: "आज बाद में",
    body: "आज और कोई जॉब नहीं।",
  },
  bar: {
    helper: "2 left",
    action: "Next: Consumables",
  },
} as const;
