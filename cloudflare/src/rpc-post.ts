// Worker replacement for src/lib/rpc-post.ts. Workers' fetch is not subject to
// the fingerprint challenge that forces the Node build onto node:https.
export async function postJson<R>(url: string, payload: unknown): Promise<R> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  try {
    return (await res.json()) as R;
  } catch {
    throw new Error(`invalid JSON from ${new URL(url).host}`);
  }
}
