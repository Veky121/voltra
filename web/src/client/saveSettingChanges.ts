export async function saveSettingChanges(changes: {save: () => Promise<void>}[]): Promise<void> {
  for (const change of changes) await change.save();
}
