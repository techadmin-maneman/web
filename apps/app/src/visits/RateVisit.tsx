// A visit done, rated by the client (design/client-redesign, a past visit's "How was this visit?";
// docs/decisions/0260-ratings.md): five stars, given once, while the visit may still be rated. A low one is a call
// from Care, and the line beneath points to reporting what went wrong. The stars the visit carries are shown, however
// they were given: here, on another phone, or by a tap whose answer never came back.

import { capsLook } from "@maneman/ui/Caps";
import { StarRating } from "@maneman/ui/StarRating";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState } from "react";
import { api, type VisitDetail } from "../api.ts";
import { visits } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import shared from "./visits.module.css";
import styles from "./visit-screen.module.css";

type Given = NonNullable<VisitDetail["rating"]>;

export function RateVisit({ visit, onRefused }: { visit: VisitDetail; onRefused: () => void }) {
  const copy = visits.detail.rating;
  const [given, setGiven] = useState<Given | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  const rated = given ?? visit.rating;
  const rate = (stars: number) =>
    once(async () => {
      const answer = await api.rateVisit(visit.id, stars);
      if (answer.ok) {
        setGiven(answer.body);
        setFailed(false);
      } else if (answer.code === "already_rated" || answer.code === "rating_closed") onRefused();
      else setFailed(true);
    });
  return (
    <section aria-labelledby="rating">
      <h2 className={capsLook(shared.label)} id="rating">
        {copy.title}
      </h2>
      <StarRating
        label={copy.label}
        starLabel={copy.star}
        value={rated?.stars ?? null}
        disabled={busy}
        {...(rated === null ? { onRate: (stars: number) => void rate(stars) } : {})}
      />
      <div role="status">
        {rated !== null && !rated.low && <p className={styles.invoiceLine}>{copy.thanks}</p>}
        {rated?.low === true && (
          <p className={styles.invoiceLine}>
            {copy.low}{" "}
            <AppLink className={textLinkLook({ inline: true })} to={`/visits/issues/new?visit=${visit.id}`}>
              {copy.report}
            </AppLink>
          </p>
        )}
      </div>
      {failed && (
        <p className={styles.invoiceLine} role="alert">
          {copy.failed}
        </p>
      )}
    </section>
  );
}
