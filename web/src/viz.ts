// Visual builders for the command center. Everything here is pure: data in,
// echarts option out, so the pages stay thin and the shapes are testable.
import type { EChartsOption } from 'echarts';
import { palette } from './charts.ts';
import { usd } from './ui.ts';

type P = ReturnType<typeof palette>;

const NEUTRAL: [number, number, number] = [27, 33, 40];
const UP: [number, number, number] = [47, 209, 139];
const DOWN: [number, number, number] = [255, 93, 108];

/** Heatmap tile colour: neutral at 0, saturating at +-10%. */
export function heat(chg: number | null | undefined, full = 10): string {
  if (chg == null || !Number.isFinite(chg)) return `rgb(${NEUTRAL.join(',')})`;
  const t = Math.min(1, Math.abs(chg) / full);
  const target = chg >= 0 ? UP : DOWN;
  const c = NEUTRAL.map((n, i) => Math.round(n + (target[i]! - n) * (0.18 + 0.82 * t)));
  return `rgb(${c.join(',')})`;
}

export const sign = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;

const tip = (p: P) => ({ backgroundColor: 'rgba(12,15,19,.96)', borderColor: p.line, textStyle: { color: p.fg, fontSize: 12 } });

export function treemapOption(items: { name: string; value: number; chg: number | null; extra?: string }[], p: P, full = 10): EChartsOption {
  return {
    tooltip: { ...tip(p), formatter: (i: any) => `<b>${i.name}</b><br/>${usd(i.value)}${i.data.chg == null ? '' : `<br/>${sign(i.data.chg, 2)} 24h`}${i.data.extra ? `<br/>${i.data.extra}` : ''}` },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        squareRatio: 1.1,
        itemStyle: { borderColor: '#0b0d10', borderWidth: 2, gapWidth: 1, borderRadius: 4 },
        label: { show: true, position: 'insideTopLeft', padding: 6, overflow: 'truncate', formatter: (i: any) => `{n|${i.name}}\n{c|${i.data.chg == null ? '' : sign(i.data.chg)}}`, rich: { n: { fontSize: 13, fontWeight: 700, color: '#fff' }, c: { fontSize: 11, color: 'rgba(255,255,255,.85)' } } },
        data: items.map((i) => ({ ...i, itemStyle: { color: heat(i.chg, full) } })),
      },
    ],
  };
}

export function gaugeOption(value: number, label: string, p: P): EChartsOption {
  return {
    series: [
      {
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        radius: '100%',
        center: ['50%', '68%'],
        splitNumber: 4,
        axisLine: { lineStyle: { width: 16, color: [[0.25, '#ff5d6c'], [0.45, '#f5b74a'], [0.55, '#8a96a3'], [0.75, '#7bd88f'], [1, '#2fd18b']] } },
        pointer: { length: '58%', width: 5, itemStyle: { color: p.fg } },
        anchor: { show: true, size: 10, itemStyle: { color: p.fg } },
        axisTick: { show: false },
        splitLine: { length: 8, lineStyle: { color: p.line, width: 2 } },
        axisLabel: { color: p.mut, distance: -34, fontSize: 10 },
        title: { offsetCenter: [0, '30%'], color: p.mut, fontSize: 13 },
        detail: { offsetCenter: [0, '56%'], fontSize: 30, fontWeight: 700, color: p.fg, formatter: '{value}' },
        data: [{ value, name: label }],
      },
    ],
  };
}

export function donutOption(slices: { name: string; value: number }[], p: P, fmt: (v: number) => string = usd): EChartsOption {
  const colors = [p.warn, p.link, p.acc, '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#34d399', p.mut];
  return {
    color: colors,
    tooltip: { ...tip(p), formatter: (i: any) => `<b>${i.name}</b><br/>${fmt(i.value)} (${i.percent}%)` },
    series: [
      {
        type: 'pie',
        radius: ['52%', '80%'],
        center: ['50%', '50%'],
        roseType: 'radius',
        itemStyle: { borderColor: '#0b0d10', borderWidth: 2, borderRadius: 6 },
        label: { color: p.fg, fontSize: 11, formatter: '{b}\n{d}%' },
        labelLine: { lineStyle: { color: p.line } },
        data: slices,
      },
    ],
  };
}

export function divergingBars(rows: { name: string; value: number }[], p: P, fmt: (v: number) => string = (v) => sign(v)): EChartsOption {
  return {
    grid: { left: 64, right: 56, top: 6, bottom: 6 },
    tooltip: { ...tip(p), trigger: 'item', valueFormatter: (v) => fmt(Number(v)) },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: p.fg, fontWeight: 600 } },
    series: [
      {
        type: 'bar',
        barWidth: '62%',
        data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.value >= 0 ? p.up : p.down, borderRadius: r.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
        label: { show: true, position: 'right', color: p.mut, fontSize: 11, formatter: (i: any) => fmt(i.value) },
      },
    ],
  };
}

export const MAJOR_EDGES = [-30, -20, -15, -10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10, 15, 20, 30];
export const TRENCH_EDGES = [-90, -75, -50, -25, -10, 0, 10, 25, 50, 100, 250, 500, 1000];

export function histogram(values: number[], p: P, edges: number[] = MAJOR_EDGES): EChartsOption {
  const zero = edges.indexOf(0);
  const labels: string[] = [];
  const counts: number[] = [];
  for (let i = 0; i <= edges.length; i++) {
    const lo = i === 0 ? -Infinity : edges[i - 1]!;
    const hi = i === edges.length ? Infinity : edges[i]!;
    labels.push(i === 0 ? `<${edges[0]}` : i === edges.length ? `>${edges[edges.length - 1]}` : `${lo}`);
    counts.push(values.filter((v) => v >= lo && v < hi).length);
  }
  return {
    grid: { left: 30, right: 8, top: 14, bottom: 28 },
    tooltip: { ...tip(p), trigger: 'axis' },
    xAxis: { type: 'category', data: labels, axisLabel: { color: p.mut, fontSize: 10 }, axisLine: { lineStyle: { color: p.line } } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.mut } },
    series: [{ type: 'bar', barCategoryGap: '8%', data: counts.map((c, i) => ({ value: c, itemStyle: { color: i <= zero ? p.down : p.up, opacity: 0.55 + 0.45 * (Math.abs(i - zero - 0.5) / Math.max(zero + 0.5, edges.length - zero - 0.5)), borderRadius: [4, 4, 0, 0] } })) }],
  };
}

export function marketMap(coins: { name: string; symbol: string; mcap: number; chg: number; volume: number }[], p: P): EChartsOption {
  const vmax = Math.max(...coins.map((c) => c.volume), 1);
  return {
    grid: { left: 52, right: 24, top: 24, bottom: 44 },
    tooltip: { ...tip(p), formatter: (i: any) => `<b>${i.data.name}</b><br/>Market cap ${usd(i.data.value[0])}<br/>24h ${sign(i.data.value[1], 2)}<br/>Volume ${usd(i.data.vol)}` },
    xAxis: { type: 'log', name: 'Market cap', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: p.mut }, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut, formatter: (v: number) => usd(v) } },
    yAxis: { type: 'value', name: '24h %', nameTextStyle: { color: p.mut }, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut, formatter: '{value}%' } },
    series: [
      {
        type: 'scatter',
        symbolSize: (d: any) => 8 + 46 * Math.sqrt(d[2] / vmax),
        data: coins.map((c) => ({ name: c.name, value: [c.mcap, Math.max(-30, Math.min(30, c.chg)), c.volume], vol: c.volume, itemStyle: { color: heat(c.chg, 8), opacity: 0.85, borderColor: 'rgba(255,255,255,.25)', borderWidth: 1 }, label: { show: c.mcap > 3e9, formatter: c.symbol, color: '#fff', fontSize: 10, position: 'inside' } })),
        markLine: { silent: true, symbol: 'none', lineStyle: { color: p.mut, type: 'dashed' }, data: [{ yAxis: 0 }], label: { show: false } },
        emphasis: { scale: 1.15 },
      },
    ],
  };
}

export function bubbleTokens(rows: { symbol: string; liq: number; chg: number; vol: number; mcap: number; status: string }[], p: P): EChartsOption {
  const vmax = Math.max(...rows.map((r) => r.vol), 1);
  const statusColor: Record<string, string> = { running: p.up, graduated: p.link, new: p.acc, curve: p.acc, dying: p.warn, dead: p.down };
  return {
    grid: { left: 52, right: 24, top: 24, bottom: 44 },
    tooltip: { ...tip(p), formatter: (i: any) => `<b>${i.data.name}</b> (${i.data.status})<br/>Liquidity ${usd(i.data.value[0])}<br/>24h ${sign(i.data.chg, 1)}<br/>Volume ${usd(i.data.vol)}<br/>Mcap ${usd(i.data.mcap)}` },
    xAxis: { type: 'log', name: 'Liquidity', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: p.mut }, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut, formatter: (v: number) => usd(v) } },
    yAxis: { type: 'value', name: '24h %', nameTextStyle: { color: p.mut }, min: -100, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut, formatter: '{value}%' } },
    series: [
      {
        type: 'scatter',
        symbolSize: (d: any) => 6 + 40 * Math.sqrt(d[2] / vmax),
        data: rows.map((r) => ({ name: r.symbol, status: r.status, chg: r.chg, vol: r.vol, mcap: r.mcap, value: [r.liq, Math.max(-100, Math.min(400, r.chg)), r.vol], itemStyle: { color: statusColor[r.status] ?? p.mut, opacity: 0.8, borderColor: 'rgba(255,255,255,.3)', borderWidth: 1 } })),
        emphasis: { scale: 1.2 },
      },
    ],
  };
}

export function stackedBars(rows: { name: string; a: number; b: number }[], names: [string, string], colors: [string, string], p: P): EChartsOption {
  return {
    grid: { left: 54, right: 14, top: 26, bottom: 6 },
    legend: { top: 0, textStyle: { color: p.mut }, icon: 'roundRect' },
    tooltip: { ...tip(p), trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => usd(Number(v)) },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: p.fg, fontWeight: 600 } },
    series: [
      { name: names[0], type: 'bar', stack: 's', data: rows.map((r) => r.a), itemStyle: { color: colors[0], borderRadius: [4, 0, 0, 4] }, barWidth: '62%' },
      { name: names[1], type: 'bar', stack: 's', data: rows.map((r) => r.b), itemStyle: { color: colors[1], borderRadius: [0, 4, 4, 0] } },
    ],
  };
}

export function hbars(rows: { name: string; value: number; color?: string; note?: string }[], p: P, fmt: (v: number) => string = usd): EChartsOption {
  return {
    grid: { left: 96, right: 70, top: 6, bottom: 6 },
    tooltip: { ...tip(p), trigger: 'item', valueFormatter: (v) => fmt(Number(v)) },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: p.fg, width: 88, overflow: 'truncate' } },
    series: [{ type: 'bar', barWidth: '64%', data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.color ?? p.acc, borderRadius: [0, 4, 4, 0] } })), label: { show: true, position: 'right', color: p.mut, fontSize: 11, formatter: (i: any) => `${fmt(i.value)}${rows[i.dataIndex]?.note ? ` ${rows[i.dataIndex]!.note}` : ''}` } }],
  };
}

export const sparkPath = (pts: number[], w = 72, h = 20): string => {
  if (!pts.length) return '';
  if (pts.length === 1) return `M0 ${h / 2}L${w} ${h / 2}`;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  return pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join('');
};

export function walletScatter(rows: { name: string; kind: string; score: number; winRate: number; tokens: number; pnl: number | null }[], p: P): EChartsOption {
  const tmax = Math.max(...rows.map((r) => r.tokens), 1);
  const color: Record<string, string> = { kol: p.link, smart: p.acc };
  return {
    grid: { left: 52, right: 24, top: 24, bottom: 44 },
    tooltip: { ...tip(p), formatter: (i: any) => `<b>${i.data.name}</b> (${i.data.kind})<br/>Score ${i.data.value[0].toFixed(1)}<br/>Win rate ${i.data.value[1].toFixed(0)}%<br/>${i.data.tokens} tokens${i.data.pnl == null ? '' : `<br/>PnL ${usd(i.data.pnl)}`}` },
    xAxis: { type: 'value', name: 'Pulse score', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: p.mut }, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut } },
    yAxis: { type: 'value', name: 'Win rate %', min: 0, max: 100, nameTextStyle: { color: p.mut }, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut, formatter: '{value}%' } },
    series: [{ type: 'scatter', symbolSize: (d: any) => 8 + 30 * Math.sqrt(d[2] / tmax), data: rows.map((r) => ({ name: r.name, kind: r.kind, tokens: r.tokens, pnl: r.pnl, value: [r.score, r.winRate * 100, r.tokens], itemStyle: { color: color[r.kind] ?? p.mut, opacity: 0.8, borderColor: 'rgba(255,255,255,.3)', borderWidth: 1 } })), emphasis: { scale: 1.2 } }],
  };
}

/** Event counts per time bucket, split by series, as stacked columns. */
export function eventBuckets(events: { ts: string | number; series: string }[], bucketMs: number, p: P, colors: Record<string, string> = {}): { option: EChartsOption; buckets: number } {
  if (!events.length) return { option: {}, buckets: 0 };
  const stamps = events.map((e) => new Date(e.ts).getTime());
  const lo = Math.floor(Math.min(...stamps) / bucketMs) * bucketMs;
  const hi = Math.floor(Math.max(...stamps) / bucketMs) * bucketMs;
  const n = Math.round((hi - lo) / bucketMs) + 1;
  const names = [...new Set(events.map((e) => e.series))];
  const counts = new Map(names.map((k) => [k, new Array<number>(n).fill(0)]));
  events.forEach((e, i) => {
    counts.get(e.series)![Math.floor((stamps[i]! - lo) / bucketMs)]!++;
  });
  const fallback = [p.acc, p.link, p.warn, '#a78bfa', '#f472b6'];
  return {
    buckets: n,
    option: {
      grid: { left: 36, right: 10, top: 28, bottom: 26 },
      legend: { top: 0, textStyle: { color: p.mut }, icon: 'roundRect' },
      tooltip: { ...tip(p), trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'category', data: Array.from({ length: n }, (_, i) => new Date(lo + i * bucketMs).toISOString().slice(11, 16)), axisLabel: { color: p.mut, fontSize: 10 }, axisLine: { lineStyle: { color: p.line } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: p.line, opacity: 0.5 } }, axisLabel: { color: p.mut } },
      series: names.map((k, i) => ({ name: k, type: 'bar' as const, stack: 's', data: counts.get(k)!, itemStyle: { color: colors[k] ?? fallback[i % fallback.length], borderRadius: i === names.length - 1 ? [3, 3, 0, 0] : 0 } })),
    },
  };
}
