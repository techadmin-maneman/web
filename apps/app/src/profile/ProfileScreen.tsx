// The profile, reached from Home's button. Boards G1 and G2 follow in the next
// step; for now it names the client and logs out.

import { profile } from "../content.ts";
import styles from "../home/tabs.module.css";
import own from "./profile.module.css";

export function ProfileScreen({ firstName, onLogout }: { firstName: string; onLogout: () => void }) {
  return (
    <section aria-labelledby="profile">
      <h1 className={styles.title} id="profile">
        {profile.title}
      </h1>
      <p className={own.name}>{firstName}</p>
      <button className={own.logout} type="button" onClick={onLogout}>
        {profile.logout}
      </button>
    </section>
  );
}
