// Wings messages retain their upstream event names; branding belongs to the panel.
export function stripConsoleControls(text: string, preserveColor = false): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, code => preserveColor && /^\x1b\[[\d;]*m$/.test(code) ? code : '');
}

export function consoleOutput(text: string, event: string, preserveColor = false): string {
  const clean = stripConsoleControls(text, preserveColor);
  return clean.split(/\r?\n/).filter(line => {
    // Only hide our demo process signal. Wings already consumes it before the UI.
    return event !== 'console output' || !/^(?:VOLTRA|PTEROCLONE)_READY$/.test(stripConsoleControls(line).trim());
  }).map(line => {
    const branded = line.replace(/^((?:\x1b\[[\d;]*m)*)container@pterodactyl~/, '$1container@voltra~').replace(/^((?:\x1b\[[\d;]*m)*)\[(?:Pterodactyl Daemon|Voltra Daemon)\]/, '$1[Voltra]');
    if (event === 'daemon message' && stripConsoleControls(branded) && !stripConsoleControls(branded).startsWith('[Voltra]')) {
      return `[Voltra] ${branded}`;
    }
    return branded;
  }).join('\n');
}
