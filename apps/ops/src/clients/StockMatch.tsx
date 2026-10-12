// The client's hair system matched to stock, beneath their hair profile (docs/decisions/0173-matching-a-client-to-
// stock.md): the stock code made exactly to their profile and where its pieces are, their city first; what the profile
// lacks; or that theirs is a custom order.

import { useLoad } from "@maneman/ui/useLoad";
import { useCallback } from "react";
import { client } from "../api.ts";
import type { paths } from "../api-schema.ts";
import form from "../components/forms.module.css";
import { stockMatch as copy } from "../content/stock-match.ts";
import { Loading, PanelFailed } from "../states/States.tsx";

type Match = paths["/api/clients/{id}/stock-match"]["get"]["responses"][200]["content"]["application/json"];

function Lines({ match }: { match: Match }) {
  if (match.kind === "no_profile") return <p className={form.note}>{copy.noProfile}</p>;
  if (match.kind === "incomplete") return <p className={form.note}>{copy.incomplete(match.missing)}</p>;
  if (match.kind === "custom") return <p className={form.note}>{copy.custom}</p>;
  return (
    <>
      <p className={form.note}>{copy.matched(match.name ?? match.code ?? "")}</p>
      {match.held.length === 0 && match.in_transit === 0 && <p className={form.note}>{copy.noneHeld}</p>}
      {match.held.map((place) => (
        <p className={form.note} key={place.place_id}>
          {copy.held(place.pieces, place.name, place.city)}
        </p>
      ))}
      {match.in_transit > 0 && <p className={form.note}>{copy.inTransit(match.in_transit)}</p>}
    </>
  );
}

export function StockMatch({ clientId }: { clientId: string }) {
  const load = useCallback(() => client.get("/api/clients/{id}/stock-match", { path: { id: clientId } }), [clientId]);
  const [loaded, retry] = useLoad(load);
  return (
    <section className={form.panel} aria-labelledby="stock-match">
      <div className={form.panelHead}>
        <h2 className={form.panelTitle} id="stock-match">
          {copy.title}
        </h2>
      </div>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && <PanelFailed onRetry={retry} requestId={loaded.requestId} />}
      {loaded.state === "loaded" && <Lines match={loaded.value} />}
    </section>
  );
}
