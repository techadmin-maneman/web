// The one way the front ends call mm-api (ADR 0037's "API client"). Each front end makes its client from its own
// surface's document, which `npm run openapi` writes into its api-schema.ts:
//
//   const client = createClient<paths, ErrorCode>({ onSessionEnded: ... });
//   client.get("/api/visits/{id}", { path: { id } });
//   client.post("/api/auth/otp", { body: { mobile } });
//
// so a path, a query, a body and what the answer carries are all checked
// against the API as it is. Every answer is read the same way:
//
//   - a success carries the body of its 2xx answer, null when it has none,
//     and whether the service worker answered from its copy (`cached`);
//   - a refusal carries the API's code and the fields it refused, and, on a
//     technician's write for a job given to another technician, whom and when;
//   - a call that never reached the API, gave up waiting, or was answered by
//     something that is not the API (a Wi-Fi sign-in page) is "offline";
//   - a session that has ended is heard in one place, `onSessionEnded`,
//     whichever call met it.
//
// Every call is same-origin, so the session's cookie goes with it and the
// Origin matches (docs/decisions/0026-hosts-and-surfaces.md).

import { pageBuild } from "./build.ts";

export type Method = "get" | "post" | "put" | "patch" | "delete";

// ---- Reading a surface's document --------------------------------------------

/** An operation as openapi-typescript writes it. */
interface Operation {
  readonly parameters: object;
  readonly responses: object;
}

/** The paths of a document that answer to `method`. */
export type PathOf<Paths, M extends Method> = {
  [P in keyof Paths]: Paths[P] extends Record<M, Operation> ? P : never;
}[keyof Paths] &
  string;

/** The operation at one path and method. */
export type OperationAt<Paths, P extends keyof Paths, M extends Method> =
  Paths[P] extends Record<M, infer Op> ? Op : never;

type JsonOf<Answer> = Answer extends { content: { "application/json": infer Body } } ? Body : null;

/** What an operation answers with when it succeeds: its 2xx answer's body, or null when it has none. */
export type Success<Op> = Op extends { responses: infer Answers }
  ? { [Status in keyof Answers]: Status extends 200 | 201 | 202 | 204 ? JsonOf<Answers[Status]> : never }[keyof Answers]
  : never;

/** What an operation is sent as its body. */
export type Sent<Op> = Op extends { requestBody?: { content: { "application/json": infer Body } } } ? Body : never;

type PathPart<Op> = Op extends { parameters: { path: infer Path } } ? { readonly path: Path } : unknown;

type QueryPart<Op> = Op extends { parameters: { query: infer Query } }
  ? { readonly query: Query }
  : Op extends { parameters: { query?: infer Query } }
    ? [Query] extends [undefined]
      ? unknown
      : { readonly query?: Query }
    : unknown;

type BodyPart<Op> = Op extends { requestBody: { content: { "application/json": infer Body } } }
  ? { readonly body: Body }
  : Op extends { requestBody?: { content: { "application/json": infer Body } } }
    ? { readonly body?: Body }
    : unknown;

/** What one call is given: its path's parts, its query and its body, as the operation asks, and how to send it. */
export type CallOptions<Op> = PathPart<Op> & QueryPart<Op> & BodyPart<Op> & Sending;

/** How to send one call, whatever the operation. */
interface Sending {
  /** Headers of the call's own, as the technician app's event id. */
  readonly headers?: Readonly<Record<string, string>>;
  /** How long to wait for this call, in milliseconds, in place of the client's own patience. */
  readonly patience?: number;
}

/** What `request` sends: a body as it is or as JSON, and whether the answer is a file rather than JSON. */
interface Asking extends Sending {
  readonly body?: BodyInit;
  readonly json?: unknown;
  /** The answer is a file, as a photograph the console opens, and is kept as it came. */
  readonly file?: boolean;
}

/** The options argument: required when the operation needs a path, a query or a body, and optional when not. */
type OptionsArgument<Op> = object extends CallOptions<Op> ? [options?: CallOptions<Op>] : [options: CallOptions<Op>];

// ---- Answers -----------------------------------------------------------------

/** Why a call failed without the API saying: it never reached it, or the API gave no code. */
export type LocalCode = "offline" | "unconfirmed" | "unknown";

/** The technician a job went to, by first name, and when ops moved it there (docs/open-points.md, item 92). */
export interface Moved {
  readonly technician: string;
  /** Null where nothing recorded when. */
  readonly at: string | null;
}

/**
 * A call's answer. `cached` is true when the service worker answered from its
 * copy (the header both apps' service workers set); `fields` names what an
 * invalid request got wrong, or what changed under a superseded one; `moved`,
 * on a superseded write of a job given to another technician, says to whom;
 * `requestId` is the API's ID for the call, which every line it logged of the
 * call carries, and null when the API never answered.
 */
export type Answer<T, Code extends string = string> =
  | { readonly ok: true; readonly status: number; readonly body: T; readonly cached: boolean }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: Code | LocalCode;
      readonly fields: readonly string[];
      readonly moved: Moved | null;
      readonly requestId: string | null;
    };

/** How long a call waits before it counts as no connection, in milliseconds: a GET, and any other call. */
export interface Patience {
  readonly read: number;
  readonly write: number;
}

/**
 * For an app that sets no patience of its own: past the API's slowest answer a person waits on, and well short
 * of the many minutes a browser would leave a button busy on a signal that never answers.
 */
const DEFAULT_PATIENCE: Patience = { read: 60_000, write: 60_000 };

export interface ClientOptions {
  /** How long a call waits before it counts as no connection; DEFAULT_PATIENCE unless the app sets its own. */
  readonly patience?: Patience;
  /** "manual" where a redirect is never the API's, as behind the console's Access. */
  readonly redirect?: RequestRedirect;
  /** Whether a refusal means the session has ended: a 401 unless the app says more. */
  readonly sessionEnded?: (response: Response, code: string | undefined) => boolean;
  /** The one place a session that has ended is heard, with the API's code, whichever call met it. */
  readonly onSessionEnded?: (code: string) => void;
  /** Every answer that reached the API, once read: the technician app sets its signal from it. */
  readonly onAnswer?: (response: Response) => void;
  /** Each answer the API gave now, not one a service worker answered from its copy: the apps set their clock from it. */
  readonly onFreshAnswer?: (response: Response) => void;
  /** A call that reached nothing, or nothing that was the API. */
  readonly onUnreached?: () => void;
  /**
   * Where Cloudflare Access may stand in front of the app, as on staging: a call it sent to its login page, its sign-in
   * run out. The redirect is not followed, and the call answers as no connection, so nothing counts it as refused.
   */
  readonly onAccessLapsed?: () => void;
  /** The code of a refusal that carried none, by its status: the technician app counts a bare 409 as superseded. */
  readonly missingCode?: (status: number) => string;
  /**
   * Whether each write carries an Idempotency-Key: a new one, or, for a write sent again whose answer never came, the
   * one it went with, so the API answers it as it did rather than doing it twice. Such a write is said to be
   * `unconfirmed`, not offline: it may have been done.
   */
  readonly keyWrites?: boolean;
  /** A write the API took, once answered: the apps tell whatever shows data, which reads it again (useLoad). */
  readonly onWrite?: () => void;
}

/** The header the apps' service workers set on an answer from their copy. */
const SERVED_FROM = "Mm-Served-From";

/** The header mm-api sets on every answer, refusals included. */
const REQUEST_ID = "X-Request-Id";

const OFFLINE = { ok: false, status: 0, code: "offline", fields: [], moved: null, requestId: null } as const;

/** A keyed write whose answer never came: it may have been done, and sending it again is answered, not done twice. */
const UNCONFIRMED = { ok: false, status: 0, code: "unconfirmed", fields: [], moved: null, requestId: null } as const;

/** How long a call waits: a read's patience, or a write's. */
const patienceFor = (patience: Patience, method: string): number =>
  method.toUpperCase() === "GET" ? patience.read : patience.write;

/** The headers a call goes with: the caller's own, and JSON's where it sends JSON. */
function headersOf(init: { readonly headers?: Readonly<Record<string, string>>; readonly json?: unknown }) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const build = pageBuild();
  if (build !== null) headers["X-Client-Version"] = build;
  return headers;
}

/** A write's body as its key compares it: the JSON sent, or nothing for a body of another kind. */
const textOf = (body: BodyInit | undefined): string => (typeof body === "string" ? body : "");

/** The key a write goes with, set on its headers: the one it went with when its answer never came, else a new one. */
function keyFor(unanswered: Map<string, string>, sent: string | null, headers: Record<string, string>): string | null {
  if (sent === null) return null;
  const key = headers["Idempotency-Key"] ?? unanswered.get(sent) ?? crypto.randomUUID();
  headers["Idempotency-Key"] = key;
  return key;
}

/** A keyed write kept while its answer never came, and let go once one does. */
function heardOf(unanswered: Map<string, string>, write: { sent: string; key: string; answered: boolean }): void {
  if (write.answered) unanswered.delete(write.sent);
  else unanswered.set(write.sent, write.key);
}

const isSessionEnded = (response: Response) => response.status === 401;

// ---- Asking ------------------------------------------------------------------

/** A path with its parts filled in, and the query after it: "/api/visits/{id}" with { id } → "/api/visits/a". */
export function urlOf(template: string, path: object | undefined, query: object | undefined): string {
  const parts = new Map(Object.entries(path ?? {}));
  const filled = template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    encodeURIComponent(String(parts.get(name) ?? "")),
  );
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) search.set(name, String(value));
  }
  const text = search.toString();
  return text === "" ? filled : `${filled}?${text}`;
}

/**
 * One request, or null when nothing answered in time. Its patience runs on until `finished`, once the body is read, so
 * a body that stalls is given up on too.
 */
async function reach(
  url: string,
  init: RequestInit,
  patience: number,
): Promise<{ readonly response: Response; readonly finished: () => void } | null> {
  const giveUp = new AbortController();
  const timer = setTimeout(() => {
    giveUp.abort();
  }, patience);
  try {
    const response = await fetch(url, { ...init, credentials: "same-origin", signal: giveUp.signal });
    return {
      response,
      finished: () => {
        clearTimeout(timer);
      },
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** A success's body: null for one with nothing in it, or undefined when it is not the API's JSON. */
async function bodyOf(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

interface Refusal {
  readonly code?: string;
  readonly fields?: string[];
  readonly moved?: Moved;
  readonly request_id?: string;
}

async function refusalOf(response: Response): Promise<Refusal> {
  const read = (await response.json().catch(() => null)) as { error?: Refusal } | null;
  return read?.error ?? {};
}

/** What a client does: a typed call for each method, and `request` for a URL the API gave, such as an upload's. */
export interface Client<Paths, Code extends string> {
  get<P extends PathOf<Paths, "get">>(
    path: P,
    ...options: OptionsArgument<OperationAt<Paths, P, "get">>
  ): Promise<Answer<Success<OperationAt<Paths, P, "get">>, Code>>;
  post<P extends PathOf<Paths, "post">>(
    path: P,
    ...options: OptionsArgument<OperationAt<Paths, P, "post">>
  ): Promise<Answer<Success<OperationAt<Paths, P, "post">>, Code>>;
  put<P extends PathOf<Paths, "put">>(
    path: P,
    ...options: OptionsArgument<OperationAt<Paths, P, "put">>
  ): Promise<Answer<Success<OperationAt<Paths, P, "put">>, Code>>;
  patch<P extends PathOf<Paths, "patch">>(
    path: P,
    ...options: OptionsArgument<OperationAt<Paths, P, "patch">>
  ): Promise<Answer<Success<OperationAt<Paths, P, "patch">>, Code>>;
  delete<P extends PathOf<Paths, "delete">>(
    path: P,
    ...options: OptionsArgument<OperationAt<Paths, P, "delete">>
  ): Promise<Answer<Success<OperationAt<Paths, P, "delete">>, Code>>;
  /**
   * A request to a URL the document does not name as such -- a photograph's upload link, a
   * queued write replayed from the phone's store -- read as every other answer is.
   */
  request<T>(method: string, url: string, init?: Asking): Promise<Answer<T, Code>>;
  /**
   * Hears each session that has ended, with the API's code, whichever call met it, until the answer is called. The app
   * forgets what it keeps and shows its sign-in, wherever the person was, so no page has to handle it.
   */
  onSessionEnded(listener: (code: string) => void): () => void;
}

/** Listeners, told each value in turn; `join` adds one until the answer it gives is called. */
function listeners<T>() {
  const joined = new Set<(value: T) => void>();
  return {
    tell: (value: T) => {
      for (const listener of joined) listener(value);
    },
    join: (listener: (value: T) => void) => {
      joined.add(listener);
      return () => {
        joined.delete(listener);
      };
    },
  };
}

/** A refusal as the client answers it, with the code the API gave, if any. */
async function refusalAnswer(response: Response, missingCode: (status: number) => string) {
  const { code, fields, moved, request_id } = await refusalOf(response);
  return {
    given: code,
    answer: {
      ok: false,
      status: response.status,
      // The API's codes are the document's; one it did not send is the app's own reading of the status.
      code: code ?? missingCode(response.status),
      fields: fields ?? [],
      moved: moved ?? null,
      requestId: request_id ?? response.headers.get(REQUEST_ID),
    } as const,
  };
}

/** A typed call: the document's path filled in, its query added and its body sent as JSON. */
const typedCall =
  <A>(request: (method: string, url: string, init?: Asking) => Promise<A>) =>
  (method: Method) =>
  (path: string, ...[given]: [({ path?: object; query?: object; body?: unknown } & Sending)?]) =>
    request(method.toUpperCase(), urlOf(path, given?.path, given?.query), {
      ...(given?.body === undefined ? {} : { json: given.body }),
      ...(given?.headers === undefined ? {} : { headers: given.headers }),
      ...(given?.patience === undefined ? {} : { patience: given.patience }),
    });

/**
 * A client's sending, with a read a second screen asks for while it is out sharing the first's answer, and each write
 * the API took told to `onWrite`.
 */
function sharedReads<A extends { readonly ok: boolean }>(
  send: (method: string, url: string, init?: Asking) => Promise<A>,
  onWrite: (() => void) | undefined,
) {
  const reading = new Map<string, Promise<A>>();
  return async (method: string, url: string, init: Asking = {}): Promise<A> => {
    if (method === "GET" && init.file !== true && init.headers === undefined) {
      const sharing = reading.get(url);
      if (sharing !== undefined) return sharing;
      const asked = send(method, url, init).finally(() => {
        reading.delete(url);
      });
      reading.set(url, asked);
      return asked;
    }
    const answer = await send(method, url, init);
    if (method !== "GET" && answer.ok) onWrite?.();
    return answer;
  };
}

export function createClient<Paths, Code extends string = string>(options: ClientOptions = {}): Client<Paths, Code> {
  const sessionEnded = options.sessionEnded ?? isSessionEnded;
  const redirect = options.redirect ?? (options.onAccessLapsed === undefined ? undefined : "manual");
  const missingCode = options.missingCode ?? (() => "unknown");
  const patience = options.patience ?? DEFAULT_PATIENCE;
  /** Each keyed write sent and never answered, by what it sent, with the key it went with. */
  const unanswered = new Map<string, string>();
  const ended = listeners<string>();

  function answered(response: Response): void {
    options.onAnswer?.(response);
    if (response.headers.get(SERVED_FROM) !== "cache") options.onFreshAnswer?.(response);
  }

  async function read<T>(response: Response, file: boolean): Promise<Answer<T, Code>> {
    if (response.ok) {
      const body = file ? await response.blob().catch(() => undefined) : await bodyOf(response);
      if (body === undefined) {
        options.onUnreached?.();
        return OFFLINE;
      }
      answered(response);
      return {
        ok: true,
        status: response.status,
        body: body as T,
        cached: response.headers.get(SERVED_FROM) === "cache",
      };
    }
    answered(response);
    const { given, answer } = await refusalAnswer(response, missingCode);
    if (sessionEnded(response, given)) {
      options.onSessionEnded?.(given ?? "unknown");
      ended.tell(given ?? "unknown");
    }
    return { ...answer, code: answer.code as Code | LocalCode };
  }

  async function send<T>(method: string, url: string, init: Asking = {}): Promise<Answer<T, Code>> {
    const headers = headersOf(init);
    const body = init.json === undefined ? init.body : JSON.stringify(init.json);
    const sent = options.keyWrites === true && method !== "GET" ? `${method} ${url} ${textOf(body)}` : null;
    const key = keyFor(unanswered, sent, headers);
    const reached = await reach(
      url,
      {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(redirect === undefined ? {} : { redirect }),
      },
      init.patience ?? patienceFor(patience, method),
    );
    if (sent !== null && key !== null) heardOf(unanswered, { sent, key, answered: reached !== null });
    if (reached === null) {
      options.onUnreached?.();
      return sent === null ? OFFLINE : UNCONFIRMED;
    }
    if (reached.response.type === "opaqueredirect" && options.onAccessLapsed !== undefined) {
      reached.finished();
      options.onAccessLapsed();
      options.onUnreached?.();
      return OFFLINE;
    }
    return read<T>(reached.response, init.file === true).finally(reached.finished);
  }

  const request = sharedReads(send, options.onWrite);
  const call = typedCall(request);
  return {
    get: call("get"),
    post: call("post"),
    put: call("put"),
    patch: call("patch"),
    delete: call("delete"),
    request,
    onSessionEnded: ended.join,
  } as Client<Paths, Code>;
}
