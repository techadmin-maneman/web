// The visit an issue is about, if one (./RaiseScreen.tsx): the client's last four, a visit a link named among them, and
// none. Nothing to choose before a first visit.

import { ChoiceCard } from "@maneman/ui/ChoiceCard";
import { Fieldset } from "@maneman/ui/Field";
import { useLoad } from "@maneman/ui/useLoad";
import { fullDate } from "@maneman/web-kit/dates";
import { api } from "../api.ts";
import { issues } from "../content.ts";
import { technicianOf, visitTitle } from "../lib/visit.ts";
import styles from "./raise.module.css";

const RECENT = 4;

export function RaiseVisit({ chosen, onChoose }: { chosen: string | null; onChoose: (visit: string | null) => void }) {
  const [loaded] = useLoad(api.visits);
  const copy = issues.raise;
  if (loaded.state !== "loaded") return null;
  const recent = loaded.value.past.filter((visit, index) => index < RECENT || visit.id === chosen);
  if (recent.length === 0) return null;
  return (
    <Fieldset
      className={styles.visits}
      legendLook="title"
      legend={
        <>
          {copy.visit} <span className={styles.hint}>{copy.visitHint}</span>
        </>
      }
    >
      {recent.map((visit) => (
        <ChoiceCard
          key={visit.id}
          name="visit"
          checked={chosen === visit.id}
          onChange={() => {
            onChoose(visit.id);
          }}
        >
          <span className={styles.visitDate}>{fullDate(visit.date)}</span>
          <span className={styles.visitWhat}>{[visitTitle(visit), ...technicianOf(visit)].join(" · ")}</span>
        </ChoiceCard>
      ))}
      <ChoiceCard
        name="visit"
        checked={chosen === null}
        onChange={() => {
          onChoose(null);
        }}
      >
        {copy.noVisit}
      </ChoiceCard>
    </Fieldset>
  );
}
