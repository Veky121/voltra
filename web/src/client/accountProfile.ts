type AccountIdentity={nickname?:string;email?:string;username?:string};

export function accountNickname(account:AccountIdentity):string{
  if(account.nickname?.trim())return account.nickname.trim();
  const email=account.email||'';
  const at=email.indexOf('@');
  return at>0?email.slice(0,at):account.username||'';
}
