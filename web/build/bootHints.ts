import type {IndexHtmlTransformContext, Plugin} from 'vite';

type Chunk = {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: string[];
  viteMetadata?: {importedCss: Set<string>};
};
type Bundle = NonNullable<IndexHtmlTransformContext['bundle']>;

const isChunk = (output: Bundle[string]): output is Bundle[string] & Chunk => output.type === 'chunk';

function chunks(bundle: Bundle, start: string[]): Chunk[] {
  const seen = new Map<string, Chunk>();
  const queue = [...start];
  while (queue.length) {
    const name = queue.pop()!;
    const output = bundle[name];
    if (seen.has(name) || !output || !isChunk(output)) continue;
    seen.set(name, output);
    queue.push(...output.imports);
  }
  return [...seen.values()];
}

/** The modules and styles the named lazy routes need that the entry does not already load. */
export function firstPageFiles(bundle: Bundle, routes: string[], base = '/'): string[] {
  const all = Object.values(bundle).filter(isChunk);
  const loaded = chunks(
    bundle,
    all.filter(chunk => chunk.isEntry).map(chunk => chunk.fileName)
  );
  const known = new Set(loaded.flatMap(chunk => [chunk.fileName, ...(chunk.viteMetadata?.importedCss ?? [])]));
  const files: string[] = [];
  for (const route of routes) {
    const facade = all.find(chunk => chunk.facadeModuleId?.replaceAll('\\', '/').endsWith(route));
    if (!facade) continue;
    for (const chunk of chunks(bundle, [facade.fileName])) {
      for (const file of [chunk.fileName, ...(chunk.viteMetadata?.importedCss ?? [])]) {
        if (known.has(file)) continue;
        known.add(file);
        files.push(base + file);
      }
    }
  }
  return files;
}

/**
 * Lazy routes are only discovered once the entry has run, one level at a time.
 * The build lists the first page's files in the document; public/startup.js
 * turns the list into preload hints, except where that page is not used. The
 * desktop build is also marked so startup.js can tell it apart: there the host
 * reads the panel at launch, and the page starts no reads of its own.
 */
export function bootHints({desktop, routes}: {desktop: boolean; routes: string[]}): Plugin {
  let base = '/';
  return {
    name: 'voltra-boot-hints',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const files = context.bundle ? firstPageFiles(context.bundle, routes, base) : [];
        return {
          html: desktop ? html.replace('<html', '<html data-voltra-desktop') : html,
          tags: files.length
            ? [{tag: 'meta', attrs: {name: 'voltra-first-page', content: files.join(' ')}, injectTo: 'head'}]
            : [],
        };
      },
    },
  };
}
