// Refer (board F1): what a referral earns, the client's credit, and the two ways on: sharing an invite (F2 to
// F4, ShareSheet) and seeing who has been fitted (F5 and F6, /refer/fitted). The tracker shows completed fits
// only (docs/decisions/0048-referrals.md).

import { fullDate, indiaDate } from "@maneman/web-kit/dates";
import { useCallback, useState } from "react";
import { ICONS_P2 } from "@maneman/brand/icons";
import { api, type Refer } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { refer } from "../content.ts";
import { Shell } from "../home/Shell.tsx";
import { AppLink } from "../home/Shell.tsx";
import { useLoad } from "../lib/useLoad.ts";
import { Loading } from "../states/Loading.tsx";
import { PageFailed } from "../states/PageFailed.tsx";
import { ShareSheet } from "./ShareSheet.tsx";
import styles from "./refer.module.css";

export function CreditTile({ credits }: { credits: Refer["credits"] }) {
  if (credits.visits === 0) return null;
  const expiry = credits.earliest_expiry;
  return (
    <div className={styles.credit}>
      <div>
        <p className={styles.creditLabel}>{refer.credit.label}</p>
        {expiry !== null && <p className={styles.creditExpiry}>{refer.credit.expire(fullDate(indiaDate(expiry)))}</p>}
      </div>
      <p className={styles.creditCount}>{credits.visits}</p>
    </div>
  );
}

function Refer({ refer: state, onChanged }: { refer: Refer; onChanged: () => void }) {
  const [sharing, setSharing] = useState(false);
  return (
    <div className={styles.page}>
      <p className={styles.promise}>{refer.promise}</p>
      <CreditTile credits={state.credits} />
      <p className={styles.note}>{refer.noOther}</p>
      {/* The board puts the two ways on at the foot of the screen, above the tabs. */}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          type="button"
          onClick={() => {
            setSharing(true);
          }}
        >
          <Icon d={ICONS_P2.share} size={17} />
          {refer.share}
        </button>
        <AppLink className={styles.secondary} to="/refer/fitted">
          {refer.tracker}
        </AppLink>
      </div>
      {sharing && (
        <ShareSheet
          refer={state}
          onClose={(changed) => {
            setSharing(false);
            if (changed) onChanged();
          }}
        />
      )}
    </div>
  );
}

export function ReferScreen() {
  const [loaded, retry] = useLoad(useCallback(() => api.refer(), []));
  return (
    <Shell header={{ kind: "tab", title: refer.title }} tab="/refer">
      {loaded.state === "loading" ? (
        <Loading />
      ) : loaded.state === "failed" ? (
        <PageFailed onRetry={retry} />
      ) : (
        <Refer refer={loaded.value} onChanged={retry} />
      )}
    </Shell>
  );
}
