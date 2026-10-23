import {useArtworkLibrary} from './ArtworkProvider';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {api,Button} from '../lib';
import {Icon,type IconName} from '../Icons';
import {bytes,can,items,json,Notice,PageError,useAction,useServer,value} from './common';
import './serverHeader.css';
import {fallbackArtwork,getServerArtwork,type ServerArtwork} from './serverArtwork';
import {ServerIdentityIcon} from './ServerIdentityIcon';
import {FavoriteButton} from '../ServerNavigation';

type Sample={at:number;cpu:number;memory:number;rx:number;tx:number;uptime:number};
type Telemetry={state:string;resources:Record<string,any>;samples:Sample[];updated:number;error:string;refresh:()=>void};
const TelemetryContext=createContext<Telemetry>({state:'unknown',resources:{},samples:[],updated:0,error:'',refresh:()=>{}});
export const useServerTelemetry=()=>useContext(TelemetryContext);
const number=(v:unknown)=>Math.max(0,Number.isFinite(Number(v))?Number(v):0);

function useTelemetry(base:string,enabled:boolean):Telemetry{
  const [data,setData]=useState<Omit<Telemetry,'refresh'>>({state:'unknown',resources:{},samples:[],updated:0,error:''});
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const abort=new AbortController();
    async function poll(){
      try{
        const response=value(await api(`${base}/resources`,{signal:abort.signal}));
        if(!active)return;
        const r=response.resources||{},at=Date.now();
        const sample={at,cpu:number(r.cpu_absolute),memory:number(r.memory_bytes),rx:number(r.network_rx_bytes),tx:number(r.network_tx_bytes),uptime:number(r.uptime)};
        setData(old=>({state:response.is_suspended?'suspended':response.current_state||'unknown',resources:r,samples:[...old.samples,sample].slice(-60),updated:at,error:''}));
      }catch(error){
        if(active)setData(old=>({...old,error:error instanceof Error?error.message:String(error)}));
      }finally{
        if(active)timer=setTimeout(poll,document.hidden?10000:3000);
      }
    }
    void poll();
    return()=>{active=false;clearTimeout(timer);abort.abort()};
  },[base,enabled,version]);
  return {...data,refresh:()=>setVersion(v=>v+1)};
}

function uptime(ms:number){
  const seconds=Math.floor(ms/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds/3600)%24,minutes=Math.floor(seconds/60)%60;
  return `${days?`${days}d `:''}${hours}h ${minutes}m ${seconds%60}s`;
}

function PowerControls({compact=false}:{compact?:boolean}){
  const {base,server,permissions}=useServer();
  const telemetry=useContext(TelemetryContext),action=useAction();
  const [pending,setPending]=useState('');
  const running=telemetry.state==='running',starting=telemetry.state==='starting';
  const blocked=!!server.status||!!server.is_node_under_maintenance||!telemetry.updated||!!telemetry.error;
  const controls:[string,string,IconName,string,boolean][]=[
    ['start','Start','play','control.start',running||starting||telemetry.state==='stopping'],
    ['restart','Restart','restart','control.restart',!running],
    ['stop','Stop','stop','control.stop',!running&&!starting],
  ];
  async function power(signal:string){
    setPending(signal);
    await action.run(()=>api(`${base}/power`,json('POST',{signal})),()=>{
      telemetry.refresh();
      action.setSuccess(`${signal==='restart'?'Restart':signal==='start'?'Start':'Stop'} requested.`);
    });
    setPending('');
  }
  return <div className="server-power">
    <div className="actions">{controls.filter(([, , ,permission])=>can(permissions,permission)).map(([signal,label,icon,,disabled])=><Button key={signal} variant={signal==='stop'?'danger':compact||signal==='restart'?'secondary':'default'} aria-label={compact?`${label} server`:undefined} title={compact?`${label} server`:undefined} aria-busy={pending===signal} disabled={blocked||disabled||action.busy} onClick={()=>void power(signal)}><Icon name={icon}/>{!compact&&(pending===signal?'Sending…':label)}</Button>)}{!compact&&<FavoriteButton id={server.uuid} name={server.name}/>}</div>
    <Notice action={action}/>
  </div>;
}

export function ServerStateLine(){
  const {server}=useServer(),telemetry=useServerTelemetry();
  const state=server.status||telemetry.state;
  const label:Record<string,string>={running:'Online',offline:'Offline',stopped:'Offline',starting:'Starting',stopping:'Stopping',unknown:'Connecting',installing:'Installing',install_failed:'Installation failed',reinstall_failed:'Reinstallation failed',suspended:'Suspended',restoring_backup:'Restoring backup'};
  return <div className="server-state-line">
          <span className={`server-state state-${telemetry.error&&!server.status?'unknown':state}`}><span className="status-dot"/>{telemetry.error&&!server.status?'Connection unavailable':label[state]||state.replaceAll('_',' ')}</span>
          {telemetry.updated&&!server.status&&<span className="server-uptime">Uptime <strong>{uptime(number(telemetry.resources.uptime))}</strong></span>}
  </div>;
}

function DashboardArtwork({art}:{art:ServerArtwork}){
  const [failed,setFailed]=useState(false);
  return <img className="server-hero-artwork" src={failed?fallbackArtwork.src:art.src} alt="" aria-hidden="true" decoding="async" draggable={false} onError={failed?undefined:()=>setFailed(true)}/>;
}

export function ServerWorkspace({children}:{children:ReactNode}){
  const {server,base}=useServer();
  useArtworkLibrary();
  const art=getServerArtwork({...server,name:server.name});
  const pathname=useLocation().pathname;
  const dashboardPage=/^\/server\/[^/]+\/?$/.test(pathname);
  const telemetry=useTelemetry(base,!server.status);
  return <TelemetryContext.Provider value={telemetry}>
    {!dashboardPage?<header className="server-topbar"><div className="server-summary"><div className="server-identity-heading"><ServerIdentityIcon artwork={server.artwork}/><div><h1>{server.name}</h1>{server.artwork?.pack_name&&<p className="server-pack-name">{server.artwork.pack_name}</p>}</div></div><ServerStateLine/></div><PowerControls compact/></header>:<header className="server-hero server-hero-with-artwork" data-artwork={art.id}>
      <DashboardArtwork key={art.src} art={art}/>
      <div className="server-hero-info">
        <div className="server-identity-heading"><ServerIdentityIcon artwork={server.artwork}/><div><h1>{server.name}</h1>{server.artwork?.pack_name&&<p className="server-pack-name">{server.artwork.pack_name}</p>}</div></div>
        {server.description&&<p className="server-description">{server.description}</p>}
        <ServerStateLine/>
      </div>
      <PowerControls/>
    </header>}
    <PageError error={telemetry.error}/>
    {children}
  </TelemetryContext.Provider>;
}

type Series={name:string;color:string;values:number[]};
function UsageChart({title,series,maximum,format}:{title:string;series:Series[];maximum:number;format:(n:number)=>string}){
  const observed=series.flatMap(s=>s.values);
  const scale=Math.max(maximum,...observed,1);
  const left=72,right=460,top=16,bottom=164;
  const hasSamples=observed.length>0;
  const x=(index:number,length:number)=>length===1?right:left+(index/(length-1))*(right-left);
  const y=(v:number)=>bottom-(v/scale)*(bottom-top);
  return <section className="usage-chart dashboard-panel" aria-label={`${title} chart`}>
    <div className="dashboard-panel-heading"><h2>{title}</h2>{series.length>1&&<div className="chart-legend">{series.map(s=><span key={s.name} style={{color:s.color}}><span/>{s.name}</span>)}</div>}</div>
    <div className="usage-chart-body">
      <svg viewBox="0 0 480 192" role="img" aria-label={`${title}: ${hasSamples?series.map(s=>`${s.name} ${format(s.values.at(-1)||0)}`).join(', '):'waiting for live samples'}`}>
        <title>{title}, live samples from this session</title>
        {[1,.5,0].map(f=><g key={f}><line x1={left} x2={right} y1={y(scale*f)} y2={y(scale*f)} className="chart-grid"/><text x={left-12} y={y(scale*f)+4} textAnchor="end" className="chart-axis">{format(scale*f)}</text></g>)}
        {series.map(s=>{
          if(!s.values.length)return null;
          const points=s.values.map((v,i)=>`${x(i,s.values.length)},${y(v)}`).join(' ');
          return <g key={s.name}>
            {series.length===1&&s.values.length>1&&<polygon points={`${left},${bottom} ${points} ${right},${bottom}`} fill={s.color} fillOpacity=".12"/>}
            <polyline points={points} fill="none" stroke={s.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
            <circle cx={x(s.values.length-1,s.values.length)} cy={y(s.values.at(-1)||0)} r="3" fill={s.color}/>
          </g>;
        })}
      </svg>
      {!hasSamples&&<p className="chart-waiting">Collecting live samples…</p>}
    </div>
  </section>;
}

function serverAddress(server:Record<string,any>){
  const allocations=items(server.relationships?.allocations),allocation=allocations.find(a=>a.is_default)||allocations[0];
  const host=allocation?.ip_alias||allocation?.alias||allocation?.ip;
  return host?`${host.includes(':')?`[${host}]`:host}:${allocation.port}`:'Not assigned';
}

export function ServerResourcePanels({children}:{children?:ReactNode}){
  const {server}=useServer();
  const {resources:r,samples,updated}=useServerTelemetry();
  const address=serverAddress(server);
  const limit=(key:string)=>server.limits?.[key]?bytes(number(server.limits[key])*1024**2):'∞';
  const cards:{label:string;icon:IconName;value:string;limit?:string}[]=[
    {label:'CPU',icon:'cpu',value:updated?`${number(r.cpu_absolute).toFixed(2)}%`:'—',limit:server.limits?.cpu?`${server.limits.cpu}%`:'∞'},
    {label:'Memory',icon:'memory',value:updated?bytes(r.memory_bytes):'—',limit:limit('memory')},
    {label:'Disk',icon:'disk',value:updated?bytes(r.disk_bytes):'—',limit:limit('disk')},
    {label:'Address',icon:'network',value:address},
  ];
  const network=samples.slice(1).map((sample,index)=>{
    const previous=samples[index],elapsed=Math.max((sample.at-previous.at)/1000,.001);
    // A restart resets Wings' byte counters. Never display that reset as traffic.
    const reset=sample.uptime<previous.uptime;
    return {rx:reset?0:Math.max(0,sample.rx-previous.rx)/elapsed,tx:reset?0:Math.max(0,sample.tx-previous.tx)/elapsed};
  });
  return <>
    <div className="server-metrics">{cards.map(card=><section className="metric-card" data-metric={card.icon} key={card.label}>
      <span className="metric-icon"><Icon name={card.icon}/></span>
      <div><h2>{card.label}</h2><p className={card.label==='Address'?'metric-address':''}><span className="metric-reading">{card.value}</span>{card.limit&&<span className="metric-limit"> / {card.limit}</span>}</p></div>
    </section>)}</div>
    {children}
    <div className="dashboard-charts">
      <UsageChart title="CPU load" series={[{name:'CPU',color:'var(--accent)',values:samples.map(s=>s.cpu)}]} maximum={number(server.limits?.cpu)||1} format={n=>`${n<1?n.toFixed(2):n.toFixed(0)}%`}/>
      <UsageChart title="Memory" series={[{name:'Memory',color:'#adb5c4',values:samples.map(s=>s.memory)}]} maximum={number(server.limits?.memory)*1024**2} format={bytes}/>
      <UsageChart title="Network" series={[{name:'In',color:'#93b2ee',values:network.map(s=>s.rx)},{name:'Out',color:'#a3a9b6',values:network.map(s=>s.tx)}]} maximum={1} format={n=>`${bytes(n)}/s`}/>
    </div>
  </>;
}

export default function ServerDashboard({children}:{children?:ReactNode}){
  const {permissions}=useServer();
  return <div className="server-dashboard">
    <ServerResourcePanels>{can(permissions,'control.console')&&children}</ServerResourcePanels>
  </div>;
}
