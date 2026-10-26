import {useArtworkLibrary} from './ArtworkProvider';
import {useEffect,useState,type CSSProperties} from "react";
import {Link,useSearchParams} from "react-router-dom";
import {api,Button,Input} from "../lib";
import {Card,CardHeader,CardTitle,CardDescription,CardAction,CardContent,CardFooter} from '../components/ui/card';
import {Item,ItemMedia,ItemContent,ItemDescription,ItemActions} from '../components/ui/item';
import {Icon} from "../Icons";
import {bytes,items,PageError,value} from "./common";
import {fallbackArtwork,getServerArtwork,type ServerArtwork} from "./serverArtwork";
import {ServerIdentityIcon} from './ServerIdentityIcon';
import {getServerSoftwareArtwork} from './serverSoftwareArtwork';
import {ServerSoftwarePatch} from './ServerSoftwarePatch';
import {artworkColor} from './artworkColor';
import "./workspace.css";
import './shadcn-cards.css';
import "./overview.css";
import {useServerNavigation} from '../ServerNavigation';

type ServerRecord=Record<string,any> & {name?:string;liveState:string;resources?:Record<string,any>;resourceError?:boolean};
const labels:Record<string,string>={running:"Running",offline:"Stopped",stopped:"Stopped",unknown:"Checking",unavailable:"Unavailable",installing:"Installing",starting:"Starting",stopping:"Stopping",suspended:"Suspended",install_failed:"Install failed",reinstall_failed:"Reinstall failed",restoring_backup:"Restoring"};

function useOverview(){
  const [servers,setServers]=useState<ServerRecord[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const abort=new AbortController();
    async function poll(){
      try{
        let response=await api("/api/client?per_page=100",{signal:abort.signal});
        const all=items(response);
        const pages=Number(response.meta?.pagination?.total_pages??1);
        for(let page=2;page<=pages;page++){
          response=await api(`/api/client?per_page=100&page=${page}`,{signal:abort.signal});
          all.push(...items(response));
        }
        if(!active)return;
        const records:ServerRecord[]=all.map(s=>({...s,liveState:s.status||(s.is_installing?"installing":"unknown")}));
        setServers(current=>records.map(s=>{
          const old=current.find(previous=>previous.uuid===s.uuid);
          return old&&!s.status&&!s.is_installing?{...s,liveState:old.liveState,resources:old.resources,resourceError:old.resourceError}:s;
        }));setLoading(false);setError("");
        let next=0;
        await Promise.all(Array.from({length:Math.min(4,records.length)},async()=>{
          while(next<records.length){
            const server=records[next++];
            if(server.status||server.is_installing)continue;
            let updated={...server};
            try{
              const stats=value(await api(`/api/client/servers/${server.identifier||server.uuid}/resources`,{signal:abort.signal}));
              updated={...server,liveState:stats.is_suspended?"suspended":stats.current_state||"unavailable",resources:stats.resources};
            }catch{updated={...server,liveState:"unavailable",resourceError:true};}
            if(active)setServers(current=>current.map(s=>s.uuid===server.uuid?updated:s));
          }
        }));
      }catch(err){if(active)setError(err instanceof Error?err.message:String(err));}
      finally{if(active){setLoading(false);timer=setTimeout(poll,1000);}}
    }
    void poll();
    return()=>{active=false;clearTimeout(timer);abort.abort();};
  },[]);
  return {servers,error,loading};
}

function Meter({label,reading,ratio}:{label:string;reading:string;ratio:number}){
  return <div className={`overview-resource resource-${label.toLowerCase()}`} data-pressure={ratio>=.95?'high':ratio>=.8?'elevated':undefined}><span>{label}</span><strong title={reading}>{reading}</strong><div className="overview-meter" aria-hidden="true"><span style={{width:`${Math.min(100,Math.max(0,ratio*100))}%`}}/></div></div>;
}
function storageReading(used:number,limitMiB:number){
  if(!limitMiB)return bytes(used);
  const unit=limitMiB>=1024?1024**3:1024**2;
  const format=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n);
  return `${format(used/unit)} / ${format(limitMiB*1024**2/unit)} ${unit===1024**3?"GiB":"MiB"}`;
}
function Artwork({art,priority,onColor}:{art:ServerArtwork;priority:boolean;onColor:(color:string|undefined)=>void}){
  const [failed,setFailed]=useState(false);
  return <img src={failed?fallbackArtwork.src:art.src} alt="" loading={priority?'eager':'lazy'} decoding="async" width={460} height={215} onLoad={event=>onColor(artworkColor(event.currentTarget))} onError={failed?undefined:()=>setFailed(true)}/>;
}
function ServerCard({server:s,priority}:{server:ServerRecord;priority:boolean}){
  useArtworkLibrary();
  const r=s.resources,art=getServerArtwork(s),software=getServerSoftwareArtwork(s);
  const [glow,setGlow]=useState<{source:string;color:string|undefined}>();
  return <Card className="overview-server-card shadcn-card" data-state={s.liveState} data-artwork={art.id} style={{'--artwork-color':glow?.source===art.src?glow.color:undefined} as CSSProperties}>
    <Link className="overview-server-link" to={`/server/${s.identifier||s.uuid}`}>
    <div className="overview-server-art"><Artwork key={art.src} art={art} priority={priority} onColor={color=>setGlow({source:art.src,color})}/>{software&&<ServerSoftwarePatch key={software.src} artwork={software}/>}</div>
    <CardHeader className="overview-server-header">
      <CardDescription className="overview-game-label">{art.name}</CardDescription>
      <CardAction><span className={`overview-state state-${s.liveState}`}><span className="status-dot"/>{labels[s.liveState]||s.liveState.replaceAll("_"," ")}</span></CardAction>
      <div className="overview-server-heading"><div className="server-identity-heading"><ServerIdentityIcon artwork={s.artwork} lazy={!priority}/><div className="overview-server-title"><CardTitle><h2>{s.name}</h2></CardTitle>{(s.artwork?.pack_name||s.description)&&<CardDescription title={[s.artwork?.pack_name,s.description].filter(Boolean).join(' · ')}>{[s.artwork?.pack_name,s.description].filter(Boolean).join(' · ')}</CardDescription>}</div></div></div>
    </CardHeader>
    <CardContent className="overview-resources">
      <Meter label="CPU" reading={r?`${Number(r.cpu_absolute||0).toFixed(1)}%`:"—"} ratio={Number(r?.cpu_absolute||0)/(s.limits?.cpu||100)}/>
      <Meter label="Memory" reading={r?storageReading(Number(r.memory_bytes||0),s.limits?.memory):"—"} ratio={s.limits?.memory?Number(r?.memory_bytes||0)/(s.limits.memory*1024**2):0}/>
      <Meter label="Disk" reading={r?storageReading(Number(r.disk_bytes||0),s.limits?.disk):"—"} ratio={s.limits?.disk?Number(r?.disk_bytes||0)/(s.limits.disk*1024**2):0}/>
    </CardContent>
    <CardFooter className="overview-server-footer"><Item size="xs" className="shadcn-compact-item"><ItemMedia variant="icon"><Icon name="nodes"/></ItemMedia><ItemContent><ItemDescription title={s.node}>{s.node}</ItemDescription></ItemContent><ItemActions className="overview-open">{s.resourceError?"Live status unavailable":"Open server"}<Icon name="chevron"/></ItemActions></Item></CardFooter>
    </Link>
  </Card>;
}
export default function Overview(){
  const q=useOverview(),[search,setSearch]=useState(""),[filter,setFilter]=useState('all');
  const navigation=useServerNavigation(),[params,setParams]=useSearchParams();
  const view=params.get('view');
  const emptySavedView=(view==='favorites'&&!navigation.servers.some(s=>s.favorite))||(view==='recent'&&!navigation.servers.some(s=>s.last_visited_at));
  const running=q.servers.filter(s=>s.liveState==="running").length;
  const stopped=q.servers.filter(s=>["offline","stopped"].includes(s.liveState)).length;
  const other=q.servers.length-running-stopped;
  const matchesState=(s:ServerRecord)=>filter==='all'||(filter==='running'?s.liveState==='running':filter==='stopped'?['offline','stopped'].includes(s.liveState):!['running','offline','stopped'].includes(s.liveState));
  const filtered=q.servers.filter(s=>{
    const preference=navigation.servers.find(p=>p.uuid===s.uuid);
    return (view!=='favorites'||preference?.favorite)&&(view!=='recent'||preference?.last_visited_at)&&matchesState(s)&&`${s.name} ${s.description||''} ${s.node||''}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  if(view==='recent')filtered.sort((a,b)=>Date.parse(navigation.servers.find(p=>p.uuid===b.uuid)?.last_visited_at||'')-Date.parse(navigation.servers.find(p=>p.uuid===a.uuid)?.last_visited_at||''));
  const filters=[{id:'all',label:'All servers',count:q.servers.length},{id:'running',label:'Running',count:running},{id:'stopped',label:'Stopped',count:stopped},{id:'attention',label:'Other states',count:other}];
  return <div className="page workspace-page overview-page">
    <h1 className="overview-accessible-title">Server overview</h1>
    <div className="overview-totals" aria-label="Server totals">
      {[{label:"Total servers",count:q.servers.length,icon:"server",kind:"total"},{label:"Running",count:running,icon:"play",kind:"running"},{label:"Stopped",count:stopped,icon:"stop",kind:"stopped"}].map(x=><Card className={`overview-total shadcn-card total-${x.kind}`} key={x.kind}><CardHeader><CardTitle>{x.label}</CardTitle><CardAction><span className="overview-total-icon" aria-hidden="true"><Icon name={x.icon as "server"|"play"|"stop"}/></span></CardAction></CardHeader><CardContent><strong>{q.loading?"—":x.count}</strong></CardContent></Card>)}
    </div>
    <PageError error={q.error}/>
    {(view==='favorites'||view==='recent')&&<div className="overview-view-heading"><h2>{view==='favorites'?'Favorites':'Recent servers'}</h2><Button variant="secondary" onClick={()=>setParams({})}>Show all servers</Button></div>}
    <div className="overview-list-heading"><div><h2>Your servers <span className="overview-count">{q.servers.length}</span></h2><p className="muted">{other>0?`${other} ${other===1?"server is":"servers are"} changing state or awaiting status.`:'Select a server to open its workspace.'}</p></div><div className="toolbar"><div className="overview-search"><Icon name="search"/><Input type="search" className="overview-search-input" aria-label="Search servers" placeholder="Find a server or node…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div></div>
    <div className="overview-filters" role="group" aria-label="Filter servers by status">{filters.map(f=><button key={f.id} type="button" aria-pressed={filter===f.id} onClick={()=>setFilter(f.id)}>{f.label}<span>{q.loading?'—':f.count}</span></button>)}</div>
    {q.loading?<div className="overview-server-grid overview-skeletons" role="status" aria-label="Loading servers">{[0,1].map(i=><div className="overview-skeleton" key={i} aria-hidden="true"><span/><span/><span/></div>)}</div>:<div className="overview-server-grid">{filtered.map((s,index)=><ServerCard key={s.uuid} server={s} priority={index<2}/>)}</div>}
    {!q.loading&&!q.error&&!filtered.length&&<Card className="workspace-empty shadcn-card"><CardHeader><span className="workspace-empty-icon"><Icon name={emptySavedView?(view==='favorites'?'star':'clock'):q.servers.length?'search':'server'}/></span><CardTitle><h2>{emptySavedView?(view==='favorites'?'No favorites yet':'No recent servers yet'):q.servers.length?"No servers in this view":"Your first server starts here"}</h2></CardTitle><CardDescription>{emptySavedView?(view==='favorites'?'Star a server to keep it in your favorites.':'Servers you open appear here.'):q.servers.length?'Try a different search or status filter.':'Choose a game from the library to create your first server.'}</CardDescription></CardHeader><CardContent>{emptySavedView?<Button variant="secondary" onClick={()=>{setParams({});setSearch('');setFilter('all')}}>Browse servers</Button>:q.servers.length?<Button variant="secondary" onClick={()=>{setSearch('');setFilter('all')}}>Clear filters</Button>:<Link className="button" to="/game-library">Explore Game Library<Icon name="chevron"/></Link>}</CardContent></Card>}
  </div>;
}
