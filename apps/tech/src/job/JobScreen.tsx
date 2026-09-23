// Board A3: one job's card. Client, time, type and slots, the badge, the
// address with its access notes and Navigate, the piece, last visit's after
// photograph, and Start job at the bottom.
//
// A job further out shows time, type and sector only: the backend's day-before
// unlock decides, and the card simply has no address to draw.

import { Icon } from "../components/Icon.tsx";
import { badges, job as copy, types, typesLower } from "../content.ts";
import { BACK, PIN } from "../icons.ts";
import { useJob } from "../lib/useDay.ts";
import { clock, where } from "../lib/when.ts";
import { go } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import { queue, replay } from "../store/outbox.ts";
import styles from "./job.module.css";

export function JobScreen({ id }: { id: string }) {
  const [loaded, retry] = useJob(id);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return (
      <main className={styles.screen}>
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} />
      </main>
    );
  }

  const job = loaded.value;
  /** The start is queued, not sent: a basement must not stop a job beginning. Step 1 follows (board B1). */
  const start = async () => {
    await queue("start", job.id, { at: new Date().toISOString() });
    void replay();
    go(`/jobs/${job.id}/photos`);
  };

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <button
          className={styles.back}
          type="button"
          aria-label={copy.back}
          onClick={() => {
            go("/");
          }}
        >
          <Icon d={BACK} size={24} />
        </button>
        <div className={styles.headWho}>
          <h1 className={styles.name}>{job.locked ? types[job.type] : job.client_name}</h1>
          <p className={styles.when}>{copy.when(clock(job.starts_at), typesLower[job.type], copy.slots(job.slots))}</p>
        </div>
        <span className={styles.badge}>{badges[job.badge]}</span>
      </header>

      <div className={styles.body}>
        {job.address === null ? (
          <section className={styles.locked}>
            <p className={styles.lockedTitle}>{copy.locked.title}</p>
            <p className={styles.lockedBody}>{copy.locked.body}</p>
            <p className={styles.sector}>{where(job.sector, job.distance_km)}</p>
          </section>
        ) : (
          <section className={styles.address}>
            <p className={styles.line}>{job.address.line}</p>
            {job.address.access_notes !== null && <p className={styles.access}>{job.address.access_notes}</p>}
            <a className={styles.navigate} href={`geo:0,0?q=${encodeURIComponent(job.address.line)}`}>
              <Icon d={PIN} size={21} />
              <span>{copy.navigate}</span>
            </a>
          </section>
        )}

        {job.spec.length > 0 && (
          <section className={styles.piece}>
            <h2 className={styles.pieceTitle}>{copy.piece}</h2>
            <dl className={styles.spec}>
              {job.spec.map((row) => (
                <div className={styles.specRow} key={row.key}>
                  <dt className={styles.specKey}>{row.key}</dt>
                  <dd className={styles.specValue}>{row.value}</dd>
                </div>
              ))}
            </dl>
            {job.last_visit !== null && (
              <div className={styles.last}>
                <img className={styles.thumb} src={job.last_visit.photo_url} alt="" />
                <p className={styles.lastLine}>{copy.lastVisit(job.last_visit.on, job.last_visit.technician)}</p>
              </div>
            )}
          </section>
        )}
      </div>

      {!job.locked && (
        <div className={styles.foot}>
          <button className={styles.action} type="button" onClick={() => void start()}>
            {copy.start}
          </button>
        </div>
      )}
    </main>
  );
}
