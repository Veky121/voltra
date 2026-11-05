import {confirmAction} from '../ui/ConfirmAction';
import {ButtonFeedback} from '../ui/ButtonFeedback';
import ServerStorageSummary from './ServerStorageSummary';
import ServerInsights from './ServerInsights';
import {useTransientMessage} from '../hooks/useTransientMessage';
import {formatUptime} from './uptime';
import {formatBytesGB} from '../resourceUnits';
import {requestServerPower} from './serverPower';
import type {PowerSignal} from './consoleLifecycle';
import {advancePowerOperation,beginPowerOperation,powerOperationLabel,powerOperationDetail,type PowerOperation} from './powerOperation';
import {useArtworkLibrary} from './ArtworkProvider';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {api,Button} from '../lib';
import {Card,CardHeader,CardTitle,CardDescription,CardAction,CardContent,CardFooter} from '../components/ui/card';
import {Item,ItemMedia,ItemContent,ItemDescription} from '../components/ui/item';
import {Icon,type IconName} from '../Icons';
import {bytes,resourceUsageGB,resourceLimitGB,can,items,PageError,useServer,value} from './common';
import './serverHeader.css';
import './powerProgress.css';
import {ServerConnection} from './ServerConnection';
import './shadcn-cards.css';
import './dashboard-ui.css';
import {fallbackArtwork,getServerArtwork,type ServerArtwork} from './serverArtwork';
import {ServerIdentityIcon} from './ServerIdentityIcon';
import {FavoriteButton} from '../ServerNavigation';
import {visiblePoll} from '../hooks/visiblePoll';
import {observeLivePath,isLivePathFresh} from '../hooks/liveEvents';

type Sample={at:number;cpu:number;memory:number;rx:number;tx:number;uptime:number};
type Telemetry={state:string;resources:Record<string,any>;samples:Sample[];updated:number;error:string;refresh:()=>void};
const TelemetryContext=createContext<Telemetry>({state:'unknown',resources:{},samples:[],updated:0,error:'',refresh:()=>{}});
export const useServerTelemetry=()=>useContext(TelemetryContext);

export function ServerOperationNotice(){
  const {server}=useServer();
  const telemetry=useServerTelemetry();
  const pathname=useLocation().pathname;
  if(!server.status)return null;
  if(server.status==='reinstall_failed'){
    // A failed attempt remains recorded, but does not describe a recovered runtime.
    if(telemetry.state==='running'&&!telemetry.error&&!pathname.endsWith('/runtime'))return null;
    return <div className="card" role="status">The last reinstall attempt failed. {telemetry.state==='running'&&!telemetry.error?'The existing installation is running. ':''}Review the installation output before retrying Reinstall server under Server settings &gt; General.</div>;
  }
  return <div className="card">Server state: {server.status.replaceAll('_',' ')}. {server.status==='installing'?'Installation output is available in the console.':''}</div>;
}


const number=(v:unknown)=>Math.max(0,Number.isFinite(Number(v))?Number(v):0);
const emptyTelemetry=():Omit<Telemetry,'refresh'>=>({state:'unknown',resources:{},samples:[],updated:0,error:''});

function useTelemetry(base:string,enabled:boolean):Telemetry{
  const [data,setData]=useState<{base:string;value:Omit<Telemetry,'refresh'>}>(()=>({base,value:emptyTelemetry()}));
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    if(!enabled){setData({base,value:emptyTelemetry()});return;}
    let active=true;
    let liveVersion=0;
    const path=`${base}/resources`;
    const consume=(payload:any)=>{
      const response=value(payload);
      const r=response.resources||{},at=Date.now();
      const sample={at,cpu:number(r.cpu_absolute),memory:number(r.memory_bytes),rx:number(r.network_rx_bytes),tx:number(r.network_tx_bytes),uptime:number(r.uptime)};
      setData(old=>({base,value:{state:response.is_suspended?'suspended':response.current_state||'unknown',resources:r,samples:[...(old.base===base?old.value.samples:[]),sample].slice(-60),updated:at,error:''}}));
    };
    const unsubscribe=observeLivePath(path,sample=>{
      if(!active||document.hidden)return;
      liveVersion++;
      if(sample.status===200)consume(sample.data);
      else setData({base,value:{...emptyTelemetry(),error:sample.data?.errors?.[0]?.detail||'Live resources unavailable.'}});
    });
    let forceRead=version>0;
    const stop=visiblePoll(async signal=>{
      if(!forceRead&&isLivePathFresh(path))return;
      forceRead=false;
      const generation=liveVersion;
      try{
        const response=await api(path,{signal});
        if(!active||signal.aborted||generation!==liveVersion)return;
        consume(response);
      }catch(error){
        if(active&&!signal.aborted&&generation===liveVersion)setData(old=>({base,value:{...(old.base===base?old.value:emptyTelemetry()),error:error instanceof Error?error.message:String(error)}}));
        throw error;
      }
    });
    return()=>{active=false;stop();unsubscribe?.()};
  },[base,enabled,version]);
  return {...(enabled&&data.base===base?data.value:emptyTelemetry()),refresh:()=>setVersion(v=>v+1)};
}

const PowerContext=createContext<{pending:PowerOperation|null;busy:boolean;error:string;success:string;completedSignal:PowerSignal|null;power:(signal:PowerSignal)=>Promise<void>;dismissError:()=>void}>({pending:null,busy:false,error:'',success:'',completedSignal:null,power:async()=>{},dismissError:()=>{}});

function usePowerOperation(base:string,telemetry:Telemetry){
  const [pending,setPending]=useState<PowerOperation|null>(null),[error,setError]=useState('');
  const [success,setSuccess]=useTransientMessage(2000);
  const [completedSignal,setCompletedSignal]=useState<PowerSignal|null>(null);
  const requestInFlight=useRef<PowerOperation|null>(null),operationRef=useRef<PowerOperation|null>(null),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  function update(operation:PowerOperation|null){operationRef.current=operation;setPending(operation)}
  useEffect(()=>{update(null);setError('');setSuccess('');requestInFlight.current=null},[base]);
  useEffect(()=>{
    const operation=operationRef.current;
    if(!operation||telemetry.error)return;
    const result=advancePowerOperation(operation,telemetry.state,number(telemetry.resources.uptime),telemetry.updated);
    if(result.operation!==operation)update(result.operation);
    if(result.outcome==='success'){setCompletedSignal(operation.signal);setSuccess(result.message!)}
    if(result.outcome==='error')setError(result.message!);
  },[telemetry.state,telemetry.updated,telemetry.error,pending?.accepted]);
  async function power(signal:PowerSignal){
    if(requestInFlight.current||(operationRef.current&&signal!=='kill'))return;
    if(signal==='kill'&&!await confirmAction({title:"Force stop?",description:'Force stop this server immediately? Unsaved progress may be lost.',confirmLabel:"Force stop",danger:true}))return;
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
  return {pending,busy:!!pending&&!pending.accepted,error,success,completedSignal,power,dismissError:()=>setError('')};
}

function usePowerElapsed(pending:PowerOperation|null){
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{
    if(!pending)return;
    setClock(Date.now());
    const timer=window.setInterval(()=>setClock(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[pending?.requestedAt]);
  return pending?Math.max(0,Math.floor((clock-pending.requestedAt)/1000)):0;
}

function PowerControls({compact=false}:{compact?:boolean}){
  const {server,permissions}=useServer();
  const telemetry=useContext(TelemetryContext),action=useContext(PowerContext),pending=action.pending;
  const elapsed=usePowerElapsed(compact?null:pending);
  const running=telemetry.state==='running',starting=telemetry.state==='starting';
  const operationBlocksPower=!!server.status||!!server.is_installing;
  const blocked=operationBlocksPower||!!server.is_node_under_maintenance||!telemetry.updated||!!telemetry.error;
  const controls:[PowerSignal,string,IconName,string,boolean][]=[
    ['start','Start','play','control.start',running||starting||telemetry.state==='stopping'],
    ['restart','Restart','restart','control.restart',!running],
    ['stop','Stop','stop','control.stop',!running],
    ['kill','Force stop','close','control.stop',!running&&!starting&&telemetry.state!=='stopping'&&!pending],
  ];
  const unavailableReason=server.is_node_under_maintenance?'The node is under maintenance.':operationBlocksPower?`Server controls are unavailable while ${String(server.status).replaceAll('_',' ')}.`:telemetry.error?'Server status is unavailable. Check the connection before sending another action.':!telemetry.updated?'Waiting for the first server status update.':'';
  return <div className="server-power">
    <div className="actions" role="group" aria-label="Server controls">{controls.filter(([, , ,permission])=>can(permissions,permission)).map(([signal,label,icon,,disabled])=>{
      const working=pending?pending.signal===signal:!telemetry.error&&(signal==='start'&&starting||signal==='stop'&&telemetry.state==='stopping');
      const feedback=working?'pending':action.success&&action.completedSignal===signal?'success':'idle';
      return <Button key={signal} className="server-power-button" data-power={signal} data-feedback={feedback} variant="secondary" aria-label={compact?`${label} server`:undefined} title={unavailableReason|| (working&&pending?powerOperationLabel(pending):pending&&signal!=='kill'?'Wait for the current action to finish.':disabled?signal==='start'?'The server is already running or changing state.':'The server must be running for this action.':signal==='kill'?'Immediately terminate the server process':`${label} server`)} aria-busy={working} disabled={blocked||disabled||action.busy||!!pending&&(signal!=='kill'||pending.signal==='kill')} onClick={()=>void action.power(signal)}><ButtonFeedback state={feedback}><Icon name={icon}/></ButtonFeedback>{!compact&&label}</Button>;
    })}{!compact&&<FavoriteButton id={server.uuid} name={server.name}/>}</div>
    <span className="button-feedback-sr" role="status">{pending?powerOperationLabel(pending):action.success}</span>
    {!compact&&pending&&(elapsed>=30||telemetry.error)&&<Button variant="secondary" title={powerOperationDetail(pending,elapsed,!!telemetry.error)} onClick={telemetry.refresh}>Check status</Button>}
    {!compact&&action.error&&<div className="error server-power-error" role="alert"><span>{action.error}</span><Button variant="secondary" aria-label="Dismiss power action error" onClick={action.dismissError}>Dismiss</Button></div>}

  </div>;
}

export function ServerStateLine({compact=false}:{compact?:boolean}){
  const {server}=useServer(),telemetry=useServerTelemetry();
  const action=useContext(PowerContext);
  const pending=compact?action.pending:null;
  const operationElapsed=usePowerElapsed(pending);
  const operationError=compact?action.error:'';
  const state=server.status&&server.status!=='reinstall_failed'?server.status:telemetry.state;
  const online=state==='running'&&!telemetry.error;
  const elapsed=online?number(telemetry.resources.uptime):0;
  const label:Record<string,string>={running:'Online',offline:'Offline',stopped:'Offline',starting:'Starting',stopping:'Stopping',unknown:'Connecting',installing:'Installing',install_failed:'Installation failed',reinstall_failed:'Reinstallation failed',suspended:'Suspended',restoring_backup:'Restoring backup'};
  const stateText=telemetry.error&&!server.status?'Connection unavailable':label[state]||state.replaceAll('_',' ');
  const statusText=operationError?'Action failed':stateText;
  const statusDetail=operationError||(pending?powerOperationDetail(pending,operationElapsed,!!telemetry.error):stateText);
  const statusState=operationError?'install_failed':telemetry.error&&!server.status?'unknown':pending?'starting':state;
  return <div className="server-state-line">
    <span className={`server-state state-${statusState}`} title={statusDetail} role={operationError?'alert':compact?'status':undefined} aria-live={compact?'polite':undefined}>
      <span className="server-meta-label">Status:</span><span className="status-dot"/>
      <span className="server-state-text">{statusText}</span>
    </span>
    <span className={`server-uptime${online&&elapsed>0?' is-online':''}`}>Uptime: <strong>{telemetry.error?'\u2014':formatUptime(elapsed)}</strong></span>
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
  const telemetry=useTelemetry(base,(!server.status||server.status==='reinstall_failed')&&!server.is_installing);
  const power=usePowerOperation(base,telemetry);
  const transition=power.pending?.signal||(!telemetry.error?(telemetry.state==='starting'?'start':telemetry.state==='stopping'?'stop':undefined):undefined);
  return <TelemetryContext.Provider value={telemetry}><PowerContext.Provider value={power}>
    {!dashboardPage?<header className="server-topbar" data-power-transition={transition} data-power-paused={!!telemetry.error}><div className="server-summary"><div className="server-identity-heading"><ServerIdentityIcon artwork={server.artwork}/><div><h1>{server.name}</h1>{server.artwork?.pack_name&&<p className="server-pack-name">{server.artwork.pack_name}</p>}</div></div><ServerStateLine compact/></div><PowerControls compact/></header>:<header><Card className="server-hero server-hero-with-artwork shadcn-card" data-artwork={art.id} data-power-transition={transition} data-power-paused={!!telemetry.error}>
      <DashboardArtwork key={art.src} art={art}/>
      <CardHeader className="server-hero-info">
        <div className="server-hero-title"><CardTitle><div className="server-identity-heading"><ServerIdentityIcon artwork={server.artwork}/><div><h1>{server.name}</h1>{server.artwork?.pack_name&&<p className="server-pack-name">{server.artwork.pack_name}</p>}</div></div></CardTitle></div>
        {server.description&&<CardDescription className="server-description">{server.description}</CardDescription>}
        <div className="server-hero-meta"><ServerStateLine/><ServerConnection key={base}/></div>
      </CardHeader>
      <CardAction className="server-hero-controls"><PowerControls/></CardAction>
    </Card></header>}

    <PageError error={telemetry.error}/>
    {children}
  </PowerContext.Provider></TelemetryContext.Provider>;
}

type Series={name:string;color:string;values:number[]};
function UsageChart({title,series,maximum,format,reading,limit,address}:{title:string;series:Series[];maximum:number;format:(n:number)=>string;reading?:string;limit?:string;address?:string}){
  const chartRef=useRef<HTMLDivElement>(null),[chartWidth,setChartWidth]=useState(480);
  useEffect(()=>{
    const node=chartRef.current;if(!node)return;
    const measure=()=>{const style=getComputedStyle(node);setChartWidth(Math.max(1,node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)))};
    measure();window.addEventListener('resize',measure);
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
    observer?.observe(node);return()=>{observer?.disconnect();window.removeEventListener('resize',measure)};
  },[]);
  const observed=series.flatMap(s=>s.values);
  const scale=Math.max(maximum,...observed,1);
  const chartHeight=128;
  const left=3,right=chartWidth-3,top=8,bottom=chartHeight-8;
  const hasSamples=observed.length>0;
  const x=(index:number,length:number)=>length===1?right:left+(index/(length-1))*(right-left);
  const y=(v:number)=>bottom-(v/scale)*(bottom-top);
  return <Card className="usage-chart dashboard-panel shadcn-card" role="region" aria-label={`${title} chart`}>
    <CardHeader className="dashboard-panel-heading"><CardTitle><div className="chart-heading"><h2>{title}</h2>{address&&<span className="chart-address" aria-label={`Server address: ${address}`} title={address}>{address}</span>}{reading!==undefined&&<p className="chart-reading"><strong>{reading}</strong>{limit&&<span> / {limit}</span>}</p>}</div></CardTitle><CardAction>{reading!==undefined?null:series.length>1?<div className="chart-legend">{series.map(s=><span key={s.name} style={{color:s.color}}><span/>{s.name}</span>)}</div>:<span className="chart-latest">{hasSamples?format(series[0].values.at(-1)||0):'Waiting'}</span>}</CardAction></CardHeader>
    <CardContent className="usage-chart-body">
      <div className="chart-scale" aria-hidden="true">{[1,.5,0].map(f=><span key={f}>{format(scale*f)}</span>)}</div>
      <div className="usage-chart-plot" ref={chartRef}>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`${title}: ${hasSamples?series.map(s=>`${s.name} ${format(s.values.at(-1)||0)}`).join(', '):'waiting for live samples'}`}>
        <title>{`${title}, live samples from this session`}</title>
        {[1,.5,0].map(f=><g key={f}><line x1={left} x2={right} y1={y(scale*f)} y2={y(scale*f)} className="chart-grid"/></g>)}
        {series.map(s=>{
          if(!s.values.length)return null;
          const points=s.values.map((v,i)=>`${x(i,s.values.length)},${y(v)}`).join(' ');
          return <g key={s.name}>
            {series.length===1&&s.values.length>1&&<polygon points={`${left},${bottom} ${points} ${right},${bottom}`} fill={s.color} fillOpacity=".06"/>}
            <polyline points={points} fill="none" stroke={s.color} strokeDasharray={series.length>1&&s.name==='Out'?'5 3':undefined} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
            <circle cx={x(s.values.length-1,s.values.length)} cy={y(s.values.at(-1)||0)} r="3" fill={s.color}/>
          </g>;
        })}
      </svg>
      </div>
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
  const limit=(key:string)=>resourceLimitGB(server.limits?.[key]);
  const network=samples.slice(1).map((sample,index)=>{
    const previous=samples[index],elapsed=Math.max((sample.at-previous.at)/1000,.001);
    // A restart resets Wings' byte counters. Never display that reset as traffic.
    const reset=sample.uptime<previous.uptime;
    return {rx:reset?0:Math.max(0,sample.rx-previous.rx)/elapsed,tx:reset?0:Math.max(0,sample.tx-previous.tx)/elapsed};
  });
  return <>
    <div className="dashboard-charts dashboard-resource-charts">
      <UsageChart title="CPU" reading={updated?`${number(r.cpu_absolute).toFixed(2)}%`:'\u2014'} limit={server.limits?.cpu?`${server.limits.cpu}%`:'\u221e'} series={[{name:'CPU',color:'var(--accent)',values:samples.map(s=>s.cpu)}]} maximum={number(server.limits?.cpu)||1} format={n=>`${n<1?n.toFixed(2):n.toFixed(0)}%`}/>
      <UsageChart title="Memory" reading={updated?resourceUsageGB(r.memory_bytes):'\u2014'} limit={limit('memory')} series={[{name:'Memory',color:'var(--theme-accent-b,var(--accent))',values:samples.map(s=>s.memory)}]} maximum={number(server.limits?.memory)*1024**2} format={formatBytesGB}/>
      <UsageChart title="Network" address={address} series={[{name:'In',color:'var(--accent)',values:network.map(s=>s.rx)},{name:'Out',color:'var(--theme-accent-b,var(--muted))',values:network.map(s=>s.tx)}]} maximum={1} format={n=>`${bytes(n)}/s`}/>
      <ServerStorageSummary compact/>
    </div>
    {children}
  </>;
}

export default function ServerDashboard({children}:{children?:ReactNode}){
  const {permissions}=useServer();
  return <div className="server-dashboard">
    <ServerInsights/>
    <ServerResourcePanels>{can(permissions,'control.console')&&children}</ServerResourcePanels>
  </div>;
}
