// A job's card or step that did not load, with the way back to Today always at the top: in the home-screen app there is
// no browser Back to fall back on. A job that is not this technician's says so, rather than offering a retry that
// cannot help.

import { ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { ReachOps } from "../components/ReachOps.tsx";
import { job as copy } from "../content.ts";
import { go } from "../route.ts";
import frame from "../components/frame.module.css";
import { Failed } from "./States.tsx";
import styles from "./job-failed.module.css";

const toToday = () => {
  go("/");
};

export function JobFailed({
  failed,
  onRetry,
}: {
  readonly failed: { readonly requestId: string | null; readonly gone: boolean };
  readonly onRetry: () => void;
}) {
  return (
    <main className={frame.screen}>
      <header className={frame.head}>
        <IconButton d={ICONS.back} size="lg" weight="heavy" label={copy.backToToday} onClick={toToday} />
      </header>
      <div className={styles.body}>
        {failed.gone ? (
          <Failed message={copy.gone} retry={copy.backToToday} onRetry={toToday} />
        ) : (
          <Failed message={copy.failed} retry={copy.retry} onRetry={onRetry} requestId={failed.requestId} />
        )}
        <ReachOps className={styles.reach} />
      </div>
    </main>
  );
}
