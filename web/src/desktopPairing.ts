export function desktopPairingString(panel:string,code:string):string {
  return `voltra://connect?panel=${encodeURIComponent(panel)}&code=${encodeURIComponent(code)}`;
}

export function parseDesktopPairing(input:string):{panel_url:string;code:string} {
  const invalid=()=>new Error('Paste the full connection string from Account > Desktop apps.');
  let link:URL;
  try {link=new URL(input.trim());} catch {throw invalid();}
  if(link.protocol!=='voltra:'||link.hostname!=='connect'||link.username||link.password||link.port||link.hash||(link.pathname&&link.pathname!=='/'))throw invalid();
  const panel=link.searchParams.get('panel'),code=link.searchParams.get('code');
  if(!panel||!code||link.searchParams.getAll('panel').length!==1||link.searchParams.getAll('code').length!==1)throw invalid();
  let address:URL;
  try {address=new URL(panel);} catch {throw invalid();}
  if(!['http:','https:'].includes(address.protocol)||address.username||address.password||address.search||address.hash)throw invalid();
  return {panel_url:panel,code};
}
