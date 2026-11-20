// Wings messages retain their upstream event names; branding belongs to the panel.
export function stripConsoleControls(text: string, preserveColor = false): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, code => (preserveColor && /^\x1b\[[\d;]*m$/.test(code) ? code : ''));
}

// Egg "done" markers (VOLTRA_READY, VOLTRA_ARK_READY ...). Eggs print them on a
// line of their own so Wings can detect startup; they are not game output.
const readinessMarker = /^(?:VOLTRA|PTEROCLONE)(?:_[A-Z0-9]+)*_READY(?:\s.*)?$/;
// The image entrypoint echoes its startup command behind a shell prompt. The
// command line can include passwords and is not game output.
const promptEcho = /^(?:container@(?:pterodactyl|voltra)~(?:\s|$)|:\/home\/container\$\s)/;
// Console capture bookkeeping written by the panel. State changes and capture
// gaps stay visible; these two only describe the panel's own housekeeping.
const captureMarker =
  /^\[Voltra\]:\s*(?:Console history capture connected\.|New run\. Keeping up to \d+ lines from the previous output\.)/;

/** True for lines the panel or daemon injects for itself. Never matches game output. */
export function isInternalConsoleLine(plain: string, event: string): boolean {
  const line = plain.trim();
  if (event === 'console output') return readinessMarker.test(line) || promptEcho.test(plain.trimStart());
  if (event === 'panel message') return captureMarker.test(line);
  return false;
}

export function consoleOutput(text: string, event: string, preserveColor = false): string {
  const clean = stripConsoleControls(text, preserveColor);
  return clean
    .split(/\r\n|[\r\n]/)
    .filter(line => !isInternalConsoleLine(stripConsoleControls(line), event))
    .map(line => {
      const branded = line.replace(/^((?:\x1b\[[\d;]*m)*)\[(?:Pterodactyl Daemon|Voltra Daemon)\]/, '$1[Voltra]');
      if (
        event === 'daemon message' &&
        stripConsoleControls(branded) &&
        !stripConsoleControls(branded).startsWith('[Voltra]')
      ) {
        return `[Voltra] ${branded}`;
      }
      return branded;
    })
    .join('\n');
}
