// Raising an issue (design/client-redesign, the raise screen; docs/decisions/0259-the-issue-log.md): what it is about,
// what is happening in the client's words, up to three photographs, and the visit it is about, if one. Sent, it opens
// on its own page in the log, its photographs following it there. A link may name the category or the visit, as a
// visit's page does: ?about=fit_guarantee&visit=<id>.

import { Button } from "@maneman/ui/Button";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { WordsField } from "@maneman/ui/WordsField";
import { PROBLEM_MAX_CHARS } from "@rules/policy/problems.ts";
import { useState } from "react";
import { api, type ProblemAbout } from "../api.ts";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { ISSUE_CATEGORIES, issues, missing, profile, titles } from "../content.ts";
import { Shell } from "../frame/Shell.tsx";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { RaisePhotos } from "./RaisePhotos.tsx";
import { RaiseVisit } from "./RaiseVisit.tsx";
import styles from "./raise.module.css";

type Category = Exclude<ProblemAbout, "hair_system">;

const CATEGORIES = Object.entries(ISSUE_CATEGORIES) as [Category, string][];

/** The category and visit a link named, where it named one the app knows. */
function named(): { about: Category | null; visit: string | null } {
  const query = new URLSearchParams(window.location.search);
  const about = query.get("about");
  const known = CATEGORIES.find(([key]) => key === about);
  return { about: known === undefined ? null : known[0], visit: query.get("visit") };
}

/** Sends the report, then each photograph; opens the issue, saying so where a photograph did not go. */
async function sent(report: { about: Category; visit: string | null; text: string; photos: readonly Blob[] }) {
  const answer = await api.reportProblem({ about: report.about, visit_id: report.visit, text: report.text });
  if (!answer.ok) return answer.status === 429 ? issues.raise.limited : issues.raise.failed;
  const { reference } = answer.body;
  let photosFailed = false;
  for (const photo of report.photos) {
    if (!(await api.problemPhoto(reference, photo)).ok) photosFailed = true;
  }
  go(`/visits/issues/${reference}${photosFailed ? "?photos=failed" : ""}`);
  return null;
}

export function RaiseScreen() {
  const { me } = useSession();
  const [preset] = useState(named);
  const [about, setAbout] = useState<Category | null>(preset.about);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<readonly Blob[]>([]);
  const [visit, setVisit] = useState<string | null>(preset.visit);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const copy = issues.raise;
  const send = () =>
    once(async () => {
      if (about === null) return;
      setProblem(await sent({ about, visit, text: text.trim(), photos }));
    });
  const ready = about !== null && text.trim() !== "" && !busy;
  const waiting = about === null || text.trim() === "" ? missing.raise(about !== null, text.trim() !== "") : null;
  const hours = me.care_hours;
  const support = profile.support;
  return (
    <Shell
      header={{ kind: "back", title: titles.raise, to: "/visits/issues", label: profile.back }}
      tab={null}
      footer={
        <>
          <Button
            variant="primary"
            size="action"
            className={styles.send}
            disabled={!ready}
            aria-describedby={describedBy("raise-missing", waiting !== null)}
            onClick={() => void send()}
          >
            {busy ? copy.sending : copy.send}
          </Button>
          <Missing id="raise-missing" what={waiting} />
        </>
      }
    >
      <div className={styles.page}>
        <section aria-labelledby="about">
          <h2 className={styles.title} id="about">
            {copy.about}
          </h2>
          <div className={styles.chips} role="radiogroup" aria-labelledby="about">
            {CATEGORIES.map(([key, words]) => (
              <ToggleButton
                key={key}
                asRadio
                pressed={about === key}
                onClick={() => {
                  setAbout(key);
                }}
              >
                {words}
              </ToggleButton>
            ))}
          </div>
        </section>
        <WordsField label={copy.what} text={text} max={PROBLEM_MAX_CHARS} onText={setText} />
        <RaisePhotos photos={photos} onChange={setPhotos} />
        <RaiseVisit chosen={visit} onChoose={setVisit} />
        <p className={styles.note}>
          {copy.note(
            support.within(hours.first_reply),
            support.hours(support.hour(hours.opens), support.hour(hours.closes)),
          )}
        </p>
        {problem !== null && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
      </div>
    </Shell>
  );
}
