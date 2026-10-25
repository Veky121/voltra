import {useEffect,useState,type CSSProperties} from 'react';
import {Button,ErrorBox,Input} from '../lib';
import {useTheme} from '../ThemeProvider';
import {defaultTheme,themeVariables,type ThemePreferences} from '../themePreferences';
import {SettingsRow,SettingsSection,Switch} from '../ui/Settings';

const presets=[{name:'Soft capsule',theme:defaultTheme},{name:'Coral tide',theme:{...defaultTheme,backgroundA:'#251e28',backgroundB:'#171c25',accentA:'#ac5363',accentB:'#366c7c'}},{name:'Iris dusk',theme:{...defaultTheme,backgroundA:'#211e32',backgroundB:'#151b27',accentA:'#735bb7',accentB:'#3a6e9d'}}];
export default function Appearance(){
 const {saved,preview,save,ready,error,reload}=useTheme();
 const [draft,setDraft]=useState(saved),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[saveError,setSaveError]=useState('');
 useEffect(()=>{setDraft(saved)},[saved]);
 useEffect(()=>{preview(draft);return()=>preview(null)},[draft,preview]);
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
 function choose(theme:ThemePreferences){setDraft({...theme});setMessage('');setSaveError('')}
 function update<K extends keyof ThemePreferences>(key:K,value:ThemePreferences[K]){setDraft(v=>({...v,[key]:value}));setMessage('');setSaveError('')}
 async function submit(){setBusy(true);setMessage('');setSaveError('');try{await save(draft);setMessage('Saved')}catch(e){setSaveError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 function colors(first:'backgroundA'|'accentA',second:'backgroundB'|'accentB',gradient:'backgroundGradient'|'accentGradient',label:string){return <SettingsRow label={label} control={<div className="appearance-setting-controls"><div className="appearance-swatches">{[first,second].map((key,i)=><Input key={key} type="color" aria-label={`${label} ${i+1}`} title={`${label} ${i+1}: ${draft[key]}`} value={draft[key]} disabled={busy||!ready} onChange={e=>update(key,e.target.value)}/>)}</div><label className="appearance-gradient"><span>Gradient</span><Switch aria-label={`${label} gradient`} checked={draft[gradient]} disabled={busy||!ready} onCheckedChange={checked => update(gradient,checked)}/></label></div>}/>}
 return <section className="appearance-settings" aria-label="Appearance">
  <SettingsSection title="Themes" plain>
  <div className="appearance-presets" aria-label="Theme presets">{presets.map(p=>{const selected=JSON.stringify(draft)===JSON.stringify(p.theme);return <button key={p.name} className="secondary appearance-preset" aria-pressed={selected} disabled={busy||!ready} onClick={()=>choose(p.theme)}><span className="appearance-preset-art" aria-hidden="true" style={{'--preset-bg-a':p.theme.backgroundA,'--preset-bg-b':p.theme.backgroundB,'--preset-accent-a':p.theme.accentA,'--preset-accent-b':p.theme.accentB} as CSSProperties}><span className="appearance-orb appearance-orb-background"/><span className="appearance-orb appearance-orb-accent"/></span><span className="appearance-preset-name">{p.name}<span className="appearance-preset-check" aria-hidden="true">{selected?'✓':''}</span></span></button>})}</div>
  </SettingsSection>
  <SettingsSection title="Colors" action={<button className="appearance-reset" disabled={busy||!ready} onClick={()=>choose(defaultTheme)}>Reset</button>}>{colors('backgroundA','backgroundB','backgroundGradient','Background')}{colors('accentA','accentB','accentGradient','Accent')}</SettingsSection>
  <SettingsSection title="Card surfaces">
   <SettingsRow label="Frosted glass" description="Use translucent cards throughout the panel. Console output and editors stay darker for readability." control={<Switch aria-label="Frosted glass cards" checked={draft.glassCards} disabled={busy||!ready} onCheckedChange={checked=>update('glassCards',checked)}/>}/>
   <SettingsRow label="Card opacity" description="Lower values reveal more of your background. Saved for this account on this device." control={<div className="appearance-opacity"><Input type="range" aria-label="Card opacity" min={35} max={100} step={1} value={draft.cardOpacity} disabled={busy||!ready||!draft.glassCards} onChange={e=>update('cardOpacity',Number(e.target.value))}/><output>{draft.cardOpacity}%</output></div>}/>
  </SettingsSection>
  <SettingsSection title="Preview" plain>
  <div className="appearance-live-preview" role="img" aria-label="Sample sidebar, resource cards and primary button" style={themeVariables(draft) as CSSProperties}>
   <div className="appearance-preview-rail" aria-hidden="true"><span className="appearance-preview-brand">V</span><span className="appearance-preview-selected"/><span/><span/></div>
   <div className="appearance-preview-main"><div className="appearance-preview-metrics"><div className="appearance-preview-metric"><span>CPU</span><strong>32<small>%</small></strong><div className="appearance-preview-meter"><i style={{width:'32%'}}/></div></div><div className="appearance-preview-metric"><span>Memory</span><strong>2.4<small>GB</small></strong><div className="appearance-preview-meter"><i style={{width:'58%'}}/></div></div></div><div className="appearance-preview-bottom"><span className="appearance-preview-lines" aria-hidden="true"/><span className="appearance-preview-button">Start server</span></div></div>
  </div>
  </SettingsSection>
  <ErrorBox>{saveError||error}</ErrorBox>{error&&<Button variant="secondary" onClick={reload} disabled={busy}>Retry</Button>}
  <div className="appearance-actions">{(dirty||!!error)&&<><Button onClick={submit} disabled={busy||!ready}>{busy?'Saving…':'Save'}</Button><Button variant="secondary" onClick={()=>choose(saved)} disabled={busy}>Cancel</Button></>}<span role="status">{!ready?'Loading…':message}</span></div>
 </section>;
}
