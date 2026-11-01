import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {ThemeProvider} from '../../src/ThemeProvider';
import {SettingsSection,SettingsRow,Switch} from '../../src/ui/Settings';
import {Input,Select,Button} from '../../src/lib';
import {Fields,f} from '../../src/admin/shared';
import {GameSettingsFields} from '../../src/client/GameSettingsFields';
import {StartupVariableField} from '../../src/client/ServerStartup';
const startupVariables=[
 {env_variable:'KEEP_INSTALLER',name:'Keep installer files',description:'Keep the installer after installation.',rules:'required|boolean',default_value:'0',server_value:'0'},
 {env_variable:'SERVER_NAME',name:'Server name',description:'Name shown in the multiplayer server browser.',rules:'required|string|max:80',default_value:'',server_value:'Weekend farm'},
 {env_variable:'WEB_USERNAME',name:'Web portal username',description:'Login for the web management portal.',rules:'required|string',default_value:'admin',server_value:'admin'},
 {env_variable:'WEB_PASSWORD',name:'Web portal password',description:'Password for the web management portal.',rules:'nullable|string',default_value:'',server_value:'',secret:true,secret_configured:true},
 {env_variable:'WEB_PORT',name:'Web portal port',rules:'required|integer|min:1|max:65535',default_value:'8080',server_value:'8080'},
 {env_variable:'MAX_PLAYERS',name:'Max players',rules:'required|integer|min:1|max:16',default_value:'12',server_value:'12'},
].map(variable=>({...variable,is_editable:true}));
import '../../src/ui/controls.css';import '../../src/styles.css';import '../../src/theme.css';import '../../src/design-system.css';import '../../src/shadcn.css';import '../../src/shadcn-app.css';import '../../src/glass-surfaces.css';import '../../src/ui/density.css';import '../../src/client/steamGames.css';import '../../src/client/startupSettings.css';import '../../src/admin/infrastructure-ui.css';
const fields=[{key:'ServerName',label:'ServerName',type:'text' as const,value:'Weekend server',help:'The name shown in the server browser.'},{key:'ExpRate',label:'ExpRate',type:'number' as const,value:'1.0',min:0.1,max:5,help:'Changes how quickly players gain experience.'},{key:'bEnableFastTravel',label:'bEnableFastTravel',type:'boolean' as const,value:true,help:'Allow players to travel between unlocked points.'},{key:'ServerPassword',label:'ServerPassword',type:'text' as const,value:null,secret:true,configured:true},{key:'PublicPort',label:'PublicPort',type:'number' as const,value:8211,readonly:true}];
function Fixture(){const [draft,setDraft]=useState({}),[values,setValues]=useState({memory:8,name:'Test server',enabled:true}),[checked,setChecked]=useState(true),[result,setResult]=useState(''),[runtime,setRuntime]=useState('21');return <ThemeProvider account="layout-fixture"><main className="app-content" data-mira-density="compact" style={{padding:24}}>
<h1>Settings layout fixture</h1>
<SettingsSection title="Runtime"><SettingsRow label="Java runtime" description="Choose the runtime used to start this server." control={<Select aria-label="Java runtime" value={runtime} onChange={e=>setRuntime(e.target.value)}><option value="21">Java 21</option><option value="17">Java 17</option></Select>}/><SettingsRow label="Automatic maximum heap" description="Reserve memory for the server process." control={<Switch aria-label="Automatic maximum heap" checked={checked} onCheckedChange={setChecked}/>}/></SettingsSection>
<form onSubmit={e=>{e.preventDefault();setResult(JSON.stringify(values))}} className="admin-panel card"><Fields fields={[f('name','Server name',undefined,{required:true,hint:'Shown in the panel.'}),f('memory','Memory (GB)','number',{unit:'GB'}),f('enabled','Enabled','checkbox')]} value={values} onChange={setValues}/><Button type="submit">Save fixture</Button><output style={{display:"block",overflowWrap:"anywhere"}}>{result}</output></form>
<div className="game-quick-page games-ui settings-responsive"><GameSettingsFields fields={fields} game="palworld" file="PalWorldSettings.ini" search="" draft={draft} onChange={(key,value)=>setDraft(v=>({...v,[key]:value}))}/>
<section className="startup-settings games-ui"><SettingsSection className="startup-variables" title="Game options"><div className="game-properties-grid">{startupVariables.map(variable=><StartupVariableField key={variable.env_variable} variable={variable} permitted onDirty={()=>{}} onSave={async()=>variable}/>)}</div></SettingsSection></section></div>
</main></ThemeProvider>}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Fixture/></BrowserRouter>);
