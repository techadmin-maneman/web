// The one way the front ends call mm-api (ADR 0037's "API client"; FEA-30,
// FEA-40, FEO-29, FEO-30). Each front end makes its client from its own
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
//   - a refusal carries the API's code and the fields it refused;
//   - a call that never reached the API, gave up waiting, or was answered by
//     something that is not the API (a Wi-Fi sign-in page) is "offline";
//   - a session that has ended is heard in one place, `onSessionEnded`,
//     whichever call met it.
//
// Every call is same-origin, so the session's cookie goes with it and the
// Origin matches (docs/decisions/0026-hosts-and-surfaces.md).

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

/** The options argument: required when the operation needs a path, a query or a body, and optional when not. */
type OptionsArgument<Op> = object extends CallOptions<Op> ? [options?: CallOptions<Op>] : [options: CallOptions<Op>];

// ---- Answers -----------------------------------------------------------------

/** Why a call failed without the API saying: it never reached it, or the API gave no code. */
export type LocalCode = "offline" | "unknown";

/**
 * A call's answer. `cached` is true when the service worker answered from its
 * copy (the header both apps' service workers set); `fields` names what an
 * invalid request got wrong, or what changed under a superseded one.
 */
export type Answer<T, Code extends string = string> =
  | { readonly ok: true; readonly status: number; readonly body: T; readonly cached: boolean }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: Code | LocalCode;
      readonly fields: readonly string[];
    };

export interface ClientOptions {
  /** How long a call waits before it counts as no connection; unbounded unless an app sets it. */
  readonly patience?: number;
  /** "manual" where a redirect is never the API's, as behind the console's Access. */
  readonly redirect?: RequestRedirect;
  /** Whether a refusal means the session has ended: a 401 unless the app says more. */
  readonly sessionEnded?: (response: Response, code: string | undefined) => boolean;
  /** The one place a session that has ended is heard, with the API's code, whichever call met it. */
  readonly onSessionEnded?: (code: string) => void;
  /** Every answer that reached the API, once read: the client app sets its clock from it, the technician app its signal. */
  readonly onAnswer?: (response: Response) => void;
  /** A call that reached nothing, or nothing that was the API. */
  readonly onUnreached?: () => void;
  /** The code of a refusal that carried none, by its status: the technician app counts a bare 409 as superseded. */
  readonly missingCode?: (status: number) => string;
}

/** The header the apps' service workers set on an answer from their copy. */
const SERVED_FROM = "Mm-Served-From";

const OFFLINE = { ok: false, status: 0, code: "offline", fields: [] } as const;

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

/** One request, or null when nothing answered in time. */
async function reach(url: string, init: RequestInit, patience: number | undefined): Promise<Response | null> {
  const giveUp = new AbortController();
  const timer =
    patience === undefined
      ? undefined
      : setTimeout(() => {
          giveUp.abort();
        }, patience);
  try {
    return await fetch(url, { ...init, credentials: "same-origin", signal: giveUp.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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

async function refusalOf(response: Response): Promise<{ code?: string; fields?: string[] }> {
  const read = (await response.json().catch(() => null)) as { error?: { code?: string; fields?: string[] } } | null;
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
  request<T>(
    method: string,
    url: string,
    init?: { body?: BodyInit; json?: unknown } & Sending,
  ): Promise<Answer<T, Code>>;
}

export function createClient<Paths, Code extends string = string>(options: ClientOptions = {}): Client<Paths, Code> {
  const sessionEnded = options.sessionEnded ?? isSessionEnded;
  const missingCode = options.missingCode ?? (() => "unknown");

  async function read<T>(response: Response): Promise<Answer<T, Code>> {
    if (response.ok) {
      const body = await bodyOf(response);
      if (body === undefined) {
        options.onUnreached?.();
        return OFFLINE;
      }
      options.onAnswer?.(response);
      return {
        ok: true,
        status: response.status,
        body: body as T,
        cached: response.headers.get(SERVED_FROM) === "cache",
      };
    }
    options.onAnswer?.(response);
    const { code, fields } = await refusalOf(response);
    if (sessionEnded(response, code)) options.onSessionEnded?.(code ?? "unknown");
    // The API's codes are the document's; one it did not send is the app's own reading of the status.
    const said = (code ?? missingCode(response.status)) as Code | LocalCode;
    return { ok: false, status: response.status, code: said, fields: fields ?? [] };
  }

  async function request<T>(
    method: string,
    url: string,
    init: { body?: BodyInit; json?: unknown } & Sending = {},
  ): Promise<Answer<T, Code>> {
    const headers: Record<string, string> = { ...init.headers };
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    const body = init.json === undefined ? init.body : JSON.stringify(init.json);
    const response = await reach(
      url,
      {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(options.redirect === undefined ? {} : { redirect: options.redirect }),
      },
      init.patience ?? options.patience,
    );
    if (response === null) {
      options.onUnreached?.();
      return OFFLINE;
    }
    return read<T>(response);
  }

  /** A typed call: the document's path filled in, its query added and its body sent as JSON. */
  const call =
    (method: Method) =>
    (path: string, ...[given]: [({ path?: object; query?: object; body?: unknown } & Sending)?]) =>
      request(method.toUpperCase(), urlOf(path, given?.path, given?.query), {
        ...(given?.body === undefined ? {} : { json: given.body }),
        ...(given?.headers === undefined ? {} : { headers: given.headers }),
        ...(given?.patience === undefined ? {} : { patience: given.patience }),
      });

  return {
    get: call("get"),
    post: call("post"),
    put: call("put"),
    patch: call("patch"),
    delete: call("delete"),
    request,
  } as Client<Paths, Code>;
}
