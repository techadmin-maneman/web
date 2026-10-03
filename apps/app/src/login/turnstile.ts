// The Turnstile check a login code is asked for with (docs/turnstile.md). The
// widget renders into the box of whichever screen can ask for a code, and is
// invisible unless Cloudflare needs the client to act.

import { turnstileWidget, type TurnstileWidget } from "@maneman/web-kit/turnstile";
import { useCallback, useRef } from "react";

/**
 * Cloudflare's always-pass test key, for a local run and staging: their APIs accept the token it gives, and the
 * staging widget does not list the app's host.
 */
const ALWAYS_PASSES = "1x00000000000000000000AA";
/** The production widget, mm-production, whose hostnames must list the app's. */
const PRODUCTION = "0x4AAAAAAE-0bRotsEzMTpZV";

const SITE_KEY = import.meta.env.MM_ENV === "production" ? PRODUCTION : ALWAYS_PASSES;

/**
 * `box` is the ref for a screen's Turnstile box: each box that appears gets a widget, removed with it. `token()`
 * waits for the showing widget's token, null if none comes; `renew()` asks for another once one has been used.
 */
export function useTurnstile() {
  const widget = useRef<TurnstileWidget | null>(null);

  const box = useCallback((element: HTMLDivElement) => {
    const made = turnstileWidget(element, SITE_KEY);
    widget.current = made;
    return () => {
      void made.remove();
      if (widget.current === made) widget.current = null;
    };
  }, []);

  const token = useCallback(async (): Promise<string | null> => (await widget.current?.token()) ?? null, []);

  const renew = useCallback(() => {
    void widget.current?.renew();
  }, []);

  return { box, token, renew };
}
