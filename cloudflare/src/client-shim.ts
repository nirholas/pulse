// Worker replacement for src/db/client.ts so shared modules (the Solana
// stream, wallet code) keep their `db()` and `insertMany` imports. Queries
// written for the shim must already be sqlite-compatible: the only rewrite
// is Postgres `$1` placeholders to sqlite `?1`.
import { insertMany as d1InsertMany, query, run, type Param, type Row } from './db.ts';

export type { Row };

export interface Db {
  kind: 'd1';
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const numbered = (sql: string) => sql.replace(/\$(\d+)/g, '?$1').replace(/\bgreatest\(/g, 'max(').replace(/\bleast\(/g, 'min(');

const instance: Db = {
  kind: 'd1',
  query: (sql, params = []) => query(numbered(sql), params as Param[]) as Promise<any[]>,
  exec: (sql) => run(sql),
  close: async () => {},
};

export const db = async (): Promise<Db> => instance;
export const insertMany = d1InsertMany;
