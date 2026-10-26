import {requestServerPower} from './serverPower';
import type {PowerSignal} from './consoleLifecycle';
import {advancePowerOperation,beginPowerOperation,powerOperationLabel,type PowerOperation} from './powerOperation';
import {useArtworkLibrary} from './ArtworkProvider';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {api,Button} from '../lib';
import {Card,CardHeader,CardTitle,CardDescription,CardAction,CardContent,CardFooter} from '../components/ui/card';
import {Item,ItemMedia,ItemContent,ItemDescription,ItemActions} from '../components/ui/item';
import {Icon,type IconName} from '../Icons';
import {bytes,can,items,PageError,useServer,value} from './common';
import './serverHeader.css';
import './shadcn-cards.css';
import './dashboard-ui.css';
import {fallbackArtwork,getServerArtwork,type ServerArtwork} from './serverArtwork';
import {ServerIdentityIcon} from './ServerIdentityIcon';
import {FavoriteButton} from '../ServerNavigation';
import {InstallationPortsNotice} from './GamePorts';

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
        if(active)timer=setTimeout(poll,document.hidden?10000:1000);
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

const PowerContext=createContext<{pending:PowerOperation|null;busy:boolean;error:string;success:string;power:(signal:PowerSignal)=>Promise<void>}>({pending:null,busy:false,error:'',success:'',power:async()=>{}});

function usePowerOperation(base:string,telemetry:Telemetry){
  const [pending,setPending]=useState<PowerOperation|null>(null),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const requestInFlight=useRef<PowerOperation|null>(null),operationRef=useRef<PowerOperation|null>(null),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  function update(operation:PowerOperation|null){operationRef.current=operation;setPending(operation)}
  useEffect(()=>{update(null);setError('');setSuccess('');requestInFlight.current=null},[base]);
  useEffect(()=>{
    const operation=operationRef.current;
    if(!operation||telemetry.error)return;
    const result=advancePowerOperation(operation,telemetry.state,number(telemetry.resources.uptime),telemetry.updated);
    if(result.operation!==operation)update(result.operation);
    if(result.outcome==='success')setSuccess(result.message!);
    if(result.outcome==='error')setError(result.message!);
  },[telemetry.state,telemetry.updated,telemetry.error,pending?.accepted]);
  async function power(signal:PowerSignal){
    if(requestInFlight.current||(operationRef.current&&signal!=='kill'))return;
    if(signal==='kill'&&!window.confirm('Force stop this server immediately? Unsaved progress may be lost.'))return;
    setError('');setSuccess('');
    const operation=beginPowerOperation(signal,telemetry.updated,number(telemetry.resources.uptime));
    requestInFlight.current=operation;
    update(operation);
    try{
      await requestServerPower(base,signal);
      if(active.current&&operationRef.current===operation){update({...operation,accepted:true});telemetry.refresh()}
    }catch(error){if(active.current&&operationRef.current===operation){update(null);setError(error instanceof Error?error.message:String(error))}}
    finally{if(requestInFlight.current===operation)requestInFlight.current=null}
  }
  return {pending,busy:!!pending&&!pending.accepted,error,success,power};
}

function PowerControls({compact=false}:{compact?:boolean}){
  const {server,permissions}=useServer();
  const telemetry=useContext(TelemetryContext),action=useContext(PowerContext),pending=action.pending;
  const running=telemetry.state==='running',starting=telemetry.state==='starting';
  const blocked=!!server.status||!!server.is_node_under_maintenance||!telemetry.updated||!!telemetry.error;
  const controls:[PowerSignal,string,IconName,string,boolean][]=[
    ['start','Start','play','control.start',running||starting||telemetry.state==='stopping'],
    ['restart','Restart','restart','control.restart',!running],
    ['stop','Stop','stop','control.stop',!running],
    ['kill','Force stop','close','control.stop',!running&&!starting&&telemetry.state!=='stopping'&&!pending],
  ];
  return <div className="server-power">
    <div className="actions" role="group" aria-label="Server controls">{controls.filter(([, , ,permission])=>can(permissions,permission)).map(([signal,label,icon,,disabled])=><Button key={signal} className="server-power-button" data-power={signal} variant="secondary" aria-label={compact?`${label} server`:undefined} title={signal==='kill'?'Immediately terminate the server process':compact?`${label} server`:undefined} aria-busy={pending?.signal===signal} disabled={blocked||disabled||action.busy||!!pending&&(signal!=='kill'||pending.signal==='kill')} onClick={()=>void action.power(signal)}><Icon name={icon}/>{!compact&&(pending?.signal===signal?powerOperationLabel(pending):label)}</Button>)}{!compact&&<FavoriteButton id={server.uuid} name={server.name}/>}</div>
    {(pending||starting||telemetry.state==='stopping')&&<div className="server-power-progress" role="status"><span>{telemetry.error?'Connection interrupted. Waiting for server status.':pending?powerOperationLabel(pending):starting?'Starting…':'Stopping…'}</span><div className="server-power-progress-track" role="progressbar" aria-label="Server power operation"><span/></div></div>}
    {action.error&&<div className="error" role="alert">{action.error}</div>}
    {action.success&&<div className="success" role="status">{action.success}</div>}
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
  const power=usePowerOperation(base,telemetry);
  return <TelemetryContext.Provider value={telemetry}><PowerContext.Provider value={power}>
    {!dashboardPage?<header className="server-topbar"><div className="server-summary"><div className="server-identity-heading"><ServerIdentityIcon artwork={server.artwork}/><div><h1>{server.name}</h1>{server.artwork?.pack_name&&<p className="server-pack-name">{server.artwork.pack_name}</p>}</div></div><ServerStateLine/></div><PowerControls compact/></header>:<header><Card className="server-hero server-hero-with-artwork shadcn-card" data-artwork={art.id}>
      <DashboardArtwork key={art.src} art={art}/>
      <CardHeader className="server-hero-info">
        <div className="server-hero-title"><CardTitle><div className="server-identity-heading"><ServerIdentityIcon artwork={server.artwork}/><div><h1>{server.name}</h1>{server.artwork?.pack_name&&<p className="server-pack-name">{server.artwork.pack_name}</p>}</div></div></CardTitle></div>
        {server.description&&<CardDescription className="server-description">{server.description}</CardDescription>}
        <ServerStateLine/>
      </CardHeader>
      <CardAction className="server-hero-controls"><PowerControls/></CardAction>
    </Card></header>}

    <InstallationPortsNotice key={server.identifier || server.uuid_short} identifier={server.identifier || server.uuid_short}/>
    <PageError error={telemetry.error}/>
    {children}
  </PowerContext.Provider></TelemetryContext.Provider>;
}

type Series={name:string;color:string;values:number[]};
function UsageChart({title,series,maximum,format,reading,limit,address}:{title:string;series:Series[];maximum:number;format:(n:number)=>string;reading?:string;limit?:string;address?:string}){
  const chartRef=useRef<HTMLDivElement>(null),[chartWidth,setChartWidth]=useState(480);
  useEffect(()=>{
    const node=chartRef.current;if(!node)return;
    const measure=()=>{const style=getComputedStyle(node);setChartWidth(Math.max(180,node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)))};
    measure();window.addEventListener('resize',measure);
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    observer?.observe(node);return()=>{observer?.disconnect();window.removeEventListener('resize',measure)};
  },[]);
  const observed=series.flatMap(s=>s.values);
  const scale=Math.max(maximum,...observed,1);
  const chartHeight=144;
  const left=72,right=chartWidth-20,top=16,bottom=chartHeight-28;
  const hasSamples=observed.length>0;
  const x=(index:number,length:number)=>length===1?right:left+(index/(length-1))*(right-left);
  const y=(v:number)=>bottom-(v/scale)*(bottom-top);
  return <Card className="usage-chart dashboard-panel shadcn-card" role="region" aria-label={`${title} chart`}>
    <CardHeader className="dashboard-panel-heading"><CardTitle><div className="chart-heading"><h2>{title}</h2>{address&&<span className="chart-address" aria-label={`Server address: ${address}`} title={address}>{address}</span>}{reading!==undefined&&<p className="chart-reading"><strong>{reading}</strong>{limit&&<span> / {limit}</span>}</p>}</div></CardTitle><CardAction>{reading!==undefined?null:series.length>1?<div className="chart-legend">{series.map(s=><span key={s.name} style={{color:s.color}}><span/>{s.name}</span>)}</div>:<span className="chart-latest">{hasSamples?format(series[0].values.at(-1)||0):'Waiting'}</span>}</CardAction></CardHeader>
    <CardContent className="usage-chart-body" ref={chartRef}>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`${title}: ${hasSamples?series.map(s=>`${s.name} ${format(s.values.at(-1)||0)}`).join(', '):'waiting for live samples'}`}>
        <title>{`${title}, live samples from this session`}</title>
        {[1,.5,0].map(f=><g key={f}><line x1={left} x2={right} y1={y(scale*f)} y2={y(scale*f)} className="chart-grid"/><text x={left-12} y={y(scale*f)+4} textAnchor="end" className="chart-axis">{format(scale*f)}</text></g>)}
        {series.map(s=>{
          if(!s.values.length)return null;
          const points=s.values.map((v,i)=>`${x(i,s.values.length)},${y(v)}`).join(' ');
          return <g key={s.name}>
            {series.length===1&&s.values.length>1&&<polygon points={`${left},${bottom} ${points} ${right},${bottom}`} fill={s.color} fillOpacity=".06"/>}
            <polyline points={points} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
            <circle cx={x(s.values.length-1,s.values.length)} cy={y(s.values.at(-1)||0)} r="3" fill={s.color}/>
          </g>;
        })}
      </svg>
      {!hasSamples&&<p className="chart-waiting">Collecting live samples…</p>}
    </CardContent>
    {reading===undefined&&!address&&<CardFooter className="chart-footer"><Item size="xs" className="shadcn-compact-item"><ItemMedia variant="icon"><Icon name="activity"/></ItemMedia><ItemContent><ItemDescription>Samples from this session</ItemDescription></ItemContent></Item></CardFooter>}
  </Card>;
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
    {label:'Disk',icon:'disk',value:updated?bytes(r.disk_bytes):'—',limit:limit('disk')},
  ];
  const network=samples.slice(1).map((sample,index)=>{
    const previous=samples[index],elapsed=Math.max((sample.at-previous.at)/1000,.001);
    // A restart resets Wings' byte counters. Never display that reset as traffic.
    const reset=sample.uptime<previous.uptime;
    return {rx:reset?0:Math.max(0,sample.rx-previous.rx)/elapsed,tx:reset?0:Math.max(0,sample.tx-previous.tx)/elapsed};
  });
  return <>
    <div className="dashboard-charts dashboard-resource-charts">
      <UsageChart title="CPU" reading={updated?`${number(r.cpu_absolute).toFixed(2)}%`:'\u2014'} limit={server.limits?.cpu?`${server.limits.cpu}%`:'\u221e'} series={[{name:'CPU',color:'var(--accent)',values:samples.map(s=>s.cpu)}]} maximum={number(server.limits?.cpu)||1} format={n=>`${n<1?n.toFixed(2):n.toFixed(0)}%`}/>
      <UsageChart title="Memory" reading={updated?bytes(r.memory_bytes):'\u2014'} limit={limit('memory')} series={[{name:'Memory',color:'var(--theme-accent-b,var(--accent))',values:samples.map(s=>s.memory)}]} maximum={number(server.limits?.memory)*1024**2} format={bytes}/>
      <UsageChart title="Network" address={address} series={[{name:'In',color:'var(--accent)',values:network.map(s=>s.rx)},{name:'Out',color:'var(--theme-accent-b,var(--muted))',values:network.map(s=>s.tx)}]} maximum={1} format={n=>`${bytes(n)}/s`}/>
    {cards.map(card=><Card className="metric-card shadcn-card" data-metric={card.icon} key={card.label}>
      <CardHeader className="metric-header"><CardTitle><h2>{card.label}</h2></CardTitle><CardAction><span className="metric-icon"><Icon name={card.icon}/></span></CardAction></CardHeader>
      <CardContent className="metric-content"><p className={card.label==='Address'?'metric-address':''} title={`${card.value}${card.limit?` / ${card.limit}`:''}`}><span className="metric-reading">{card.value}</span>{card.limit&&<span className="metric-limit"> / {card.limit}</span>}</p>
        {card.label==='Disk'?<div className="metric-disk-usage">{updated&&number(server.limits?.disk)>0?<div className="overview-meter" aria-label={`Disk usage ${card.value} of ${card.limit}`}><span style={{width:`${Math.min(100,number(r.disk_bytes)/(number(server.limits.disk)*1024**2)*100)}%`}}/></div>:<span>{updated?'Current usage':'Waiting for live samples'}</span>}</div>:null}
      </CardContent>
      <CardFooter className="metric-footer"><Item size="xs" className="shadcn-compact-item"><ItemMedia variant="icon"><Icon name={card.icon}/></ItemMedia><ItemContent><ItemDescription>{card.limit?'Limit':'Server allocation'}</ItemDescription></ItemContent>{card.limit&&<ItemActions>{card.limit}</ItemActions>}</Item></CardFooter>
    </Card>)}</div>
    {children}
  </>;
}

export default function ServerDashboard({children}:{children?:ReactNode}){
  const {permissions}=useServer();
  return <div className="server-dashboard">
    <ServerResourcePanels>{can(permissions,'control.console')&&children}</ServerResourcePanels>
  </div>;
}
