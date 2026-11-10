// What a client's record keeps for the technicians who visit them (docs/decisions/0242-client-record.md): the alerts
// every technician sees before they start, and the note one leaves at a visit's close for whoever comes next.

/** The most an alert holds: a line a technician reads at a glance ("Allergic to latex. Use the cotton gloves."). */
export const ALERT_MAX_CHARS = 200;

/** The most a note for the next technician holds. */
export const HANDOFF_MAX_CHARS = 500;
