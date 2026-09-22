// Photos (board D1): each visit's photographs, newest first, and Compare once
// there are two visits to compare. Before the first fit, board D3's empty
// state. A photograph opens in a sheet, to download.

import { fullDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api } from "../api.ts";
import { empty, photos, states } from "../content.ts";
import { AppLink, Shell } from "../home/Shell.tsx";
import { EmptyState } from "../home/TabScreens.tsx";
import { TAB_ICONS } from "../icons.ts";
import { useLoad } from "../lib/useLoad.ts";
import { visitName } from "../lib/visit.ts";
import { PageFailed } from "../states/PageFailed.tsx";
import { ANGLES, PhotoRow, type OpenPhoto } from "./PhotoRow.tsx";
import { PhotoSheet } from "./PhotoSheet.tsx";
import styles from "./photos.module.css";

/** Board D3's loading: the row's five blocks, before anything has arrived. */
function PhotosLoading() {
  return (
    <div className={styles.timeline} role="status">
      <span className={styles.hidden}>{states.loading}</span>
      <div className={styles.row}>
        {ANGLES.map((angle) => (
          <div key={angle} className={styles.cell} />
        ))}
      </div>
    </div>
  );
}

export function PhotosScreen() {
  const [loaded, retry] = useLoad(api.photos);
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  const visits = loaded.state === "loaded" ? loaded.value.visits : [];
  const compare =
    visits.length >= 2 ? (
      <AppLink className={styles.compareLink} to="/photos/compare">
        <span>{photos.compare}</span>
      </AppLink>
    ) : undefined;

  return (
    <Shell header={{ kind: "tab", title: photos.title, action: compare }} tab="/photos">
      {loaded.state === "loading" ? (
        <PhotosLoading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : visits.length === 0 ? (
        <EmptyState lines={empty.photos.lines} icon={TAB_ICONS.photos} />
      ) : (
        <div className={styles.timeline}>
          {visits.map((visit) => (
            <section key={visit.visit_id} aria-labelledby={`visit-${visit.visit_id}`}>
              <div className={styles.group}>
                <h2 className={styles.groupDate} id={`visit-${visit.visit_id}`}>
                  {fullDate(visit.date)}
                </h2>
                <p className={styles.groupWhat}>{visitName(visit.type)}</p>
              </div>
              <PhotoRow set={visit.photos} date={visit.date} onOpen={setOpen} />
            </section>
          ))}
        </div>
      )}
      {open !== null && (
        <PhotoSheet
          photo={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </Shell>
  );
}
