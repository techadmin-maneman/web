// A local .dev.vars brought up to .dev.vars.example (scripts/dev/ensure-dev-vars.ts):
// the keys the example has gained are added, and a key left empty is given the
// example's value once it has one. A value already set is never overwritten.

export interface DevVarsUpdate {
  readonly text: string;
  /** Keys that were not there at all. */
  readonly added: readonly string[];
  /** Keys that were there but empty, and now have the example's value. */
  readonly filled: readonly string[];
}

const keyOf = (line: string): string | undefined => /^([A-Z0-9_]+)=/.exec(line)?.[1];
const valueOf = (line: string): string => line.slice(line.indexOf("=") + 1).trim();

export function updatedDevVars(local: string, example: string): DevVarsUpdate {
  const exampleLines = new Map(
    example.split(/\r?\n/).flatMap((line) => {
      const key = keyOf(line);
      return key === undefined ? [] : [[key, line] as const];
    }),
  );
  const filled: string[] = [];
  const lines = local.split(/\r?\n/).map((line) => {
    const key = keyOf(line);
    const offered = key === undefined ? undefined : exampleLines.get(key);
    if (key === undefined || offered === undefined || valueOf(line) !== "" || valueOf(offered) === "") return line;
    filled.push(key);
    return offered;
  });
  const have = new Set(lines.flatMap((line) => keyOf(line) ?? []));
  const added = [...exampleLines.keys()].filter((key) => !have.has(key));

  const body = lines.join("\n").replace(/\n*$/, "");
  const additions = added.map((key) => exampleLines.get(key) ?? `${key}=`);
  return { text: `${[body, ...additions].filter((part) => part !== "").join("\n")}\n`, added, filled };
}
