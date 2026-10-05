// Board B2: the client's photographs, locked, then open. The locked state says
// plainly what opening them does. Opening them asks the API to log the view
// first, one entry for the whole opening, and nothing is fetched unless that
// is written (docs/decisions/0031-access-and-audit.md). The time shown is the
// one the API logged, by its own clock, and beside the photographs is the log
// of who opened them before.
//
// The newest visits' photographs come first; earlier ones are fetched only when
// asked for, since a client of some years has a great many. The opening is held
// by the client's page, so leaving this tab and coming back is the same view.

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { fullDate, indiaClock, longDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Photo, type PhotoView, type PhotoVisit } from "../api.ts";
import { clients } from "../content.ts";
import { whoWords } from "../lib/who.ts";
import { Loading } from "../states/States.tsx";
import styles from "./clients.module.css";
import { firstNameOf } from "../../../../src/lib/names.ts";

const copy = clients.photos;
const PHASES = ["before", "after"] as const;
/** How many visits' photographs one press fetches. */
const VISITS_AT_ONCE = 2;

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
  | { readonly step: "none" }
  | { readonly step: "failed"; readonly code: string }
  | {
      readonly step: "open";
      readonly view: PhotoView;
      readonly shown: readonly Visit[];
      readonly waiting: readonly PhotoVisit[];
      readonly fetching: boolean;
    };

/**
 * The client's photographs as the page holds them: the opening, the visits
 * shown so far, and those still to fetch. Every image is an object URL, let go
 * when the page is.
 */
export function usePhotos(clientId: string) {
  const [state, setState] = useState<State>({ step: "locked" });
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    },
    [],
  );

  const fetchVisit = useCallback(
    async (visit: PhotoVisit): Promise<Visit> => ({
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
    }),
    [clientId],
  );

  const open = useCallback(async () => {
    setState({ step: "opening" });
    const listing = await api.clientPhotos(clientId);
    if (!listing.ok) {
      setState({ step: "failed", code: listing.code });
      return;
    }
    // With nothing to show there is nothing to open, and nothing is logged.
    if (listing.body.visits.length === 0) {
      setState({ step: "none" });
      return;
    }
    // Logged before a single image is asked for; a view that could not be logged shows nothing.
    const view = await api.openPhotos(clientId);
    if (!view.ok) {
      setState({ step: "failed", code: view.code });
      return;
    }
    const first = listing.body.visits.slice(0, VISITS_AT_ONCE);
    const shown = await Promise.all(first.map(fetchVisit));
    setState({
      step: "open",
      view: view.body,
      shown,
      waiting: listing.body.visits.slice(VISITS_AT_ONCE),
      fetching: false,
    });
  }, [clientId, fetchVisit]);

  const more = useCallback(async () => {
    if (state.step !== "open") return;
    setState({ ...state, fetching: true });
    const next = await Promise.all(state.waiting.slice(0, VISITS_AT_ONCE).map(fetchVisit));
    setState({
      ...state,
      shown: [...state.shown, ...next],
      waiting: state.waiting.slice(VISITS_AT_ONCE),
      fetching: false,
    });
  }, [state, fetchVisit]);

  return { state, open, more } as const;
}

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

function VisitPhotos({ visit, shown }: Visit) {
  return (
    <div className={styles.visit}>
      {PHASES.map((phase) => {
        const ofPhase = shown.filter((each) => each.photo.phase === phase);
        if (ofPhase.length === 0) return null;
        return (
          <div key={phase}>
            <p className={capsLook(styles.phase)}>{copy.phases[phase]}</p>
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

/** The log the locked state promises: who opened these before this opening, and when. */
function Before({ view }: { view: PhotoView }) {
  return (
    <section className={styles.before} aria-labelledby="photos-before">
      <h4 className={capsLook(styles.phase)} id="photos-before">
        {copy.before}
      </h4>
      {view.before.length === 0 ? (
        <p className={styles.caption}>{copy.neverBefore}</p>
      ) : (
        <ul className={styles.beforeList}>
          {view.before.map((each) => (
            <li className={styles.caption} key={each.at}>
              {copy.beforeRow(whoWords(each.by), longDate(each.at), indiaClock(each.at))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The earlier visits, fetched a few at a time, while any are left. */
function Earlier({ waiting, fetching, onMore }: { waiting: number; fetching: boolean; onMore: () => void }) {
  if (waiting === 0) return null;
  if (fetching) return <Loading />;
  return (
    <Button variant="outline" size="small" className={styles.secondary} onClick={onMore}>
      {copy.earlier(Math.min(waiting, VISITS_AT_ONCE))}
    </Button>
  );
}

export function Photos({ photos, name }: { photos: ReturnType<typeof usePhotos>; name: string }) {
  const { state, open, more } = photos;

  if (state.step === "none") {
    return (
      <section className={styles.photos} aria-label={copy.title(name)}>
        <p className={styles.empty}>{copy.empty}</p>
      </section>
    );
  }

  if (state.step === "open") {
    return (
      <section className={styles.photos} aria-label={copy.title(name)}>
        <p className={capsLook(styles.eyebrow)}>{copy.opened(indiaClock(state.view.logged_at))}</p>
        <p className={styles.caption}>{copy.basis}</p>
        {state.shown.map((each) => (
          <VisitPhotos key={each.visit.visit_id} visit={each.visit} shown={each.shown} />
        ))}
        <Earlier waiting={state.waiting.length} fetching={state.fetching} onMore={() => void more()} />
        <Before view={state.view} />
      </section>
    );
  }

  return (
    <section className={styles.photos} aria-label={copy.title(name)}>
      <p className={capsLook(styles.eyebrow)}>{copy.locked}</p>
      <h3 className={styles.photosTitle}>{copy.title(name)}</h3>
      <p className={styles.caption}>{copy.basis}</p>
      <p className={styles.warning}>{copy.warning(firstNameOf(name))}</p>
      {state.step === "opening" ? (
        <Loading />
      ) : (
        <Button variant="primary" size="small" className={styles.primary} onClick={() => void open()}>
          {copy.open}
        </Button>
      )}
      {state.step === "failed" && (
        <p className={styles.error} role="alert">
          {copy.errors[state.code] ?? copy.errors.unknown}
        </p>
      )}
    </section>
  );
}
