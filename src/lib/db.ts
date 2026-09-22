import Database from "@tauri-apps/plugin-sql";

/**
 * Thin wrapper over `@tauri-apps/plugin-sql`, pointed at the same SQLite
 * file the Rust side manages via sqlx (src-tauri/src/db.rs). Rust runs the
 * migrations before this ever connects, so the frontend only ever reads
 * a schema that already exists.
 */
let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:leadscout.db");
  }
  return dbPromise;
}

export async function dbSelect<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(query, params);
}

export async function dbExecute(
  query: string,
  params: unknown[] = [],
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const db = await getDb();
  return db.execute(query, params);
}
