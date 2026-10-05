// What the share sheet (./ShareSheet.tsx) does, apart from how it draws it: the card chosen, the consent its own
// photographs need, the card composed and stored, and the share itself (docs/decisions/0048-referrals.md).
//
// Their card is composed first, then the consent recorded, then the card stored: nothing is agreed to for a card the
// phone could not make. Every step that changes what the invite shows waits for the API's answer, and a refusal says
// so and changes nothing: an invite must never carry photographs the client thinks are gone.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useRef, useState } from "react";
import { api, cardUrl, putCard, storedCard, type Refer } from "../api.ts";
import { refer } from "../content.ts";
import { composeCard, firstFitPhotos, type FirstFitPair } from "./card.ts";
import { houseCard, type Shown } from "./CardPreview.tsx";
import { forOtherApps, inviteFile } from "./share.ts";

type Step = "choice" | "consent" | "composing" | "share";
export type Which = "mine" | "house";

/**
 * A card composed in this sheet: kept as it was made, to share as a file, and shown through a link to it. The link
 * is for the image alone: the app's policy lets no request fetch it (packages/web-kit/headers.ts).
 */
interface Made {
  readonly card: Blob;
  readonly url: string;
}

export const HOUSE: Shown = { kind: "house" };

/** The card the friend will see: one just made, the client's stored one, or the house example. */
function sentCard(state: Refer, made: Made | null): Shown {
  if (made !== null) return { kind: "made", url: made.url };
  if (state.card.state === "personal") return { kind: "made", url: cardUrl(state.card.version) };
  return HOUSE;
}

/** The house example, read from the app's own files. */
async function houseExample(): Promise<Blob | null> {
  const response = await fetch(houseCard).catch(() => null);
  return response?.ok === true ? response.blob() : null;
}

/** The card the friend is sent, to share as a file; null where it could not be read, and the words go alone. */
async function cardToSend(which: Which, state: Refer, made: Made | null): Promise<Blob | null> {
  if (which === "house") return houseExample();
  if (made !== null) return made.card;
  if (state.card.state !== "personal") return null;
  const stored = await storedCard(state.card.version);
  return stored.ok ? stored.body : null;
}

/** The client's first fit's photographs, once the photos answer; known missing, so their own card is not offered. */
function useFirstFitPair() {
  const [pair, setPair] = useState<FirstFitPair | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let current = true;
    void api.photos().then((answer) => {
      if (!current || !answer.ok) return;
      const found = firstFitPhotos(answer.body);
      setPair(found);
      setMissing(found === null);
    });
    return () => {
      current = false;
    };
  }, []);
  return { pair, missing };
}

/** Sending the invite: a way that failed, not one the client backed out of, is board F6's "Share failed". */
function useSending(link: string, file: File | null, message: string) {
  const [shareFailed, setShareFailed] = useState<(() => Promise<void>) | null>(null);
  const [copied, setCopied] = useState(false);

  async function sharing(attempt: () => Promise<void>) {
    setShareFailed(null);
    await attempt().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareFailed(() => attempt);
    });
  }
  const copyLink = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  };
  const otherApps = async () => {
    const shared = forOtherApps(navigator, file, message);
    if (shared === null) await copyLink();
    else await navigator.share(shared);
  };
  return { shareFailed, copied, sharing, copyLink, otherApps };
}

export function useShareFlow(opened: Refer) {
  // The invite as it stands, read again once the sheet has changed it: the preview must name the client, and show
  // the card, exactly as the invite now will.
  const [state, setState] = useState(opened);
  const [step, setStep] = useState<Step>("choice");
  const [which, setWhich] = useState<Which>(state.card.state === "personal" ? "mine" : "house");
  const { pair, missing } = useFirstFitPair();
  const [made, setMade] = useState<Made | null>(null);
  // The card the share step sends, made ready before it shows.
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = useRef(false);
  // One card per intent: a second Allow would record the consent again and build the whole card again.
  const [busy, once] = useOneAtATime();

  // A card made here lives in the page until the sheet closes.
  useEffect(
    () => () => {
      if (made !== null) URL.revokeObjectURL(made.url);
    },
    [made],
  );

  const message = refer.preview.message(state.link);

  /** The share step, once the card it sends is a file. */
  async function toShare(card: "house" | "theirs", line: string | null, justMade: Made | null = made) {
    const chosen = card === "house" ? "house" : "mine";
    const sent = await cardToSend(chosen, state, justMade);
    setFile(sent === null ? null : inviteFile(sent));
    setWhich(chosen);
    setProblem(line);
    setStep("share");
  }

  /** The sheet changed the invite: it is read again, and the Refer page will be when the sheet closes. */
  async function changedInvite() {
    changed.current = true;
    const fresh = await api.refer();
    if (fresh.ok) setState(fresh.body);
  }

  /** Their own card: composed, then the consent recorded if it is still to give, then stored. */
  const makeTheirOwn = (consentToo: boolean) =>
    once(async () => {
      setStep("composing");
      setProblem(null);
      const photos = pair ?? (await api.photos().then((answer) => (answer.ok ? firstFitPhotos(answer.body) : null)));
      const card = photos === null ? null : await composeCard(photos);
      if (card === null) {
        await toShare("house", refer.cardFailed);
        return;
      }
      if (consentToo) {
        const consent = await api.switchConsent("photos_referral_cards", true, "app_share_sheet");
        if (!consent.ok) {
          setProblem(refer.notChanged);
          setStep("consent");
          return;
        }
        changed.current = true;
      }
      const stored = await putCard(card);
      if (!stored.ok) {
        if (consentToo) await changedInvite();
        await toShare("house", refer.cardFailed);
        return;
      }
      const justMade = { card, url: URL.createObjectURL(card) };
      setMade(justMade);
      await changedInvite();
      await toShare("theirs", null, justMade);
    });

  /** The example: any card of theirs comes down first, and until it has, nothing is shared. */
  const takeTheExample = () =>
    once(async () => {
      if (state.card.state === "personal") {
        const revoked = await api.revokeCard();
        if (!revoked.ok) {
          setProblem(refer.notChanged);
          return;
        }
        await changedInvite();
      }
      await toShare("house", null);
    });

  function continueToShare() {
    if (which === "house") void takeTheExample();
    else if (state.card.state === "personal") void once(() => toShare("theirs", null));
    else void makeTheirOwn(false);
  }

  const sending = useSending(state.link, file, message);

  return {
    state,
    step,
    which,
    pair,
    made,
    file,
    problem,
    busy,
    message,
    /** Whether the client has agreed to their photographs on cards: a card of theirs stands, or the consent does. */
    agreed: state.card.state === "personal" || state.card.consented,
    /** Their own card is offered where there is one, or the photographs to make one. */
    offerTheirOwn: state.card.state === "personal" || made !== null || !missing,
    /** The card the share step shows the friend. */
    card: which === "house" ? HOUSE : sentCard(state, made),
    /** Whether the sheet changed the invite, so the Refer page reads it again. */
    changed: () => changed.current,
    choose: setWhich,
    askConsent: () => {
      setStep("consent");
    },
    makeTheirOwn,
    takeTheExample,
    continueToShare,
    ...sending,
  };
}

export type ShareFlow = ReturnType<typeof useShareFlow>;
