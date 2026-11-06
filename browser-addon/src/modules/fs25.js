export function validateMod(mod) {
  const url = new URL(mod.url);
  const source = new URL(mod.source);
  if (mod.module !== 'fs25' || mod.gameVersion !== '25' ||
      source.origin !== 'https://www.farming-simulator.com' || source.pathname !== '/mod.php' ||
      !/^\d+$/.test(source.searchParams.get('mod_id') || '') ||
      url.protocol !== 'https:' || !/^cdn\d*\.giants-software\.com$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash ||
      !/^\/modHub\/storage\/\d+\/FS25_[A-Za-z0-9_.-]+\.zip$/.test(url.pathname) ||
      !/^FS25_[A-Za-z0-9_.-]+\.zip$/.test(mod.filename) ||
      url.pathname.split('/').pop() !== mod.filename) throw new Error('unsupported-mod');
  return {module: 'fs25', gameVersion: '25', source: source.href, url: url.href,
    filename: mod.filename, title: String(mod.title || mod.filename).slice(0, 200),
    modVersion: String(mod.modVersion || 'Unknown').slice(0, 40)};
}

export function readMod(document, address) {
  const fields = {};
  for (const row of document.querySelectorAll('.table-game-info .table-row')) {
    const cells = row.querySelectorAll('.table-cell');
    if (cells.length === 2) fields[cells[0].textContent.trim().toLowerCase()] = cells[1].textContent.trim();
  }
  if (fields.game !== 'Farming Simulator 25') return null;
  const link = [...document.querySelectorAll('.download-box a[href]')].find(a => /\.zip(?:$|\?)/i.test(a.href));
  if (!link) return null;
  try {
    return validateMod({module: 'fs25', gameVersion: '25', source: address, url: link.href,
      filename: fields.filename, modVersion: fields.version, title: document.querySelector('h1,h2')?.textContent.trim()});
  } catch { return null; }
}

export function matchTargets(mod, targets) {
  return targets.filter(target => target.module === mod.module && target.game_version === mod.gameVersion);
}

export function serverTarget(server, permissions = []) {
  if (!server?.egg_features?.includes('voltra_fs25')) return null;
  const can = permission => permissions.includes('*') || permissions.includes(permission);
  return {uuid: server.uuid, name: server.name, module: 'fs25', game_version: '25',
    can_install: can('file.read') && can('file.create'),
    unavailable: !!(server.is_installing || server.is_suspended || server.is_transferring || server.is_node_under_maintenance || server.status && server.status !== 'reinstall_failed')};
}

export const fs25 = {id: 'fs25', directory: '/data/mods', readMod, validateMod, matchTargets, serverTarget};
