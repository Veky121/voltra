import {readdir, stat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {Logger, Plugin} from 'vite';

// The build keeps earlier hashed files (emptyOutDir is off) because an open tab
// can still lazy-load chunks of the build it was loaded from. Without pruning
// they pile up forever (about 9,500 files in November 2026).
//
// A file is removed once it has been out of use for the retention window. It
// went out of use when a later build was published without it. Every build
// rewrites all of its own files, so a file's modification time is the last
// build that still contained it, and the next later modification time in the
// directory is the build that replaced it. No record file is needed, and a
// file from a build that stayed current for a month still gets the full
// window after it was replaced.
//
// Seven days covers tabs left open over a weekend or a holiday week. A tab
// open longer than that across an update gets a clean 404 for a missing chunk
// (serveWeb never answers /assets/ with the page shell) and must be reloaded.
export const assetRetentionMs = 7 * 24 * 60 * 60 * 1000;
// Files written by one build are a few seconds apart; builds are further apart.
export const sameBuildMs = 10 * 60 * 1000;

export type AssetFile = {name: string; mtimeMs: number};

// expiredAssets lists the files to delete. Files of the current build are
// never listed, whatever their times.
export function expiredAssets(
  files: AssetFile[],
  current: ReadonlySet<string>,
  now: number,
  retentionMs = assetRetentionMs
): string[] {
  const times = [...files.map(file => file.mtimeMs), now].sort((a, b) => a - b);
  // The first build time after the build that last wrote mtimeMs.
  const replacedAt = (mtimeMs: number) => {
    let low = 0,
      high = times.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (times[mid] <= mtimeMs + sameBuildMs) low = mid + 1;
      else high = mid;
    }
    return low < times.length ? times[low] : Infinity;
  };
  return files
    .filter(file => !current.has(file.name) && now - replacedAt(file.mtimeMs) >= retentionMs)
    .map(file => file.name);
}

export function pruneAssets({retentionMs = assetRetentionMs}: {retentionMs?: number} = {}): Plugin {
  let logger: Logger | undefined;
  let directory: string | undefined;
  let current = new Set<string>();
  return {
    name: 'voltra-prune-assets',
    apply: 'build',
    configResolved(config) {
      logger = config.logger;
    },
    writeBundle(options, bundle) {
      if (!options.dir) return;
      directory = join(options.dir, 'assets');
      // Compressed copies are written beside each file by compressedAssets.
      current = new Set(
        Object.keys(bundle)
          .filter(name => name.startsWith('assets/') && !name.slice(7).includes('/'))
          .flatMap(name => {
            const base = name.slice(7);
            return [base, `${base}.gz`, `${base}.br`];
          })
      );
    },
    // closeBundle runs after every writeBundle hook, so compressed copies of
    // this build exist by now. It only touches plain files directly inside
    // <outDir>/assets.
    async closeBundle() {
      if (!directory || !current.size) return;
      const files: AssetFile[] = [];
      for (const entry of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
        if (!entry.isFile()) continue;
        const info = await stat(join(directory, entry.name)).catch(() => undefined);
        if (info) files.push({name: entry.name, mtimeMs: info.mtimeMs});
      }
      const expired = expiredAssets(files, current, Date.now(), retentionMs);
      await Promise.all(expired.map(name => unlink(join(directory!, name)).catch(() => undefined)));
      if (expired.length)
        logger?.info(
          `Removed ${expired.length} build files replaced more than ${Math.round(retentionMs / 86400000)} days ago from ${directory}.`
        );
    },
  };
}
