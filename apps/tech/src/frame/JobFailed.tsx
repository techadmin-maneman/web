// A job's card or step that did not load, with the way back to Today always at the top: in the home-screen app there is
// no browser Back to fall back on. A job that is not this technician's says so, rather than offering a retry that
// cannot help.

import { ICONS } from "@maneman/brand/icons";
import { classes } from "@maneman/ui/classes";
import { IconButton } from "@maneman/ui/IconButton";
import { ReachOps } from "./ReachOps.tsx";
import { job as copy } from "../content.ts";
import { go } from "../route.ts";
import frame from "./frame.module.css";
import { Failed } from "./States.tsx";
import styles from "./job-failed.module.css";
import light from "./light.module.css";

const toToday = () => {
  go("/");
};

export function JobFailed({
  failed,
  onRetry,
  onPaper = false,
}: {
  readonly failed: { readonly requestId: string | null; readonly gone: boolean };
  readonly onRetry: () => void;
  /** On a screen redrawn in the new look (../styles/look.css). */
  readonly onPaper?: boolean;
}) {
  return (
    <main className={classes(frame.screen, onPaper && light.paperScreen)} data-look={onPaper ? "light" : undefined}>
      <header className={classes(frame.head, onPaper && light.paperHead)}>
        <IconButton d={ICONS.back} size="lg" weight="heavy" label={copy.backToToday} onClick={toToday} />
      </header>
      <div className={styles.body}>
        {failed.gone ? (
          <Failed message={copy.gone} retry={copy.backToToday} onRetry={toToday} onPaper={onPaper} />
        ) : (
          <Failed
            message={copy.failed}
            retry={copy.retry}
            onRetry={onRetry}
            requestId={failed.requestId}
            onPaper={onPaper}
          />
        )}
        <ReachOps className={styles.reach} onPaper={onPaper} />
      </div>
    </main>
  );
}
