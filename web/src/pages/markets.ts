import { api } from '../api.ts';
import { chart, lineOption } from '../charts.ts';
import { ago, empty, errorBox, html, int, mount, pct, raw, short, skeleton, usd } from '../ui.ts';
import type { Page } from '../router.ts';

type Section = { id: string; title: string; sub?: string; path: string; render: (data: any, el: HTMLElement, cleanup: (fn: () => void) => void) => void | Promise<void> };

const safeHref = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '#');
const apr = (v: number) => pct(v, Math.abs(v) < 100 ? 1 : 0);
const sentimentLabel = (s: any): string => (typeof s === 'string' ? s : s?.label ?? '');
const sentiment = (s: unknown) => { const l = sentimentLabel(s); return l === 'bullish' || l === 'positive' ? 'up' : l === 'bearish' || l === 'negative' ? 'down' : 'mut'; };
const fgColor = (v: number) => (v < 25 ? 'down' : v < 45 ? 'warn' : v < 55 ? 'mut' : 'up');

const spark = (pts: number[], chg: number | null) => {
  if (!pts || pts.length < 2) return raw('');
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 72).toFixed(1)} ${(18 - ((v - lo) / (hi - lo || 1)) * 16).toFixed(1)}`).join('');
  return raw(`<svg width="72" height="20" viewBox="0 0 72 20" role="img" aria-label="7 day price trend"><path d="${path}" fill="none" stroke="var(--${(chg ?? 0) >= 0 ? 'up' : 'down'})" stroke-width="1.5"/></svg>`);
};

const table = (head: string[], rows: unknown[][]) =>
  html`<div class="tablewrap"><table><thead><tr>${head.map((h, i) => raw(`<th${i === 0 ? ' class="l"' : ''}>${h}</th>`))}</tr></thead><tbody>${rows.map((r) => html`<tr>${r.map((c, i) => html`<td${raw(i === 0 ? ' class="l"' : '')}>${c}</td>`)}</tr>`)}</tbody></table></div>`;

const SECTIONS: Section[] = [
  {
    id: 'global',
    title: 'Crypto market',
    path: '/intel/global',
    async render(d, el, cleanup) {
      const kpi = (l: string, v: string, delta: unknown) => html`<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${delta}</div></div>`;
      mount(
        el,
        html`<div class="grid g4">
          ${kpi('Total market cap', usd(d.marketCapUsd), pct(d.marketCapChange24h))}
          ${kpi('24h volume', usd(d.volume24hUsd), `${int(d.activeCoins)} active coins`)}
          ${kpi('BTC dominance', d.btcDominance == null ? 'n/a' : `${d.btcDominance.toFixed(1)}%`, `ETH ${d.ethDominance == null ? 'n/a' : d.ethDominance.toFixed(1) + '%'}`)}
          ${kpi('Fear and greed', `${d.fearGreed.value}`, html`<span class="${fgColor(d.fearGreed.value)}">${d.fearGreed.label}</span>${d.fearGreed.previousWeek == null ? '' : ` (last week ${d.fearGreed.previousWeek})`}`)}
        </div>
        <section class="card" style="margin-top:14px"><h2>Fear and greed (30d)</h2><div class="chart" id="c-fg"></div></section>`,
      );
      const off = await chart(el.querySelector('#c-fg') as HTMLElement, (p) => ({
        ...lineOption(p, [{ name: 'Fear and greed', data: d.fearGreed.history.map((h: any) => [h.ts, h.value]), color: p.acc, area: true }], (v) => String(Math.round(v))),
      }));
      cleanup(off);
    },
  },
  {
    id: 'markets',
    title: 'Top 100 by market cap',
    path: '/intel/markets',
    render: (d, el) =>
      mount(
        el,
        table(['Coin', 'Price', '24h', '7d', '7d trend', 'Market cap', '24h volume'], d.slice(0, 50).map((r: any) => [
          html`<span class="mut">${r.rank}</span> ${r.name} <span class="mut">${String(r.symbol).toUpperCase()}</span>`,
          usd(r.price), pct(r.chg24h), pct(r.chg7d), spark(r.spark, r.chg7d), usd(r.mcap), usd(r.volume24h),
        ])),
      ),
  },
  {
    id: 'smart',
    title: 'Smart money on pump.fun',
    path: '/intel/smart-money',
    render: (d, el) =>
      d.length
        ? mount(
            el,
            table(['Token', 'Category', 'Score', 'Smart wallets', 'Smart SOL bought', 'First seen'], d.slice(0, 15).map((c: any) => [
              html`<a href="#/token/solana/${c.mint}">${c.symbol || short(c.mint)}</a> <span class="mut">${c.name ?? ''}</span>`,
              c.category ?? '', Number(c.smart_money_score ?? 0).toFixed(1), int(c.smart_wallet_count), `${Number(c.proven_buy_sol ?? 0).toFixed(2)} SOL`, ago(c.first_seen_at),
            ])),
          )
        : mount(el, empty('No smart-money activity right now.', 'Scores update as labelled wallets buy new launches.')),
  },
  {
    id: 'sectors',
    title: 'Sectors',
    path: '/intel/sectors',
    render: (d, el) =>
      mount(el, table(['Sector', 'Market cap', '24h', '24h volume'], d.map((c: any) => [c.name, usd(c.mcap), pct(c.chg24h), usd(c.volume24h)]))),
  },
  {
    id: 'liqs',
    title: 'Liquidations',
    path: '/intel/liquidations',
    render(d, el) {
      if (!d.count) return mount(el, empty('No liquidations in the latest window.'));
      mount(
        el,
        html`<div class="grid g4"><div class="card kpi"><div class="l">Longs liquidated</div><div class="v down">${usd(d.longs)}</div><div class="d">&nbsp;</div></div><div class="card kpi"><div class="l">Shorts liquidated</div><div class="v up">${usd(d.shorts)}</div><div class="d">&nbsp;</div></div></div>
        <div class="grid g2" style="margin-top:14px"><section class="card"><h3>By symbol</h3>${table(['Symbol', 'Longs', 'Shorts', 'Events'], d.bySymbol.map((r: any) => [r.symbol, usd(r.longs), usd(r.shorts), int(r.count)]))}</section>
        <section class="card"><h3>Largest</h3>${table(['Symbol', 'Side', 'Size', 'Venue', 'When'], d.largest.map((l: any) => [l.symbol, l.side, usd(l.value), l.exchange, ago(l.time)]))}</section></div>`,
      );
    },
  },
  {
    id: 'derivs',
    title: 'Derivatives (Hyperliquid)',
    path: '/intel/derivatives',
    render(d, el) {
      const cols = ['Market', 'Mark', '24h', 'Funding APR', 'Open interest', '24h volume'];
      const row = (r: any) => [r.symbol, usd(r.mark), pct(r.change24h), apr(r.fundingApr), usd(r.openInterestUsd), usd(r.volume24h)];
      mount(
        el,
        html`<div class="grid g4"><div class="card kpi"><div class="l">Open interest</div><div class="v">${usd(d.totalOpenInterestUsd)}</div><div class="d">&nbsp;</div></div><div class="card kpi"><div class="l">24h volume</div><div class="v">${usd(d.totalVolume24h)}</div><div class="d">&nbsp;</div></div></div>
        <div class="grid g2" style="margin-top:14px">
          <section class="card"><h3>Largest by open interest</h3>${table(cols, d.byOpenInterest.slice(0, 12).map(row))}</section>
          <section class="card"><h3>Most crowded long (highest funding)</h3>${table(cols, d.mostLongCrowded.map(row))}<h3 style="margin-top:14px">Most crowded short (lowest funding)</h3>${table(cols, d.mostShortCrowded.map(row))}</section>
        </div>`,
      );
    },
  },
  {
    id: 'defi',
    title: 'DeFi',
    path: '/intel/defi',
    render(d, el) {
      mount(
        el,
        html`<div class="grid g4"><div class="card kpi"><div class="l">DEX volume 24h</div><div class="v">${usd(d.dexVolume24h)}</div><div class="d">&nbsp;</div></div><div class="card kpi"><div class="l">Protocol fees 24h</div><div class="v">${usd(d.fees24h)}</div><div class="d">&nbsp;</div></div></div>
        <div class="grid g2" style="margin-top:14px">
          <section class="card"><h3>TVL by chain</h3>${table(['Chain', 'TVL'], d.chains.slice(0, 12).map((c: any) => [c.name, usd(c.tvl)]))}</section>
          <section class="card"><h3>Stablecoin supply</h3>${table(['Stablecoin', 'Supply', '7d change'], d.stablecoins.map((s: any) => [`${s.name} (${s.symbol})`, usd(s.supply), usd(s.change7d)]))}</section>
          <section class="card"><h3>Solana yields by TVL</h3>${table(['Pool', 'Protocol', 'TVL', 'APY'], d.solanaYields.slice(0, 12).map((p: any) => [p.symbol, p.project, usd(p.tvl), `${p.apy.toFixed(1)}%`]))}</section>
          <section class="card"><h3>Highest yields (TVL above $5M)</h3>${table(['Pool', 'Chain', 'TVL', 'APY'], d.yields.slice(0, 12).map((p: any) => [`${p.symbol} · ${p.project}`, p.chain, usd(p.tvl), `${p.apy.toFixed(1)}%`]))}</section>
          <section class="card"><h3>Top DEXs by 24h volume</h3>${table(['DEX', '24h volume', '1d'], d.topDexs.map((p: any) => [p.name, usd(p.volume24h), pct(p.change1d)]))}</section>
          <section class="card"><h3>Top protocols by 24h fees</h3>${table(['Protocol', '24h fees', '1d'], d.topFees.map((p: any) => [p.name, usd(p.fees24h), pct(p.change1d)]))}</section>
        </div>`,
      );
    },
  },
  {
    id: 'predictions',
    title: 'Prediction markets',
    path: '/intel/predictions',
    render: (d, el) =>
      d.length
        ? mount(
            el,
            table(['Market', 'Odds', '24h volume', 'Liquidity', 'Ends'], d.slice(0, 15).map((m: any) => [
              html`<a href="https://polymarket.com/market/${m.slug}" target="_blank" rel="noopener noreferrer">${m.question}</a>`,
              m.outcomes.slice(0, 3).map((o: any) => `${o.name} ${(o.price * 100).toFixed(0)}%`).join(' · '),
              usd(m.volume24h), usd(m.liquidity), m.endDate ? new Date(m.endDate).toLocaleDateString() : 'n/a',
            ])),
          )
        : mount(el, empty('No active prediction markets returned.')),
  },
  {
    id: 'news',
    title: 'News',
    path: '/intel/news',
    render: (d, el) =>
      d.length
        ? mount(
            el,
            html`<ul class="news">${d.slice(0, 20).map((a: any) => html`<li><a href="${safeHref(a.link)}" target="_blank" rel="noopener noreferrer">${a.title}</a><div class="mut">${a.source ?? ''}${a.publishedAt ? html` · ${ago(a.publishedAt)}` : raw('')}${sentimentLabel(a.sentiment) ? html` · <span class="${sentiment(a.sentiment)}">${sentimentLabel(a.sentiment)}</span>` : raw('')}${a.tickers?.length ? html` · ${a.tickers.join(', ')}` : raw('')}</div></li>`)}</ul>`,
          )
        : mount(el, empty('No headlines right now.')),
  },
];

export const markets: Page = async (el, _p, onCleanup) => {
  mount(
    el,
    html`<h1>Markets</h1><p class="sub">The whole crypto market in one place: prices, sentiment, derivatives, DeFi, prediction markets and news. Live from the three.ws intelligence API, DefiLlama, Hyperliquid and Polymarket.</p>
    ${SECTIONS.map((s) => html`<section class="intel" style="margin-top:18px"><h2>${s.title}</h2><div id="sec-${s.id}">${skeleton(4)}</div></section>`)}`,
  );
  const disposers: (() => void)[] = [];
  onCleanup(() => disposers.forEach((fn) => fn()));
  const load = async (s: Section) => {
    const box = el.querySelector(`#sec-${s.id}`) as HTMLElement | null;
    if (!box) return;
    try {
      const { data } = await api(s.path);
      await s.render(data, box, (fn) => disposers.push(fn));
    } catch (e) {
      mount(box, errorBox((e as Error).message));
      box.querySelector('[data-retry]')?.addEventListener('click', () => {
        mount(box, skeleton(4));
        void load(s);
      });
    }
  };
  await Promise.all(SECTIONS.map(load));
};
