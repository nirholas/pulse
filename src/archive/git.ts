// The archive lives in a plain git working tree. Auth is passed per command as
// an http header so the token is never written into .git/config or the remote URL.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../lib/log.ts';

const run = promisify(execFile);
const log = logger('archive-git');

export type GitTarget = { dir: string; repo: string; token: string; branch: string };

function authArgs(t: GitTarget): string[] {
  if (!t.token || !/^https:\/\/github\.com\//.test(t.repo)) return [];
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${Buffer.from(`x-access-token:${t.token}`).toString('base64')}`];
}

async function git(t: GitTarget, args: string[], opts: { remote?: boolean; cwd?: string } = {}): Promise<string> {
  const full = [...(opts.remote ? authArgs(t) : []), ...args];
  try {
    const { stdout } = await run('git', full, { cwd: opts.cwd ?? t.dir, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    // Never echo the auth header into logs.
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message).replace(/Authorization: Basic \S+/g, 'Authorization: ***').trim()}`);
  }
}

/** Clone the archive repo on first use, otherwise fast-forward it. An empty remote is fine. */
export async function openArchive(t: GitTarget): Promise<void> {
  if (!existsSync(join(t.dir, '.git'))) {
    mkdirSync(t.dir, { recursive: true });
    await git(t, ['clone', '--quiet', t.repo, t.dir], { remote: true, cwd: process.cwd() });
    log.info(`cloned ${t.repo.replace(/^https:\/\/[^@/]+@/, 'https://')}`);
  }
  await git(t, ['config', 'user.name', 'pulse-archive']);
  await git(t, ['config', 'user.email', 'pulse-archive@users.noreply.github.com']);
  const remoteHasBranch = (await git(t, ['ls-remote', '--heads', 'origin', t.branch], { remote: true })).length > 0;
  if (remoteHasBranch) {
    await git(t, ['fetch', '--quiet', 'origin', t.branch], { remote: true });
    await git(t, ['checkout', '--quiet', '-B', t.branch, `origin/${t.branch}`]);
  } else {
    await git(t, ['checkout', '--quiet', '-B', t.branch]);
  }
}

/** Commit everything under the tree. Returns false when nothing changed. */
export async function commitAll(t: GitTarget, message: string): Promise<boolean> {
  await git(t, ['add', '-A']);
  if (!(await git(t, ['status', '--porcelain'])).length) return false;
  await git(t, ['commit', '--quiet', '-m', message]);
  return true;
}

/** Push, rebasing once if another writer got there first. */
export async function pushArchive(t: GitTarget): Promise<void> {
  try {
    await git(t, ['push', '--quiet', 'origin', `HEAD:${t.branch}`], { remote: true });
  } catch (err) {
    log.warn(`push rejected, rebasing: ${(err as Error).message}`);
    await git(t, ['pull', '--quiet', '--rebase', 'origin', t.branch], { remote: true });
    await git(t, ['push', '--quiet', 'origin', `HEAD:${t.branch}`], { remote: true });
  }
}
