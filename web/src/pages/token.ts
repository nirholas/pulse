import { api } from '../api.ts';
import { chart, lineOption } from '../charts.ts';
import { donutOption, gaugeOption } from '../viz.ts';
import { ago, dex, empty, errorBox, explorer, html, int, mount, pct, raw, short, skeleton, statusPill, usd } from '../ui.ts';
import type { Page } from '../router.ts';

const TFS = ['5m', '15m', '1h', '4h', '1d'];

export const token: Page = async (el, [chain = '', address = ''], onCleanup) => {
  mount(el, skeleton(10));
  let d: any;
  try {
    d = await api(`/tokens/${chain}/${address}`);
  } catch (e) {
    mount(el, errorBox((e as Error).message));
    el.querySelector('[data-retry]')?.addEventListener('click', () => void token(el, [chain, address], onCleanup));
    return;
  }
  const t = d.token;
  const fromAth = t.ath_mcap && t.last_mcap ? (t.last_mcap / t.ath_mcap - 1) * 100 : null;
  const stat = (l: string, v: unknown) => html`<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  mount(
    el,
    html`<p><a href="#/tokens">Tokens</a> / ${t.symbol || short(address)}</p>
    <h1>${t.symbol || short(address)} <span class="mut">${t.name ?? ''}</span> ${statusPill(t.status)}</h1>
    <p class="sub"><span class="pill">${t.category}</span> ${t.category && t.category !== 'unclassified' ? html`tech score ${Math.round((t.tech_score ?? 0) * 100)} · ` : raw('')}${t.launchpad ?? 'no launchpad'} · first seen ${ago(t.first_seen)} · <a href="${dex(chain, address)}" target="_blank" rel="noopener">DexScreener</a> · <a href="${explorer(chain, address)}" target="_blank" rel="noopener">Explorer</a></p>
    ${t.description ? html`<p class="mut">${t.description}</p>` : raw('')}
    ${t.last_mcap == null && t.last_volume_24h == null && t.last_liquidity == null ? html`<div class="card notice" role="status"><b>Awaiting the first market snapshot.</b> This token was just discovered. Prices, liquidity and holders fill in on the next collection cycle (every 5 minutes). Live trade flow below is already streaming.</div>` : raw('')}
    <div class="grid g4">
      ${stat('Market cap', usd(t.last_mcap))}${stat('24h change', pct(t.last_change_24h))}${stat('24h volume', usd(t.last_volume_24h))}${stat('Liquidity', usd(t.last_liquidity))}
      ${stat('Holders', int(t.last_holders))}${stat('ATH mcap', usd(t.ath_mcap))}${stat('From ATH', pct(fromAth))}${stat('Peak 24h volume', usd(t.peak_volume_24h))}
    </div>
    <section class="card" style="margin-top:14px"><div class="tabs" role="group" aria-label="Timeframe">${TFS.map((tf) => html`<button type="button" data-tf="${tf}" aria-pressed="${tf === '15m'}">${tf}</button>`)}</div><div class="chart tall" id="candles"></div><p class="mut" id="csrc"></p></section>
    <div class="grid g2" style="margin-top:14px">
      <section class="card"><h2>Market cap and liquidity (our snapshots)</h2><div class="chart" id="snap"></div></section>
      <section class="card"><h2>Holders and traders</h2><div class="chart" id="hold"></div></section>
    </div>
    ${chain === 'solana' ? html`<section class="card" style="margin-top:14px"><h2>Risk and conviction</h2><div id="risk">${skeleton(3)}</div></section>` : raw('')}
    ${d.heat ? html`<section class="card" style="margin-top:14px"><h2>Live heat</h2><p>${int(d.heat.trades)} trades in the last hour, ${int(d.heat.buys)} buys vs ${int(d.heat.sells)} sells, ${int(d.heat.traders)} traders, ${d.heat.vol.toFixed(1)} SOL volume.</p></section>` : raw('')}
    <section style="margin-top:14px"><h2>Smart money and KOL positions</h2>${d.positions.length ? html`<div class="tablewrap"><table><thead><tr><th class="l">Wallet</th><th class="l">Kind</th><th>First buy</th><th>Entry mcap</th><th>Bought</th><th>Sold</th></tr></thead><tbody>${d.positions.map((p: any) => html`<tr><td class="l"><a href="#/wallet/${p.wallet}">${p.label || short(p.wallet)}</a></td><td class="l">${p.kind ?? 'unlabelled'}</td><td>${ago(p.first_buy_at)}</td><td>${usd(p.first_buy_mcap_usd)}</td><td>${p.bought_quote?.toFixed(2)}</td><td>${p.sold_quote?.toFixed(2)}</td></tr>`)}</tbody></table></div>` : empty('No tracked wallet positions yet.', 'Positions are recorded for labelled wallets, whales and early buyers while the firehose is running.')}</section>
    <div class="grid g2" style="margin-top:14px">
      <section><h2>Recent notable trades</h2>${d.trades.length ? html`<div class="tablewrap"><table><thead><tr><th>When</th><th class="l">Wallet</th><th class="l">Side</th><th>Size</th><th>Mcap</th></tr></thead><tbody>${d.trades.map((x: any) => html`<tr><td>${ago(x.ts)}</td><td class="l"><a href="#/wallet/${x.wallet}">${x.label || short(x.wallet)}</a></td><td class="l ${x.side === 'buy' ? 'up' : 'down'}">${x.side}</td><td>${x.quote_amount?.toFixed(2)}</td><td>${usd(x.mcap_usd)}</td></tr>`)}</tbody></table></div>` : empty('No notable trades recorded.')}</section>
      <section><h2>Discovery lists and events</h2>${d.lists.length || d.events.length ? html`<div class="tablewrap"><table><thead><tr><th class="l">Source</th><th>Best rank</th><th>Seen</th><th>Last</th></tr></thead><tbody>${d.lists.map((l: any) => html`<tr><td class="l">${l.list}</td><td>${l.best_rank}</td><td>${l.appearances}</td><td>${ago(l.last_ts)}</td></tr>`)}${d.events.map((e: any) => html`<tr><td class="l">${e.kind} ${e.launchpad ?? ''}</td><td></td><td></td><td>${ago(e.ts)}</td></tr>`)}</tbody></table></div>` : empty('Not seen on any list yet.')}</section>
    </div>`,
  );
  const cleaners: (() => void)[] = [];
  onCleanup(() => cleaners.forEach((c) => c()));
  if (chain === 'solana') void loadRisk(el.querySelector('#risk') as HTMLElement, address, cleaners);
  const snaps = d.snapshots as any[];
  const col = (k: string) => snaps.filter((s) => s[k] != null).map((s) => [Date.parse(s.ts), s[k]] as [number, number]);
  if (snaps.length > 1) {
    cleaners.push(await chart(el.querySelector('#snap')!, (p) => lineOption(p, [{ name: 'Mcap', data: col('mcap'), area: true }, { name: 'Liquidity', data: col('liquidity'), color: p.warn }], usd)));
    cleaners.push(await chart(el.querySelector('#hold')!, (p) => lineOption(p, [{ name: 'Holders', data: col('holders') }, { name: 'Traders 24h', data: col('traders_24h'), color: p.warn }], (v) => int(v))));
  } else {
    for (const id of ['#snap', '#hold']) mount(el.querySelector(id)!, empty('Not enough snapshots yet.', 'A chart appears after two collection cycles.'));
  }

  let disposeCandles: (() => void) | null = null;
  onCleanup(() => disposeCandles?.());
  async function loadCandles(tf: string) {
    const host = el.querySelector('#candles') as HTMLElement;
    const src = el.querySelector('#csrc')!;
    disposeCandles?.();
    disposeCandles = null;
    host.innerHTML = '';
    try {
      const res = await api(`/tokens/${chain}/${address}/candles?tf=${tf}`);
      if (!res.candles.length) {
        src.textContent = res.pool ? 'Live chart from GeckoTerminal.' : '';
        if (chain === 'solana' && res.pool) host.innerHTML = `<iframe title="GeckoTerminal chart" class="dexframe" loading="lazy" referrerpolicy="no-referrer" src="https://www.geckoterminal.com/solana/pools/${encodeURIComponent(res.pool)}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0"></iframe>`;
        else mount(host, empty('No candles available.', res.error ?? 'No trading pair is indexed for this token yet.'));
        return;
      }
      src.textContent = `Candles from ${res.source}, pool ${short(res.pool)}`;
      const lc = await import('lightweight-charts');
      const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const c = lc.createChart(host, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: css('--mut') }, grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } }, timeScale: { timeVisible: true }, rightPriceScale: { borderColor: css('--line') } });
      const s = c.addSeries(lc.CandlestickSeries, { upColor: css('--up'), downColor: css('--down'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--down'), priceFormat: { type: 'price', precision: 8, minMove: 1e-8 } });
      s.setData(res.candles.map((k: any) => ({ time: k.time ?? k.t ?? k[0], open: k.open ?? k.o ?? k[1], high: k.high ?? k.h ?? k[2], low: k.low ?? k.l ?? k[3], close: k.close ?? k.c ?? k[4] })));
      c.timeScale().fitContent();
      disposeCandles = () => c.remove();
    } catch (e) {
      mount(host, errorBox((e as Error).message));
      host.querySelector('[data-retry]')?.addEventListener('click', () => void loadCandles(tf));
    }
  }
  el.querySelectorAll<HTMLButtonElement>('[data-tf]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      void loadCandles(b.dataset.tf!);
    }),
  );
  await loadCandles('15m');
};

const TIER: Record<string, string> = { strong: 'up', watch: 'warn', weak: 'down' };

async function loadRisk(box: HTMLElement, mint: string, cleaners: (() => void)[]): Promise<void> {
  let d: any;
  try {
    d = (await api(`/intel/token/${mint}`)).data;
  } catch (e) {
    mount(box, errorBox((e as Error).message));
    box.querySelector('[data-retry]')?.addEventListener('click', () => void loadRisk(box, mint, cleaners));
    return;
  }
  const conv = d.coin?.conviction;
  const safety = d.safety;
  const sec = d.security;
  const holders = d.holders;
  if (!conv && !safety && !sec && !holders) return mount(box, empty('No risk data yet.', 'Security checks appear once the token has an indexed pool.'));
  const flag = (ok: boolean | null | undefined, good: string, bad: string) => (ok == null ? '' : ok ? html`<li class="up">${good}</li>` : html`<li class="down">${bad}</li>`);
  mount(
    box,
    html`<div class="riskgrid">
      <div><h4>Conviction ${conv ? html`<span class="pill ${TIER[conv.tier] ?? ''}">${conv.tier}</span>` : raw('')}</h4><div class="chartbox short" id="r-gauge"></div></div>
      <div><h4>Pillars</h4><div class="chartbox short" id="r-radar"></div></div>
      <div><h4>Top holders</h4><div class="chartbox short" id="r-hold"></div></div>
      <div><h4>Checks ${safety ? html`<span class="pill ${safety.verdict === 'pass' ? 'running' : safety.verdict === 'warn' ? 'dying' : 'dead'}">${safety.verdict}</span>` : raw('')}</h4>
        <ul class="flags">${sec ? html`${flag(sec.checks?.mintAuthorityRevoked, 'Mint authority revoked', 'Mint authority still active')}${flag(sec.checks?.freezeAuthorityRevoked, 'Freeze authority revoked', 'Freeze authority still active')}${flag(sec.checks?.lpBurnedOrLocked, 'Liquidity burned or locked', 'Liquidity not locked')}${flag(sec.checks?.topHolderPctFlag === undefined ? null : !sec.checks.topHolderPctFlag, 'Holders well spread', 'Concentrated holders')}` : raw('')}${(safety?.reasons ?? []).map((r: string) => html`<li class="warn">${r}</li>`)}${(conv?.reasons ?? []).slice(0, 4).map((r: any) => html`<li class="mut">${r.text}</li>`)}</ul></div>
    </div>`,
  );
  const mk = async (id: string, opt: Parameters<typeof chart>[1]) => cleaners.push(await chart(box.querySelector(id) as HTMLElement, opt));
  if (conv) {
    await mk('#r-gauge', (p) => gaugeOption(conv.score, conv.tier, p));
    const pill = conv.pillars ?? {};
    await mk('#r-radar', (p) => ({
      radar: { radius: '62%', indicator: Object.keys(pill).map((k) => ({ name: k, max: 100 })), axisName: { color: p.mut }, splitLine: { lineStyle: { color: p.line } }, splitArea: { show: false }, axisLine: { lineStyle: { color: p.line } } },
      series: [{ type: 'radar', data: [{ value: Object.values(pill) as number[], areaStyle: { color: p.acc, opacity: 0.25 }, lineStyle: { color: p.acc }, itemStyle: { color: p.acc } }] }],
    }));
  } else {
    for (const id of ['#r-gauge', '#r-radar']) mount(box.querySelector(id) as HTMLElement, empty('Not scored yet.'));
  }
  const top = holders?.top ?? [];
  if (top.length) {
    const rest = Math.max(0, 100 - top.reduce((s: number, h: any) => s + h.pct, 0));
    await mk('#r-hold', (p) => donutOption([...top.slice(0, 8).map((h: any) => ({ name: short(h.owner), value: h.pct })), { name: 'Others', value: rest }], p));
  } else mount(box.querySelector('#r-hold') as HTMLElement, empty('No holder data.'));
}
