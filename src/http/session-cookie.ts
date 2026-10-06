// A session's cookie (docs/decisions/0029-sessions.md): host-only under its __Host- name, HttpOnly, Secure,
// SameSite=Lax, at path /, 90 days from last use. The name it had until October 2026 is still read, and cleared, until
// every session it names has lapsed.

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SESSION_TTL_MS } from "../domain/sign-in/sessions.ts";
import type { AppEnv } from "./context.ts";

interface SessionCookie {
  /** No Domain attribute: the cookie stays on the app's own host. */
  readonly set: (c: Context<AppEnv>, token: string) => void;
  readonly clear: (c: Context<AppEnv>) => void;
  /** The token the request carries, if it is shaped as a session's can be. */
  readonly tokenOf: (c: Context<AppEnv>) => string | null;
}

export function sessionCookie(name: `__Host-${string}`, oldName: string): SessionCookie {
  return {
    set: (c, token) => {
      setCookie(c, name, token, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_TTL_MS / 1000,
      });
    },
    clear: (c) => {
      deleteCookie(c, name, { path: "/", secure: true });
      deleteCookie(c, oldName, { path: "/", secure: true });
    },
    tokenOf: (c) => {
      const token = getCookie(c, name) ?? getCookie(c, oldName);
      return token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    },
  };
}
