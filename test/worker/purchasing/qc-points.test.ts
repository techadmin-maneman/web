// The checks on a hair system that arrives (src/routes/ops/qc-points.ts,
// docs/decisions/0283-changed-and-deleted-while-unused.md): the five the code held, each added, renamed, switched off,
// or deleted while no claim names it, each change audited. A claim keeping the names it read is held in
// ./supplier-claims.test.ts.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { POST, auditFor } from "../ops/ops-settings-fixtures.ts";

let ops: App;

const send = (method: string, path: string, body?: unknown) =>
  request(ops, path, { method, headers: POST, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const points = async () =>
  (await (await request(ops, "/api/qc-points")).json<{ points: { id: string; name: string; checked: boolean }[] }>())
    .points;

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("a check on a hair system that arrives", () => {
  it("is one of the five the code held, each checked, until ops change them", async () => {
    expect((await points()).map((point) => [point.id, point.name, point.checked])).toEqual([
      ["base_size", "Base size", true],
      ["colour", "Colour against the ring", true],
      ["density", "Density", true],
      ["lace_knots", "Lace and knots", true],
      ["label", "Label", true],
    ]);
  });

  it("is added last, checked, and audited; a name another goes by, however cased, is refused", async () => {
    const added = await send("POST", "/api/qc-points", { name: "Hairline shape " });
    expect(added.status).toBe(201);
    const point = await added.json<{ id: string; name: string; checked: boolean; deletable: boolean }>();
    expect(point).toMatchObject({ name: "Hairline shape", checked: true, deletable: true });
    expect((await points()).at(-1)).toMatchObject({ id: point.id, name: "Hairline shape" });
    expect((await auditFor("qc_point.add")).results).toEqual([expect.objectContaining({ subject_id: point.id })]);

    const taken = await send("POST", "/api/qc-points", { name: "hairline SHAPE" });
    expect(taken.status).toBe(409);
    expect((await send("PATCH", `/api/qc-points/${point.id}`, { name: "label", checked: true })).status).toBe(409);
    expect((await auditFor("qc_point.change")).results).toEqual([]);
  });

  it("is renamed and switched off, audited, and deleted while no claim names it", async () => {
    const changed = await send("PATCH", "/api/qc-points/label", { name: "Label inside the base", checked: false });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ id: "label", name: "Label inside the base", checked: false });
    expect((await auditFor("qc_point.change")).results).toEqual([
      expect.objectContaining({ subject_id: "label", detail: JSON.stringify({ checked: false }) }),
    ]);

    expect((await send("POST", "/api/qc-points/label/delete")).status).toBe(204);
    expect(await env.DB.prepare("SELECT 1 FROM qc_points WHERE id = 'label'").first()).toBeNull();
    expect((await auditFor("qc_point.delete")).results).toEqual([expect.objectContaining({ subject_id: "label" })]);
    expect((await send("POST", "/api/qc-points/label/delete")).status).toBe(404);
    expect((await send("PATCH", "/api/qc-points/label", { name: "Label", checked: true })).status).toBe(404);
  });
});
