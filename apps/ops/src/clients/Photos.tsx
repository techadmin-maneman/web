// Board B2: the client's photographs, locked, then open. The locked state says
// plainly what opening them does, because the API writes the audit entry
// before it serves a single image and serves none if that write fails
// (docs/decisions/0031-access-and-audit.md). Nothing is fetched until the
// press, so the locked state records nothing.

import { indiaClock, fullDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import { api, type Photo, type PhotoVisit } from "../api.ts";
import { clients } from "../content.ts";
import { Loading } from "../states/States.tsx";
import styles from "./clients.module.css";

const copy = clients.photos;
const PHASES = ["before", "after"] as const;

/** One photograph, once its bytes have been asked for: the image, or why it did not come. */
interface Shown {
  readonly photo: Photo;
  readonly url: string | null;
  readonly code: string | null;
}

interface Visit {
  readonly visit: PhotoVisit;
  readonly shown: readonly Shown[];
}

type State =
  | { readonly step: "locked" }
  | { readonly step: "opening" }
  | { readonly step: "failed"; readonly code: string }
  | { readonly step: "open"; readonly at: string; readonly visits: readonly Visit[] };

function captionOf(visit: PhotoVisit): string {
  const type = visit.type === null ? clients.unknown : copy.types[visit.type];
  const technician = visit.technician?.name ?? clients.unknown;
  return copy.caption(fullDate(visit.date), type, technician);
}

function Tile({ shown, visit }: { shown: Shown; visit: PhotoVisit }) {
  const angle = copy.angles[shown.photo.angle];
  if (shown.url === null) {
    return (
      <p className={styles.tileFailed} role="alert">
        {copy.errors[shown.code ?? "unknown"] ?? copy.errors.unknown}
      </p>
    );
  }
  return (
    <img
      className={styles.tile}
      src={shown.url}
      alt={copy.alt(angle, copy.phases[shown.photo.phase], fullDate(visit.date))}
    />
  );
}

function VisitPhotos({ visit, shown }: { visit: PhotoVisit; shown: readonly Shown[] }) {
  return (
    <div className={styles.visit}>
      {PHASES.map((phase) => {
        const ofPhase = shown.filter((each) => each.photo.phase === phase);
        if (ofPhase.length === 0) return null;
        return (
          <div key={phase}>
            <p className={styles.phase}>{copy.phases[phase]}</p>
            <div className={styles.grid}>
              {ofPhase.map((each) => (
                <Tile key={each.photo.id} shown={each} visit={visit} />
              ))}
            </div>
          </div>
        );
      })}
      <p className={styles.caption}>{captionOf(visit)}</p>
    </div>
  );
}

export function Photos({ clientId, name }: { clientId: string; name: string }) {
  const [state, setState] = useState<State>({ step: "locked" });
  // The images are object URLs, so they are released when the tab or the client changes.
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const open = async () => {
    setState({ step: "opening" });
    const listing = await api.clientPhotos(clientId);
    if (!listing.ok) {
      setState({ step: "failed", code: listing.code });
      return;
    }
    const at = new Date().toISOString();
    const visits = await Promise.all(
      listing.body.visits.map(async (visit) => ({
        visit,
        shown: await Promise.all(
          visit.photos.map(async (photo) => {
            const image = await api.clientPhoto(clientId, photo.id);
            if (!image.ok) return { photo, url: null, code: image.code };
            const url = URL.createObjectURL(image.body);
            urls.current.push(url);
            return { photo, url, code: null };
          }),
        ),
      })),
    );
    setState({ step: "open", at, visits });
  };

  if (state.step === "open") {
    return (
      <section className={styles.photos} aria-label={copy.title(name)}>
        {state.visits.length === 0 ? (
          <p className={styles.empty}>{copy.empty}</p>
        ) : (
          <>
            <p className={styles.eyebrow}>{copy.opened(indiaClock(state.at))}</p>
            {state.visits.map(({ visit, shown }) => (
              <VisitPhotos key={visit.visit_id} visit={visit} shown={shown} />
            ))}
          </>
        )}
      </section>
    );
  }

  return (
    <section className={styles.photos} aria-label={copy.title(name)}>
      <p className={styles.eyebrow}>{copy.locked}</p>
      <h3 className={styles.photosTitle}>{copy.title(name)}</h3>
      <p className={styles.warning}>{copy.warning(name.split(" ")[0] ?? name)}</p>
      {state.step === "opening" ? (
        <Loading />
      ) : (
        <button className={styles.primary} type="button" onClick={() => void open()}>
          {copy.open}
        </button>
      )}
      {state.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[state.code] ?? copy.errors.unknown}
        </p>
      )}
    </section>
  );
}
