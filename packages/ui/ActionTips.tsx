// The words of an action drawn as its icon (./icon-actions.ts), shown above it as the pointer rests on it, the keyboard
// comes to it or a finger presses and holds it, and gone on leaving, on Escape, on a scroll or on the next touch. One
// that cannot act yet says what it waits for beneath its name: the line its aria-describedby names (./Missing.tsx).
// One label serves the whole app: it stands in the browser's top layer, so a drawer or a dialog never covers it. It
// is drawn for the eye alone; the button's own words are its name for a screen reader.

import { useEffect, useRef } from "react";
import styles from "./action-tips.module.css";

/** How long the pointer rests before the words show, in milliseconds; the keyboard shows them at once. */
const REST = 350;
/** How long a finger holds an action before its words show instead of it acting, in milliseconds. */
const HOLD = 500;
/** The gap between an action and its words, and the least room kept from the window's edge, in pixels. */
const GAP = 8;

/** The element whose words show: an action that names them in `data-tip`. */
const tipped = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;

/** What an action that cannot act yet waits for: the text of the lines its aria-describedby names. */
function waitsFor(at: HTMLElement): string {
  if (at.getAttribute("aria-disabled") !== "true") return "";
  return (at.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => (id === "" ? "" : (document.getElementById(id)?.textContent ?? "").trim()))
    .filter((line) => line !== "")
    .join(" ");
}

/** Places the words above the action, or below it where the window has no room above, inside the window's edges. */
function place(tip: HTMLElement, at: HTMLElement): void {
  const box = at.getBoundingClientRect();
  const own = tip.getBoundingClientRect();
  const left = Math.min(Math.max(GAP, box.left + box.width / 2 - own.width / 2), window.innerWidth - own.width - GAP);
  const above = box.top - own.height - GAP;
  tip.style.setProperty("--tip-x", `${String(Math.round(left))}px`);
  tip.style.setProperty("--tip-y", `${String(Math.round(above >= GAP ? above : box.bottom + GAP))}px`);
}

/** The one label: shown for an action, with what it waits for on a line beneath, and hidden. */
function labelOf(element: HTMLElement) {
  let shownFor: HTMLElement | null = null;
  return {
    showing: (at: HTMLElement | null) => at === shownFor,
    hide() {
      shownFor = null;
      if (element.matches(":popover-open")) element.hidePopover();
    },
    show(at: HTMLElement) {
      const words = at.dataset.tip ?? "";
      if (words === "" || at.matches(":disabled")) return;
      const lines = [words, waitsFor(at)].filter((line) => line !== "");
      element.replaceChildren(
        ...lines.map((line) => Object.assign(document.createElement("span"), { textContent: line })),
      );
      if (!element.matches(":popover-open")) element.showPopover();
      place(element, at);
      shownFor = at;
    },
  };
}

type Label = ReturnType<typeof labelOf>;
type Handler = readonly [Document | Window, string, (event: Event) => void, boolean];

/**
 * A wait under way; the action a held finger showed the words of, whose ending tap does not act on it; and whether the
 * last press was a finger's, the only press whose menu the label keeps away.
 */
interface Hold {
  timer?: ReturnType<typeof setTimeout>;
  held: HTMLElement | null;
  touch: boolean;
}

/** What the pointer and the finger do to the label: a rest shows the words, a hold shows them instead of acting. */
function pointerHandlers(label: Label, hold: Hold, hide: () => void): Handler[] {
  const later = (at: HTMLElement, wait: number, holding: boolean) => {
    hold.timer = setTimeout(() => {
      label.show(at);
      if (holding) hold.held = at;
    }, wait);
  };
  const stop = () => {
    clearTimeout(hold.timer);
  };
  const over = (event: Event) => {
    const at = tipped(event.target);
    if ((event as PointerEvent).pointerType === "touch" || (at !== null && label.showing(at))) return;
    hide();
    if (at !== null) later(at, REST, false);
  };
  const down = (event: Event) => {
    hide();
    hold.held = null;
    hold.touch = (event as PointerEvent).pointerType === "touch";
    const at = tipped(event.target);
    if (hold.touch && at !== null) later(at, HOLD, true);
  };
  const tap = (event: Event) => {
    const { held } = hold;
    if (held === null) return;
    hold.held = null;
    // A click from the keyboard (no pointer, detail 0) is always the person's own.
    if ((event as MouseEvent).detail === 0 || !(event.target instanceof Node) || !held.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const menu = (event: Event) => {
    if (hold.held !== null || (hold.touch && tipped(event.target) !== null)) event.preventDefault();
  };
  return [
    [document, "pointerover", over, false],
    [document, "pointerdown", down, false],
    [document, "pointerup", stop, false],
    [document, "pointercancel", stop, false],
    [document, "click", tap, true],
    [document, "contextmenu", menu, false],
    [document, "keydown", () => (hold.held = null), true],
  ];
}

/** What the keyboard and a scroll do to the label: focus shows the words at once; Escape and a scroll take them away. */
function otherHandlers(label: Label, hide: () => void): Handler[] {
  const focus = (event: Event) => {
    const at = tipped(event.target);
    hide();
    if (at?.matches(":focus-visible")) label.show(at);
  };
  const key = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape") hide();
  };
  return [
    [document, "focusin", focus, false],
    [document, "focusout", hide, false],
    [document, "keydown", key, false],
    [window, "scroll", hide, true],
  ];
}

/** The label following the page's actions; the cleanup that stops it. */
function follow(element: HTMLElement): () => void {
  const label = labelOf(element);
  const hold: Hold = { held: null, touch: false };
  const hide = () => {
    clearTimeout(hold.timer);
    label.hide();
  };
  const handlers = [...pointerHandlers(label, hold, hide), ...otherHandlers(label, hide)];
  for (const [target, type, handler, capture] of handlers) target.addEventListener(type, handler, capture);
  return () => {
    hide();
    for (const [target, type, handler, capture] of handlers) target.removeEventListener(type, handler, capture);
  };
}

export function ActionTips() {
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = tip.current;
    if (element === null || typeof element.showPopover !== "function") return;
    return follow(element);
  }, []);
  return <div ref={tip} popover="manual" className={styles.tip} aria-hidden="true" />;
}
