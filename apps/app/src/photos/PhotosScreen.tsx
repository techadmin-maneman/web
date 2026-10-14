// Photos: each visit's photographs, newest first, and Compare once
// there are two visits to compare. Before the first fit, Photos' empty
// state. Above them, a try-on the client made on the site, while it is kept
// (ADR 0082). A photograph opens in a sheet, to download.

import { TAB_ICONS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { useLiveLoad, whenLoaded } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type PhotoTimeline } from "../api.ts";
import { empty, photos, states, TRY_ON_URL } from "../content.ts";
import { AppLink, Shell } from "../components/Shell.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { visitName } from "../lib/visit.ts";
import { PageFailed } from "../states/PageFailed.tsx";
import { ANGLES, PhotoRow, type OpenPhoto } from "./PhotoRow.tsx";
import { PhotoSheet } from "./PhotoSheet.tsx";
import { LINKS_FRESH_MS, type Relink, useRelink } from "./relink.ts";
import { TryOnGroup } from "./TryOnGroup.tsx";
import styles from "./photos.module.css";

/** Photos' loading: the row's five blocks, before anything has arrived. */
function PhotosLoading() {
  return (
    <div className={styles.timeline} role="status">
      <VisuallyHidden>{states.loading}</VisuallyHidden>
      <div className={styles.row}>
        {ANGLES.map((angle) => (
          <div key={angle} className={styles.cell} />
        ))}
      </div>
    </div>
  );
}

/**
 * Each visit's photographs, newest first, beneath the try-ons still kept (ADR 0082); before the first
 * fit, Photos' empty state, or its lines beneath a try-on.
 */
function Timeline({
  timeline,
  onOpen,
  relink,
}: {
  timeline: PhotoTimeline;
  onOpen: (photo: OpenPhoto) => void;
  relink: Relink;
}) {
  const { visits, try_ons: tryOns } = timeline;
  if (visits.length === 0 && tryOns.length === 0) {
    const tryOn = (
      <ButtonLink variant="outline" size="small" className={styles.tryOn} href={TRY_ON_URL[import.meta.env.MM_ENV]}>
        {empty.photos.tryOn}
      </ButtonLink>
    );
    return <EmptyState look="page" lines={empty.photos.lines} icon={TAB_ICONS.photos} action={tryOn} />;
  }
  return (
    <>
      <div className={styles.timeline}>
        {tryOns.map((tryOn) => (
          <TryOnGroup key={tryOn.id} tryOn={tryOn} onOpen={onOpen} relink={relink} />
        ))}
        {visits.length > 0 && <p className={styles.basis}>{photos.basis}</p>}
        {visits.map((visit) => (
          <section key={visit.visit_id} aria-labelledby={`visit-${visit.visit_id}`}>
            <div className={styles.group}>
              <h2 className={styles.groupDate} id={`visit-${visit.visit_id}`}>
                {fullDate(visit.date)}
              </h2>
              <p className={styles.groupWhat}>{visitName(visit.type)}</p>
            </div>
            <PhotoRow set={visit.photos} date={visit.date} onOpen={onOpen} relink={relink} />
          </section>
        ))}
      </div>
      {visits.length === 0 && <EmptyState look="page" lines={empty.photos.lines} />}
    </>
  );
}

export function PhotosScreen() {
  const { loaded, refresh, retry } = useLiveLoad(api.photos, LINKS_FRESH_MS);
  const relink = useRelink(refresh);
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
      {whenLoaded(loaded, {
        loading: <PhotosLoading />,
        failed: <PageFailed onRetry={retry} />,
        loaded: (timeline) => <Timeline timeline={timeline} onOpen={setOpen} relink={relink} />,
      })}
      {open !== null && (
        <PhotoSheet
          photo={open}
          relink={relink}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </Shell>
  );
}
