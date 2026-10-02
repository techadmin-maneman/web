// The pieces tab and the technician's label lookup (src/domain/pieces.ts),
// mirrored from FSM's assets, and the utilisation the board writes to events.
// NOW is Monday 21 September 2026, 12 noon in India. Every code is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { recordUtilisation } from "../../src/domain/dispatch.ts";
import { COMMITTED } from "../../src/domain/ops-settings.ts";
import { piecesOf, recordFailedPiece, recordFittedPiece, syncPieces } from "../../src/domain/pieces.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { createStubFsm, EMPTY_FSM, type FsmAsset, type FsmProvider, type StubFsm } from "../../src/providers/fsm.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request, type TestDependencies } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER_PERSON = "11111111-1111-4111-8111-111111111112";
const IMRAN = "33333333-3333-4333-8333-333333333331";
const JOB = "22222222-2222-4222-8222-222222222221";
const OWNER = { personId: PERSON, fsmContactId: "contact-1" };

const asset = (overrides: Partial<FsmAsset> = {}): FsmAsset => ({
  id: "asset-1",
  assetNumber: "MM-STD-4417-B",
  contactId: "contact-1",
  productId: "part-standard",
  productName: "Standard base",
  serialNumber: "LOT-2026-07",
  installedAt: "2026-07-01",
  status: "Active",
  modifiedAt: "2026-07-01T10:00:00+05:30",
  ...overrides,
});

let fsm: StubFsm;
let deps: TestDependencies;
let tech: App;
let ops: App;

const syncDeps = (provider: FsmProvider) => ({
  fsm: provider,
  alertOnce: deps.alertOnce,
  cycles: COMMITTED.pieceCycleDays,
});

/** Another client, with an FSM contact of their own. */
async function addOtherPerson(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000002', 'Kabir Sethi', 'contact-2')`,
  )
    .bind(OTHER_PERSON, NOW.toISOString())
    .run();
}

async function openAlertKeys(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key").all<{
    key: string;
  }>();
  return results.map((row) => row.key);
}

beforeEach(async () => {
  await markDatabase();
  fsm = createStubFsm({
    ...EMPTY_FSM,
    items: [{ id: "part-standard", name: "Standard base", type: "Part", price: null }],
    assets: { "contact-1": [asset()] },
  });
  deps = fakeDependencies({ fsm });
  tech = appFor("local", deps, {}, "tech");
  ops = appFor("local", deps, {}, "ops");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?2)`,
  )
    .bind(IMRAN, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'ap-1', ?2, 'replacement', 'scheduled', 'Scheduled', '2026-09-21T07:30:00.000Z',
       '2026-09-21T09:45:00.000Z', ?3, ?4, ?4)`,
  )
    .bind(JOB, PERSON, IMRAN, NOW.toISOString())
    .run();
});

describe("the mirror of FSM's assets", () => {
  it("computes the replacement due date from the base's cycle, which FSM has no field for", async () => {
    expect(await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW)).toBe(1);

    const [piece] = await piecesOf(env.DB, PERSON);
    expect(piece).toMatchObject({
      piece_code: "MM-STD-4417-B",
      base: "Standard base",
      supplier_lot: "LOT-2026-07",
      fitted_at: "2026-07-01",
      // 180 days on from the fit, the cycle the owner ruled for every base.
      replacement_due_at: "2026-12-28",
      failed_at: null,
    });
  });

  it("reads a piece FSM holds as Inactive back as failed, which is how our own failure writes it", async () => {
    const inactive = createStubFsm({
      ...EMPTY_FSM,
      assets: { "contact-1": [asset({ status: "Inactive" })] },
    });
    await syncPieces(env.DB, syncDeps(inactive), OWNER, NOW);

    const [piece] = await piecesOf(env.DB, PERSON);
    expect(piece?.failed_at).toBe(NOW.toISOString());
  });

  it("writes FSM's answer over the copy, and never doubles a piece", async () => {
    await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW);
    await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW);

    expect(await piecesOf(env.DB, PERSON)).toHaveLength(1);
  });

  it("takes none of another client's assets when FSM answers with them", async () => {
    await addOtherPerson();
    const everyAsset = createStubFsm({
      ...EMPTY_FSM,
      assets: {
        "contact-1": [asset(), asset({ id: "asset-2", assetNumber: "MM-STD-7001-A", contactId: "contact-2" })],
      },
    });

    expect(await syncPieces(env.DB, syncDeps(everyAsset), OWNER, NOW)).toBe(1);

    expect((await piecesOf(env.DB, PERSON)).map((piece) => piece.piece_code)).toEqual(["MM-STD-4417-B"]);
    const strays = await env.DB.prepare("SELECT COUNT(*) AS count FROM pieces WHERE fsm_id = 'asset-2'").first("count");
    expect(strays).toBe(0);
  });

  it("never moves a piece our copy has on another client, and tells ops once", async () => {
    await addOtherPerson();
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-theirs', 'asset-1', ?1, 'MM-STD-4417-B', 'Standard base', '2026-07-01', '2026-12-28', ?2)`,
    )
      .bind(OTHER_PERSON, NOW.toISOString())
      .run();

    expect(await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW)).toBe(0);
    await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW);

    expect(await piecesOf(env.DB, PERSON)).toEqual([]);
    expect((await piecesOf(env.DB, OTHER_PERSON)).map((piece) => piece.piece_code)).toEqual(["MM-STD-4417-B"]);
    expect(await openAlertKeys()).toEqual(["piece_owner_mismatch:asset-1"]);
    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toContain(`our records have it on client ${OTHER_PERSON}`);
  });
});

describe("a piece the technician fitted", () => {
  // The catalogue holds ops' consumables as parts too (docs/decisions/0087-consumables-and-stock.md), and "Bonding
  // glue" sorts before "Standard base": a piece whose base nobody named must still be built on a base.
  it("is never built on a consumable's part when its base is not named", async () => {
    const withConsumables = createStubFsm({
      ...EMPTY_FSM,
      items: [
        { id: "part-glue", name: "Bonding glue", type: "Part", price: 0 },
        { id: "part-acetone", name: "Acetone", type: "Part", price: 0 },
        { id: "part-standard", name: "Standard base", type: "Part", price: null },
      ],
    });
    await env.DB.prepare(
      `INSERT INTO consumables (code, name, unit, unit_cost, fsm_item_id, fsm_name, created_at, updated_at)
       VALUES ('bonding_glue', 'Bonding glue', 'ml', 90, NULL, NULL, ?1, ?1),
              ('solvent', 'Solvent', 'ml', 50, 'part-acetone', 'Acetone', ?1, ?1)`,
    )
      .bind(NOW.toISOString())
      .run();

    await recordFittedPiece(env.DB, withConsumables, {
      personId: PERSON,
      fsmContactId: "contact-1",
      appointmentId: JOB,
      pieceCode: "MM-STD-9002-A",
      base: null,
      supplierLot: null,
      fittedOn: "2026-09-21",
      replacementDue: "2027-03-20",
      now: NOW,
    });

    expect(withConsumables.made.assets[0]?.productId).toBe("part-standard");
  });

  it("becomes an asset in FSM first, then our copy, and a replay writes neither twice", async () => {
    const fitted = {
      personId: PERSON,
      fsmContactId: "contact-1",
      appointmentId: JOB,
      pieceCode: "MM-STD-9001-A",
      base: "Standard base",
      supplierLot: "LOT-2026-09",
      fittedOn: "2026-09-21",
      replacementDue: "2027-03-20",
      now: NOW,
    };
    const first = await recordFittedPiece(env.DB, fsm, fitted);
    const again = await recordFittedPiece(env.DB, fsm, fitted);

    expect(again).toBe(first);
    expect(fsm.made.assets).toHaveLength(1);
    expect(fsm.made.assets[0]).toMatchObject({
      contactId: "contact-1",
      assetNumber: "MM-STD-9001-A",
      productId: "part-standard",
      installedAt: "2026-09-21",
    });
    expect(await piecesOf(env.DB, PERSON)).toHaveLength(1);
  });

  it("finds by its label an asset FSM made whose answer never came, rather than making a second", async () => {
    const fitted = {
      personId: PERSON,
      fsmContactId: "contact-1",
      appointmentId: JOB,
      pieceCode: "MM-STD-9001-A",
      base: "Standard base",
      supplierLot: "LOT-2026-09",
      fittedOn: "2026-09-21",
      replacementDue: "2027-03-20",
      now: NOW,
    };
    fsm.loseAnswer("createAsset");
    await expect(recordFittedPiece(env.DB, fsm, fitted)).rejects.toThrow();

    const retried = await recordFittedPiece(env.DB, fsm, fitted);
    expect(fsm.made.assets).toHaveLength(1);
    const held = (await fsm.assets("contact-1")).find((each) => each.assetNumber === "MM-STD-9001-A");
    expect(retried).toBe(held?.id);
    expect(await piecesOf(env.DB, PERSON)).toHaveLength(1);
  });

  it("marks a failed piece in FSM and keeps the reason on our side", async () => {
    await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW);

    const done = await recordFailedPiece(env.DB, syncDeps(fsm), {
      pieceCode: "MM-STD-4417-B",
      reason: "base torn at the hairline",
      owner: OWNER,
      now: NOW,
    });

    expect(done).toBe(true);
    expect(fsm.made.assetUpdates).toEqual([{ assetId: "asset-1", status: "Inactive" }]);
    const [piece] = await piecesOf(env.DB, PERSON);
    expect(piece).toMatchObject({ failed_at: NOW.toISOString(), failure_reason: "base torn at the hairline" });
  });
});

describe("a piece that came off whose label our copy does not know", () => {
  it("is found among the client's own assets in FSM and marked failed", async () => {
    const done = await recordFailedPiece(env.DB, syncDeps(fsm), {
      pieceCode: "MM-STD-4417-B",
      reason: "lifted at the front",
      owner: OWNER,
      now: NOW,
    });

    expect(done).toBe(true);
    expect(fsm.made.assetUpdates).toEqual([{ assetId: "asset-1", status: "Inactive" }]);
    const [piece] = await piecesOf(env.DB, PERSON);
    expect(piece).toMatchObject({ piece_code: "MM-STD-4417-B", failure_reason: "lifted at the front" });
    expect(await openAlertKeys()).toEqual([]);
  });

  it("is never taken from another client's assets, and ops are told it is unknown", async () => {
    await addOtherPerson();
    const everyAsset = createStubFsm({
      ...EMPTY_FSM,
      assets: { "contact-1": [asset({ id: "asset-2", assetNumber: "MM-STD-7001-A", contactId: "contact-2" })] },
    });

    const done = await recordFailedPiece(env.DB, syncDeps(everyAsset), {
      pieceCode: "MM-STD-7001-A",
      reason: "torn",
      owner: OWNER,
      now: NOW,
    });

    expect(done).toBe(false);
    expect(everyAsset.made.assetUpdates).toEqual([]);
    expect(await piecesOf(env.DB, OTHER_PERSON)).toEqual([]);
    expect(await openAlertKeys()).toEqual(["piece_unknown:MM-STD-7001-A"]);
    expect(deps.alerts[0]).toContain(`not among client ${PERSON}'s pieces here or in FSM`);
  });
});

describe("the label the technician scans", () => {
  it("is found in the mirror, and says whether it is this job's client's", async () => {
    await syncPieces(env.DB, syncDeps(fsm), OWNER, NOW);
    const cookie = `mm_tech=${await openTechnicianSession(env.DB, {
      technicianId: IMRAN,
      deviceId: "phone-abc-123",
      label: null,
      now: NOW,
    })}`;

    const answer = await request(tech, `/api/tech/pieces/lookup?code=MM-STD-4417-B&job=${JOB}`, {
      headers: { Cookie: cookie },
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      piece: {
        piece_code: "MM-STD-4417-B",
        base: "Standard base",
        supplier_lot: "LOT-2026-07",
        fitted_at: "2026-07-01",
        replacement_due_at: "2026-12-28",
        failed_at: null,
        failure_reason: null,
      },
      belongs_to_this_job: true,
    });
    const unknown = await request(tech, "/api/tech/pieces/lookup?code=MM-STD-0000-Z", {
      headers: { Cookie: cookie },
    });
    expect(unknown.status).toBe(404);
  });
});

describe("GET /api/clients/:id/pieces", () => {
  it("reads FSM afresh, since FSM is the record", async () => {
    const answer = await request(ops, `/api/clients/${PERSON}/pieces`);

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      pieces: [
        {
          piece_code: "MM-STD-4417-B",
          base: "Standard base",
          supplier_lot: "LOT-2026-07",
          fitted_at: "2026-07-01",
          replacement_due_at: "2026-12-28",
          failed_at: null,
          failure_reason: null,
        },
      ],
    });
  });

  it("shows each of two clients only their own pieces when FSM answers every client's assets", async () => {
    await addOtherPerson();
    const everyAsset = [asset(), asset({ id: "asset-2", assetNumber: "MM-STD-7001-A", contactId: "contact-2" })];
    const unfiltered = createStubFsm({ ...EMPTY_FSM, assets: { "contact-1": everyAsset, "contact-2": everyAsset } });
    const opsApp = appFor("local", fakeDependencies({ fsm: unfiltered }), {}, "ops");

    const codesOf = async (personId: string) => {
      const answer = await request(opsApp, `/api/clients/${personId}/pieces`);
      const { pieces } = await answer.json<{ pieces: { piece_code: string }[] }>();
      return pieces.map((piece) => piece.piece_code);
    };

    expect(await codesOf(PERSON)).toEqual(["MM-STD-4417-B"]);
    expect(await codesOf(OTHER_PERSON)).toEqual(["MM-STD-7001-A"]);
    expect(await codesOf(PERSON)).toEqual(["MM-STD-4417-B"]);
  });
});

describe("the utilisation the board writes to events daily", () => {
  it("records yesterday's share of the day's slots, once", async () => {
    // Yesterday: one replacement, a slot and a half of the one technician's four.
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         technician_id, fsm_modified_at, synced_at)
       VALUES ('yesterday', 'ap-2', ?1, 'replacement', 'scheduled', 'Scheduled', '2026-09-20T04:30:00.000Z',
         '2026-09-20T06:45:00.000Z', ?2, ?3, ?3)`,
    )
      .bind(PERSON, IMRAN, NOW.toISOString())
      .run();

    expect(await recordUtilisation(env.DB, NOW)).toBe("2026-09-20");
    expect(await recordUtilisation(env.DB, NOW)).toBeNull();

    const event = await env.DB.prepare(
      "SELECT subject_id, payload_json FROM events WHERE name = 'dispatch_utilisation'",
    ).first<{ subject_id: string; payload_json: string }>();
    expect(event?.subject_id).toBe("2026-09-20");
    expect(JSON.parse(event?.payload_json ?? "{}")).toEqual({
      percent: 38,
      technicians: 1,
      slots_per_day: 4,
    });
  });
});
