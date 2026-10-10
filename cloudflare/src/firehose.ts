// The always-on half of Pulse. One Durable Object owns the outbound Solana
// logsSubscribe socket and runs the collection cycle from an alarm, so the
// in-memory heat, early-buyer tracking and the cycle share one process.
// Cron triggers and API requests wake it; the alarm re-arms itself.
import { DurableObject } from 'cloudflare:workers';
import { SolanaStream, type HotToken, type StreamStats } from '../../src/collector/solana-stream.ts';
import { logger } from '../../src/lib/log.ts';
import { applyEnv, type Env } from './env.ts';
import { useDb } from './db.ts';
import { FetchWebSocket } from './ws.ts';
import { collectCycle, periodicJobs, prices, type CycleResult } from './collector.ts';

const log = logger('firehose');
(globalThis as { WebSocket: unknown }).WebSocket = FetchWebSocket;

/** Provider URLs carry the API key in the query string; the public status shows the host only. */
const redact = (url: string | null): string | null => (url ? url.replace(/[?].*$/, '') : url);
const CYCLE_MS = 5 * 60_000;

export type FirehoseStatus = { running: boolean; stats: StreamStats | null; hot: HotToken[]; prices: typeof prices; lastCycle: CycleResult | null; lastError: string | null };

export class Firehose extends DurableObject<Env> {
  private stream: SolanaStream | null = null;
  private starting: Promise<void> | null = null;
  private lastCycle: CycleResult | null = null;
  private lastError: string | null = null;
  private cycling = false;
  private startedAt = Date.now();

  private prepare(): void {
    applyEnv(this.env);
    useDb(this.env);
  }

  private async ensureStream(): Promise<SolanaStream> {
    this.prepare();
    if (this.stream) return this.stream;
    this.starting ??= (async () => {
      const s = new SolanaStream();
      await s.start();
      this.stream = s;
      this.startedAt = Date.now();
    })().finally(() => {
      this.starting = null;
    });
    await this.starting;
    return this.stream!;
  }

  /** Start the socket if needed and make sure the next cycle is scheduled. */
  async wake(): Promise<FirehoseStatus> {
    await this.ensureStream();
    await this.recycleIfDisconnected();
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1_000);
    return this.status();
  }

  /** A socket that has not connected since the last wake is replaced, so rotated RPC secrets and dead sockets heal on the next cron tick. */
  private async recycleIfDisconnected(): Promise<void> {
    const s = this.stream;
    if (!s || s.stats().connected || Date.now() - this.startedAt < 60_000) return;
    this.stream = null;
    await s.stop().catch(() => undefined);
    await this.ensureStream();
  }

  async status(): Promise<FirehoseStatus> {
    return {
      running: this.stream !== null,
      stats: this.stream ? { ...this.stream.stats(), endpoint: redact(this.stream.stats().endpoint) } : null,
      hot: this.stream?.hot(20) ?? [],
      prices,
      lastCycle: this.lastCycle,
      lastError: this.lastError,
    };
  }

  async heat(mint: string) {
    return this.stream?.heatFor(mint) ?? null;
  }

  /** Run one collection cycle now. Used by the manual trigger and the alarm. */
  async cycle(force = false): Promise<CycleResult | null> {
    if (this.cycling) return this.lastCycle;
    this.cycling = true;
    try {
      const stream = await this.ensureStream();
      this.lastCycle = await collectCycle(stream);
      await periodicJobs(stream, force);
      this.lastError = null;
    } catch (err) {
      this.lastError = (err as Error).message;
      log.error(`cycle failed: ${(err as Error).stack ?? err}`);
    } finally {
      this.cycling = false;
    }
    return this.lastCycle;
  }

  async alarm(): Promise<void> {
    await this.cycle();
    await this.ctx.storage.setAlarm(Date.now() + CYCLE_MS);
  }
}
