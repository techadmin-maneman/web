// A database whose audit writes for one action fail, to prove nothing audited happens unaudited
// (docs/decisions/0031-access-and-audit.md): a photograph is served only once its viewing is written.

export function auditFailsFor(db: D1Database, action: string): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver) as unknown;
      return (sql: string): D1PreparedStatement => {
        const statement = target.prepare(sql);
        if (!/INSERT INTO audit_log/i.test(sql)) return statement;
        return new Proxy(statement, {
          get(inner, key, self) {
            if (key !== "bind") return Reflect.get(inner, key, self) as unknown;
            return (...values: unknown[]): D1PreparedStatement =>
              values.includes(action)
                ? ({ run: () => Promise.reject(new Error("D1_ERROR: simulated write failure")) } as D1PreparedStatement)
                : inner.bind(...values);
          },
        });
      };
    },
  });
}
