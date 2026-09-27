// The apps' shared motion, as classes a screen adds to what it draws (DS-14):
//
//   <div className={classes(styles.page, ARRIVE)}>…</div>

import styles from "./motion.module.css";

/** Fades in as it arrives: a page, or an image replacing another. */
export const ARRIVE = styles.arrive;
