import {usePendingSetting} from './PendingSettings';
import {useEffect,useState,type CSSProperties} from 'react';
import {Check,RotateCcw} from 'lucide-react';
import {Button,ErrorBox} from '../lib';
import {Button as MiraButton} from '../components/ui/button';
import {Card,CardHeader,CardTitle,CardContent} from '../components/ui/card';
import {FieldSet,FieldLegend} from '../components/ui/field';
import {Slider} from '../components/ui/slider';
import {useTheme} from '../ThemeProvider';
import {defaultTheme,themeVariables,type ThemePreferences} from '../themePreferences';
import {themePresets} from '../themePresets';
import {ColorField} from '../ui/ColorField';
import {SettingsRow,Switch} from '../ui/Settings';
import './appearance.css';

const presetStyles=themePresets.map(p=>themeVariables(p.theme) as CSSProperties);
function ThemeSample({theme,mini=false}:{theme:ThemePreferences;mini?:boolean}){
 return <div className={mini?'appearance-mini':'appearance-live-preview'} style={themeVariables(theme) as CSSProperties} aria-hidden={mini||undefined} role={mini?undefined:'img'} aria-label={mini?undefined:'Theme preview with sidebar, cards and both panel accents'}>
  <div className="appearance-sample-rail"><i/><i/><i/></div>
  <div className="appearance-sample-main"><div className="appearance-sample-accents"><span>Admin</span><span>Servers</span></div><div className="appearance-sample-cards"><div/><div/></div><div className="appearance-sample-line"/></div>
 </div>;
}
export default function Appearance(){
 const {saved,preview,save,ready,error,reload}=useTheme();
 const [draft,setDraft]=useState(saved),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[saveError,setSaveError]=useState(''),[resetKey,setResetKey]=useState(0);
 useEffect(()=>{setDraft(saved);setResetKey(v=>v+1)},[saved]);
 useEffect(()=>{preview(draft);return()=>preview(null)},[draft,preview]);
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved),disabled=busy||!ready;
 const selected=themePresets.find(p=>JSON.stringify(p.theme)===JSON.stringify(draft));
 function choose(theme:ThemePreferences){setDraft({...theme});setResetKey(v=>v+1);setMessage('');setSaveError('')}
 function update<K extends keyof ThemePreferences>(key:K,value:ThemePreferences[K]){setDraft(v=>({...v,[key]:value}));setMessage('');setSaveError('')}
 async function submit(){setBusy(true);setMessage('');setSaveError('');try{await save(draft);setMessage('Saved')}catch(e){setSaveError(e instanceof Error?e.message:String(e));throw e}finally{setBusy(false)}}
 usePendingSetting('appearance',dirty,{blocked:disabled,save:submit,discard:()=>choose(saved)});
 const color=(key:'backgroundA'|'backgroundB'|'accentA'|'accentB',label:string,inactive=false)=><ColorField key={`${key}-${resetKey}`} label={label} value={draft[key]} disabled={disabled||inactive} onChange={value=>update(key,value)}/>;
 return <form className="appearance-settings" aria-label="Appearance" onSubmit={e=>{e.preventDefault();void submit().catch(()=>{})}}>
  <section aria-labelledby="appearance-themes-title">
   <div className="appearance-section-heading"><h2 id="appearance-themes-title">Themes</h2><span>{selected?.name??'Custom theme'}</span></div>
   <div className="appearance-presets" aria-label="Theme presets">{themePresets.map((p,i)=><MiraButton type="button" variant="outline" key={p.name} className="appearance-preset" aria-pressed={selected?.name===p.name} disabled={disabled} onClick={()=>choose(p.theme)} style={presetStyles[i]}>
    <ThemeSample theme={p.theme} mini/>
    <span className="appearance-preset-name">{p.name}{selected?.name===p.name&&<Check size={14} aria-hidden="true"/>}</span>
   </MiraButton>)}</div>
  </section>
  <div className="appearance-customize">
   <Card className="appearance-colors"><CardHeader><CardTitle>Customize</CardTitle><MiraButton type="button" variant="ghost" className="appearance-reset" disabled={disabled} onClick={()=>choose(defaultTheme)}><RotateCcw size={14}/>Reset</MiraButton></CardHeader><CardContent>
    <FieldSet className="appearance-color-section"><FieldLegend>Background</FieldLegend>
     <SettingsRow label="Background gradient" control={<Switch aria-label="Background gradient" checked={draft.backgroundGradient} disabled={disabled} onCheckedChange={checked=>update('backgroundGradient',checked)}/>}/>
     <div className="appearance-color-grid">{color('backgroundA','Primary background')}{color('backgroundB','Secondary background',!draft.backgroundGradient)}</div>
     <p className="appearance-hint">{draft.backgroundGradient?'Blends both colors across the page.':'Uses a single background color.'} Bright colors are darkened for readability.</p>
    </FieldSet>
    <FieldSet className="appearance-color-section"><FieldLegend>Accents</FieldLegend>
     <div className="appearance-color-grid">{color('accentA','Admin & buttons')}{color('accentB','Servers')}</div>
     <SettingsRow label="Blend accents" description="Use both colors in decorative highlights." control={<Switch aria-label="Accent gradient" checked={draft.accentGradient} disabled={disabled} onCheckedChange={checked=>update('accentGradient',checked)}/>}/>
    </FieldSet>
   </CardContent></Card>
   <div className="appearance-preview-column">
    <Card><CardHeader><CardTitle>Live preview</CardTitle></CardHeader><CardContent><ThemeSample theme={draft}/><p className="appearance-hint">Changes preview across the app until you save or cancel.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Card surfaces</CardTitle></CardHeader><CardContent>
     <SettingsRow label="Frosted glass" control={<Switch aria-label="Frosted glass cards" checked={draft.glassCards} disabled={disabled} onCheckedChange={checked=>update('glassCards',checked)}/>}/>
     <div className="appearance-opacity-heading"><label id="appearance-opacity-label">Opacity</label><output>{draft.glassCards?draft.cardOpacity:100}%</output></div>
     <Slider aria-label="Card opacity" min={35} max={100} step={1} value={[draft.cardOpacity]} disabled={disabled||!draft.glassCards} onValueChange={value=>update('cardOpacity',Array.isArray(value)?value[0]:value)}/>
     <p className="appearance-hint">{draft.glassCards?'Lower opacity shows more of the background.':'Solid cards. Enable glass to adjust opacity.'}</p>
    </CardContent></Card>
   </div>
  </div>
  <ErrorBox>{saveError||error}</ErrorBox>{error&&<Button variant="secondary" onClick={reload} disabled={busy}>Retry</Button>}
  <p className="appearance-hint" role="status">{message||'Saved to this device'}</p>
 </form>;
}
