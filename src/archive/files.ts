// Deterministic gzip JSONL. The gzip header carries no timestamp and rows are
// written in query order, so re-exporting an unchanged day yields identical
// bytes and git records no new commit for it.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export type Row = Record<string, unknown>;

export function toJsonl(rows: Row[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

export function fromJsonl(text: string): Row[] {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
}

export function gzipDeterministic(text: string): Buffer {
  const buf = gzipSync(text, { level: 9 });
  buf.writeUInt32LE(0, 4); // MTIME
  buf[9] = 3; // OS = Unix, so the bytes match across platforms
  return buf;
}

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** Write only when the content changed. Returns the bytes written and the digest. */
export function writeIfChanged(path: string, data: Buffer | string): { bytes: number; sha: string; changed: boolean } {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  const sha = sha256(buf);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && sha256(readFileSync(path)) === sha) return { bytes: buf.length, sha, changed: false };
  writeFileSync(path, buf);
  return { bytes: buf.length, sha, changed: true };
}

export function writeJsonlGz(path: string, rows: Row[]) {
  return writeIfChanged(path, gzipDeterministic(toJsonl(rows)));
}

export function readJsonlGz(path: string): Row[] {
  return fromJsonl(gunzipSync(readFileSync(path)).toString('utf8'));
}
