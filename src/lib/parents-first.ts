// Tables in the order their foreign keys allow: each after every table it points at. D1 checks foreign keys as a long
// file loads, not once at its end, so a backup and a restore write rows in this order (src/domain/platform/backups.ts,
// scripts/lib/backup-restore.ts, scripts/lib/restore-carry.ts).

/** Table names, each after every table it points at; a cycle, which the schema has none of, keeps name order. */
export function parentsFirst(
  tables: readonly { readonly name: string; readonly parents: readonly string[] }[],
): string[] {
  const parentsOf = new Map(tables.map((table) => [table.name, table.parents.filter((name) => name !== table.name)]));
  const order: string[] = [];
  const place = (name: string, path: ReadonlySet<string>): void => {
    if (order.includes(name) || path.has(name) || !parentsOf.has(name)) return;
    for (const parent of parentsOf.get(name) ?? []) place(parent, new Set([...path, name]));
    order.push(name);
  };
  for (const name of [...parentsOf.keys()].sort()) place(name, new Set());
  return order;
}
