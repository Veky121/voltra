export function uploadTarget(directory: string, relativePath: string, name: string) {
  const parts = (path: string) => path.split('/').filter(Boolean);
  const root = parts(directory);
  const relative = parts(relativePath || name);
  if ([...root, ...relative].some(p => p === '.' || p === '..' || p.includes('\0'))) throw new Error('Invalid upload path.');
  if (!name || name.includes('/') || name.includes('\0') || name === '.' || name === '..') throw new Error('Invalid filename.');
  if (relativePath && relative.at(-1) !== name) throw new Error('Upload path does not match the filename.');
  return '/' + [...root, ...relative.slice(0, -1)].join('/');
}

export function transferIdentity(base: string, directory: string, id: string) {
  return `${encodeURIComponent(base)}:${encodeURIComponent(directory)}:${id}`;
}
