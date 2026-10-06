# The service area and the referral log

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

**The pincodes we serve** are loaded from `data/pincodes/ncr-pincodes.csv` (docs/decisions/0048-referrals.md). Fill in its `served` and `launch_on` columns, then:

```sh
node scripts/ops/import-pincodes.ts staging --all-served-from 2026-09-22   # staging's placeholder (open point 48)
node scripts/ops/import-pincodes.ts production                             # the file's own columns
```

Run it again whenever the file changes: each pincode's row is replaced, except an area name ops gave it in the console. **The import tells nobody on a waitlist, so it refuses to serve a pincode people are waiting for.** It names each such pincode with how many wait, and writes nothing. Serve those from the console — Growth · Service area, or the waitlist's Mark live — which tells those who asked (ADR 0071), then run the import again: a pincode already served is no launch.

**Launching a pincode** is ops' own, in the console: it says how many are waiting and how many will be told, then marks the pincode served and sends the alerts, ten a minute. Nobody is told twice. Serving a pincode in Growth · Service area is a launch too, and says who it will message before it saves; a pincode already live whose waitlist was never told is told from its row on the waitlist.

**Ops' log of referrals before January** is imported once, from a CSV in git-ignored `private/`:

```sh
node scripts/ops/import-referrals.ts production --file private/referrals-before-january.csv
```

It writes people, codes, attributions and the credits, and can be run again safely. Staging uses the synthetic sample in `data/referrals/`.

---
