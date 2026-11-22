// The piece step's rules (apps/tech/src/steps/piece-form.ts): what keeps Next dim, and the body the step sends.

import { describe, expect, it } from "vitest";
import type { Queued } from "../../../apps/tech/src/store/outbox.ts";
import { steps as copy, oneVisit } from "../../../apps/tech/src/content.ts";
import {
  cameOff,
  cameOffEarly,
  DECLINED,
  kitChoices,
  labelTaken,
  noticeFor,
  pieceBody,
  profileToMatch,
  stillMissing,
  type KitHairSystem,
  type PieceForm,
} from "../../../apps/tech/src/steps/piece-form.ts";

const EMPTY: PieceForm = {
  code: "",
  noLabel: false,
  base: "",
  lot: "",
  stock: null,
  oldCode: "",
  failure: null,
  choice: null,
  later: false,
};
const FIRST_FIT = { one_visit: false, kit_hair_systems: [], date: "2026-09-21" };
const ONE_VISIT = { one_visit: true, kit_hair_systems: [], date: "2026-09-21" };
const LABEL = "MM-STD-4417-B";

describe("the piece step", () => {
  it("waits for a label in the API’s format, and for one that is not another client’s", () => {
    expect(stillMissing(EMPTY, FIRST_FIT, "found")).toBe(copy.piece.checkFirst);
    expect(stillMissing({ ...EMPTY, code: "MM-STD-44" }, FIRST_FIT, "found")).toBe(copy.piece.checkFirst);
    expect(stillMissing({ ...EMPTY, code: LABEL }, FIRST_FIT, "another_client")).toBe(copy.piece.notThisClientAction);
    expect(stillMissing({ ...EMPTY, code: LABEL }, FIRST_FIT, "found")).toBeNull();
  });

  it("goes on with a label in the kit, or one checked as this client's, and never with one unknown to us", () => {
    const kit = {
      ...FIRST_FIT,
      kit_hair_systems: [{ code: "hs_exact", units: [{ code: LABEL, lot_code: null, expires_on: null }] }],
    } as unknown as typeof FIRST_FIT;
    const typed = { ...EMPTY, code: "MM-STD-9999-Z" };
    expect(stillMissing(typed, FIRST_FIT, "none")).toBe(copy.piece.uncheckedAction);
    expect(stillMissing(typed, FIRST_FIT, "unknown")).toBe(copy.piece.notInKitAction);
    // With no signal to check it, the label goes as typed, and the API checks it once the phone is back.
    expect(stillMissing(typed, FIRST_FIT, "offline")).toBeNull();
    expect(stillMissing({ ...EMPTY, code: LABEL }, kit, "none")).toBeNull();
    // A row picked whose pieces carry labels takes only one of theirs; one whose pieces carry none takes the piece's.
    expect(stillMissing({ ...typed, stock: "hs_exact" }, kit, "unknown")).toBe(copy.piece.notInKitAction);
    const unlabelledKit = {
      ...FIRST_FIT,
      kit_hair_systems: [{ code: "hs_exact", units: [] }],
    } as unknown as typeof FIRST_FIT;
    expect(stillMissing({ ...typed, stock: "hs_exact" }, unlabelledKit, "unknown")).toBeNull();
  });

  it("takes the piece that came off, the one on the client's head, with no why: the step no longer asks it", () => {
    const off = { ...EMPTY, code: LABEL, oldCode: "MM-STD-1201-A" };
    expect(stillMissing(off, FIRST_FIT, "found")).toBeNull();
    expect(stillMissing({ ...off, oldCode: "MM-STD-12" }, FIRST_FIT, "found")).toBe(copy.piece.checkFirst);
    expect(pieceBody(off, FIRST_FIT)).toEqual({ piece_code: LABEL, old_piece: { piece_code: "MM-STD-1201-A" } });
  });

  it("on a one visit, waits for the client’s choice, and asks for no label once they decline", () => {
    expect(stillMissing(EMPTY, ONE_VISIT, "found")).toBe(oneVisit.chooseFirst);
    expect(stillMissing({ ...EMPTY, choice: DECLINED }, ONE_VISIT, "found")).toBeNull();
    expect(pieceBody({ ...EMPTY, choice: DECLINED }, ONE_VISIT)).toEqual({ declined: true });
  });

  it("on a one visit, sends the product alone, with no label asked, once its fit is booked for later", () => {
    const later = { ...EMPTY, choice: "natural", later: true };
    expect(stillMissing(later, ONE_VISIT, "none")).toBeNull();
    // Fit today needs the hair system in the kit, which ONE_VISIT's holds none of.
    expect(stillMissing({ ...later, later: false }, ONE_VISIT, "found")).toBe(oneVisit.notInKitAction);
    expect(pieceBody(later, ONE_VISIT)).toEqual({ product: "natural", fit_later: true });
    // An expired kit label left in the field holds back neither a fit booked for later nor one declined.
    const expired = {
      ...ONE_VISIT,
      kit_hair_systems: [
        {
          code: "hs_natural",
          product: "natural",
          held: 1,
          units: [{ code: LABEL, lot_code: null, expires_on: "2026-09-01" }],
        },
      ],
    } as unknown as typeof ONE_VISIT;
    expect(stillMissing({ ...later, code: LABEL }, expired, "none")).toBeNull();
    expect(stillMissing({ ...later, code: LABEL, choice: DECLINED }, expired, "none")).toBeNull();
    expect(stillMissing({ ...later, code: LABEL, later: false }, expired, "none")).toBe(copy.piece.expiredAction);
    // Booked for later means nothing on any other visit, nor once the fit is declined.
    expect(pieceBody({ ...later, choice: DECLINED }, ONE_VISIT)).toEqual({ declined: true });
  });

  it("sends only what was said, trimmed, with the product on a one visit and the piece that came off", () => {
    expect(pieceBody({ ...EMPTY, code: LABEL, base: " Lace ", choice: "natural" }, ONE_VISIT)).toEqual({
      piece_code: LABEL,
      product: "natural",
      base: "Lace",
    });
    const replaced = { ...EMPTY, code: LABEL, lot: "L-7", oldCode: "MM-STD-1201-A" };
    expect(pieceBody(replaced, FIRST_FIT)).toEqual({
      piece_code: LABEL,
      supplier_lot: "L-7",
      old_piece: { piece_code: "MM-STD-1201-A" },
    });
  });

  it("bases a piece of kit stock with no labels as its hair system is named", () => {
    const kit = {
      ...FIRST_FIT,
      kit_hair_systems: [{ code: "hs_old", name: "Mane Man Essential, before labels", units: [] }],
    } as unknown as typeof FIRST_FIT;
    expect(pieceBody({ ...EMPTY, code: LABEL, stock: "hs_old" }, kit)).toEqual({
      piece_code: LABEL,
      base: "Mane Man Essential, before labels",
      stock_code: "hs_old",
    });
  });

  // A label lost or never stuck on never stops the fit.
  it("goes on with no label once a hair system is picked from the kit, labelled or not, and sends none", () => {
    const kit = {
      ...FIRST_FIT,
      kit_hair_systems: [
        {
          code: "hs_exact",
          name: "Mane Man Essential",
          held: 1,
          units: [{ code: LABEL, lot_code: null, expires_on: null }],
        },
      ],
    } as unknown as typeof FIRST_FIT;
    const none = { ...EMPTY, noLabel: true };
    expect(stillMissing(none, kit, "none")).toBe(copy.piece.pickFromKit);
    expect(stillMissing({ ...none, stock: "hs_exact" }, kit, "none")).toBeNull();
    expect(pieceBody({ ...none, stock: "hs_exact" }, kit)).toEqual({
      no_label: true,
      base: "Mane Man Essential",
      stock_code: "hs_exact",
    });
  });

  it("holds a hair system picked with no label where every piece of it in the kit has expired", () => {
    const held = (expires: string, count: number) =>
      ({
        ...FIRST_FIT,
        kit_hair_systems: [
          {
            code: "hs_exact",
            name: "Mane Man Essential",
            held: count,
            units: [{ code: LABEL, lot_code: "HS-1", expires_on: expires }],
          },
        ],
      }) as unknown as typeof FIRST_FIT;
    const picked = { ...EMPTY, noLabel: true, stock: "hs_exact" };
    expect(stillMissing(picked, held("2026-09-20", 1), "none")).toBe(copy.piece.expiredAction);
    // A pick the kit no longer has a piece of free, as a refused step's may be, is no pick.
    expect(stillMissing(picked, held("2028-03-31", 0), "none")).toBe(copy.piece.pickFromKit);
    expect(stillMissing(picked, held("2026-09-21", 1), "none")).toBeNull();
    // A piece never labelled, its expiry not on the card, is the API's to judge.
    expect(stillMissing(picked, held("2026-09-20", 2), "none")).toBeNull();
  });

  it("says a hair system picked with no label was refused for none of it in the kit being fit to fit", () => {
    expect(noticeFor(["stock_code"], { no_label: true, stock_code: "hs_exact" })).toBe(copy.corrected.noneToFit);
    expect(noticeFor(["stock_code"], { piece_code: LABEL, stock_code: "hs_exact" })).toBe(copy.corrected.other);
    expect(noticeFor(["piece_code"], { no_label: true })).toBe(copy.corrected.piece);
  });

  it("sends the hair system picked from the kit", () => {
    expect(pieceBody({ ...EMPTY, code: LABEL, stock: "hs_essential_8x10_1b_g20_d100" }, FIRST_FIT)).toEqual({
      piece_code: LABEL,
      stock_code: "hs_essential_8x10_1b_g20_d100",
    });
  });
});

describe("the kit’s hair systems", () => {
  const spec = { product: "essential", base_width_in: 8, base_length_in: 10, colour: "1B", grey_percent: 20 };
  const kit = (code: string, more: Partial<KitHairSystem>): KitHairSystem => ({
    code,
    name: code,
    held: 1,
    ...spec,
    density_percent: 100,
    units: [],
    ...more,
  });
  const profile = { fit: { ...spec, density_percent: 100, product: "natural" } };

  it("lists first those made to the client’s profile and the product they paid for", () => {
    const job = {
      kit_hair_systems: [kit("denser", { density_percent: 120 }), kit("exact", {})],
      profile,
      service: { tier: "essential" },
      one_visit: false,
      type: "first_fit",
    } as unknown as Parameters<typeof kitChoices>[0];
    expect(kitChoices(job, null).map((each) => [each.hairSystem.code, each.matches])).toEqual([
      ["exact", true],
      ["denser", false],
    ]);
  });

  it("on a one visit, matches the product the client chose", () => {
    const job = {
      kit_hair_systems: [kit("exact", {})],
      profile,
      service: null,
      one_visit: true,
      type: "first_fit",
    } as unknown as Parameters<typeof kitChoices>[0];
    expect(kitChoices(job, "natural")[0]?.matches).toBe(false);
    expect(kitChoices(job, "essential")[0]?.matches).toBe(true);
  });

  // Measured on the head with no signal (docs/decisions/0245-the-steps.md): the kit is matched to what the phone holds.
  it("matches the profile the phone holds, measured with no signal, over the card's", () => {
    const card = { id: "a", profile } as unknown as Parameters<typeof profileToMatch>[0];
    const measured = { ...spec, density_percent: 120 };
    const held = (state: string) =>
      ({ job_id: "a", kind: "profile", state, body: { fit: measured } }) as unknown as Queued;

    expect(profileToMatch(card, [])).toBe(profile);
    expect(profileToMatch(card, [held("waiting")])).toEqual({ fit: measured });
    // A profile ops took the job from under does not count.
    expect(profileToMatch(card, [held("superseded")])).toBe(profile);

    const job = {
      kit_hair_systems: [kit("denser", { density_percent: 120 }), kit("exact", {})],
      profile: profileToMatch(card, [held("waiting")]),
      service: { tier: "essential" },
      one_visit: false,
      type: "first_fit",
    } as unknown as Parameters<typeof kitChoices>[0];
    expect(kitChoices(job, null)[0]?.hairSystem.code).toBe("denser");
  });
});

describe("a label taken", () => {
  const unit = (code: string, lot: string | null) => ({ code, lot_code: lot, expires_on: null });
  const kit = {
    kit_hair_systems: [
      { code: "hs_a", name: "Mane Man Essential · 8 × 10 in", units: [unit("MM-ESS-0000001-A", "LOT-A")] },
      { code: "hs_b", name: "Mane Man Natural · 7 × 9 in", units: [unit("MM-NAT-0000002-B", "LOT-B")] },
      { code: "hs_old", name: "Mane Man Essential, before labels", units: [] },
    ],
  } as unknown as Parameters<typeof labelTaken>[0];

  it("takes a kit piece's hair system, its name as the base and its lot, with or without signal", () => {
    expect(labelTaken(kit, null, "MM-ESS-0000001-A")).toEqual({
      stock: "hs_a",
      base: "Mane Man Essential · 8 × 10 in",
      lot: "LOT-A",
    });
  });

  it("keeps nothing of the label before it, so a piece read again is sent as itself", () => {
    expect(labelTaken(kit, "hs_a", "MM-NAT-0000002-B")).toEqual({
      stock: "hs_b",
      base: "Mane Man Natural · 7 × 9 in",
      lot: "LOT-B",
    });
    // A piece from outside the kit after one of it: no hair system, base or lot left from the kit's.
    expect(labelTaken(kit, "hs_a", "MM-STD-4417-B")).toEqual({ stock: null, base: "", lot: "" });
    // Rescan: nothing at all.
    expect(labelTaken(kit, "hs_a", "")).toEqual({ stock: null, base: "", lot: "" });
  });

  it("keeps kit stock with no labels picked, for the label on its piece", () => {
    expect(labelTaken(kit, "hs_old", "MM-ESS-0000999-Z")).toEqual({ stock: "hs_old", base: "", lot: "" });
  });

  it("keeps a refused step's base and lot when its label is corrected to the same piece, and only then", () => {
    const sent = { code: "MM-STD-7193 C", base: "Lace", lot: "LOT-5120" };
    expect(labelTaken(kit, null, "MM-STD-7193-C", sent)).toEqual({ stock: null, base: "Lace", lot: "LOT-5120" });
    // Another piece altogether: nothing of the refused one.
    expect(labelTaken(kit, null, "MM-STD-8000-D", sent)).toEqual({ stock: null, base: "", lot: "" });
    // A kit piece gives its own.
    expect(labelTaken(kit, null, "MM-ESS-0000001-A", { ...sent, code: "MM-ESS-0000001 A" })).toEqual({
      stock: "hs_a",
      base: "Mane Man Essential · 8 × 10 in",
      lot: "LOT-A",
    });
  });
});

describe("the piece that comes off a replacement", () => {
  const piece = (code: string, fitted: string | null) => ({
    piece_code: code,
    base: null,
    supplier_lot: null,
    fitted_at: fitted,
    replacement_due_at: null as string | null,
    failed_at: null as string | null,
    failure_reason: null,
    replaced_at: null as string | null,
  });
  const job = (pieces: ReturnType<typeof piece>[]) =>
    ({ type: "replacement", date: "2026-11-17", pieces }) as unknown as Parameters<typeof cameOff>[0];

  it("is the one on the head from before the visit's day, never the one this visit fitted", () => {
    const today = piece("MM-ESS-0000779-S", "2026-11-17");
    const worn = piece("MM-STD-4417-B", "2026-07-02");
    expect(cameOff(job([today, worn]))?.piece_code).toBe("MM-STD-4417-B");
  });

  it("is none where nothing is on the head, and on any other visit", () => {
    expect(cameOff(job([]))).toBeNull();
    expect(cameOff({ ...job([piece("MM-STD-4417-B", "2026-07-02")]), type: "first_fit" })).toBeNull();
  });

  it("is none on a step opened again after it landed, never an older piece that failed long ago", () => {
    const fitted = piece("MM-STD-5520-A", "2026-11-17");
    const replaced = { ...piece("MM-STD-4417-B", "2026-07-02"), replaced_at: "2026-11-17T08:00:00.000Z" };
    const failedLongAgo = { ...piece("MM-STD-1201-A", "2026-01-10"), failed_at: "2026-07-02T08:00:00.000Z" };
    expect(cameOff(job([fitted, replaced, failedLongAgo]))).toBeNull();
    // Worn over an older failure, the worn one comes off.
    const worn = piece("MM-STD-4417-B", "2026-07-02");
    expect(cameOff(job([worn, failedLongAgo]))?.piece_code).toBe("MM-STD-4417-B");
  });

  it("is one Care marked failed before the visit, which then asks no why of its own", () => {
    const marked = {
      ...piece("MM-STD-4417-B", "2026-07-02"),
      replacement_due_at: "2027-01-02",
      failed_at: "2026-11-10",
    };
    expect(cameOff(job([marked]))?.piece_code).toBe("MM-STD-4417-B");
    expect(cameOffEarly(job([marked]))).toBe(false);
  });

  it("came off early where it was due after the visit's day, and not on or after its due day", () => {
    const due = (on: string | null) => job([{ ...piece("MM-STD-4417-B", "2026-07-02"), replacement_due_at: on }]);
    expect(cameOffEarly(due("2027-01-02"))).toBe(true);
    expect(cameOffEarly(due("2026-11-17"))).toBe(false);
    expect(cameOffEarly(due("2026-10-02"))).toBe(false);
    expect(cameOffEarly(due(null))).toBe(false);
    expect(cameOffEarly(job([]))).toBe(false);
  });

  it("is sent with why it failed where the technician said", () => {
    const off = { ...EMPTY, code: LABEL, oldCode: "MM-STD-1201-A", failure: "edges_lifting" };
    expect(pieceBody(off, FIRST_FIT)).toEqual({
      piece_code: LABEL,
      old_piece: { piece_code: "MM-STD-1201-A", failure_reason: "edges_lifting" },
    });
  });
});
