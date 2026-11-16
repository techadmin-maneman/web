// Today's after photos inside the sign-off panel (design/client-redesign, the sign-off panel), read with the visit, so
// the client checks the fit against them without leaving the checks they have ticked.

import { useLiveLoad } from "@maneman/ui/useLoad";
import { useCallback, useState } from "react";
import { api } from "../api.ts";
import { live } from "../content.ts";
import { LINKS_FRESH_MS, type OpenPhoto, PhotoRow, PhotoSheet, useRelink } from "../photos/index.ts";
import styles from "./live-card.module.css";

export function AfterPhotos({ visitId }: { visitId: string }) {
  const { loaded, refresh } = useLiveLoad(
    useCallback(() => api.visit(visitId), [visitId]),
    LINKS_FRESH_MS,
  );
  const relink = useRelink(refresh);
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  if (loaded.state !== "loaded" || loaded.value.photos.after.length === 0) return null;
  const visit = loaded.value;
  return (
    <div className={styles.photos}>
      <p className={styles.panelLine}>{live.signOff.photos}</p>
      <PhotoRow set={{ before: [], after: visit.photos.after }} date={visit.date} onOpen={setOpen} relink={relink} />
      {open !== null && (
        <PhotoSheet
          photo={open}
          relink={relink}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
