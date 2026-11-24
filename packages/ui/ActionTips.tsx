// The words of an action drawn as its icon (./icon-actions.ts), shown above it as the pointer rests on it or the
// keyboard comes to it, and gone on leaving, on Escape or on a scroll. One label serves the whole app: it stands in the
// browser's top layer, so a drawer or a dialog never covers it. It is drawn for the eye alone; the button's own words
// are its name for a screen reader.

import { useEffect, useRef } from "react";
import styles from "./action-tips.module.css";

/** How long the pointer rests before the words show, in milliseconds; the keyboard shows them at once. */
const REST = 350;
/** The gap between an action and its words, and the least room kept from the window's edge, in pixels. */
const GAP = 8;

/** The element whose words show: an action that names them in `data-tip`. */
const tipped = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;

/** Places the words above the action, or below it where the window has no room above, inside the window's edges. */
function place(tip: HTMLElement, at: HTMLElement): void {
  const box = at.getBoundingClientRect();
  const own = tip.getBoundingClientRect();
  const left = Math.min(Math.max(GAP, box.left + box.width / 2 - own.width / 2), window.innerWidth - own.width - GAP);
  const above = box.top - own.height - GAP;
  tip.style.setProperty("--tip-x", `${String(Math.round(left))}px`);
  tip.style.setProperty("--tip-y", `${String(Math.round(above >= GAP ? above : box.bottom + GAP))}px`);
}

export function ActionTips() {
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = tip.current;
    if (element === null || typeof element.showPopover !== "function") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shownFor: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      shownFor = null;
      if (element.matches(":popover-open")) element.hidePopover();
    };
    const show = (at: HTMLElement) => {
      const words = at.dataset.tip ?? "";
      if (words === "" || at.matches(":disabled")) return;
      element.textContent = words;
      if (!element.matches(":popover-open")) element.showPopover();
      place(element, at);
      shownFor = at;
    };
    const rest = (event: PointerEvent) => {
      const at = tipped(event.target);
      if (at === shownFor) return;
      hide();
      if (at !== null && event.pointerType !== "touch") {
        timer = setTimeout(() => {
          show(at);
        }, REST);
      }
    };
    const focus = (event: FocusEvent) => {
      const at = tipped(event.target);
      hide();
      if (at?.matches(":focus-visible")) show(at);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", rest);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", rest);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div ref={tip} popover="manual" className={styles.tip} aria-hidden="true" />;
}
