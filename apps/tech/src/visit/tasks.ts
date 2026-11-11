// The words of each guided task (docs/prompts/tech-redesign.md, "Guided tasks"): its title, what its reference
// photograph shows, the numbered instructions, and what to watch for. Draft words from the prototype, kept here, apart
// from the screens, for the training lead to edit. Each is keyed by the job sheet's item it guides
// (src/config/job-sheet.ts); an item with none here shows its label alone.

import { localised, sayNow } from "../lang/index.ts";
export interface TaskWords {
  readonly title: string;
  /** What the reference photograph shows, until there is one. */
  readonly reference: string;
  readonly how: readonly string[];
  /** What to stop for, or to check; none where there is nothing to say. */
  readonly watch: string | null;
}

const REMOVE: TaskWords = {
  title: "Remove the hair system",
  reference: "Solvent along the front edge",
  how: ["Spray solvent along the front edge.", "Wait for the tape to release.", "Lift front to back."],
  watch: "Pulling or pain: stop and add solvent.",
};

const SET: TaskWords = {
  title: "Set and press",
  reference: "Hairline aligned",
  how: ["Align the front hairline first.", "Press front to back, then the sides.", "Hold each section a few seconds."],
  watch: "Check the hairline in the mirror with the client.",
};

const TASKS: Readonly<Record<string, TaskWords>> = localised({
  piece_removed: REMOVE,
  old_piece_removed: { ...REMOVE, title: "Remove the old hair system" },
  scalp_cleaned: {
    title: "Clean the scalp",
    reference: "Bonding area, cleaned",
    how: ["Shampoo the scalp.", "Wipe the bonding area with alcohol.", "Dry fully."],
    watch: "Redness or cuts: note it and tell ops.",
  },
  piece_cleaned: {
    title: "Clean the hair system",
    reference: "Base with old tape removed",
    how: [
      "Take old tape and adhesive off the base with solvent.",
      "Wash and condition the hair.",
      "Dry it and check the base for tears.",
    ],
    watch: "Torn base: don’t refit. Call ops.",
  },
  piece_refitted: {
    title: "Refit the hair system",
    reference: "Hairline aligned",
    how: [
      "Tape the base: front, sides, back.",
      "Align the front hairline first.",
      "Press front to back, then the sides.",
    ],
    watch: "Check the hairline in the mirror with the client.",
  },
  template_checked: {
    title: "Check the template",
    reference: "Template on the head, front",
    how: [
      "Place the template on the head.",
      "Check the front hairline against the consultation.",
      "Check the sides and crown for gaps.",
    ],
    watch: "Doesn’t sit right: call the lead technician before cutting.",
  },
  base_trimmed: {
    title: "Trim the base",
    reference: "Base marked from the template",
    how: [
      "Mark the outline from the template.",
      "Trim in small cuts, front first.",
      "Recheck on the head after each side.",
    ],
    watch: "A trimmed base can’t be undone. Cut less, check more.",
  },
  adhesive_applied: {
    title: "Apply the tape",
    reference: "Tape placement on the base",
    how: [
      "Wipe the bonding area with alcohol.",
      "Tape the base: front, sides, back.",
      "Peel the liners once the system is in position.",
    ],
    watch: null,
  },
  piece_set: SET,
  cut_and_styled: {
    title: "Cut and style",
    reference: "Blend at the sides",
    how: ["Blend into the client’s hair at the sides and back.", "Style as agreed at the consultation."],
    watch: null,
  },
  aftercare_explained: {
    title: "Explain aftercare",
    reference: "Aftercare card",
    how: [
      "When the client can first wash it.",
      "Shampoo and products to use.",
      "Sleep, sport and swimming.",
      "Next service date.",
    ],
    watch: null,
  },
  scalp_checked: {
    title: "Check the scalp",
    reference: "Scalp under good light",
    how: ["Look over the scalp under good light.", "Note irritation, cuts or skin conditions."],
    watch: "Broken skin: no fit. Record it and tell ops.",
  },
});

/** A job sheet's item as a task: its words here, or its label alone. */
export function taskFor(item: { readonly id: string; readonly label: string }): TaskWords {
  return TASKS[item.id] ?? { title: sayNow(item.label), reference: "", how: [], watch: null };
}
