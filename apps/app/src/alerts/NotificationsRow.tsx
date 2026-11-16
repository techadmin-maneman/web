// Home's row asking for this phone's notifications (docs/decisions/0255-client-alerts-and-push.md): only once a visit
// is booked, never on load, and only where the phone can show them, they are not on yet, and the API can push.

import { GLYPHS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState } from "react";
import { alerts } from "../content.ts";
import { pushKeyNow } from "./kept-push.ts";
import { notificationsHere, turnOnNotifications, type OnThisPhone } from "./push.ts";

export function NotificationsRow() {
  const [here, setHere] = useState<OnThisPhone>(notificationsHere);
  const [key, setKey] = useState<string | null>(null);
  const [busy, once] = useOneAtATime();
  const asking = here === "off" || here === "failed";
  useEffect(() => {
    if (asking && key === null) void pushKeyNow().then(setKey);
  }, [asking, key]);
  if (!asking || key === null) return null;
  const copy = alerts.phone;
  return (
    <ListRows>
      <ListRow
        icon={GLYPHS.bell}
        title={copy.title}
        meta={copy[here]}
        action={
          <Button
            variant="outline"
            size="small"
            disabled={busy}
            onClick={() =>
              void once(async () => {
                setHere(await turnOnNotifications(key));
              })
            }
          >
            {copy.turnOn}
          </Button>
        }
      />
    </ListRows>
  );
}
