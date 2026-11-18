// Photos (design/client-redesign, the photos screen): once two visits have photographs, their before and after at the
// top; then every visit's photographs, newest first, beneath a try-on the client made on the site while it is kept
// (ADR 0082). Before the first fit, Photos' empty state. A photograph opens in a sheet, to download.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { useLiveLoad, whenLoaded } from "@maneman/ui/useLoad";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { fullDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import { api, type PhotoTimeline } from "../api.ts";
import { empty, photos, states, TRY_ON_URL } from "../content.ts";
import { Shell } from "../frame/Shell.tsx";
import { EmptyState } from "@maneman/ui/EmptyState";
import { visitName } from "../lib/visit.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
import { PhotoCompare } from "./PhotoCompare.tsx";
import { ANGLES, PhotoRow, shownPhase, type OpenPhoto } from "./PhotoRow.tsx";
import { PhotoSheet } from "./PhotoSheet.tsx";
import { LINKS_FRESH_MS, type Relink, useRelink } from "./relink.ts";
import { TryOnGroup } from "./TryOnGroup.tsx";
import shared from "./photos.module.css";
import styles from "./photos-screen.module.css";

/** Photos' loading: the row's five blocks, before anything has arrived. */
function PhotosLoading() {
  return (
    <div className={shared.timeline} role="status">
      <VisuallyHidden>{states.loading}</VisuallyHidden>
      <div className={shared.row}>
        {ANGLES.map((angle) => (
          <div key={angle} className={shared.cell} />
        ))}
      </div>
    </div>
  );
}

type Visit = PhotoTimeline["visits"][number];

/** Every visit's photographs, newest first, under how many there are. */
function EveryVisit({ visits, onOpen, relink }: { visits: readonly Visit[]; onOpen: Open; relink: Relink }) {
  const count = visits.reduce((sum, visit) => sum + visit.photos[shownPhase(visit.photos)].length, 0);
  return (
    <section className={styles.every} aria-labelledby="every-visit">
      <div className={shared.group}>
        <h2 className={styles.everyTitle} id="every-visit">
          {photos.everyVisit}
        </h2>
        <p className={shared.groupWhat}>{photos.count(count)}</p>
      </div>
      {visits.map((visit) => (
        <section key={visit.visit_id} className={styles.visit} aria-labelledby={`visit-${visit.visit_id}`}>
          <div className={shared.group}>
            <h3 className={shared.groupDate} id={`visit-${visit.visit_id}`}>
              {fullDate(visit.date)}
            </h3>
            <p className={shared.groupWhat}>{visitName(visit.type)}</p>
          </div>
          <PhotoRow set={visit.photos} date={visit.date} onOpen={onOpen} relink={relink} />
        </section>
      ))}
    </section>
  );
}

type Open = (photo: OpenPhoto) => void;

/** The before and after, the try-ons still kept and every visit; before the first fit, the empty state. */
function Timeline({ timeline, onOpen, relink }: { timeline: PhotoTimeline; onOpen: Open; relink: Relink }) {
  const { visits, try_ons: tryOns } = timeline;
  const emptyState = (
    <EmptyState
      look="page"
      lines={empty.photos.lines}
      icon={CLIENT_ICONS.camera}
      action={
        <ButtonLink variant="outline" size="small" className={styles.tryOn} href={TRY_ON_URL[import.meta.env.MM_ENV]}>
          {empty.photos.tryOn}
        </ButtonLink>
      }
    />
  );
  if (visits.length === 0 && tryOns.length === 0) return emptyState;
  return (
    <div className={shared.timeline}>
      <PhotoCompare visits={visits} relink={relink} />
      {tryOns.map((tryOn) => (
        <TryOnGroup key={tryOn.id} tryOn={tryOn} onOpen={onOpen} relink={relink} />
      ))}
      {visits.length > 0 ? (
        <EveryVisit visits={visits} onOpen={onOpen} relink={relink} />
      ) : (
        <EmptyState look="page" lines={empty.photos.lines} />
      )}
    </div>
  );
}

export function PhotosScreen() {
  const { loaded, refresh, retry } = useLiveLoad(api.photos, LINKS_FRESH_MS);
  const relink = useRelink(refresh);
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  return (
    <Shell header={{ kind: "tab", title: photos.title }} tab="/photos">
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
