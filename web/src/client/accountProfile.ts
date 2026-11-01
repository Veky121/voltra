type AccountIdentity={nickname?:string;email?:string;username?:string};

export function accountNickname(account:AccountIdentity):string{
  for(const value of [account.nickname,account.username]){
    const name=value?.trim();
    if(name&&!name.includes('@'))return name;
  }
  return 'User';
}
