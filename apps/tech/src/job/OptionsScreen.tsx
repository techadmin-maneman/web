// A consultation's Options (src/routes/tech/options.ts), shown to the client as the checklist's "Options and prices
// shown" asks: each package on sale with what it costs them, from the price book, and the looks they made with the
// try-on. A look is never kept on the phone.

import { ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { useLoad } from "@maneman/ui/useLoad";
import { dayMonth } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback } from "react";
import { api, type Options } from "../api.ts";
import { options as copy } from "../content.ts";
import { useScreen } from "../lib/useScreen.ts";
import { go } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import frame from "../components/frame.module.css";
import styles from "./options.module.css";

type Price = Options["packages"][number]["first_fit"];

const priceOf = (price: Price | null) => (price === null ? copy.noPrice : rupees(price.amount));

function Package({ option }: { option: Options["packages"][number] }) {
  return (
    <section className={styles.section} aria-labelledby={`package-${option.code}`}>
      <h2 className={styles.name} id={`package-${option.code}`}>
        {option.name}
      </h2>
      {option.description !== null && <p className={styles.quiet}>{option.description}</p>}
      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt>{copy.firstFit}</dt>
          <dd>{priceOf(option.first_fit)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>{copy.service(option.service_every_days)}</dt>
          <dd>{priceOf(option.service)}</dd>
        </div>
        <div className={styles.figure}>
          <dt>{copy.replacement(option.replace_after_months)}</dt>
          <dd>{priceOf(option.replacement)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function OptionsScreen({ id }: { id: string }) {
  const heading = useScreen(copy.title);
  const read = useCallback(() => api.options(id), [id]);
  const [loaded, retry] = useLoad(read);
  return (
    <main className={styles.screen}>
      <header className={frame.head}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size="lg"
          weight="heavy"
          label={copy.back}
          onClick={() => {
            go(`/jobs/${id}`);
          }}
        />
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      )}
      {loaded.state === "loaded" && (
        <>
          {loaded.value.packages.length === 0 ? (
            <section className={styles.section}>
              <p className={styles.quiet}>{copy.none}</p>
            </section>
          ) : (
            loaded.value.packages.map((option) => <Package key={option.code} option={option} />)
          )}
          {loaded.value.looks.length > 0 && (
            <section className={styles.section} aria-labelledby="looks-title">
              <h2 className={styles.sectionTitle} id="looks-title">
                {copy.looksTitle}
              </h2>
              <div className={styles.looks}>
                {loaded.value.looks.map((look) => (
                  <img key={look.id} className={styles.look} src={look.url} alt={copy.look(dayMonth(look.made_on))} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
