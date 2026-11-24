import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url =
  process.env.DATABASE_URL ?? "postgres://petcom:petcom@localhost:5433/petcom";

/**
 * One pool per process. In dev, Next reloads modules on every edit, so the
 * client is cached on globalThis to avoid leaking connections.
 */
const globalForDb = globalThis as unknown as {
  __petcomSql?: ReturnType<typeof postgres>;
};

const sqlClient =
  globalForDb.__petcomSql ??
  postgres(url, {
    max: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });

if (!globalForDb.__petcomSql) globalForDb.__petcomSql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export { sqlClient };
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
