import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Select,Field} from '../../src/lib';
import {Switch} from '../../src/ui/Settings';
import {GameSwitch} from '../../src/client/GameSwitch';
import {DropdownMenuItem} from '../../src/components/ui/dropdown-menu';
import FileMenu from '../../src/client/FileMenu';
import {MemoryRouter} from 'react-router-dom';
import {SectionTabs} from '../../src/ui/SectionTabs';
import '../../src/admin/management-ui.css';
import '../../src/admin/infrastructure-ui.css';
import '../../src/client/accountProfile.css';
import '../../src/client/operations-ui.css';
import '../../src/client/serverAdminTools.css';
import '../../src/client/minecraftContent.css';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/design-system.css';
import '../../src/shadcn.css';
import '../../src/shadcn-app.css';
import '../../src/ui/controls.css';
function Fixture(){
 const [enabled,setEnabled]=useState(false),[choice,setChoice]=useState(''),[many,setMany]=useState<string[]>([]),[submitted,setSubmitted]=useState(''),[menu,setMenu]=useState(false),[action,setAction]=useState(''),[dynamic,setDynamic]=useState(false);
 const anchor=useRef<HTMLButtonElement>(null);
 return <main style={{padding:24,maxWidth:700}}><form id="controls" onSubmit={event=>{event.preventDefault();setSubmitted(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))))}}>
  <Field label="Enable feature"><Switch name="enabled" checked={enabled} onCheckedChange={setEnabled}/></Field>
  <Field label="Choose game"><Select name="game" value={choice} onChange={event=>setChoice(event.target.value)} required><option value="">Choose game</option><option value="minecraft">Minecraft</option><option value="fs25">Farming Simulator 25</option><option value="disabled" disabled>Unavailable</option><optgroup label="More"><option value="other">Other</option></optgroup></Select></Field>
  <Field label="Multiple games"><Select multiple name="games" value={many} onChange={event=>setMany(Array.from(event.target.selectedOptions,option=>option.value))}><option value="a">Alpha</option><option value="b">Beta</option></Select></Field>
  <Field label="Dynamic"><Select value={dynamic?'loaded':''} onChange={()=>{}}>{dynamic&&<option value="loaded">Loaded option</option>}</Select></Field><button type="button" onClick={()=>setDynamic(true)}>Load options</button>
  <Field label="Default switch"><Switch name="uncontrolled" defaultChecked/></Field>
  <fieldset disabled><legend>Read only</legend><Field label="Disabled switch"><Switch checked={false} onCheckedChange={()=>{throw Error('Disabled switch changed')}}/></Field><Field label="Disabled select"><Select defaultValue="a"><option value="a">Alpha</option><option value="b">Beta</option></Select></Field></fieldset>
  <label>Required agreement <Switch name="agreement" required/></label>
  <button type="submit">Submit</button><button type="reset">Reset</button>
 </form>
 <Field label="External form select"><Select name="external" form="controls" defaultValue="external"><option value="external">External</option><option value="changed">Changed external</option></Select></Field>
 <button ref={anchor} type="button" onClick={()=>setMenu(true)}>File options</button>
 {menu&&anchor.current&&<FileMenu anchor={anchor.current} label="File options" onClose={restore=>{setMenu(false);if(restore)anchor.current?.focus()}}><DropdownMenuItem disabled>Unavailable action</DropdownMenuItem><DropdownMenuItem onClick={()=>{setAction('Details');setMenu(false)}}>Details</DropdownMenuItem><DropdownMenuItem onClick={()=>{setAction('Delete');setMenu(false)}}>Delete</DropdownMenuItem></FileMenu>}
 <output id="fixture-state" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify({enabled,choice,many,submitted,action})}</output></main>;
}
function TabsFixture(){
 const [active,setActive]=useState('general');
 const items=[{id:'general',label:'General'},{id:'network',label:'Network'},{id:'blocked',label:'Disabled',disabled:true},{id:'databases',label:'Databases'}];
 return <MemoryRouter initialEntries={['/general']}><main style={{padding:24,minWidth:0}}>
  {['server-settings-shell','account-page','admin-management-page','server-admin-tools','minecraft-content'].map((className,index)=><div className={className} key={className}><SectionTabs label={className} scope={'fixture-'+index} active={active} onChange={setActive} items={items}/></div>)}
  <SectionTabs label="Route tabs" items={items.filter(item=>!item.disabled).map(item=>({...item,to:'/'+item.id,end:true}))}/>
 </main></MemoryRouter>;
}
function SwitchGeometryFixture(){
 const [checked,setChecked]=useState<Record<string,boolean>>({});
 return <main style={{padding:24}}>{['game-setting-control','management-ui','admin-infrastructure','management-ui admin-infrastructure','appearance-gradient','operations-check'].map(context=><section key={context} className={context} data-context={context} style={{display:'flex',alignItems:'center',gap:24,marginBottom:24}}><span>{context}</span>{[false,true].flatMap(initial=>[false,true].map(disabled=>{
  const id=context+' '+(initial?'on':'off')+' '+(disabled?'disabled':'enabled');
  return <GameSwitch key={id} aria-label={id} checked={checked[id]??initial} disabled={disabled} onCheckedChange={value=>setChecked(old=>({...old,[id]:value}))}/>;
 }))}</section>)}</main>;
}
createRoot(document.getElementById('root')!).render(location.pathname==='/tabs'?<TabsFixture/>:location.pathname==='/geometry'?<SwitchGeometryFixture/>:<Fixture/>);
