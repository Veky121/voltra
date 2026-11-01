import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {ThemeProvider} from '../../src/ThemeProvider';
import {SettingsSection,SettingsRow,Switch} from '../../src/ui/Settings';
import {Input,Select,Button} from '../../src/lib';
import {Fields,f} from '../../src/admin/shared';
import {GameSettingsFields} from '../../src/client/GameSettingsFields';
import '../../src/ui/controls.css';import '../../src/styles.css';import '../../src/theme.css';import '../../src/design-system.css';import '../../src/shadcn.css';import '../../src/shadcn-app.css';import '../../src/glass-surfaces.css';import '../../src/ui/density.css';import '../../src/client/steamGames.css';import '../../src/client/startupSettings.css';import '../../src/admin/infrastructure-ui.css';
const fields=[{key:'ServerName',label:'ServerName',type:'text' as const,value:'Weekend server',help:'The name shown in the server browser.'},{key:'ExpRate',label:'ExpRate',type:'number' as const,value:'1.0',min:0.1,max:5,help:'Changes how quickly players gain experience.'},{key:'bEnableFastTravel',label:'bEnableFastTravel',type:'boolean' as const,value:true,help:'Allow players to travel between unlocked points.'},{key:'ServerPassword',label:'ServerPassword',type:'text' as const,value:null,secret:true,configured:true},{key:'PublicPort',label:'PublicPort',type:'number' as const,value:8211,readonly:true}];
function Fixture(){const [draft,setDraft]=useState({}),[values,setValues]=useState({memory:8,name:'Test server',enabled:true}),[checked,setChecked]=useState(true),[result,setResult]=useState(''),[runtime,setRuntime]=useState('21');return <ThemeProvider account="layout-fixture"><main className="app-content" data-mira-density="compact" style={{padding:24}}>
<h1>Settings layout fixture</h1>
<SettingsSection title="Runtime"><SettingsRow label="Java runtime" description="Choose the runtime used to start this server." control={<Select aria-label="Java runtime" value={runtime} onChange={e=>setRuntime(e.target.value)}><option value="21">Java 21</option><option value="17">Java 17</option></Select>}/><SettingsRow label="Automatic maximum heap" description="Reserve memory for the server process." control={<Switch aria-label="Automatic maximum heap" checked={checked} onCheckedChange={setChecked}/>}/></SettingsSection>
<form onSubmit={e=>{e.preventDefault();setResult(JSON.stringify(values))}} className="admin-panel card"><Fields fields={[f('name','Server name',undefined,{required:true,hint:'Shown in the panel.'}),f('memory','Memory (GB)','number',{unit:'GB'}),f('enabled','Enabled','checkbox')]} value={values} onChange={setValues}/><Button type="submit">Save fixture</Button><output style={{display:"block",overflowWrap:"anywhere"}}>{result}</output></form>
<div className="game-quick-page games-ui"><GameSettingsFields fields={fields} game="palworld" file="PalWorldSettings.ini" search="" draft={draft} onChange={(key,value)=>setDraft(v=>({...v,[key]:value}))}/></div>
</main></ThemeProvider>}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Fixture/></BrowserRouter>);
