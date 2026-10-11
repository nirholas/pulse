// `npm run archive` exports every finished UTC day the repo is missing and pushes.
//   npm run archive                       catch up through yesterday
//   npm run archive -- --day 2026-10-10   re-export one day (then commit and push)
//   npm run archive -- --no-push          commit locally only
//   npm run archive:restore -- --from <dir>   load an archive tree into the database
import { config } from '../lib/env.ts';
import { logger } from '../lib/log.ts';
import { migrate } from '../db/migrate.ts';
import { db } from '../db/client.ts';
import { archivePending } from './archive.ts';
import { restoreArchive } from './restore.ts';

const log = logger('archive-cli');
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

try {
  await migrate();
  if (argv.includes('--restore')) {
    const from = flag('from') ?? config.archiveDir;
    log.info(`restored: ${JSON.stringify(await restoreArchive(from))}`);
  } else {
    const day = flag('day');
    const res = await archivePending({ days: day ? [day] : undefined, push: !argv.includes('--no-push'), brief: !argv.includes('--no-brief') });
    log.info(`done: ${JSON.stringify(res)}`);
  }
  await (await db()).close();
} catch (err) {
  log.error((err as Error).message);
  process.exit(1);
}
