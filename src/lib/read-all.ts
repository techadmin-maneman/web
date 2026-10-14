// Several reads in one batch, each answered by its name in the row type its statement was read for. D1 types a batch
// by a single row type, so the reads of one were once cast by their place in it; here each read carries its type,
// and moving one cannot leave another's rows under its name.

/** A statement, read for rows of `Row`. */
export interface Read<Row> {
  readonly statement: D1PreparedStatement;
  /** Never set: it carries the row type. */
  readonly row?: Row;
}

export const read = <Row>(statement: D1PreparedStatement): Read<Row> => ({ statement });

type Answers<T> = { readonly [K in keyof T]: T[K] extends Read<infer Row> ? Row[] : never };

/** The reads in one round trip, each by its name. */
export async function readAll<T extends Readonly<Record<string, Read<unknown>>>>(
  db: D1Database,
  reads: T,
): Promise<Answers<T>> {
  const named = Object.entries(reads);
  const answers = await db.batch(named.map(([, each]) => each.statement));
  return Object.fromEntries(named.map(([name], index) => [name, answers[index]?.results ?? []])) as Answers<T>;
}
