// Exact catalog identity; similarly named eggs do not acquire Cfx restrictions.
export const fiveMTemplateID = '3cd8a8bc0acd8f2f';
export function cfxSetupProblem(id:string, environment:Record<string,string>) {
 if(id!==fiveMTemplateID || environment.TXHOST_GAME_NAME!=='redm')return '';
 const value=environment.MAX_PLAYERS??'';
 return /^[+-]?\d+$/.test(value)&&Number(value)>=1&&Number(value)<=32?'':'RedM requires a capacity between 1 and 32. Choose a valid capacity explicitly.';
}
