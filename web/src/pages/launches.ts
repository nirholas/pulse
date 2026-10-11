import { api } from '../api.ts';
import { ago, empty, errorBox, html, mount, short, skeleton, statusPill, usd } from '../ui.ts';
import type { Page } from '../router.ts';
import { chart } from '../charts.ts';
import { donutOption, eventBuckets } from '../viz.ts';

export const launches: Page = async (el, _p, onCleanup) => {
  const state = { chain: '', kind: '' };
  mount(
    el,
    html`<h1>Launches</h1><p class="sub">Every launch and graduation the firehose and the Robinhood Chain walker have recorded.</p>
    <div class="toolbar"><select id="chain" aria-label="Chain"><option value="">All chains</option><option value="solana">Solana</option><option value="robinhood">Robinhood Chain</option></select>
    <select id="kind" aria-label="Event type"><option value="">Launches and graduations</option><option value="launch">Launches</option><option value="graduation">Graduations</option></select></div>
    <div class="cols launchviz" id="viz" hidden><section class="panel"><header><h3>Events per minute by launchpad</h3></header><div class="chartbox short" data-v="rate"></div></section><section class="panel"><header><h3>Launchpad share</h3></header><div class="chartbox short" data-v="mix"></div></section></div>
    <div id="results"></div>`,
  );
  const results = el.querySelector('#results')!;
  const viz = el.querySelector('#viz') as HTMLElement;
  let disposers: (() => void)[] = [];
  async function drawViz(rows: any[]) {
    disposers.forEach((d) => d());
    disposers = [];
    viz.hidden = rows.length < 5;
    if (viz.hidden) return;
    const at = (v: string) => viz.querySelector(`[data-v="${v}"]`) as HTMLElement;
    const named = rows.map((r) => ({ ts: r.ts, series: r.launchpad ?? 'unknown' }));
    const span = Math.max(...named.map((e) => +new Date(e.ts))) - Math.min(...named.map((e) => +new Date(e.ts)));
    const bucketMs = span > 3 * 3_600_000 ? 600_000 : span > 3_600_000 ? 300_000 : 60_000;
    const share = new Map<string, number>();
    named.forEach((e) => share.set(e.series, (share.get(e.series) ?? 0) + 1));
    disposers = await Promise.all([
      chart(at('rate'), (p) => eventBuckets(named, bucketMs, p).option),
      chart(at('mix'), (p) => donutOption([...share].map(([name, value]) => ({ name, value })), p, (v) => `${v} events`)),
    ]);
  }
  async function load() {
    mount(results, skeleton(8));
    try {
      const q = new URLSearchParams({ limit: '200' });
      if (state.chain) q.set('chain', state.chain);
      if (state.kind) q.set('kind', state.kind);
      const { rows } = await api(`/launches?${q}`);
      if (!rows.length) {
        mount(results, empty('No launch events recorded yet.', 'Run npm start so the Solana firehose and the Robinhood walker can record launches.'));
        return;
      }
      void drawViz(rows);
      mount(results, html`<div class="tablewrap"><table><thead><tr><th>When</th><th class="l">Event</th><th class="l">Token</th><th class="l">Launchpad</th><th>Mcap</th><th>24h volume</th><th class="l">Status</th></tr></thead><tbody>${rows.map((r: any) => html`<tr><td>${ago(r.ts)}</td><td class="l"><span class="pill ${r.kind === 'graduation' ? 'up' : ''}">${r.kind}</span></td><td class="l"><a href="#/token/${r.chain}/${r.token}">${r.symbol || short(r.token)}</a> <span class="mut">${r.name ?? ''}</span></td><td class="l">${r.launchpad ?? ''}</td><td>${r.last_mcap == null ? '' : usd(r.last_mcap)}</td><td>${r.last_volume_24h == null ? '' : usd(r.last_volume_24h)}</td><td class="l">${r.status ? statusPill(r.status) : ''}</td></tr>`)}</tbody></table></div>`);
    } catch (e) {
      mount(results, errorBox((e as Error).message));
      results.querySelector('[data-retry]')?.addEventListener('click', () => void load());
    }
  }
  el.querySelector('#chain')!.addEventListener('change', (e) => ((state.chain = (e.target as HTMLSelectElement).value), void load()));
  el.querySelector('#kind')!.addEventListener('change', (e) => ((state.kind = (e.target as HTMLSelectElement).value), void load()));
  const timer = setInterval(() => void load(), 60_000);
  onCleanup(() => {
    clearInterval(timer);
    disposers.forEach((d) => d());
  });
  await load();
};
