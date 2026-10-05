import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { adrIndex, readAdr, readDecisions } from "../../../scripts/lib/adr-index.ts";

const adr = (file: string, header: string) => ({ file, text: `${header}\n\n## Context\n\nThe reason.\n` });

describe("reading an ADR's header", () => {
  it("takes the number, the title, the date and the status's first clause", () => {
    const record = readAdr(
      adr(
        "0006-deployment-pipeline.md",
        "# 0006. Deployment pipeline\n\n- Status: accepted (reviewers wait; see 0008). Amended 25 September 2026.\n- Date: 2026-09-21",
      ),
    );
    expect(record).toEqual({
      file: "0006-deployment-pipeline.md",
      number: "0006",
      title: "Deployment pipeline",
      date: "2026-09-21",
      status: "accepted",
      changes: [],
      changedBy: [],
    });
  });

  it("keeps the words of a status that is more than accepted, without its links", () => {
    const record = readAdr(
      adr(
        "0020-x.md",
        "# 0020. X\n\n- Status: superseded by [0050](0050-crm-in-the-real-org.md) on 22 September 2026\n- Date: 2026-09-21",
      ),
    );
    expect(record.status).toBe("superseded by 0050 on 22 September 2026");
    expect(record.changedBy).toEqual(["0050"]);
  });

  it("reads which records an ADR changes, from its header, and not the ones it only follows", () => {
    const record = readAdr(
      adr(
        "0073-prices.md",
        "# 0073. Prices\n\n- Status: accepted\n- Date: 2026-09-26\n- Amends [0027](0027-a.md) and [0039](0039-b.md); adds item 39 to [0022](0022-c.md); completes what [0061](0061-d.md) left; follows [0070](0070-e.md)",
      ),
    );
    expect(record.changes).toEqual(["0022", "0027", "0039"]);
  });

  it("reads a change named in the status, and one a record says it resolves", () => {
    expect(
      readAdr(
        adr(
          "0066-x.md",
          "# 0066. X\n\n- Status: accepted. Amends the order in ADR 0019 and ADR 0049.\n- Date: 2026-09-25",
        ),
      ).changes,
    ).toEqual(["0019", "0049"]);
    expect(
      readAdr(adr("0008-x.md", "# 0008. X\n\n- Status: accepted\n- Date: 2026-09-21\n- Resolves: 0007")).changes,
    ).toEqual(["0007"]);
  });
});

describe("the index", () => {
  it("gathers each record's changes from both sides, newest record last, and names the next free number", () => {
    const index = adrIndex(
      [
        adr("0001-a.md", "# 0001. A\n\n- Status: accepted. Amended by ADR 0003: something.\n- Date: 2026-09-21"),
        adr("0002-b.md", "# 0002. B\n\n- Status: accepted\n- Date: 2026-09-21\n- Amends [0001](0001-a.md)"),
        adr("0003-c.md", "# 0003. C\n\n- Status: accepted\n- Date: 2026-09-22"),
      ],
      [{ file: "trial.md", text: "# The trial\n\nWhat it found." }],
    );
    expect(index).toContain("| [0001](0001-a.md) | A | 2026-09-21 | accepted | [0002](0002-b.md), [0003](0003-c.md) |");
    expect(index).toContain("| [0003](0003-c.md) | C | 2026-09-22 | accepted |  |");
    expect(index).toContain("The next free number is 0004.");
    expect(index).toContain("- [The trial](trial.md)");
  });
});

// The index said this test failed until it was regenerated, and nothing did.
describe("the committed index", () => {
  it("is the index the records' headers make, so a new record or a changed status needs npm run adr-index", () => {
    const { adrs, others } = readDecisions();
    expect(readFileSync("docs/decisions/README.md", "utf8")).toBe(adrIndex(adrs, others));
  });
});
