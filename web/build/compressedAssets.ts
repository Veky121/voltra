import {brotliCompressSync, constants, gzipSync} from 'node:zlib';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Plugin} from 'vite';

export function compressedAssets(): Plugin {
  return {
    name: 'voltra-compressed-assets',
    apply: 'build',
    async writeBundle(options, bundle) {
      if (!options.dir) return;
      // Vite rewrites dynamic-import preload markers in generateBundle. Compress
      // final files after those rewrites, so compressed and identity bytes always
      // agree. The panel serves .br when the browser accepts it, otherwise .gz.
      const directory = options.dir;
      await Promise.all(
        Object.keys(bundle)
          .filter(name => /\.(js|css)$/.test(name))
          .map(async name => {
            const path = join(directory, name);
            const raw = await readFile(path);
            await Promise.all([
              writeFile(`${path}.gz`, gzipSync(raw, {level: 9})),
              writeFile(
                `${path}.br`,
                brotliCompressSync(raw, {
                  params: {
                    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                    [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                    [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
                  },
                })
              ),
            ]);
          })
      );
    },
  };
}
