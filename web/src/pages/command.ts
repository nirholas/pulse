// The command center: the whole crypto market on one screen, Solana first.
// Every panel is an independent live data source with its own loading,
// error and refresh behaviour (see panels.ts).
import { chart } from '../charts.ts';
import { mountPanels, type Entry, type Track } from '../panels.ts';
import { bubbleTokens, divergingBars, donutOption, gaugeOption, hbars, heat, histogram, marketMap, sign, sparkPath, stackedBars, treemapOption } from '../viz.ts';
import { api } from '../api.ts';
import { ago, empty, escape, html, int, mount, pct, raw, short, usd } from '../ui.ts';
import type { Page } from '../router.ts';

const safeHref = (u: unknown) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '#');
const chartTo = async (body: HTMLElement, track: Track, opt: Parameters<typeof chart>[1]) => {
  body.innerHTML = '';
  track(await chart(body, opt));
};
const kpi = (l: string, v: unknown, d: unknown, cls = '') => html`<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;

// Channel ids (verified against each channel page). The live_stream embed
// always resolves to the broadcast that is on air now, so no video id is pinned.
const CHANNELS = [
  { name: 'Bloomberg', id: 'UCIALMKvObZNtJ6AmdCLP7Lg', url: 'https://www.youtube.com/@Bloomberg/live' },
  { name: 'CNBC', id: 'UCvJJ_dzjViJCoLf5uKUTwoA', url: 'https://www.youtube.com/@CNBC/live' },
  { name: 'Yahoo Finance', id: 'UCEAZeUIeJs0IjQiqTCdVSIg', url: 'https://www.youtube.com/@YahooFinance/live' },
  { name: 'Sky News', id: 'UCoMdktPbSTixAyNGwb-UYkQ', url: 'https://www.youtube.com/@SkyNews/live' },
  { name: 'DW News', id: 'UCknLrEdhRCp1aegoMqRaCZg', url: 'https://www.youtube.com/@DWNews/live' },
  { name: 'France 24', id: 'UCQfwfsi5VrQ8yKZ-UWmAEFg', url: 'https://www.youtube.com/@FRANCE24English/live' },
  { name: 'Al Jazeera', id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', url: 'https://www.youtube.com/@AlJazeeraEnglish/live' },
  { name: 'Coin Bureau', id: 'UCqK_GSMbpiV8spgD3ZGloSw', url: 'https://www.youtube.com/@CoinBureau/live' },
];

function videoPanel(_d: unknown, body: HTMLElement, track: Track): void {
  body.innerHTML = `<div class="tv"><div class="tabs" role="group" aria-label="Live channel">${CHANNELS.map((c, i) => `<button type="button" data-ch="${i}" aria-pressed="${i === 0}">${escape(c.name)}</button>`).join('')}</div><div class="tvframe"><iframe title="Live market news" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div><p class="mut tvnote"></p></div>`;
  const frame = body.querySelector('iframe') as HTMLIFrameElement;
  const note = body.querySelector('.tvnote') as HTMLElement;
  function play(i: number) {
    const c = CHANNELS[i]!;
    body.querySelectorAll('[data-ch]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.ch === String(i))));
    frame.src = `https://www.youtube-nocookie.com/embed/live_stream?channel=${c.id}&autoplay=1&mute=1&playsinline=1&rel=0`;
    note.innerHTML = `${escape(c.name)} live. Blank? <a href="${c.url}" target="_blank" rel="noopener">Open the stream on YouTube</a>.`;
  }
  body.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => play(Number(b.dataset.ch))));
  track(() => {
    frame.src = 'about:blank';
  });
  play(0);
}

const ENTRIES: Entry[] = [
  {
    id: 'kpis', title: 'Market pulse', span: 12, path: ['/intel/global', '/intel/markets'], every: 120,
    render([g, m], body) {
      const adv = m.filter((c: any) => (c.chg24h ?? 0) > 0).length;
      mount(
        body,
        html`<div class="kpis">
          ${kpi('Total market cap', usd(g.marketCapUsd), pct(g.marketCapChange24h))}
          ${kpi('24h volume', usd(g.volume24hUsd), `${int(g.activeCoins)} active coins`)}
          ${kpi('BTC dominance', g.btcDominance == null ? 'n/a' : `${g.btcDominance.toFixed(1)}%`, `ETH ${g.ethDominance == null ? 'n/a' : `${g.ethDominance.toFixed(1)}%`}`)}
          ${kpi('Breadth (top 100)', `${adv} / ${m.length - adv}`, adv >= m.length / 2 ? html`<span class="up">advancing</span>` : html`<span class="down">declining</span>`)}
          ${kpi('Fear and greed', g.fearGreed.value, `${g.fearGreed.label}${g.fearGreed.previousWeek == null ? '' : `, last week ${g.fearGreed.previousWeek}`}`)}
        </div>`,
      );
    },
  },
  {
    id: 'heat', title: 'Market heatmap: top 100 by market cap, colour is 24h change', span: 8, tall: true, path: '/intel/markets', every: 90,
    async render(m, body, track) {
      await chartTo(body, track, (p) => treemapOption(m.map((c: any) => ({ name: String(c.symbol).toUpperCase(), value: c.mcap, chg: c.chg24h, extra: c.name })), p));
    },
  },
  {
    id: 'sent', title: 'Sentiment and dominance', span: 4, tall: true, path: ['/intel/global', '/intel/markets'], every: 120,
    async render([g, m], body, track) {
      body.innerHTML = '<div class="split"><div class="c" data-a></div><div class="c" data-b></div></div>';
      const top = m.slice(0, 7).map((c: any) => ({ name: String(c.symbol).toUpperCase(), value: c.mcap }));
      const rest = g.marketCapUsd - top.reduce((s: number, c: any) => s + c.value, 0);
      track(await chart(body.querySelector('[data-a]') as HTMLElement, (p) => gaugeOption(g.fearGreed.value, g.fearGreed.label, p)));
      track(await chart(body.querySelector('[data-b]') as HTMLElement, (p) => donutOption([...top, { name: 'Others', value: Math.max(rest, 0) }], p)));
    },
  },
  {
    id: 'movers', title: 'Top movers (top 100, 24h)', span: 6, path: '/intel/markets', every: 90,
    async render(m, body, track) {
      const sorted = [...m].filter((c: any) => c.chg24h != null).sort((a: any, b: any) => b.chg24h - a.chg24h);
      const rows = [...sorted.slice(0, 8), ...sorted.slice(-8)].map((c: any) => ({ name: String(c.symbol).toUpperCase(), value: c.chg24h }));
      body.innerHTML = '<div class="chartbox mid"></div>';
      await chartTo(body.firstElementChild as HTMLElement, track, (p) => divergingBars(rows, p));
    },
  },
  {
    id: 'breadth', title: 'Breadth: how the top 100 moved in 24h', span: 6, path: '/intel/markets', every: 90,
    async render(m, body, track) {
      const v = m.map((c: any) => c.chg24h).filter((x: unknown): x is number => typeof x === 'number');
      const up = v.filter((x: number) => x > 0).length;
      const avg = v.reduce((s: number, x: number) => s + x, 0) / (v.length || 1);
      mount(body, html`<div class="stats"><span class="up">${up} up</span><span class="down">${v.length - up} down</span><span>average ${pct(avg)}</span></div><div class="chartbox short"></div>`);
      await chartTo(body.querySelector('.chartbox') as HTMLElement, track, (p) => histogram(v, p));
    },
  },
  {
    id: 'map', title: 'Market map: size is volume, colour is 24h change', span: 12, tall: true, path: '/intel/markets', every: 120,
    async render(m, body, track) {
      await chartTo(body, track, (p) => marketMap(m.filter((c: any) => c.mcap > 0 && c.chg24h != null).map((c: any) => ({ name: c.name, symbol: String(c.symbol).toUpperCase(), mcap: c.mcap, chg: c.chg24h, volume: c.volume24h ?? 0 })), p));
    },
  },
  { band: 'News and sectors', note: 'Live video, narrative rotation' },
  { id: 'tv', title: 'Live market TV', span: 6, tall: true, render: videoPanel },
  {
    id: 'sectors', title: 'Sector rotation: size is market cap, colour is 24h change', span: 6, tall: true, path: '/intel/sectors', every: 300,
    async render(s, body, track) {
      await chartTo(body, track, (p) => treemapOption(s.map((c: any) => ({ name: c.name, value: c.mcap, chg: c.chg24h })), p, 6));
    },
  },
  { band: 'Solana', note: 'The home chain: launches, flow and smart money, straight from the firehose' },
  {
    id: 'sol-kpis', title: 'Solana pulse', span: 12, path: '/overview', every: 45,
    render(o, body) {
      const sol = o.markets.find((x: any) => x.chain === 'solana');
      const st = o.stream;
      mount(
        body,
        html`<div class="kpis">
          ${kpi('SOL price', usd(sol?.native_usd ?? o.prices?.solUsd), 'native token')}
          ${kpi('Trades last hour', st?.connected ? int(st.trades1h) : 'offline', st ? `${usd(st.volume1h)} volume` : 'firehose idle')}
          ${kpi('Launches last hour', int(sol?.launches_1h), `${int(st?.graduations1h)} graduations`)}
          ${kpi('Active traders (1h)', int(st?.tradersSeen1h), `${int(st?.pools1h)} pools touched`)}
          ${kpi('Trench market cap', usd(sol?.total_mcap), `${int(sol?.tracked_tokens)} tokens tracked`)}
        </div>`,
      );
    },
  },
  {
    id: 'launch', title: 'Launches and graduations per hour (48h)', span: 6, path: '/overview', every: 180,
    async render(o, body, track) {
      const L = o.launches.filter((r: any) => r.chain === 'solana');
      const G = o.launches.filter((r: any) => r.chain === 'solana');
      await chartTo(body, track, (p) => ({
        grid: { left: 40, right: 12, top: 28, bottom: 26 },
        legend: { top: 0, textStyle: { color: p.mut }, icon: 'roundRect' },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(12,15,19,.96)', borderColor: p.line, textStyle: { color: p.fg } },
        xAxis: { type: 'category', data: L.map((r: any) => new Date(r.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), axisLabel: { color: p.mut }, axisLine: { lineStyle: { color: p.line } } },
        yAxis: { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut } },
        series: [
          { name: 'Launches', type: 'bar', barCategoryGap: '30%', data: L.map((r: any) => r.launches), itemStyle: { color: p.acc, borderRadius: [3, 3, 0, 0] } },
          { name: 'Graduations', type: 'line', smooth: true, showSymbol: true, data: G.map((r: any) => r.graduations), lineStyle: { color: p.warn, width: 2 }, areaStyle: { color: p.warn, opacity: 0.12 } },
        ],
      }));
    },
  },
  {
    id: 'flow', title: 'Solana trade flow and trench market cap (7d)', span: 6, path: '/overview', every: 180,
    async render(o, body, track) {
      const S = o.series.filter((r: any) => r.chain === 'solana');
      if (S.length < 2) return mount(body, empty('Collecting history.', 'This chart fills in after a couple of collection cycles.'));
      await chartTo(body, track, (p) => ({
        grid: { left: 56, right: 56, top: 28, bottom: 26 },
        legend: { top: 0, textStyle: { color: p.mut }, icon: 'roundRect' },
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(12,15,19,.96)', borderColor: p.line, textStyle: { color: p.fg } },
        xAxis: { type: 'time', axisLabel: { color: p.mut }, axisLine: { lineStyle: { color: p.line } } },
        yAxis: [
          { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut, formatter: (v: number) => usd(v) } },
          { type: 'value', splitLine: { show: false }, axisLabel: { color: p.mut, formatter: (v: number) => usd(v) } },
        ],
        series: [
          { name: 'Trench market cap', type: 'line', smooth: true, showSymbol: false, data: S.map((r: any) => [Date.parse(r.ts), r.total_mcap]), lineStyle: { color: p.acc, width: 2 }, areaStyle: { color: p.acc, opacity: 0.16 } },
          { name: 'Stream volume (1h)', type: 'line', yAxisIndex: 1, smooth: true, showSymbol: false, data: S.filter((r: any) => r.stream_volume_1h != null).map((r: any) => [Date.parse(r.ts), r.stream_volume_1h]), lineStyle: { color: p.link, width: 1.5 } },
        ],
      }));
    },
  },
  {
    id: 'bubbles', title: 'Solana token field: liquidity vs 24h move, size is volume', span: 7, tall: true, path: '/tokens?chain=solana&limit=200&minVolume=5000&sort=volume', every: 120,
    async render(d, body, track) {
      const rows = d.rows.filter((r: any) => r.last_liquidity > 0 && r.last_mcap < 1e9 && r.last_change_24h != null).map((r: any) => ({ symbol: r.symbol || short(r.address), liq: r.last_liquidity, chg: r.last_change_24h, vol: r.last_volume_24h ?? 0, mcap: r.last_mcap ?? 0, status: r.status }));
      if (!rows.length) return mount(body, empty('No liquid tokens tracked yet.'));
      await chartTo(body, track, (p) => bubbleTokens(rows, p));
    },
  },
  {
    id: 'hot', title: 'Hottest on the firehose, live', span: 5, tall: true, path: '/overview', every: 15,
    render(o, body) {
      const hot = (o.hot as any[]).slice(0, 14);
      if (!hot.length) return mount(body, empty('The firehose is warming up.', 'Trades appear here seconds after they land on-chain.'));
      mount(
        body,
        html`<ul class="hotlist">${hot.map((h) => {
          const t = h.buys + h.sells || 1;
          return html`<li><a href="#/token/solana/${h.mint}"><b>${h.symbol || short(h.mint)}</b></a><span class="bar" role="img" aria-label="${h.buys} buys, ${h.sells} sells" style="--b:${((h.buys / t) * 100).toFixed(0)}%"></span><span class="mut">${int(h.trades)} trades, ${h.vol.toFixed(1)} SOL</span></li>`;
        })}</ul>`,
      );
    },
  },
  {
    id: 'smart', title: 'Smart money on new launches', span: 6, path: '/intel/smart-money', every: 90,
    render(d, body) {
      if (!d.length) return mount(body, empty('No smart-money activity right now.', 'Scores update as labelled wallets buy new launches.'));
      mount(
        body,
        html`<ul class="hotlist">${d.slice(0, 10).map((c: any) => html`<li><a href="#/token/solana/${c.mint}"><b>${c.symbol || short(c.mint)}</b></a><span class="meter" role="img" aria-label="score ${Number(c.smart_money_score ?? 0).toFixed(0)}" style="--v:${Math.min(100, Number(c.smart_money_score ?? 0))}%"></span><span class="mut">${(c.notable ?? []).map((n: any) => n.label).slice(0, 2).join(', ') || 'unlabelled'}, ${Number(c.total_buy_sol ?? 0).toFixed(1)} SOL, ${ago(c.first_seen_at)}</span></li>`)}</ul>`,
      );
    },
  },
  {
    id: 'trend', title: 'Trending right now', span: 6, path: '/intel/trending', every: 90,
    render(d, body) {
      const t = d.tokens ?? [];
      if (!t.length) return mount(body, empty('Nothing trending.'));
      mount(
        body,
        html`<ul class="hotlist">${t.slice(0, 10).map((c: any) => html`<li><a href="#/token/solana/${c.mint}"><b>${c.symbol || short(c.mint)}</b></a><span class="meter" role="img" aria-label="score ${c.score}" style="--v:${Math.min(100, c.score ?? 0)}%"></span><span class="mut">${usd(c.marketCapUsd)} mcap, ${usd(c.volumeUsd)} volume</span></li>`)}</ul>`,
      );
    },
  },
  { band: 'Derivatives', note: 'Perpetual futures positioning and forced liquidations' },
  {
    id: 'oi', title: 'Open interest: size is OI, colour is 24h move', span: 6, tall: true, path: '/intel/derivatives', every: 90,
    async render(d, body, track) {
      await chartTo(body, track, (p) => treemapOption(d.byOpenInterest.slice(0, 30).map((r: any) => ({ name: r.symbol, value: r.openInterestUsd, chg: r.change24h, extra: `Funding ${sign(r.fundingApr, 1)} APR` })), p, 6));
    },
  },
  {
    id: 'funding', title: 'Funding rates (APR): who is paying to hold the trade', span: 6, tall: true, path: '/intel/derivatives', every: 90,
    async render(d, body, track) {
      const rows = d.byOpenInterest.slice(0, 22).map((r: any) => ({ name: r.symbol, value: Math.max(-150, Math.min(150, r.fundingApr)) }));
      await chartTo(body, track, (p) => divergingBars(rows, p, (v) => sign(v, 1)));
    },
  },
  {
    id: 'liq', title: 'Liquidations: longs vs shorts wiped out', span: 6, path: '/intel/liquidations', every: 45,
    async render(d, body, track) {
      if (!d.count) return mount(body, empty('No liquidations in the latest window.'));
      mount(body, html`<div class="stats"><span class="down">longs ${usd(d.longs)}</span><span class="up">shorts ${usd(d.shorts)}</span><span class="mut">${d.count} events</span></div><div class="chartbox mid"></div>`);
      await chartTo(body.querySelector('.chartbox') as HTMLElement, track, (p) => stackedBars(d.bySymbol.map((r: any) => ({ name: r.symbol, a: r.longs, b: r.shorts })), ['Longs', 'Shorts'], [p.down, p.up], p));
    },
  },
  {
    id: 'crowd', title: 'Crowded trades', span: 6, path: '/intel/derivatives', every: 90,
    render(d, body) {
      const row = (r: any, side: string) => html`<li><b>${r.symbol}</b><span class="${side}">${sign(r.fundingApr, 0)} APR</span><span class="mut">${usd(r.openInterestUsd)} OI</span></li>`;
      mount(body, html`<div class="cols"><div><h4 class="down">Crowded long</h4><ul class="hotlist plain">${d.mostLongCrowded.map((r: any) => row(r, 'down'))}</ul></div><div><h4 class="up">Crowded short</h4><ul class="hotlist plain">${d.mostShortCrowded.map((r: any) => row(r, 'up'))}</ul></div></div><p class="mut">${usd(d.totalOpenInterestUsd)} open interest, ${usd(d.totalVolume24h)} 24h volume on ${d.venue}.</p>`);
    },
  },
  { band: 'DeFi', note: 'Where the capital sits and where it earns' },
  {
    id: 'tvl', title: 'Chain TVL', span: 6, tall: true, path: '/intel/defi', every: 600,
    async render(d, body, track) {
      await chartTo(body, track, (p) => hbars(d.chains.slice(0, 14).map((c: any) => ({ name: c.name, value: c.tvl, color: c.name === 'Solana' ? p.acc : p.link })), p));
    },
  },
  {
    id: 'stables', title: 'Stablecoin supply, 7d change', span: 6, tall: true, path: '/intel/defi', every: 600,
    async render(d, body, track) {
      await chartTo(body, track, (p) => hbars(d.stablecoins.slice(0, 12).map((s: any) => ({ name: s.symbol, value: s.supply, color: s.change7d >= 0 ? p.up : p.down, note: `${s.change7d >= 0 ? '+' : ''}${usd(s.change7d)}` })), p));
    },
  },
  {
    id: 'dex', title: 'DEX volume, 24h', span: 6, path: '/intel/defi', every: 600,
    async render(d, body, track) {
      body.innerHTML = '<div class="chartbox mid"></div>';
      await chartTo(body.firstElementChild as HTMLElement, track, (p) => hbars(d.topDexs.slice(0, 10).map((x: any) => ({ name: x.name, value: x.volume24h, color: p.acc })), p));
    },
  },
  {
    id: 'fees', title: 'Protocol fees, 24h', span: 6, path: '/intel/defi', every: 600,
    async render(d, body, track) {
      body.innerHTML = '<div class="chartbox mid"></div>';
      await chartTo(body.firstElementChild as HTMLElement, track, (p) => hbars(d.topFees.slice(0, 10).map((x: any) => ({ name: x.name, value: x.fees24h, color: p.warn })), p));
    },
  },
  {
    id: 'syield', title: 'Solana yields', span: 6, path: '/intel/defi', every: 600,
    render(d, body) {
      mount(body, html`<ul class="hotlist">${d.solanaYields.slice(0, 10).map((y: any) => html`<li><b>${y.symbol}</b><span class="meter" role="img" aria-label="${y.apy.toFixed(1)} percent APY" style="--v:${Math.min(100, y.apy * 4)}%"></span><span class="mut">${y.apy.toFixed(2)}% APY on ${y.project}, ${usd(y.tvl)} TVL</span></li>`)}</ul>`);
    },
  },
  {
    id: 'yield', title: 'Highest yields (TVL above $5M)', span: 6, path: '/intel/defi', every: 600,
    render(d, body) {
      mount(body, html`<ul class="hotlist">${d.yields.slice(0, 10).map((y: any) => html`<li><b>${y.symbol}</b><span class="meter" role="img" aria-label="${y.apy.toFixed(0)} percent APY" style="--v:${Math.min(100, y.apy)}%"></span><span class="mut">${y.apy.toFixed(1)}% on ${y.project} (${y.chain}), ${usd(y.tvl)}</span></li>`)}</ul>`);
    },
  },
  { band: 'Prediction markets and headlines' },
  {
    id: 'pred', title: 'Prediction markets by 24h volume', span: 6, path: '/intel/predictions', every: 180,
    render(d, body) {
      if (!d.length) return mount(body, empty('No active markets.'));
      mount(
        body,
        html`<ul class="preds">${d.slice(0, 8).map((q: any) => {
          const lead = [...q.outcomes].sort((a: any, b: any) => b.price - a.price)[0];
          const pctv = Math.round((lead?.price ?? 0) * 100);
          return html`<li><div class="q">${q.question}</div><div class="odds"><span class="fill" style="--v:${pctv}%"></span><span>${lead?.name} ${pctv}%</span></div><div class="mut">${usd(q.volume24h)} volume</div></li>`;
        })}</ul>`,
      );
    },
  },
  {
    id: 'news', title: 'Headlines', span: 6, path: '/intel/news', every: 180,
    render(d, body) {
      if (!d.length) return mount(body, empty('No headlines right now.'));
      mount(body, html`<ul class="news">${d.slice(0, 10).map((a: any) => html`<li><a href="${safeHref(a.link)}" target="_blank" rel="noopener noreferrer">${a.title}</a><div class="mut">${a.source ?? ''}${a.publishedAt ? html` · ${ago(a.publishedAt)}` : raw('')}${a.sentiment?.label ? html` · <span class="${a.sentiment.label === 'positive' ? 'up' : a.sentiment.label === 'negative' ? 'down' : 'mut'}">${a.sentiment.label}</span>` : raw('')}</div></li>`)}</ul>`);
    },
  },
];

export const command: Page = (el, _p, onCleanup) => {
  mount(el, html`<div class="ticker" id="ticker" aria-label="Live prices"></div><div class="bento" id="bento"></div>`);
  mountPanels(el.querySelector('#bento') as HTMLElement, ENTRIES, onCleanup);

  const ticker = el.querySelector('#ticker') as HTMLElement;
  async function loadTicker() {
    try {
      const { data } = await api('/intel/markets');
      const items = (data as any[]).slice(0, 24).map((c) => `<span class="tk"><b>${escape(String(c.symbol).toUpperCase())}</b> ${escape(usd(c.price))} <i class="${(c.chg24h ?? 0) >= 0 ? 'up' : 'down'}">${c.chg24h == null ? '' : sign(c.chg24h)}</i></span>`).join('');
      ticker.innerHTML = `<div class="track">${items}${items}</div>`;
    } catch {
      ticker.hidden = true;
    }
  }
  void loadTicker();
  const t = setInterval(() => void loadTicker(), 120_000);
  onCleanup(() => clearInterval(t));
  void heat;
  void sparkPath;
};
