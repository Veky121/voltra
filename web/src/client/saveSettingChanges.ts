export async function saveSettingChanges(changes: {save: () => Promise<void>;afterSave?:()=>void}[]): Promise<void> {
  for (const change of changes) await change.save();
  // Refresh only after all writes succeed; a reload must not erase another draft.
  for (const change of changes) change.afterSave?.();
}
