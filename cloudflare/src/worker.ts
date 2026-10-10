// Pulse on Cloudflare. fetch serves the API and the built dashboard, the cron
// trigger keeps the Firehose Durable Object awake, and the Durable Object does
// the collecting.
import { createApi, type StreamPort } from './api.ts';
import { applyEnv, type Env } from './env.ts';
import { useDb } from './db.ts';
import type { Firehose } from './firehose.ts';

export { Firehose } from './firehose.ts';

type FirehoseStub = DurableObjectStub<Firehose>;
const firehose = (env: Env): FirehoseStub => env.FIREHOSE.get(env.FIREHOSE.idFromName('solana')) as FirehoseStub;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    applyEnv(env);
    useDb(env);
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      const port = (): StreamPort => firehose(env);
      const app = createApi(port);
      app.post('/api/admin/cycle', async (c) => {
        const token = env.ADMIN_TOKEN;
        if (typeof token !== 'string' || !token || c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthorized' }, 401);
        return c.json({ result: await firehose(env).cycle(c.req.query('force') === '1') });
      });
      ctx.waitUntil(firehose(env).wake().catch(() => undefined));
      return app.fetch(req, env, ctx);
    }
    const asset = await env.ASSETS.fetch(req);
    if (asset.status !== 404) return asset;
    return env.ASSETS.fetch(new Request(new URL('/index.html', req.url), req));
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    applyEnv(env);
    useDb(env);
    ctx.waitUntil(firehose(env).wake().then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
