// What happened on a visit, under its facts in its drawer (./BlockDrawer.tsx): each step the technician took, when and
// by whom, how it ended, and a way to the client's photographs. Read when the drawer opens.

import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock } from "@maneman/web-kit/dates";
import { useCallback } from "react";
import { OpsLink } from "../components/Shell.tsx";
import { dispatch } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { clientPath } from "../route.ts";
import styles from "./dispatch.module.css";
import { dispatchApi } from "./dispatch-api.ts";

const copy = dispatch.drawer.story;

export function VisitStory({ visitId, clientId }: { visitId: string; clientId: string | null }) {
  const read = useCallback(() => dispatchApi.story(visitId), [visitId]);
  const [loaded] = useLoad(read);
  const mayRead = useAccess().mayCall("GET /api/visits/{id}/story");
  if (!mayRead || loaded.state === "loading") return null;
  if (loaded.state === "failed") return <p className={styles.storyNone}>{copy.failed}</p>;
  const { steps } = loaded.value;
  return (
    <section className={styles.story} aria-labelledby={`story-${visitId}`}>
      <h3 id={`story-${visitId}`} className={styles.storyTitle}>
        {copy.title}
      </h3>
      {steps.length === 0 ? (
        <p className={styles.storyNone}>{copy.none}</p>
      ) : (
        <ol className={styles.storySteps}>
          {steps.map((step, at) => (
            <li key={`${step.kind}-${String(at)}`} className={styles.storyStep}>
              <span className={styles.storyTime}>{indiaClock(step.at)}</span>
              <span>
                {copy.step(
                  copy.steps[step.kind] ?? step.kind,
                  step.outcome === null ? undefined : copy.outcomes[step.outcome],
                )}
                {step.technician !== null && <span className={styles.storyBy}> · {step.technician}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {clientId !== null && steps.some((step) => step.kind.endsWith("photos")) && (
        <OpsLink to={clientPath(clientId, "photos")}>{copy.photos}</OpsLink>
      )}
    </section>
  );
}
