// Cloudflare Turnstile, the check the site's forms and the client app's login
// carry. Neither design has a slot for it, so the managed widget renders with
// appearance "interaction-only": invisible unless Cloudflare needs the visitor
// to act. Each front end keeps its own site keys (docs/turnstile.md).

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
  remove(widget: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

/** Loads the script once. A load that fails is forgotten, so the next attempt fetches it again. */
function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    const fail = () => {
      script.remove();
      loading = undefined;
      reject(new Error("Turnstile did not load"));
    };
    script.onload = () => {
      if (window.turnstile === undefined) fail();
      else resolve(window.turnstile);
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

export type TurnstileWidget = ReturnType<typeof turnstileWidget>;

/**
 * A widget in `container` that keeps one fresh token. `token()` waits for it,
 * up to `waitMs`, and first tries the script again if it had failed to load;
 * `renew()` asks for another once a token has been used; `remove()` takes the
 * widget out when its container goes.
 */
export function turnstileWidget(container: HTMLElement, siteKey: string) {
  let current: string | null = null;
  let waiting: ((token: string | null) => void)[] = [];
  let widget: string | undefined;
  let api: Promise<TurnstileApi | undefined> | undefined;
  let removed = false;

  const settle = (token: string | null) => {
    current = token;
    if (token === null) return;
    for (const resolve of waiting) resolve(token);
    waiting = [];
  };

  /** Renders the widget, unless it already has or is on its way to. */
  const render = () => {
    api ??= load()
      .then((turnstile) => {
        if (removed) return turnstile;
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
        return turnstile;
      })
      .catch(() => {
        api = undefined;
        return undefined;
      });
  };
  render();

  return {
    token(waitMs = 15_000): Promise<string | null> {
      if (current !== null) return Promise.resolve(current);
      render();
      return new Promise((resolve) => {
        waiting.push(resolve);
        setTimeout(() => {
          resolve(null);
        }, waitMs);
      });
    },
    async renew(): Promise<void> {
      current = null;
      const turnstile = await api;
      if (turnstile !== undefined && widget !== undefined && !removed) turnstile.reset(widget);
    },
    async remove(): Promise<void> {
      removed = true;
      current = null;
      const turnstile = await api;
      if (turnstile !== undefined && widget !== undefined) turnstile.remove(widget);
    },
  };
}
