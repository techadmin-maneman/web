// The client's hair system matched to stock, beneath their hair profile (docs/decisions/0173-matching-a-client-to-
// stock.md): the stock code made exactly to their profile and where its pieces are, their city first; what the profile
// lacks; or that theirs is a custom order.

import type { Success } from "@maneman/web-kit/api";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import type { paths } from "../api-schema.ts";
import { stockMatch as copy } from "../content/stock-match.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { clientsApi } from "./clients-api.ts";

type Match = Success<paths["/api/clients/{id}/stock-match"]["get"]>;

function Lines({ match }: { match: Match }) {
  if (match.kind === "no_profile") return <Note>{copy.noProfile}</Note>;
  if (match.kind === "incomplete") return <Note>{copy.incomplete(match.missing)}</Note>;
  if (match.kind === "custom") return <Note>{copy.custom}</Note>;
  return (
    <>
      <Note>{copy.matched(match.name ?? match.code ?? "")}</Note>
      {match.held.length === 0 && match.in_transit === 0 && <Note>{copy.noneHeld}</Note>}
      {match.held.map((place) => (
        <Note key={place.place_id}>{copy.held(place.pieces, place.name, place.city)}</Note>
      ))}
      {match.in_transit > 0 && <Note>{copy.inTransit(match.in_transit)}</Note>}
    </>
  );
}

export function StockMatch({ clientId }: { clientId: string }) {
  const load = useCallback(() => clientsApi.stockMatch(clientId), [clientId]);
  const [loaded, retry] = useLoad(load);
  return (
    <Panel titleId="stock-match" title={copy.title}>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Lines match={loaded.value} />}
    </Panel>
  );
}
