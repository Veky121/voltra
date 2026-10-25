import {validatePrivateOriginal, type SteamOriginalControls, type SteamOriginalField} from './privateSteamTemplateModel.ts';
export type PrivateGuard = {challenge_id: string; kind: string; expires_at: string; code_controls?: SteamOriginalField[]};

export function privateGuardUsable(guard: PrivateGuard | undefined, now = Date.now()): boolean {
  return !!guard && !!guard.challenge_id && ['device_code', 'email_code', 'device_confirmation'].includes(guard.kind) && Date.parse(guard.expires_at) > now;
}

export function privateGuardReply(guard: PrivateGuard, reply: {code?: string; accepted?: boolean}, now = Date.now()) {
  if (!privateGuardUsable(guard, now)) throw new Error('This Steam Guard challenge expired. Wait for a new challenge or create a new job.');
  if (guard.kind === 'device_confirmation') {
    if (typeof reply.accepted !== 'boolean' || reply.code !== undefined) throw new Error('Confirm or decline the Steam sign-in.');
    return {challenge_id: guard.challenge_id, kind: guard.kind, accepted: reply.accepted};
  }
  if (!reply.code || reply.accepted !== undefined) throw new Error('Enter the Steam Guard code.');
  validatePrivateOriginal(reply.code, guard.code_controls);
  return {challenge_id: guard.challenge_id, kind: guard.kind, code: reply.code};
}

export function privateAuthorizationBody(username: string, savePassword: boolean, password: string, controls?: SteamOriginalControls) {
  if (!username) throw new Error('Enter the Steam account name.');
  if (savePassword && !password) throw new Error('Enter the password to save.');
  validatePrivateOriginal(username, controls?.username);
  if (savePassword) validatePrivateOriginal(password, controls?.password);
  return {username, save_password: savePassword, ...(savePassword ? {password} : {})};
}
