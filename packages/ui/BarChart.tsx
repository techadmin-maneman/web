// Figures to compare at a glance: a line each, its name, a bar as long as its share of the largest, and the figure
// itself beside it, so the chart is read as well as seen. The bars are drawn, not styled, so no figure is a style.

import styles from "./bar-chart.module.css";

export interface Bar {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** The figure as the page writes it: "12", "34%", "Rs. 2,360". */
  readonly shown: string;
}

export function BarChart({ label, bars }: { readonly label: string; readonly bars: readonly Bar[] }) {
  const most = Math.max(...bars.map((bar) => bar.value), 0);
  return (
    <figure className={styles.chart} aria-label={label}>
      <ul className={styles.bars}>
        {bars.map((bar) => (
          <li key={bar.key} className={styles.row}>
            <span className={styles.label}>{bar.label}</span>
            <svg className={styles.bar} viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">
              <rect width={most <= 0 ? 0 : (Math.max(bar.value, 0) / most) * 100} height="1" />
            </svg>
            <span className={styles.value}>{bar.shown}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
