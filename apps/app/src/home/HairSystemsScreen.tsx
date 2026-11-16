// The four hair systems compared (design/client-redesign, the compare screen; GET /api/packages): each on sale, in
// ops' order, with what it costs for this client, a first fit before they are fitted and a replacement after, how
// long it lasts, and its service and how often, the one worn now marked.

import { Badge } from "@maneman/ui/Badge";
import { DescriptionList } from "@maneman/ui/DescriptionList";
import { Loading } from "@maneman/ui/States";
import { useLoad, whenLoaded } from "@maneman/ui/useLoad";
import { rupees } from "@maneman/web-kit/money";
import { api, type Me } from "../api.ts";
import { hairSystems, profile, titles } from "../content.ts";
import { PageFailed } from "../frame/PageFailed.tsx";
import { Shell } from "../frame/Shell.tsx";
import { useSession } from "../session.ts";
import styles from "./hair-systems.module.css";

type Offered =
  Awaited<ReturnType<typeof api.packages>> extends infer Answer
    ? Answer extends { ok: true; body: { packages: (infer Each)[] } }
      ? Each
      : never
    : never;

function Package({ offered, me }: { offered: Offered; me: Me }) {
  const copy = hairSystems;
  const fitted = me.state === "fitted";
  const price = fitted ? offered.replacement : offered.first_fit;
  const wearing = me.hair_system?.package === offered.code;
  return (
    <article className={styles.package} aria-labelledby={`package-${offered.code}`}>
      <div className={styles.head}>
        <h2 className={styles.name} id={`package-${offered.code}`}>
          {offered.name}
        </h2>
        {wearing && <Badge>{copy.wearing}</Badge>}
      </div>
      {offered.description !== null && <p className={styles.description}>{offered.description}</p>}
      <DescriptionList
        layout="row"
        className={styles.facts}
        items={[
          ...(price === null
            ? []
            : [{ term: fitted ? copy.replacementPrice : copy.firstFit, details: rupees(price.amount) }]),
          { term: copy.lasts, details: copy.months(offered.replace_after_months) },
          ...(offered.service === null
            ? []
            : [
                {
                  term: copy.service,
                  details: `${rupees(offered.service.amount)} ${copy.every(offered.service_every_days)}`,
                },
              ]),
        ]}
      />
    </article>
  );
}

export function HairSystemsScreen() {
  const { me } = useSession();
  const [loaded, retry] = useLoad(api.packages);
  const copy = hairSystems;
  return (
    <Shell header={{ kind: "back", title: titles.hairSystems, to: "/hair-system", label: profile.back }} tab={null}>
      <div className={styles.page}>
        <p className={styles.lede}>{`${copy.lede} ${me.state === "fitted" ? copy.ledeFitted : copy.ledeLead}`}</p>
        {whenLoaded(loaded, {
          loading: <Loading />,
          failed: <PageFailed onRetry={retry} />,
          loaded: ({ packages }) => (
            <>
              {packages.map((offered) => (
                <Package key={offered.code} offered={offered} me={me} />
              ))}
              <p className={styles.gst}>{copy.gst}</p>
            </>
          ),
        })}
      </div>
    </Shell>
  );
}
