// Each angle's frame on the phone, small, for its tile on the capture screen (./CaptureScreen.tsx): the thumbnail kept
// with it, or the frame itself where an older release kept none. The addresses go as the frames change.

import { useEffect, useState } from "react";
import type { TakenAngle } from "../lib/sets.ts";
import { frames as keptFrames } from "../store/outbox.ts";

/** Each frame on the phone's picture, by the frame's ID, as an address an image can show. */
export function useThumbnails(taken: readonly TakenAngle[]): ReadonlyMap<string, string> {
  const [pictures, setPictures] = useState<ReadonlyMap<string, string>>(new Map());
  const onPhone = taken.flatMap((one) => (one.frameId === null ? [] : [one.frameId])).join(" ");
  useEffect(() => {
    const wanted = new Set(onPhone.split(" "));
    const made: string[] = [];
    let current = true;
    keptFrames().then(
      (held) => {
        if (!current) return;
        const next = new Map<string, string>();
        for (const frame of held.filter((each) => wanted.has(each.id))) {
          const address = URL.createObjectURL(frame.small ?? frame.frame);
          made.push(address);
          next.set(frame.id, address);
        }
        setPictures(next);
      },
      () => {
        // A store that will not open shows no pictures: each tile keeps its name.
      },
    );
    return () => {
      current = false;
      for (const address of made) URL.revokeObjectURL(address);
    };
  }, [onPhone]);
  return pictures;
}
