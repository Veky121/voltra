export type ConsoleStyle = {
  color?: string; backgroundColor?: string; fontWeight?: number; opacity?: number;
  fontStyle?: 'italic'; textDecoration?: string;
};
export type ConsoleSegment = {text: string; style: ConsoleStyle};
export type ConsoleLevel = 'error' | 'warning' | 'debug' | 'info' | 'success' | 'daemon' | 'normal';

const palette = ['#8b90a0','#ff808e','#86dba0','#f4cf83','#89b4ff','#d6a1ed','#80d4df','#e5e7ef',
  '#a0a4b3','#ff9ca7','#a3edb9','#ffe2a3','#accbff','#e5bdf7','#a5e7ed','#ffffff'];
function ansiColor(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 255) return;
  if (value < 16) return palette[value];
  if (value >= 232) { const gray = 8 + (value - 232) * 10; return `rgb(${gray}, ${gray}, ${gray})`; }
  const cube = value - 16, channel = (v: number) => v === 0 ? 0 : 55 + v * 40;
  return `rgb(${channel(Math.floor(cube / 36))}, ${channel(Math.floor(cube / 6) % 6)}, ${channel(cube % 6)})`;
}

// Read severity from log prefixes, rather than matching words in player chat/messages.
export function detectConsoleLevel(text: string): ConsoleLevel {
  try {
    if (text.trimStart().startsWith('{')) {
      const record = JSON.parse(text);
      const level = severity(String(record.level ?? record.severity ?? record.lvl ?? ''));
      if (level) return level;
    }
  } catch { /* Regular text logs are expected. */ }
  const prefix = text.match(/^(?:(?:\d{4}-\d\d-\d\d[T ][\d:.]+Z?\s*)|(?:\d\d:\d\d:\d\d(?:\.\d+)?\s*)|(?:\[[^\]\r\n]{1,100}\]\s*)){0,6}/)?.[0] ?? '';
  const tokens = prefix.match(/\b(?:FATAL|SEVERE|CRITICAL|ERROR|ERR|WARNING|WARN|DEBUG|TRACE|INFO)\b/gi);
  const body = text.slice(prefix.length).replace(/^:\s*/, '');
  const direct = body.match(/^(?:Log[\w]+:\s*)?(FATAL|SEVERE|CRITICAL|ERROR|ERR|WARNING|WARN|DEBUG|TRACE|INFO)(?=\s|:|\[|$)/i);
  const level = severity(direct?.[1] ?? tokens?.at(-1) ?? '');
  if (level && level !== 'info') return level;
  if (/^(?:Done \([\d.]+s\)!|Server (?:is )?(?:ready|started|listening)\b|Game server (?:connected|initialized)\b|Listening on\b)/i.test(body)) return 'success';
  if (level) return level;
  return text.startsWith('[Voltra]') ? 'daemon' : 'normal';
}
function severity(value: string): ConsoleLevel | undefined {
  if (/^(?:fatal|severe|critical|error|err)$/i.test(value)) return 'error';
  if (/^warn(?:ing)?$/i.test(value)) return 'warning';
  if (/^(?:debug|trace)$/i.test(value)) return 'debug';
  if (/^info$/i.test(value)) return 'info';
}

export function formatConsoleLines(lines: string[]): {level: ConsoleLevel; segments: ConsoleSegment[]}[] {
  let style: ConsoleStyle = {};
  return lines.map(line => {
    const segments: ConsoleSegment[] = [];
    let position = 0;
    for (const match of line.matchAll(/\x1b\[([\d;]*)m/g)) {
      if (match.index > position) segments.push({text: line.slice(position, match.index), style: {...style}});
      const codes = match[1] === '' ? [0] : match[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) style = {};
        else if (code === 1) style.fontWeight = 700;
        else if (code === 2) style.opacity = .75;
        else if (code === 3) style.fontStyle = 'italic';
        else if (code === 4) style.textDecoration = 'underline';
        else if (code === 9) style.textDecoration = 'line-through';
        else if (code === 22) { delete style.fontWeight; delete style.opacity; }
        else if (code === 23) delete style.fontStyle;
        else if (code === 24 || code === 29) delete style.textDecoration;
        else if (code === 39) delete style.color;
        else if (code === 49) delete style.backgroundColor;
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) style.color = palette[code < 90 ? code - 30 : code - 90 + 8];
        else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) style.backgroundColor = palette[code < 100 ? code - 40 : code - 100 + 8];
        else if (code === 38 || code === 48) {
          const key = code === 38 ? 'color' : 'backgroundColor';
          if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
            const color = ansiColor(codes[i + 2]); if (color) style[key] = color; i += 2;
          } else if (codes[i + 1] === 2 && codes.length > i + 4) {
            const rgb = codes.slice(i + 2, i + 5);
            if (rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) style[key] = `rgb(${rgb.join(', ')})`;
            i += 4;
          }
        }
      }
      position = match.index + match[0].length;
    }
    if (position < line.length) segments.push({text: line.slice(position), style: {...style}});
    return {level: detectConsoleLevel(segments.map(s => s.text).join('')), segments};
  });
}
