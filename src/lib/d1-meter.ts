// What a request, a cron run or a queue batch costs D1: the rows its statements read and wrote, and how many
// statements it ran, summed from what D1 reports of each. Past 5 million rows read a day D1 refuses every query
// until midnight UTC, so the log line that closes each piece of work carries these figures.

export interface D1Usage {
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly queries: number;
}

export interface MeteredDatabase {
  /** The database to hand the work, in place of the one metered. */
  readonly db: D1Database;
  /** What the work has cost so far. */
  usage(): D1Usage;
}

export function meterDatabase(db: D1Database): MeteredDatabase {
  const tally = new Tally();
  return {
    db: new MeteredD1(db, tally),
    usage: () => ({ rowsRead: tally.rowsRead, rowsWritten: tally.rowsWritten, queries: tally.queries }),
  };
}

/** The usage as fields of a log line. */
export function usageFields(usage: D1Usage): { d1_rows_read: number; d1_rows_written: number; d1_queries: number } {
  return { d1_rows_read: usage.rowsRead, d1_rows_written: usage.rowsWritten, d1_queries: usage.queries };
}

class Tally {
  rowsRead = 0;
  rowsWritten = 0;
  queries = 0;

  add(result: D1Result<unknown>): void {
    this.queries += 1;
    this.rowsRead += result.meta.rows_read;
    this.rowsWritten += result.meta.rows_written;
  }
}

class MeteredStatement implements D1PreparedStatement {
  constructor(
    readonly real: D1PreparedStatement,
    private readonly tally: Tally,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new MeteredStatement(this.real.bind(...values), this.tally);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.real.run<T>();
    this.tally.add(result);
    return result;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.real.all<T>();
    this.tally.add(result);
    return result;
  }

  first<T = unknown>(column: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  // D1 reports nothing of what first() read, so it is answered from all(), which runs the same query.
  async first<T>(column?: string): Promise<T | null> {
    const [row] = (await this.all()).results;
    if (row === undefined) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return (row[column] ?? null) as T | null;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  // D1 reports nothing of what raw() read either, so it counts as a query alone.
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    this.tally.queries += 1;
    if (options?.columnNames === true) return this.real.raw<T>({ columnNames: true });
    return this.real.raw<T>();
  }
}

/** The statement D1 itself made, which a batch must be given. */
function unmetered(statement: D1PreparedStatement): D1PreparedStatement {
  return statement instanceof MeteredStatement ? statement.real : statement;
}

async function meteredBatch<T>(
  real: Pick<D1Database, "batch">,
  statements: D1PreparedStatement[],
  tally: Tally,
): Promise<D1Result<T>[]> {
  const results = await real.batch<T>(statements.map(unmetered));
  for (const result of results) tally.add(result);
  return results;
}

class MeteredD1 implements D1Database {
  constructor(
    private readonly real: D1Database,
    private readonly tally: Tally,
  ) {}

  prepare(query: string): D1PreparedStatement {
    return new MeteredStatement(this.real.prepare(query), this.tally);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return meteredBatch(this.real, statements, this.tally);
  }

  async exec(query: string): Promise<D1ExecResult> {
    const result = await this.real.exec(query);
    this.tally.queries += result.count;
    return result;
  }

  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession {
    return new MeteredSession(this.real.withSession(constraintOrBookmark), this.tally);
  }

  /** Only for D1's retired alpha databases. */
  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("dump() is not supported"));
  }
}

class MeteredSession implements D1DatabaseSession {
  constructor(
    private readonly real: D1DatabaseSession,
    private readonly tally: Tally,
  ) {}

  prepare(query: string): D1PreparedStatement {
    return new MeteredStatement(this.real.prepare(query), this.tally);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return meteredBatch(this.real, statements, this.tally);
  }

  getBookmark(): D1SessionBookmark | null {
    return this.real.getBookmark();
  }
}
