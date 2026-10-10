// Pure observation merging, shared by the Node and Cloudflare collectors.
import type { Observation, Snapshot, TokenMeta } from '../sources/types.ts';

/** Fold many observations of the same token into one, later sources filling gaps left by earlier ones. */
export function mergeObservations(list: Observation[]): Map<string, Observation> {
  const merged = new Map<string, Observation>();
  for (const o of list) {
    const key = `${o.meta.chain}:${o.meta.address}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...o, meta: { ...o.meta }, snap: o.snap ? { ...o.snap } : undefined, pairs: o.pairs ? [...o.pairs] : undefined, lists: o.list ? [o.list] : [] } as Observation & { lists: { name: string; rank: number }[] });
      continue;
    }
    const target = prev as Observation & { lists: { name: string; rank: number }[] };
    for (const [k, v] of Object.entries(o.meta) as [keyof TokenMeta, unknown][]) {
      if (v !== undefined && v !== null && target.meta[k] === undefined) (target.meta as Record<string, unknown>)[k] = v;
    }
    if (o.snap) {
      target.snap ??= {};
      for (const [k, v] of Object.entries(o.snap) as [keyof Snapshot, number | null | undefined][]) {
        if (v !== undefined && v !== null && (target.snap[k] === undefined || target.snap[k] === null)) target.snap[k] = v;
      }
    }
    if (o.pairs?.length) target.pairs = [...(target.pairs ?? []), ...o.pairs];
    if (o.list) target.lists.push(o.list);
    if (o.source && !target.source.includes(o.source)) target.source = `${target.source}+${o.source}`;
  }
  return merged;
}
