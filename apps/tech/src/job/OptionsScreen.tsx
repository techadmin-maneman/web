// A consultation's Options from its job, open at any point of the visit (docs/decisions/0247-the-steps-left.md): each
// product on sale with what it costs the client, and the looks they made with the try-on, as the outcome's Options
// shows them, with no pick.

import { options as copy, visit } from "../content.ts";
import { CardFrame, nameOf } from "../frame/CardFrame.tsx";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { kindNameLower } from "../lib/kind.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { OptionsList } from "../steps/index.ts";

export function OptionsScreen({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  if (loaded.state === "loading") return <Loading onPaper />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} onPaper />;
  const job = loaded.value;
  return (
    <CardFrame
      title={copy.title}
      sub={visit.whoAndWhat(nameOf(job), kindNameLower(job))}
      back={`/jobs/${job.id}`}
      foot={null}
    >
      <OptionsList job={job} />
    </CardFrame>
  );
}
