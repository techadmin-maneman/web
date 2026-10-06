# A personal data breach

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

A breach is any unauthorised access to, or loss or disclosure of, personal data we hold. For example:

- a leaked secret or token;
- a bucket or database opened to someone who should not have it;
- a client's photographs or details sent to the wrong person;
- a lost phone signed in to ops.

The DPDP Act and its Rules require us to tell the Data Protection Board and each person affected, without delay, and the Board in detail within 72 hours. **Start the clock when anyone at Mane Man first learns of it.**

1. **Contain, within the hour.**
   - Revoke what leaked:
     - rotate the secret (`W secret put … --env <env>`);
     - revoke the Zoho, Razorpay or Evolution key in its console;
     - sign out the ops user in Cloudflare Access;
     - revoke a technician's phone in the console ([A technician's lost phone](technician-app.md#a-technicians-lost-phone));
     - revoke client sessions with `UPDATE sessions SET revoked_at = '<now>' WHERE …`.
   - Close the opening. To shut a host at once, put it behind an Access application that lets in only the founders (provisioning, step 3): every request to it, `/api/*` included, then needs their login, with no release. Roll back a Worker version if a release caused it (below). Switching a surface off for good is provisioning's step 11 in reverse, in a release: `ENABLED_SURFACES` in `src/config/environments.ts` and its route in `wrangler.jsonc`.
2. **Keep the evidence.** Save `wrangler tail` output, the audit log rows (`SELECT * FROM audit_log WHERE created_at > …`), and the provider's own logs, to a private folder (`private/`, git-ignored). Never paste personal data into chat or email.
3. **Assess.**
   - What data, whose, how many people, since when.
   - Whether photographs were involved: they are the most sensitive thing we hold.
   - Write down what you know and what you do not.
4. **Notify.**
   - **The Board,** at once in brief, and in full within 72 hours: what happened, when, the data and people affected, the harm likely, what we have done, and who to contact.
   - **Each person affected,** in plain words on WhatsApp or by phone: what happened to their data, what it may mean for them, what we have done, what they can do, and who to contact.
   - **The Grievance Officer** leads both (`docs/open-points.md`, item 51).
5. **Record.** Keep a note of the breach, the timeline, the decisions and the notices, for the Board and for us. Review it within two weeks, and fix what let it happen.

---
