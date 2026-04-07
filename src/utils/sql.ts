import { type Database } from "sql.js";

let sqlJsPromise: Promise<Awaited<ReturnType<typeof import("sql.js")["default"]>>> | null = null;

export async function createDatabase(data?: Uint8Array): Promise<Database> {
  if (!sqlJsPromise) {
    const [initSqlJs, { default: wasm }] = await Promise.all([
      import("sql.js").then((m) => m.default),
      import("sql.js/dist/sql-wasm.wasm?url"),
    ]);
    sqlJsPromise = initSqlJs({ locateFile: () => wasm });
  }
  const SQL = await sqlJsPromise;
  return data ? new SQL.Database(data) : new SQL.Database();
}

export function executeQuery<T>(db: Database, query: string, params?: Record<string, string>): T {
  const stmt = db.prepare(query);
  stmt.step();
  const result = stmt.getAsObject(params) as T;
  stmt.free();
  return result;
}

export function executeQueryAll<T>(
  db: Database,
  query: string,
  params?: Record<string, string>,
): T[] {
  const stmt = db.prepare(query);
  const rows = Array.from(
    (function* () {
      while (stmt.step()) {
        yield stmt.getAsObject(params) as T;
      }
    })(),
  );
  stmt.free();
  return rows;
}
