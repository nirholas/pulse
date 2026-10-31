// The board: every leaderboard on one screen. Highest volume, runners, what
// is being bought right now, newest launches and staking/yield pools, each
// loading and failing on its own so one dead source never blanks the page.
import { api } from '../api.ts';
import { ago, errorBox, empty, html, int, mount, pct, raw, short, skeleton, tokenCell, usd } from '../ui.ts';
import type { Page } from '../router.ts';

type Panel = { id: string; title: string; note: string; more?: string; load: () => Promise<{ head: string[]; rows: unknown[][] } | null> };

const tokenRows = (rows: any[], extra: (t: any) => unknown[]) => rows.map((t) => [tokenCell(t), ...extra(t)]);
const TOK = (q: string) => async () => (await api(`/tokens?${q}`)).rows as any[];

const PANELS: Panel[] = [
  {
    id: 'volume', title: 'Highest volume', note: 'Tokens by 24h volume, both chains', more: '#/tokens?preset=volume',
    async load() {
      const r = await TOK('sort=volume&limit=15&minMcap=10000')();
      return { head: ['Token', 'Volume 24h', 'Mcap', '24h'], rows: tokenRows(r, (t) => [usd(t.last_volume_24h), usd(t.last_mcap), pct(t.last_change_24h)]) };
    },
  },
  {
    id: 'runners', title: 'Runners', note: 'Still running, biggest 24h move', more: '#/tokens?preset=runners',
    async load() {
      const r = await TOK('status=running&sort=change&limit=15&minMcap=50000&minVolume=10000')();
      return { head: ['Token', '24h', 'Mcap', 'Volume 24h'], rows: tokenRows(r, (t) => [pct(t.last_change_24h, 0), usd(t.last_mcap), usd(t.last_volume_24h)]) };
    },
  },
  {
    id: 'buying', title: 'Being bought right now', note: 'Live Solana trade flow, last hour, by volume', more: '#/solana',
    async load() {
      const hot = ((await api('/overview')).hot as any[]).slice(0, 15);
      return {
        head: ['Token', 'Buys', 'Sells', 'Buy share', 'Traders', 'Vol SOL'],
        rows: hot.map((h) => {
          const n = h.buys + h.sells || 1;
          const share = (h.buys / n) * 100;
          return [html`<a class="tok" href="#/token/solana/${h.mint}"><span class="ph" aria-hidden="true">${(h.symbol || '?').slice(0, 1).toUpperCase()}</span><span><b>${h.symbol || short(h.mint)}</b><small>${usd(h.lastMcapUsd)}</small></span></a>`, int(h.buys), int(h.sells), html`<span class="${share >= 55 ? 'up' : share <= 45 ? 'down' : 'mut'}">${share.toFixed(0)}%</span>`, int(h.traders), Number(h.vol).toFixed(1)];
        }),
      };
    },
  },
  {
    id: 'new', title: 'Newest with traction', note: 'Just discovered, already trading', more: '#/launches',
    async load() {
      const r = await TOK('sort=new&limit=15&minVolume=2000')();
      return { head: ['Token', 'Age', 'Mcap', 'Volume 24h', 'Holders'], rows: tokenRows(r, (t) => [ago(t.first_seen), usd(t.last_mcap), usd(t.last_volume_24h), int(t.last_holders)]) };
    },
  },
  {
    id: 'staking', title: 'Staking protocols', note: 'Liquid staking, staking pools and restaking by TVL', more: '#/markets',
    async load() {
      const d = (await api('/intel/staking')).data;
      return {
        head: ['Protocol', 'Type', 'TVL', '24h', '7d', 'Chains'],
        rows: d.protocols.slice(0, 15).map((p: any) => [html`<b>${p.name}</b> ${p.solana ? html`<small class="up">SOL</small>` : raw('')}`, p.category, usd(p.tvl), pct(p.chg1d), pct(p.chg7d), p.chains.join(', ')]),
      };
    },
  },
  {
    id: 'yield', title: 'Yield pools', note: 'Solana pools by TVL, plus the highest APY anywhere (TVL above $5M)', more: '#/markets',
    async load() {
      const d = (await api('/intel/defi')).data;
      const row = (y: any, chain: string) => [html`<b>${y.symbol}</b> <small class="mut">${y.project}</small>`, chain, usd(y.tvl), html`<span class="up">${y.apy.toFixed(2)}%</span>`];
      return { head: ['Pool', 'Chain', 'TVL', 'APY'], rows: [...d.solanaYields.slice(0, 8).map((y: any) => row(y, 'Solana')), ...d.yields.slice(0, 7).map((y: any) => row(y, y.chain))] };
    },
  },
];

export const board: Page = (el, _p, onCleanup) => {
  mount(
    el,
    html`<h1>Board</h1><p class="sub">The whole market on one screen. Refreshes every 30 seconds.</p>
    <div class="board">${PANELS.map((p) => html`<section class="card bpanel" id="b-${p.id}"><header><h2>${p.title}</h2>${p.more ? html`<a href="${p.more}">all</a>` : raw('')}</header><p class="mut bnote">${p.note}</p><div class="bbody">${skeleton(6)}</div></section>`)}</div>`,
  );
  const ctl = new AbortController();
  async function refresh(p: Panel, first: boolean) {
    const body = el.querySelector(`#b-${p.id} .bbody`) as HTMLElement | null;
    if (!body || ctl.signal.aborted) return;
    try {
      const d = await p.load();
      if (ctl.signal.aborted) return;
      if (!d || !d.rows.length) return mount(body, empty('Nothing here yet.'));
      mount(body, html`<div class="tablewrap"><table><thead><tr>${d.head.map((h, i) => raw(`<th${i === 0 ? ' class="l"' : ''}>${h}</th>`))}</tr></thead><tbody>${d.rows.map((r) => html`<tr>${r.map((c, i) => html`<td${raw(i === 0 ? ' class="l"' : '')}>${c}</td>`)}</tr>`)}</tbody></table></div>`);
    } catch (e) {
      if (!first) return;
      mount(body, errorBox((e as Error).message));
      body.querySelector('[data-retry]')?.addEventListener('click', () => void refresh(p, true));
    }
  }
  for (const p of PANELS) void refresh(p, true);
  const t = setInterval(() => PANELS.forEach((p) => void refresh(p, false)), 30_000);
  onCleanup(() => {
    ctl.abort();
    clearInterval(t);
  });
};
