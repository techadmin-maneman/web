// Me's row for Alerts: how many kinds are on, once the inbox has been read.

import { ListRow } from "@maneman/ui/ListRow";
import { useLoad } from "@maneman/ui/useLoad";
import { api } from "../api.ts";
import { alerts as copy } from "../content.ts";

export function AlertsRow() {
  const [loaded] = useLoad(api.alerts);
  const on = loaded.state === "loaded" ? Object.values(loaded.value.settings).filter(Boolean).length : null;
  return <ListRow title={copy.title} meta={on === null ? undefined : copy.on(on)} to="/alerts" />;
}
