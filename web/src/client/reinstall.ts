type Backup = {uuid: string; completed_at?: string | null; is_successful?: boolean};
type Dependencies = {
  createBackup: (name: string) => Promise<Backup>;
  readBackup: (uuid: string) => Promise<Backup>;
  reinstall: (backupUUID?: string) => Promise<unknown>;
  wait: () => Promise<void>;
  signal: AbortSignal;
  stage: (text: string) => void;
};
export function reinstallBackupName(now = new Date()): string {
  return `Reinstall Backup - ${now.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
export async function reinstallWithBackup(enabled: boolean, deps: Dependencies) {
  const check = () => {if (deps.signal.aborted) throw new Error('Reinstall cancelled. Any backup already started remains in Backups.');};
  check();
  let backupUUID: string | undefined;
  if (enabled) {
    deps.stage('Creating backup. Reinstall will begin after it succeeds. Keep this dialog open.');
    let backup = await deps.createBackup(reinstallBackupName());
    backupUUID = backup.uuid;
    if (!backupUUID) throw new Error('Backup did not return an ID. Reinstall was not started.');
    while (!backup.completed_at) {
      check(); await deps.wait(); check();
      backup = await deps.readBackup(backupUUID);
    }
    check();
    if (!backup.is_successful) throw new Error('Backup failed. Reinstall was not started. Check Backups before trying again.');
  }
  check();
  deps.stage('Requesting reinstall?');
  await deps.reinstall(backupUUID);
}
