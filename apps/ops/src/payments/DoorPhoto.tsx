// The technician's photograph of the door a no-show was closed with, on a case's facts (./NoShowsScreen.tsx): fetched
// only when asked for, since its viewing is logged as a client photograph's is.

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState } from "react";
import { noShows } from "../content.ts";
import styles from "./no-shows.module.css";
import { paymentsApi } from "./payments-api.ts";

const copy = noShows.queue.doorPhoto;

export function DoorPhoto({ caseId }: { caseId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (url !== null) return <img className={styles.doorPhoto} src={url} alt={copy.alt} />;
  const show = () =>
    once(async () => {
      setFailed(false);
      const answer = await paymentsApi.doorPhoto(caseId);
      if (answer.ok) setUrl(URL.createObjectURL(answer.body));
      else setFailed(true);
    });
  return (
    <>
      <Button variant="outline" size="small" busy={busy} onClick={() => void show()}>
        {copy.show}
      </Button>
      {failed && <span className={styles.doorFailed}>{copy.failed}</span>}
    </>
  );
}
