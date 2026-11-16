// A visit done, rated by the client (design/client-redesign, a past visit's "How was this visit?";
// docs/decisions/0260-ratings.md): five stars, given once. Under four, Care call the client, and the line beneath points
// to reporting what went wrong.

import { capsLook } from "@maneman/ui/Caps";
import { StarRating } from "@maneman/ui/StarRating";
import { textLinkLook } from "@maneman/ui/TextLink";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { LOW_RATING_BELOW } from "@rules/policy/ratings.ts";
import { useState } from "react";
import { api, type VisitDetail } from "../api.ts";
import { visits } from "../content.ts";
import { AppLink } from "../frame/Shell.tsx";
import shared from "./visits.module.css";
import styles from "./visit-screen.module.css";

export function RateVisit({ visit, onRefused }: { visit: VisitDetail; onRefused: () => void }) {
  const copy = visits.detail.rating;
  const [rated, setRated] = useState<number | null>(visit.rating?.stars ?? null);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  const rate = (stars: number) =>
    once(async () => {
      const answer = await api.rateVisit(visit.id, stars);
      if (answer.ok) {
        setRated(answer.body.stars);
        setFailed(false);
      } else if (answer.code === "already_rated") onRefused();
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
        value={rated}
        disabled={busy}
        {...(rated === null ? { onRate: (stars: number) => void rate(stars) } : {})}
      />
      {rated !== null && rated >= LOW_RATING_BELOW && <p className={styles.invoiceLine}>{copy.thanks}</p>}
      {rated !== null && rated < LOW_RATING_BELOW && (
        <p className={styles.invoiceLine}>
          {copy.low}{" "}
          <AppLink className={textLinkLook({ inline: true })} to={`/visits/issues/new?visit=${visit.id}`}>
            {copy.report}
          </AppLink>
        </p>
      )}
      {failed && (
        <p className={styles.invoiceLine} role="alert">
          {copy.failed}
        </p>
      )}
    </section>
  );
}
