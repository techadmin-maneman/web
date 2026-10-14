// The SQL statements left in each route file, which the domain is to own (docs/architecture.md, "Routes").
// A file may only hold fewer, and one not listed none (test/node/architecture/route-sql.test.ts).

export const ROUTE_SQL: Readonly<Record<string, number>> = {
  "src/routes/client/changes.ts": 1,
  "src/routes/client/data.ts": 1,
  "src/routes/client/problems.ts": 1,
  "src/routes/dev-visits.ts": 1,
  "src/routes/ops/cities.ts": 1,
  "src/routes/ops/client-consents.ts": 1,
  "src/routes/ops/client-photos.ts": 1,
  "src/routes/ops/clients.ts": 3,
  "src/routes/ops/custom-orders.ts": 2,
  "src/routes/ops/demand-events.ts": 1,
  "src/routes/ops/profile.ts": 2,
  "src/routes/ops/purchasing.ts": 1,
  "src/routes/ops/referrals.ts": 1,
  "src/routes/ops/spend.ts": 1,
  "src/routes/ops/stock.transit.ts": 1,
  "src/routes/ops/suppliers.ts": 1,
  "src/routes/ops/supply-plan.ts": 1,
  "src/routes/ops/targets.ts": 1,
  "src/routes/ops/waitlist.ts": 1,
  "src/routes/public/tryon-generate.ts": 1,
  "src/routes/tech/auth.ts": 1,
  "src/routes/tech/kit.ts": 1,
  "src/routes/tech/pieces.ts": 2,
};
