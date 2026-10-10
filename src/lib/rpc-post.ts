import { request as httpsRequest } from 'node:https';

/**
 * The public RPC sits behind Cloudflare, which challenges undici's fetch
 * fingerprint but lets Node's https client through, so RPC calls use https.
 */
export function postJson<R>(url: string, payload: unknown): Promise<R> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 20_000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) return reject(new Error(`HTTP ${res.statusCode} from ${new URL(url).host}`));
        try {
          resolve(JSON.parse(data) as R);
        } catch {
          reject(new Error(`invalid JSON from ${new URL(url).host}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout calling ${new URL(url).host}`)));
    req.on('error', reject);
    req.end(body);
  });
}
