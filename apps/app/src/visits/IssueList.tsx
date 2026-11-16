// Visits' Issues (design/client-redesign, Visits): every issue the client raised, newest first, with where it stands,
// each opening its own page (docs/decisions/0259-the-issue-log.md).

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { Badge } from "@maneman/ui/Badge";
import { EmptyState } from "@maneman/ui/EmptyState";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Loading } from "@maneman/ui/States";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { dayMonth, indiaDate } from "@maneman/web-kit/dates";
import { api, type Issue } from "../api.ts";
import { ISSUE_CATEGORIES, issues } from "../content.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
import styles from "./issue-list.module.css";

/** What an issue is: a report's category, or a grievance or a dispute. */
export function issueTitle(issue: Issue): string {
  if (issue.kind !== "report") return issues.kinds[issue.kind];
  return issue.category === null ? ISSUE_CATEGORIES.other : ISSUE_CATEGORIES[issue.category];
}

/** Where an issue stands, in its tag: done once resolved, else waiting on us. */
export function IssueState({ state }: { state: Issue["state"] }) {
  return <Badge tone={state === "resolved" ? "done" : "attention"}>{issues.states[state]}</Badge>;
}

/** An issue's path: its report's reference, or its ID where it has none. */
export const issuePath = (issue: Issue): string => `/visits/issues/${issue.reference ?? issue.id}`;

export function IssueList() {
  const [loaded, retry] = useLoad(api.problems);
  return whenLoaded(loaded, {
    loading: <Loading />,
    failed: <PageFailed onRetry={retry} />,
    loaded: ({ issues: log }) =>
      log.length === 0 ? (
        <EmptyState look="page" lines={[issues.none.title, issues.none.line]} icon={CLIENT_ICONS.flag} />
      ) : (
        <div className={styles.list}>
          <ListRows>
            {log.map((issue) => (
              <ListRow
                key={issue.id}
                title={issueTitle(issue)}
                meta={issues.raised(issue.reference, dayMonth(indiaDate(issue.raised_at)))}
                end={<IssueState state={issue.state} />}
                to={issuePath(issue)}
                chevron
              />
            ))}
          </ListRows>
          <p className={styles.kept}>{issues.kept}</p>
        </div>
      ),
  });
}
