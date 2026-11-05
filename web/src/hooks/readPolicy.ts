// Read policy only. Mutations, signed URLs and file bytes always remain HTTP.
// Editing/secret reads stay on demand so background updates cannot overwrite drafts.
export function readPolicy(path:string):{domains:string[];reconcileMs:number}|null {
  let url:URL;try{url=new URL(path,'http://panel.local')}catch{return null}
  const p=url.pathname;
  if(!/^\/api\/(client|admin|application)(?:\/|$)/.test(p))return null;
  if(/\/(?:events|ws|websocket|contents|download|download-stream|preview|upload|password|credentials|token|pair|pairings|sftp-password|licences|api-keys|ssh-keys|node-installer|export|artwork|config)(?:\/|$)/.test(p)||/password|token|secret/i.test(url.search))return null;
  if(/\/(?:startup|configuration|game-settings|quick-setup)(?:\/|$)/.test(p)||/^\/api\/client\/account(?:\/(?!activity)[^/]*)?$/.test(p)||/\/servers\/[^/]+\/java$/.test(p))return null;
  if(/^\/api\/(?:admin|application)\/[^/]+\/[^/]+$/.test(p))return null;
  if(/\/servers\/[^/]+\/settings(?:\/|$)/.test(p))return null;
  if(/^\/api\/admin\/(?:settings|integrations)(?:\/|$)/.test(p))return null;
  if(/^\/api\/client\/?$/.test(p))return {domains:['servers','access','navigation'],reconcileMs:60000};
  const families:[RegExp,string][]=[
    [/\/backups(?:\/|$)/,'backups'],[/\/schedules(?:\/|$)/,'schedules'],
    [/\/files\//,'files'],[/\/steam(?:\/|$)/,'steam'],[/\/activity(?:\/|$)/,'activity'],
    [/\/(?:users|subusers|permissions)(?:\/|$)/,'access'],
    [/\/(?:network|allocations|proxy|proxy-routes|proxy-gateways|subdomain)(?:\/|$)/,'network'],
    [/\/(?:databases|database-hosts)(?:\/|$)/,'databases'],
    [/\/(?:nodes|locations|node-enrollments)(?:\/|$)/,'nodes'],
    [/\/(?:game-library|eggs|nests|minecraft|java)(?:\/|$)/,'catalog'],
    [/\/(?:settings|integrations)(?:\/|$)/,'settings'],
    [/\/(?:servers|mounts)(?:\/|$)/,'servers'],
  ];
  for(const [pattern,domain] of families)if(pattern.test(p))return {domains:[domain,'access','servers'],reconcileMs:domain==='files'?15000:60000};
  return {domains:['all'],reconcileMs:60000};
}

export function matchesReadChange(path:string,domains:readonly string[]):boolean {
  const policy=readPolicy(path);
  return !!policy&&(domains.includes('all')||policy.domains.includes('all')||domains.some(domain=>policy.domains.includes(domain)));
}
