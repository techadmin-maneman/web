// The piece step's rules (apps/tech/src/steps/piece-form.ts): what keeps Next dim, and the body the step sends.

import { describe, expect, it } from "vitest";
import { steps as copy, oneVisit } from "../../../apps/tech/src/content.ts";
import {
  DECLINED,
  kitChoices,
  pieceBody,
  stillMissing,
  type KitHairSystem,
  type PieceForm,
} from "../../../apps/tech/src/steps/piece-form.ts";

const EMPTY: PieceForm = { code: "", base: "", lot: "", stock: null, oldCode: "", oldReason: "", choice: null };
const FIRST_FIT = { one_visit: false };
const ONE_VISIT = { one_visit: true };
const LABEL = "MM-STD-4417-B";

describe("the piece step", () => {
  it("waits for a label in the API's format, and for one that is not another client's", () => {
    expect(stillMissing(EMPTY, FIRST_FIT, false)).toBe(copy.piece.checkFirst);
    expect(stillMissing({ ...EMPTY, code: "MM-STD-44" }, FIRST_FIT, false)).toBe(copy.piece.checkFirst);
    expect(stillMissing({ ...EMPTY, code: LABEL }, FIRST_FIT, true)).toBe(copy.piece.notThisClientAction);
    expect(stillMissing({ ...EMPTY, code: LABEL }, FIRST_FIT, false)).toBeNull();
  });

  it("asks why a piece that came off failed, once its label is given", () => {
    const off = { ...EMPTY, code: LABEL, oldCode: "MM-STD-1201-A" };
    expect(stillMissing(off, FIRST_FIT, false)).toBe(copy.piece.old.needsReason);
    expect(stillMissing({ ...off, oldReason: "lifted at the front" }, FIRST_FIT, false)).toBeNull();
  });

  it("on a one visit, waits for the client's choice, and asks for no label once they decline", () => {
    expect(stillMissing(EMPTY, ONE_VISIT, false)).toBe(oneVisit.chooseFirst);
    expect(stillMissing({ ...EMPTY, choice: DECLINED }, ONE_VISIT, false)).toBeNull();
    expect(pieceBody({ ...EMPTY, choice: DECLINED }, ONE_VISIT)).toEqual({ declined: true });
  });

  it("sends only what was said, trimmed, with the product on a one visit and the piece that came off", () => {
    expect(pieceBody({ ...EMPTY, code: LABEL, base: " Lace ", choice: "natural" }, ONE_VISIT)).toEqual({
      piece_code: LABEL,
      product: "natural",
      base: "Lace",
    });
    const replaced = { ...EMPTY, code: LABEL, lot: "L-7", oldCode: "MM-STD-1201-A", oldReason: " lifted " };
    expect(pieceBody(replaced, FIRST_FIT)).toEqual({
      piece_code: LABEL,
      supplier_lot: "L-7",
      old_piece: { piece_code: "MM-STD-1201-A", failure_reason: "lifted" },
    });
  });

  it("sends the hair system picked from the kit", () => {
    expect(pieceBody({ ...EMPTY, code: LABEL, stock: "hs_essential_8x10_1b_g20_d100" }, FIRST_FIT)).toEqual({
      piece_code: LABEL,
      stock_code: "hs_essential_8x10_1b_g20_d100",
    });
  });
});

describe("the kit's hair systems", () => {
  const spec = { product: "essential", base_width_in: 8, base_length_in: 10, colour: "1B", grey_percent: 20 };
  const kit = (code: string, more: Partial<KitHairSystem>): KitHairSystem => ({
    code,
    name: code,
    held: 1,
    ...spec,
    density_percent: 100,
    ...more,
  });
  const profile = { fit: { ...spec, density_percent: 100, product: "natural" } };

  it("lists first those made to the client's profile and the product they paid for", () => {
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
});
