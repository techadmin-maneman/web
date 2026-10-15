// Where a page sits: each page above it a link, the page itself last and not a link (WAI-ARIA's breadcrumb pattern).
//
//   <Breadcrumbs label={copy.where} crumbs={[{ label: "Clients", to: "/clients" }, { label: name }]} />

import { Link } from "./router.tsx";
import styles from "./breadcrumbs.module.css";

export interface Crumb {
  readonly label: string;
  /** Where it goes; none for the page itself. */
  readonly to?: string;
}

export function Breadcrumbs({ label, crumbs }: { readonly label: string; readonly crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label={label}>
      <ol className={styles.crumbs}>
        {crumbs.map((crumb, at) => (
          <li key={`${String(at)} ${crumb.label}`} className={styles.crumb}>
            {crumb.to === undefined ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <Link className={styles.link} to={crumb.to}>
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
