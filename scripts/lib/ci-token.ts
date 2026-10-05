// What scripts/release/verify-ci-token.ts reports about the other environment's
// database. D1 Edit is account-wide (docs/decisions/0008, #3), so each
// environment's CI token can write the other's database; the report says so in
// as many words.

/** A write that matches no row: D1 accepts it only from a token that may write, and it changes nothing. */
export const NO_OP_WRITE = "UPDATE deployment_identity SET database_name = database_name WHERE 0";

export function otherDatabaseAccess(access: { read: boolean; write: boolean }, database: string): string {
  if (access.write) {
    return `can read and WRITE ${database}: D1 Edit is account-wide (accepted in docs/decisions/0008, #3)`;
  }
  if (access.read) return `can read ${database}, not write it`;
  return `cannot reach ${database} (tighter than required)`;
}
