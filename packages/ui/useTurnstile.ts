// The Turnstile check the apps ask a login code with (docs/turnstile.md). The widget renders into the box of whichever
// screen can ask for a code, and is invisible unless Cloudflare needs the person to act.

import { turnstileWidget, type TurnstileWidget } from "@maneman/web-kit/turnstile";
import { useCallback, useRef } from "react";

/**
 * Cloudflare's always-pass test key, for a local run and staging: their APIs accept the token it gives, and the
 * staging widget does not list the app's host.
 */
const ALWAYS_PASSES = "1x00000000000000000000AA";
/** The production widget, mm-production, whose hostnames cover the apps' hosts. */
const PRODUCTION = "0x4AAAAAAE-0bRotsEzMTpZV";

/** An app's site key, for the environment it was built for. */
export const appSiteKey = (environment: string): string => (environment === "production" ? PRODUCTION : ALWAYS_PASSES);

/**
 * `box` is the ref for a screen's Turnstile box: each box that appears gets a widget, removed with it, made once the
 * person starts on the box's form, so no challenge competes with the screen's first paint. `token()` waits for the
 * showing widget's token, making it first where the form was sent without being focused, null if none comes;
 * `renew()` asks for another once one has been used.
 */
export function useTurnstile(siteKey: string) {
  const widget = useRef<TurnstileWidget | null>(null);
  /** Makes the showing box's widget, if it has none yet. */
  const start = useRef<(() => void) | null>(null);

  const box = useCallback(
    (element: HTMLDivElement) => {
      let made: TurnstileWidget | null = null;
      const make = () => {
        made ??= turnstileWidget(element, siteKey);
        widget.current = made;
      };
      start.current = make;
      const form = element.closest("form");
      form?.addEventListener("focusin", make);
      form?.addEventListener("input", make);
      return () => {
        form?.removeEventListener("focusin", make);
        form?.removeEventListener("input", make);
        void made?.remove();
        if (widget.current === made) widget.current = null;
        if (start.current === make) start.current = null;
      };
    },
    [siteKey],
  );

  const token = useCallback(async (): Promise<string | null> => {
    if (widget.current === null) start.current?.();
    return (await widget.current?.token()) ?? null;
  }, []);

  const renew = useCallback(() => {
    void widget.current?.renew();
  }, []);

  return { box, token, renew };
}
