// Panel framework for the command center. Each panel owns its fetch, its
// loading skeleton, its error state with retry, its refresh timer and the
// chart instances it creates, so one failing upstream never blanks the page.
import { api } from './api.ts';
import { ago, errorBox, escape, html, skeleton } from './ui.ts';

export type Track = (fn: () => void) => void;

export type PanelDef = {
  id: string;
  title: string;
  /** Columns out of 12 on wide screens. */
  span?: number;
  tall?: boolean;
  /** One or several API paths. Intel routes are unwrapped from `{ data }`. */
  path?: string | string[];
  /** Auto refresh in seconds. */
  every?: number;
  render: (data: any, body: HTMLElement, track: Track) => void | Promise<void>;
};

export type BandDef = { band: string; note?: string };
export type Entry = PanelDef | BandDef;

const unwrap = (res: any) => (res && typeof res === 'object' && 'data' in res && !('rows' in res) ? res.data : res);

export function mountPanels(host: HTMLElement, entries: Entry[], onCleanup: (fn: () => void) => void): void {
  host.innerHTML = entries
    .map((e) =>
      'band' in e
        ? `<h2 class="band"><span>${escape(e.band)}</span>${e.note ? `<small>${escape(e.note)}</small>` : ''}</h2>`
        : `<section class="panel" style="--span:${e.span ?? 6}" id="p-${e.id}" aria-labelledby="h-${e.id}"><header><h3 id="h-${e.id}">${escape(e.title)}</h3><span class="upd" data-upd></span></header><div class="pbody${e.tall ? ' tall' : ''}">${skeleton(4).value}</div></section>`,
    )
    .join('');

  const timers: ReturnType<typeof setInterval>[] = [];
  const disposers = new Set<() => void>();
  const stamps = new Map<string, { el: HTMLElement; at: number; stale: boolean }>();

  async function run(def: PanelDef): Promise<void> {
    const section = host.querySelector(`#p-${def.id}`) as HTMLElement | null;
    if (!section) return;
    const body = section.querySelector('.pbody') as HTMLElement;
    const upd = section.querySelector('[data-upd]') as HTMLElement;
    const local: (() => void)[] = [];
    const prior = (section as HTMLElement & { _cleanup?: (() => void)[] })._cleanup ?? [];
    let data: unknown = null;
    try {
      if (def.path) {
        const paths = Array.isArray(def.path) ? def.path : [def.path];
        const res = await Promise.all(paths.map((p) => api(p)));
        data = Array.isArray(def.path) ? res.map(unwrap) : unwrap(res[0]);
      }
      prior.forEach((fn) => fn());
      (section as HTMLElement & { _cleanup?: (() => void)[] })._cleanup = local;
      local.forEach((fn) => disposers.add(fn));
      await def.render(data, body, (fn) => {
        local.push(fn);
        disposers.add(fn);
      });
      stamps.set(def.id, { el: upd, at: Date.now(), stale: false });
      upd.className = 'upd';
      upd.textContent = 'just now';
    } catch (e) {
      const had = stamps.get(def.id);
      if (had) {
        had.stale = true;
        upd.className = 'upd warn';
        upd.textContent = 'stale, retrying';
        return;
      }
      body.innerHTML = errorBox(`${def.title}: ${(e as Error).message}`).value;
      body.querySelector('[data-retry]')?.addEventListener('click', () => {
        body.innerHTML = skeleton(4).value;
        void run(def);
      });
    }
  }

  const defs = entries.filter((e): e is PanelDef => !('band' in e));
  for (const d of defs) {
    void run(d);
    if (d.every) timers.push(setInterval(() => { if (!document.hidden) void run(d); }, d.every * 1000));
  }
  timers.push(
    setInterval(() => {
      for (const s of stamps.values()) if (!s.stale) s.el.textContent = ago(new Date(s.at));
    }, 15_000),
  );
  onCleanup(() => {
    timers.forEach(clearInterval);
    disposers.forEach((fn) => fn());
    disposers.clear();
  });
  void html;
}
