// Worker replacement for src/lib/env.ts. The shared source clients read
// `config.*` at call time, so one mutable object filled from the Worker's
// bindings at the start of every invocation keeps them untouched.
export interface Env {
  DB: D1Database;
  ARCHIVE: R2Bucket;
  ASSETS: Fetcher;
  FIREHOSE: DurableObjectNamespace;
  PUBLIC_URL?: string;
  REPORT_TIMEZONE?: string;
  REPORT_HOUR?: string;
  SOLANA_RPC_URLS?: string;
  SOLANA_WS_URLS?: string;
  ROBINHOOD_RPC_URLS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  HELIUS_API_KEY?: string;
  ADMIN_TOKEN?: string;
  [key: string]: unknown;
}

const list = (v: unknown, fallback: string[]) => (typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

export const config = {
  databaseUrl: '',
  pgliteDir: '',
  port: 0,
  publicUrl: '',
  timezone: 'UTC',
  reportHour: 13,
  snapshotEveryMin: 5,
  solanaRpcHttp: ['https://api.mainnet-beta.solana.com'],
  solanaRpcWs: ['wss://api.mainnet-beta.solana.com'],
  robinhoodRpc: ['https://rpc.mainnet.chain.robinhood.com'],
  telegramBotToken: '',
  telegramChatId: '',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-5-5',
  streams: true,
};

/** Apply the Worker's vars and secrets. Cheap, idempotent, called on every entry point. */
export function applyEnv(env: Env): void {
  config.publicUrl = str(env.PUBLIC_URL);
  config.timezone = str(env.REPORT_TIMEZONE, 'UTC');
  config.reportHour = Math.min(23, Math.max(0, Number(str(env.REPORT_HOUR, '13')) || 0));
  config.solanaRpcHttp = list(env.SOLANA_RPC_URLS, ['https://api.mainnet-beta.solana.com']);
  config.solanaRpcWs = list(env.SOLANA_WS_URLS, ['wss://api.mainnet-beta.solana.com']);
  config.robinhoodRpc = list(env.ROBINHOOD_RPC_URLS, ['https://rpc.mainnet.chain.robinhood.com']);
  config.telegramBotToken = str(env.TELEGRAM_BOT_TOKEN);
  config.telegramChatId = str(env.TELEGRAM_CHAT_ID);
  config.anthropicApiKey = str(env.ANTHROPIC_API_KEY);
  config.anthropicModel = str(env.ANTHROPIC_MODEL, 'claude-sonnet-5-5');
}

export type Config = typeof config;
