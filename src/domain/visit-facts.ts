// What more than one reader asks of a visit, as SQL fragments over an expression for the visit's ID.

/**
 * A credit paid for the visit. The ledger is the record: booking on a credit writes its redeem row in the batch that
 * writes the visit, so a hold's own flag is never asked.
 */
export const creditSpentOn = (visit: string): string =>
  `EXISTS (SELECT 1 FROM credit_ledger spent WHERE spent.kind = 'redeem' AND spent.source_id = ${visit})`;
