// What a tap on WhatsApp or Other apps sends with an invite (apps/app/src/refer/share.ts): the card itself, as a
// photograph captioned with the invite's words, wherever the phone's share sheet takes files; else the words alone,
// with WhatsApp's link where there is no share sheet to take them (docs/decisions/0048-referrals.md, amended
// 27 September 2026). The owner found invites reaching WhatsApp with no image: nothing ever sent the card.

import { describe, expect, it } from "vitest";
import { forOtherApps, inviteFile, withCard, type Phone } from "../../../apps/app/src/refer/share.ts";

const TEXT = "Got my hair system fitted at home by Mane Man. Worth a look: https://maneman.in/r/RM4K7P";
const CARD = inviteFile(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]));

const share = () => Promise.resolve();

/** A phone whose share sheet takes files or not, and what it was asked whether it could share. */
function phone(files: boolean): Phone & { asked: ShareData[] } {
  const asked: ShareData[] = [];
  return {
    asked,
    canShare: (data) => {
      asked.push(data);
      return files || data.files === undefined;
    },
    share,
  };
}

describe("the card, as the share sheet takes it", () => {
  it("is a JPEG, named for what it is", () => {
    expect(CARD.name).toBe("mane-man-invite.jpg");
    expect(CARD.type).toBe("image/jpeg");
    expect(CARD.size).toBe(4);
  });
});

describe("WhatsApp", () => {
  it("sends the card with the invite's words where the phone can share it as a file", () => {
    const files = phone(true);
    expect(withCard(files, CARD, TEXT)).toEqual({ files: [CARD], text: TEXT });
    // The phone is asked about the file alone, as the site's try-on asks (site/src/islands/tryon/Result.tsx).
    expect(files.asked).toEqual([{ files: [CARD] }]);
  });

  it.each([
    ["the phone shares no files", phone(false)],
    ["the phone cannot say, as a desktop browser without canShare", { share }],
    ["the phone has no share sheet", {}],
  ])("leaves the words to WhatsApp's link where %s", (_, without: Phone) => {
    expect(withCard(without, CARD, TEXT)).toBeNull();
  });

  it("leaves the words to the link while the card is not ready", () => {
    expect(withCard(phone(true), null, TEXT)).toBeNull();
  });
});

describe("Other apps", () => {
  it("sends the card with the invite's words where the phone can share it as a file", () => {
    expect(forOtherApps(phone(true), CARD, TEXT)).toEqual({ files: [CARD], text: TEXT });
  });

  it("sends the words alone where the phone shares no files, or the card is not ready", () => {
    expect(forOtherApps(phone(false), CARD, TEXT)).toEqual({ text: TEXT });
    expect(forOtherApps({ share }, CARD, TEXT)).toEqual({ text: TEXT });
    expect(forOtherApps(phone(true), null, TEXT)).toEqual({ text: TEXT });
  });

  it("sends nothing where the phone has no share sheet, so the link is copied instead", () => {
    expect(forOtherApps({}, CARD, TEXT)).toBeNull();
  });
});
