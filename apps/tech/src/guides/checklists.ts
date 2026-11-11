// Each kind of visit's checklist for Guides, as ops set it in the console (GET /api/tech/checklists), so a guide lists the
// tasks the visit's own checklist step asks for. Kept on the phone as last read, for Guides with no signal; the
// committed lists stand until the first read.

import { CHECKLIST } from "@rules/config/job-sheet.ts";
import { VISIT_TYPES } from "@rules/config/visit-types.ts";
import { useEffect, useState } from "react";
import { api, type Checklists } from "../api.ts";
import { deviceRecord, put } from "../store/db.ts";

const COMMITTED = Object.fromEntries(
  VISIT_TYPES.map((type) => [type, CHECKLIST[type].map(({ id, label }) => ({ id, label }))]),
) as Checklists;

/** The checklists, and whether the phone's own copy has been read: until then a task may not be in them yet. */
export function useChecklists(): { readonly lists: Checklists; readonly ready: boolean } {
  const [lists, setLists] = useState<Checklists>(COMMITTED);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const screen = { open: true };
    const gone = () => !screen.open;
    void (async () => {
      const kept = await deviceRecord("checklists").catch(() => null);
      if (gone()) return;
      if (kept !== null) setLists(kept.checklists);
      setReady(true);
      const answer = await api.checklists();
      if (!answer.ok || gone()) return;
      setLists(answer.body.checklists);
      await put("device", { key: "checklists", checklists: answer.body.checklists }).catch(() => undefined);
    })();
    return () => {
      screen.open = false;
    };
  }, []);
  return { lists, ready };
}
