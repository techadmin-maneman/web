// What a request, a cron run or a queue batch costs D1: the rows its statements read and wrote, and how many
// statements it ran, summed from what D1 reports of each. Past 5 million rows read a day D1 refuses every query
// until midnight UTC, so the log line that closes each piece of work carries these figures.
//
// It also times how long the work waited on D1. Each statement is a round trip to the database's region and back,
// so statements sent together cost one wait, and statements awaited one after another cost one each.

export interface D1Usage {
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly queries: number;
}

/** How long the work waited on D1. */
export interface D1Waits {
  /**
   * The stretches with a statement on its way, each at least one round trip waited on in turn. Statements sent while
   * another is on its way share its stretch, so this never counts more trips than the work waited on.
   */
  readonly trips: number;
  /** How long those stretches took, in milliseconds. */
  readonly ms: number;
}

export interface MeteredDatabase {
  /** The database to hand the work, in place of the one metered. */
  readonly db: D1Database;
  /** What the work has cost so far. */
  usage(): D1Usage;
  /** How long the work has waited on D1 so far. */
  waits(): D1Waits;
}

export function meterDatabase(db: D1Database): MeteredDatabase {
  const tally = new Tally();
  return {
    db: new MeteredD1(db, tally),
    usage: () => ({ rowsRead: tally.rowsRead, rowsWritten: tally.rowsWritten, queries: tally.queries }),
    waits: () => ({ trips: tally.trips, ms: tally.waitedMs }),
  };
}

/** The waits as a Server-Timing entry, which a browser's network panel shows beside the request. */
export function serverTiming(waits: D1Waits): string {
  return `d1;dur=${String(waits.ms)};desc="${String(waits.trips)} round trips"`;
}

/** The usage as fields of a log line. */
export function usageFields(usage: D1Usage): { d1_rows_read: number; d1_rows_written: number; d1_queries: number } {
  return { d1_rows_read: usage.rowsRead, d1_rows_written: usage.rowsWritten, d1_queries: usage.queries };
}

/** What changed between two readings of the same meter. */
export function usageSince(before: D1Usage, after: D1Usage): D1Usage {
  return {
    rowsRead: after.rowsRead - before.rowsRead,
    rowsWritten: after.rowsWritten - before.rowsWritten,
    queries: after.queries - before.queries,
  };
}

/** What D1 says of one statement it ran. A stand-in database may say nothing, which counts as nothing read. */
interface Reported {
  readonly meta?: { readonly rows_read?: number; readonly rows_written?: number };
}

class Tally {
  rowsRead = 0;
  rowsWritten = 0;
  queries = 0;
  trips = 0;
  waitedMs = 0;
  private onTheirWay = 0;
  private waitingSince = 0;

  add(result: Reported): void {
    this.queries += 1;
    this.rowsRead += result.meta?.rows_read ?? 0;
    this.rowsWritten += result.meta?.rows_written ?? 0;
  }

  /** Sends a statement or a batch, timing the wait it starts or joins. */
  async timed<T>(send: () => Promise<T>): Promise<T> {
    if (this.onTheirWay === 0) {
      this.trips += 1;
      this.waitingSince = Date.now();
    }
    this.onTheirWay += 1;
    try {
      return await send();
    } finally {
      this.onTheirWay -= 1;
      if (this.onTheirWay === 0) this.waitedMs += Date.now() - this.waitingSince;
    }
  }
}

class MeteredStatement implements D1PreparedStatement {
  /** The statement D1 itself made, which a batch must be given. */
  readonly real: D1PreparedStatement;
  private readonly tally: Tally;

  constructor(real: D1PreparedStatement, tally: Tally) {
    this.real = real;
    this.tally = tally;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new MeteredStatement(this.real.bind(...values), this.tally);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.tally.timed(() => this.real.run<T>());
    this.tally.add(result);
    return result;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.tally.timed(() => this.real.all<T>());
    this.tally.add(result);
    return result;
  }

  // D1 reports nothing of what first() read, so it is answered from all(), which runs the same query.
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const [row] = (await this.all()).results;
    if (row === undefined) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return (row[column] ?? null) as T | null;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  // D1 reports nothing of what raw() read either, so it counts as a statement alone.
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<[string[], ...T[]] | T[]> {
    this.tally.queries += 1;
    if (options?.columnNames === true) return this.tally.timed(() => this.real.raw<T>({ columnNames: true }));
    return this.tally.timed(() => this.real.raw<T>());
  }
}

function unmetered(statement: D1PreparedStatement): D1PreparedStatement {
  return statement instanceof MeteredStatement ? statement.real : statement;
}

async function meteredBatch<T>(
  real: Pick<D1Database, "batch">,
  statements: D1PreparedStatement[],
  tally: Tally,
): Promise<D1Result<T>[]> {
  const results = await tally.timed(() => real.batch<T>(statements.map(unmetered)));
  for (const result of results) tally.add(result);
  return results;
}

class MeteredD1 implements D1Database {
  private readonly real: D1Database;
  private readonly tally: Tally;

  constructor(real: D1Database, tally: Tally) {
    this.real = real;
    this.tally = tally;
  }

  prepare(query: string): D1PreparedStatement {
    return new MeteredStatement(this.real.prepare(query), this.tally);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return meteredBatch(this.real, statements, this.tally);
  }

  async exec(query: string): Promise<D1ExecResult> {
    const result = await this.tally.timed(() => this.real.exec(query));
    this.tally.queries += result.count;
    return result;
  }

  withSession(constraintOrBookmark?: Parameters<D1Database["withSession"]>[0]): D1DatabaseSession {
    return new MeteredSession(this.real.withSession(constraintOrBookmark), this.tally);
  }

  /** Only D1's retired alpha databases had this. */
  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("dump() is not supported"));
  }
}

class MeteredSession implements D1DatabaseSession {
  private readonly real: D1DatabaseSession;
  private readonly tally: Tally;

  constructor(real: D1DatabaseSession, tally: Tally) {
    this.real = real;
    this.tally = tally;
  }

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
