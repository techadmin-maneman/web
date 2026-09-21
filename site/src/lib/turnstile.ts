// Cloudflare Turnstile, the check every mutating call carries. The design has
// no slot for it, so the managed widget renders with appearance
// "interaction-only": invisible unless Cloudflare needs the visitor to act.
// Site keys are public (docs/turnstile.md).

import type { SiteEnvironment } from "./environment.ts";

export const TURNSTILE_SITE_KEYS: Readonly<Record<SiteEnvironment, string>> = {
  local: "1x00000000000000000000AA", // Cloudflare's always-pass test key
  staging: "0x4AAAAAAE-0a-QSaClo_rF3",
  production: "0x4AAAAAAE-0bRotsEzMTpZV",
};

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.turnstile === undefined) reject(new Error("Turnstile did not load"));
      else resolve(window.turnstile);
    };
    script.onerror = () => {
      reject(new Error("Turnstile did not load"));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * A widget in `container` that keeps one fresh token. `token()` waits for it,
 * up to `waitMs`; `renew()` asks for another once a token has been used.
 */
export function turnstileWidget(container: HTMLElement, siteKey: string) {
  let current: string | null = null;
  let waiting: ((token: string | null) => void)[] = [];
  let widget: string | undefined;
  const api = load();

  const settle = (token: string | null) => {
    current = token;
    if (token === null) return;
    for (const resolve of waiting) resolve(token);
    waiting = [];
  };

  void api
    .then((turnstile) => {
      widget = turnstile.render(container, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: settle,
        "expired-callback": () => {
          settle(null);
        },
        "error-callback": () => {
          settle(null);
        },
      });
    })
    .catch(() => undefined);

  return {
    token(waitMs = 15_000): Promise<string | null> {
      if (current !== null) return Promise.resolve(current);
      return new Promise((resolve) => {
        waiting.push(resolve);
        setTimeout(() => {
          resolve(null);
        }, waitMs);
      });
    },
    async renew(): Promise<void> {
      current = null;
      const turnstile = await api.catch(() => undefined);
      if (turnstile !== undefined && widget !== undefined) turnstile.reset(widget);
    },
  };
}
