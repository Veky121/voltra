import {formatConsoleBatch, type ConsoleStyle, type FormattedConsoleLine} from './consoleFormatting.ts';

export const CONSOLE_HISTORY_LINES = 100_000;
// UTF-16 text budget, separate from the browser's rendering overhead.
export const CONSOLE_HISTORY_CHARACTERS = 16 * 1024 * 1024;
const CHUNK_LINES = 500;
export type ConsoleHistoryLine = {id: number; text: string; formatted: FormattedConsoleLine};
export type ConsoleHistoryChunk = {id: number; lines: ConsoleHistoryLine[]};
export type ConsoleHistory = {chunks: ConsoleHistoryChunk[]; count: number; characters: number; nextID: number; endStyle: ConsoleStyle};
export function emptyConsoleHistory(): ConsoleHistory {
  return {chunks: [], count: 0, characters: 0, nextID: 0, endStyle: {}};
}
export function appendConsoleHistory(history: ConsoleHistory, incoming: string[]): ConsoleHistory {
  if (!incoming.length) return history;
  const parsed = formatConsoleBatch(incoming, history.endStyle);
  const chunks = history.chunks.slice();
  let count = history.count, characters = history.characters, nextID = history.nextID;
  let tail = chunks.at(-1);
  if (tail && tail.lines.length < CHUNK_LINES) {
    tail = {...tail, lines: tail.lines.slice()}; chunks[chunks.length - 1] = tail;
  }
  for (let i = 0; i < incoming.length; i++) {
    if (!tail || tail.lines.length >= CHUNK_LINES) {tail = {id: nextID, lines: []}; chunks.push(tail);}
    const text = incoming[i];
    tail.lines.push({id: nextID++, text, formatted: parsed.lines[i]});
    characters += text.length + 1; count++;
  }
  let removeChunks = 0;
  while (count > CONSOLE_HISTORY_LINES || characters > CONSOLE_HISTORY_CHARACTERS) {
    const chunk = chunks[removeChunks];
    let removed = 0;
    while (removed < chunk.lines.length && (count > CONSOLE_HISTORY_LINES || characters > CONSOLE_HISTORY_CHARACTERS)) {
      characters -= chunk.lines[removed++].text.length + 1; count--;
    }
    if (removed === chunk.lines.length) removeChunks++;
    else {chunks[removeChunks] = {...chunk, lines: chunk.lines.slice(removed)}; break;}
  }
  return {chunks: chunks.slice(removeChunks), count, characters, nextID, endStyle: parsed.endStyle};
}
export function consoleHistoryText(history: ConsoleHistory): string {
  return history.chunks.flatMap(chunk => chunk.lines.map(line => line.text)).join('\n');
}
