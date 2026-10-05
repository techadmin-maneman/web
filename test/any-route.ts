// What any /api/* route can answer besides its own documented replies, by status and error code (src/app.ts): the
// error handler's 500; the database check's 503, which runs before any route; and the 403s of the middleware that
// stands before every route of a surface: Access and the Staff list on the console's, and the Origin check on every
// write off the public site. The browser tests' contract (e2e/contract.ts) and the Worker tests' (test/worker/contract.ts)
// both allow them.

export const ANY_ROUTE: Readonly<Record<number, readonly string[]>> = {
  403: ["access_required", "not_permitted", "forbidden_origin"],
  500: ["internal_error"],
  503: ["unavailable", "environment_mismatch"],
};
