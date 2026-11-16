// This phone's notifications, on the inbox's head (docs/decisions/0255-client-alerts-and-push.md): whether they are on,
// and Turn on where they are not, which asks the phone and subscribes; kept current each time the inbox opens with them
// allowed. Nothing where the phone cannot show them, or the API has no key to push with.

import { GLYPHS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState } from "react";
import { alerts } from "../content.ts";
import { keepSubscription, notificationsHere, turnOnNotifications, type OnThisPhone } from "./push.ts";

export function PhoneAlerts({ pushKey }: { pushKey: string | null }) {
  const [here, setHere] = useState<OnThisPhone>(notificationsHere);
  const [busy, once] = useOneAtATime();
  useEffect(() => {
    if (pushKey !== null && notificationsHere() === "on") void keepSubscription(pushKey).catch(() => false);
  }, [pushKey]);
  if (pushKey === null || here === "unsupported") return null;
  const copy = alerts.phone;
  const offered = here === "off" || here === "failed";
  return (
    <ListRows>
      <ListRow
        icon={GLYPHS.bell}
        title={copy.title}
        meta={copy[here]}
        action={
          offered ? (
            <Button
              variant="outline"
              size="small"
              disabled={busy}
              onClick={() =>
                void once(async () => {
                  setHere(await turnOnNotifications(pushKey));
                })
              }
            >
              {copy.turnOn}
            </Button>
          ) : undefined
        }
      />
    </ListRows>
  );
}
