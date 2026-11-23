// Tasks' "New task" in the page's head (docs/decisions/0302-tasks-written-by-hand.md): it opens the panel a task is
// written in, and says so once it is added.

import { Button } from "@maneman/ui/Button";
import { Toast } from "@maneman/ui/Toast";
import { useLoad } from "@maneman/ui/useLoad";
import { ICONS } from "@maneman/brand/icons";
import { useState } from "react";
import { tasks } from "../content.ts";
import { PageActions } from "../frame/PageHead.tsx";
import { useAccess, whoami } from "../lib/access.ts";
import { useCity } from "../lib/city.ts";
import { NewTask } from "./NewTask.tsx";

export function WriteTask({ me, staff }: { readonly me: string | null; readonly staff: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(0);
  const [signedIn] = useLoad(whoami);
  const { city } = useCity();
  const access = useAccess();
  if (!access.mayCall("POST /api/tasks")) return null;
  // The writer's own department first, as the first of their grants names it.
  const department =
    (signedIn.state === "loaded" ? signedIn.value.staff.grants[0]?.department : undefined) ?? "operations";
  return (
    <>
      <PageActions>
        <Button
          variant="outline"
          size="small"
          icon={ICONS.plus}
          onClick={() => {
            setOpen(true);
          }}
        >
          {tasks.write.open}
        </Button>
      </PageActions>
      {open && (
        <NewTask
          department={department}
          city={city}
          cities={signedIn.state === "loaded" && !signedIn.value.every_city ? signedIn.value.cities : null}
          mayFind={access.mayCall("POST /api/clients/find")}
          me={me}
          staff={staff}
          onAdded={() => {
            setOpen(false);
            setAdded((count) => count + 1);
          }}
          onDismiss={() => {
            setOpen(false);
          }}
        />
      )}
      {added > 0 && <Toast key={added}>{tasks.write.added}</Toast>}
    </>
  );
}
