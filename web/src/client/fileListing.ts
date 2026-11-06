export interface FileEntry {
  name: string;
  is_file: boolean;
  is_symlink?: boolean;
  size: number;
  modified_at: string;
  mode_bits?: string;
  mode?: string;
}

export type FileSort = { key: "name" | "size" | "modified_at"; direction: "asc" | "desc" } | null;

export function nextFileSort(sort: FileSort, key: NonNullable<FileSort>["key"]): FileSort {
  const first = key === "modified_at" ? "desc" : "asc";
  if (sort?.key !== key) return { key, direction: first };
  if (sort.direction === first) return { key, direction: first === "asc" ? "desc" : "asc" };
  return null;
}

export function sortFiles<T extends FileEntry>(entries: T[], sort: FileSort, sizes: Record<string, number>): T[] {
  return [...entries].sort((a, b) => {
    const name = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    if (!sort) return Number(a.is_file) - Number(b.is_file) || name;
    if (sort.key === "name") return (sort.direction === "asc" ? 1 : -1) * name;
    const left = sort.key === "size" ? (a.is_file ? a.size : sizes[a.name]) : Date.parse(a.modified_at);
    const right = sort.key === "size" ? (b.is_file ? b.size : sizes[b.name]) : Date.parse(b.modified_at);
    // Unknown folder sizes stay at the end in either direction.
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : name;
    if (!Number.isFinite(right)) return -1;
    return (sort.direction === "asc" ? 1 : -1) * (left - right) || name;
  });
}

export const filePath = (directory: string, name: string) => `${directory.replace(/\/$/, "")}/${name}`;

// Only list metadata. Never follow symlinks or read file contents.
export async function scanFolder(
  directory: string,
  list: (directory: string, signal: AbortSignal) => Promise<FileEntry[]>,
  signal: AbortSignal,
  options: { query?: string; budget?: { remaining: number } } = {},
): Promise<{ size: number; matched: boolean; skippedLinks: boolean }> {
  const budget = options.budget ?? { remaining: 2000 };
  const pending = [directory];
  let size = 0, skippedLinks = false;
  while (pending.length) {
    signal.throwIfAborted();
    if (budget.remaining-- <= 0) throw new Error("Folder scan reached the 2,000-directory limit. Open a smaller folder and try again.");
    const current = pending.pop()!;
    const entries = await list(current, signal);
    signal.throwIfAborted();
    for (const entry of entries) {
      // Reject malformed child names rather than traversing outside this tree.
      if (!entry.name || entry.name === "." || entry.name === ".." || /[/\0]/.test(entry.name)) {
        throw new Error("Folder scan received an invalid file name.");
      }
      if (entry.is_symlink) { skippedLinks = true; continue; }
      if (entry.is_file) {
        if (typeof entry.size !== "number" || !Number.isFinite(entry.size) || entry.size < 0) {
          throw new Error("A file size is unavailable. Refresh the folder and try again.");
        }
        size += entry.size;
        if (options.query && entry.name.toLocaleLowerCase().includes(options.query)) {
          return { size, matched: true, skippedLinks };
        }
      } else {
        pending.push(filePath(current, entry.name));
      }
    }
  }
  return { size, matched: false, skippedLinks };
}

export async function searchFileTree(
  root: string, query: string,
  list: (directory: string, signal: AbortSignal) => Promise<FileEntry[]>,
  signal: AbortSignal,
): Promise<{ entries: Map<string, FileEntry[]>; folders: Set<string>; errors: string[] }> {
  const entries = new Map<string, FileEntry[]>(), folders = new Set<string>(), errors: string[] = [];
  const pending = [root];
  let remaining = 2000;
  while (pending.length) {
    signal.throwIfAborted();
    if (remaining-- <= 0) { errors.push("Search reached the 2,000-folder limit. Results are incomplete."); break; }
    const current = pending.pop()!;
    let files: FileEntry[];
    try { files = await list(current, signal); }
    catch { signal.throwIfAborted(); errors.push(`Could not search ${current}. Check access and retry.`); continue; }
    signal.throwIfAborted();
    entries.set(current, files);
    for (const file of files) {
      if (!file.name || file.name === "." || file.name === ".." || /[/\0]/.test(file.name)) {
        errors.push(`Invalid entry in ${current}.`); continue;
      }
      if (file.is_symlink) continue;
      if (!file.is_file) pending.push(filePath(current, file.name));
      else if (file.name.toLocaleLowerCase().includes(query)) {
        let parent = current;
        while (parent && parent !== root) {
          folders.add(parent);
          parent = parent.slice(0, parent.lastIndexOf("/")) || "/";
        }
        folders.add(root);
      }
    }
  }
  return { entries, folders, errors };
}
