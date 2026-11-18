// The photographs a client sent with their reports (docs/decisions/0259-the-issue-log.md), beside their chat and in a fit
// guarantee claim's drawer: a button saying how many, and each photograph once it is pressed, since a viewing is logged
// as a client photograph's is. Nothing shows for a client who sent none.

import { Button } from "@maneman/ui/Button";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useState } from "react";
import { careApi, type ReportPhoto } from "./care-api.ts";
import { care } from "../content/care.ts";
import { useAccess } from "../lib/access.ts";
import styles from "./care.module.css";

const copy = care.reportPhotos;

interface Shown {
  readonly photo: ReportPhoto;
  readonly url: string;
}

interface Props {
  readonly conversationId: string;
  /** The reports whose photographs to show, by reference, as a claim's; every report of the client's without. */
  readonly only?: readonly string[];
}

/** The photographs, for those who may read Care's chats; nothing for anyone else. */
export function ReportPhotos(props: Props) {
  const mayRead = useAccess().mayCall("GET /api/conversations/{id}/report-photos");
  return mayRead ? <Photos {...props} /> : null;
}

function Photos({ conversationId, only }: Props) {
  const load = useCallback(() => careApi.reportPhotos(conversationId), [conversationId]);
  const [loaded] = useLoad(load);
  const [shown, setShown] = useState<readonly Shown[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, once] = useOneAtATime();
  // Each image is an object URL, let go when the next set replaces it or the column closes.
  useEffect(
    () => () => {
      for (const each of shown ?? []) URL.revokeObjectURL(each.url);
    },
    [shown],
  );
  const photos =
    loaded.state === "loaded"
      ? loaded.value.photos.filter((photo) => only === undefined || only.includes(photo.reference))
      : [];
  if (photos.length === 0) return null;
  const show = () =>
    once(async () => {
      setFailed(false);
      const answers = await Promise.all(
        photos.map(async (photo) => ({
          photo,
          answer: await careApi.reportPhoto(conversationId, photo.report_id, photo.n),
        })),
      );
      const opened = answers.flatMap(({ photo, answer }) =>
        answer.ok ? [{ photo, url: URL.createObjectURL(answer.body) }] : [],
      );
      setShown(opened);
      setFailed(opened.length < photos.length);
    });
  return (
    <div className={styles.reportPhotos}>
      {(shown === null || failed) && (
        <Button variant="outline" size="small" busy={busy} onClick={() => void show()}>
          {copy.show(photos.length)}
        </Button>
      )}
      {failed && <InlineMessage tone="error">{copy.failed}</InlineMessage>}
      {shown !== null && shown.length > 0 && (
        <ul className={styles.photoList} aria-label={copy.list}>
          {shown.map(({ photo, url }) => (
            <li key={`${photo.report_id}-${String(photo.n)}`}>
              <figure className={styles.photoFigure}>
                <img className={styles.photo} src={url} alt={copy.alt(photo.reference, photo.n)} />
                <figcaption>{copy.caption(photo.reference, photo.n)}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
