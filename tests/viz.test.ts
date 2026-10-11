import { describe, expect, it } from 'vitest';
import { TRENCH_EDGES, bubbleTokens, eventBuckets, divergingBars, heat, histogram, marketMap, sign, sparkPath, treemapOption } from '../web/src/viz.ts';

const p = { fg: '#fff', mut: '#999', line: '#333', up: '#0f0', down: '#f00', acc: '#0ff', link: '#00f', warn: '#fa0' } as any;

describe('heat', () => {
  it('is neutral for missing data', () => {
    expect(heat(null)).toBe('rgb(27,33,40)');
    expect(heat(undefined)).toBe(heat(Number.NaN));
  });
  it('saturates at the full-scale change and is symmetric in hue', () => {
    expect(heat(10)).toBe(heat(25));
    expect(heat(10)).toBe('rgb(47,209,139)');
    expect(heat(-10)).toBe('rgb(255,93,108)');
  });
  it('gets stronger as the move grows', () => {
    const g = (s: string) => Number(s.match(/rgb\((\d+),(\d+)/)![2]);
    expect(g(heat(8))).toBeGreaterThan(g(heat(2)));
  });
});

describe('sign', () => {
  it('prefixes positives only', () => {
    expect(sign(1.234)).toBe('+1.2%');
    expect(sign(-1.234, 2)).toBe('-1.23%');
    expect(sign(0)).toBe('0.0%');
  });
});

describe('histogram', () => {
  it('puts every value in exactly one bucket', () => {
    const vals = [-50, -12, -3, -0.1, 0, 0.1, 3, 6, 40];
    const o: any = histogram(vals, p);
    const total = o.series[0].data.reduce((n: number, d: any) => n + d.value, 0);
    expect(total).toBe(vals.length);
    expect(o.xAxis.data).toHaveLength(o.series[0].data.length);
  });
  it('treats 0 as the first positive bucket', () => {
    const o: any = histogram([0], p);
    expect(o.series[0].data[8].value).toBe(1);
  });
});

describe('histogram with custom edges', () => {
  it('spreads trench-scale moves across buckets and keeps losers red', () => {
    const o: any = histogram([-80, 5, 60, 300, 4000], p, TRENCH_EDGES);
    const d = o.series[0].data;
    expect(d.reduce((n: number, x: any) => n + x.value, 0)).toBe(5);
    expect(d.filter((x: any) => x.value > 0)).toHaveLength(5);
    expect(d[1].itemStyle.color).toBe('#f00');
    expect(d[d.length - 1].itemStyle.color).toBe('#0f0');
  });
});

describe('treemapOption', () => {
  it('colours each tile by its change', () => {
    const o: any = treemapOption([{ name: 'A', value: 5, chg: 12 }, { name: 'B', value: 3, chg: -12 }], p);
    expect(o.series[0].data.map((d: any) => d.itemStyle.color)).toEqual([heat(12), heat(-12)]);
  });
});

describe('scatter builders', () => {
  it('clamps outliers so one pump cannot flatten the chart', () => {
    const m: any = marketMap([{ name: 'X', symbol: 'X', mcap: 1e9, chg: 900, volume: 1 }], p);
    expect(m.series[0].data[0].value[1]).toBe(30);
    const b: any = bubbleTokens([{ symbol: 'Y', liq: 1e4, chg: -500, vol: 1, mcap: 1, status: 'new' }], p);
    expect(b.series[0].data[0].value[1]).toBe(-100);
  });
  it('scales bubble size by volume without exceeding the cap', () => {
    const b: any = bubbleTokens([{ symbol: 'Y', liq: 1, chg: 0, vol: 100, mcap: 1, status: 'new' }], p);
    expect(b.series[0].symbolSize([1, 0, 100])).toBe(46);
  });
});

describe('divergingBars', () => {
  it('colours by sign', () => {
    const o: any = divergingBars([{ name: 'a', value: 1 }, { name: 'b', value: -1 }], p);
    expect(o.series[0].data.map((d: any) => d.itemStyle.color)).toEqual(['#0f0', '#f00']);
  });
});

describe('sparkPath', () => {
  it('draws a path through every point', () => {
    expect(sparkPath([1, 2, 3]).match(/[ML]/g)).toHaveLength(3);
  });
  it('never emits NaN for a single point or a flat series', () => {
    expect(sparkPath([5])).not.toMatch(/NaN/);
    expect(sparkPath([5, 5, 5])).not.toMatch(/NaN/);
    expect(sparkPath([])).toBe('');
  });
});

describe('xHandle', () => {
  it('reduces a profile url or @handle to the bare handle', async () => {
    const { xHandle } = await import('../web/src/ui.ts');
    expect(xHandle('https://x.com/r4yancore')).toBe('r4yancore');
    expect(xHandle('https://twitter.com/foo/')).toBe('foo');
    expect(xHandle('@bar')).toBe('bar');
    expect(xHandle('baz')).toBe('baz');
    expect(xHandle(null)).toBeNull();
    expect(xHandle('https://example.com/not-twitter')).toBeNull();
  });
});

describe('eventBuckets', () => {
  it('counts events per bucket per series and keeps empty buckets between', () => {
    const t = Date.UTC(2026, 9, 11, 0, 0, 0);
    const { option, buckets } = eventBuckets([{ ts: t, series: 'pump' }, { ts: t + 30_000, series: 'pump' }, { ts: t + 180_000, series: 'bonk' }], 60_000, p);
    const o: any = option;
    expect(buckets).toBe(4);
    expect(o.series.find((s: any) => s.name === 'pump').data).toEqual([2, 0, 0, 0]);
    expect(o.series.find((s: any) => s.name === 'bonk').data).toEqual([0, 0, 0, 1]);
    expect(o.xAxis.data[3]).toBe('00:03');
  });
  it('is empty without events', () => {
    expect(eventBuckets([], 60_000, p).buckets).toBe(0);
  });
});

describe('usd negatives', () => {
  it('puts the sign before the dollar sign', async () => {
    const { usd } = await import('../web/src/ui.ts');
    expect(usd(-115.22)).toBe('-$115.22');
    expect(usd(-1500)).toBe('-$1.5K');
    expect(usd(-2_500_000_000)).toBe('-$2.50B');
    expect(usd(1500)).toBe('$1.5K');
  });
});
