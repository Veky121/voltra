import {AdminResourceSummary} from '../admin/FleetSummary';
import {ResourceSummary,ResourceMetric} from '../ui/ResourceSummary';
import {queryCacheEpoch} from '../hooks/queryCache';
import {readOverviewSnapshot,writeOverviewSnapshot} from './overviewSnapshot';
import {formatMiBGB} from '../resourceUnits';
import {useErrorState} from '../notifications/useErrorState';
import {compareServers} from './serverOrder';
import {Progress} from '../components/ui/progress';
import {useArtworkLibrary} from './ArtworkProvider';
import {useEffect,useState,type CSSProperties} from "react";
import {Link,useSearchParams} from "react-router-dom";
import {api,Button,Input,useAPI} from "../lib";
import {Card,CardHeader,CardTitle,CardDescription,CardAction,CardContent,CardFooter} from '../components/ui/card';
import {Item,ItemMedia,ItemContent,ItemDescription,ItemActions} from '../components/ui/item';
import {Icon} from "../Icons";
import {resourceReadingGB,items,PageError,value} from "./common";
import {fallbackArtwork,getServerBannerArtwork,type ServerArtwork} from "./serverArtwork";
import {ServerIdentityIcon} from './ServerIdentityIcon';
import {getServerSoftwareArtwork} from './serverSoftwareArtwork';
import {artworkColor} from './artworkColor';
import "./workspace.css";
import './shadcn-cards.css';
import "./overview.css";
import {useServerNavigation} from '../ServerNavigation';
import {observeLivePath,observeLiveNavigation,isLivePathFresh} from '../hooks/liveEvents';

type ServerRecord=Record<string,any> & {name?:string;liveState:string;resources?:Record<string,any>;resourceError?:boolean};
const labels:Record<string,string>={running:"Running",offline:"Stopped",stopped:"Stopped",unknown:"Checking",unavailable:"Unavailable",installing:"Installing",starting:"Starting",stopping:"Stopping",suspended:"Suspended",install_failed:"Install failed",reinstall_failed:"Reinstall failed",restoring_backup:"Restoring"};

function useOverview(){
  const [servers,setServers]=useState<ServerRecord[]>(()=>readOverviewSnapshot()??[]),[error,setError]=useErrorState('client/Overview.tsx'),[loading,setLoading]=useState(()=>!readOverviewSnapshot());
  useEffect(()=>{
    const epoch=queryCacheEpoch();
    let active=true,metadataAt=0;
    let stateTimer:ReturnType<typeof setTimeout>,resourceTimer:ReturnType<typeof setTimeout>,flushTimer:ReturnType<typeof setTimeout>|undefined;
    let stateAbort=new AbortController(),resourceAbort=new AbortController();
    let records:ServerRecord[]=readOverviewSnapshot()??[];
    let statePolling=false,resourcePolling=false;
    const generations=new Map<string,object>();
    for(const server of records)generations.set(server.uuid,{});
    const pending=new Map<string,{generation:object;patch:Partial<ServerRecord>}>();
    const subscriptions=new Map<string,()=>void>(),resourceVersions=new Map<string,number>();
    const statesPath='/api/client?summary=overview&states=1';
    function syncSubscriptions(){
      const wanted=new Set(records.filter(s=>!s.status&&!s.is_installing).map(s=>s.uuid));
      for(const [uuid,stop] of subscriptions)if(!wanted.has(uuid)){stop();subscriptions.delete(uuid);resourceVersions.delete(uuid)}
      for(const server of records){
        if(!wanted.has(server.uuid)||subscriptions.has(server.uuid))continue;
        const stop=observeLivePath(`/api/client/servers/${server.identifier||server.uuid}/resources`,snapshot=>{
          if(!active||document.hidden)return;
          resourceVersions.set(server.uuid,(resourceVersions.get(server.uuid)||0)+1);
          const stats=snapshot.status===200?value(snapshot.data):null;
          const patch=stats?{liveState:stats.is_suspended?'suspended':stats.current_state||'unavailable',resources:stats.resources,resourceError:false}:{liveState:'unavailable',resources:undefined,resourceError:true};
          pending.set(server.uuid,{generation:generations.get(server.uuid)!,patch});
          if(flushTimer===undefined)flushTimer=setTimeout(flush,50);
        });
        if(stop)subscriptions.set(server.uuid,stop);
      }
    }
    function publish(next:ServerRecord[]){
      if(!active||epoch!==queryCacheEpoch())return;
      const previous=new Map(records.map(s=>[s.uuid,s]));
      const present=new Set(next.map(s=>s.uuid));
      for(const uuid of generations.keys())if(!present.has(uuid))generations.delete(uuid);
      for(const s of next)if(!generations.has(s.uuid)||previous.get(s.uuid)?.status!==s.status)generations.set(s.uuid,{});
      records=next;
      syncSubscriptions();
      writeOverviewSnapshot(records,epoch);
      setServers(records);
    }
    function flush(){
      flushTimer=undefined;
      if(active&&epoch===queryCacheEpoch()&&!document.hidden&&pending.size){
        records=records.map(s=>{
          const update=pending.get(s.uuid);
          return update&&update.generation===generations.get(s.uuid)&&!s.status&&!s.is_installing?{...s,...update.patch}:s;
        });
        writeOverviewSnapshot(records,epoch);
        setServers(records);
      }
      pending.clear();
    }
    async function resourceRequest(server:ServerRecord,signal:AbortSignal){
      const child=new AbortController();
      let deadline:ReturnType<typeof setTimeout>;
      let cancel=()=>{};
      const stopped=new Promise<never>((_,reject)=>{
        cancel=()=>{child.abort();reject(new Error('Resource request cancelled'));};
        signal.addEventListener('abort',cancel,{once:true});
        deadline=setTimeout(cancel,3000);
        if(signal.aborted)cancel();
      });
      try{
        return value(await Promise.race([api(`/api/client/servers/${server.identifier||server.uuid}/resources`,{signal:child.signal}),stopped]));
      }finally{clearTimeout(deadline!);signal.removeEventListener('abort',cancel);}
    }
    async function collectResources(){
      if(resourcePolling||!active||document.hidden)return;
      resourcePolling=true;
      const controller=resourceAbort=new AbortController();
      const queue=records.filter(s=>!s.status&&!s.is_installing).map(server=>({server,generation:generations.get(server.uuid)!}));
      let next=0;
      try{
        await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
          while(next<queue.length&&!controller.signal.aborted){
            const {server,generation}=queue[next++];
            if(generations.get(server.uuid)!==generation)continue;
            if(isLivePathFresh(`/api/client/servers/${server.identifier||server.uuid}/resources`))continue;
            const version=resourceVersions.get(server.uuid)||0;
            let patch:Partial<ServerRecord>;
            try{
              const stats=await resourceRequest(server,controller.signal);
              patch={liveState:stats.is_suspended?'suspended':stats.current_state||'unavailable',resources:stats.resources,resourceError:false};
            }catch{patch={liveState:'unavailable',resourceError:true};}
            if(active&&!controller.signal.aborted&&version===(resourceVersions.get(server.uuid)||0)){
              pending.set(server.uuid,{generation,patch});
              if(flushTimer===undefined)flushTimer=setTimeout(flush,50);
            }
          }
        }));
      }finally{
        resourcePolling=false;
        if(active&&!document.hidden)resourceTimer=setTimeout(collectResources,1000);
      }
    }
    async function poll(){
      if(statePolling||!active||document.hidden)return;
      statePolling=true;
      const controller=stateAbort=new AbortController();
      try{
        if(Date.now()-metadataAt>=15000){
          let response=await api('/api/client?summary=overview&per_page=100',{signal:controller.signal});
          const all=items(response);
          const pages=Number(response.meta?.pagination?.total_pages??1);
          for(let page=2;page<=pages;page++){
            response=await api(`/api/client?summary=overview&per_page=100&page=${page}`,{signal:controller.signal});
            all.push(...items(response));
          }
          if(!active||controller.signal.aborted)return;
          const previous=new Map(records.map(s=>[s.uuid,s]));
          publish(all.map(s=>({...s,liveState:s.status||(s.is_installing?'installing':previous.get(s.uuid)?.liveState||'unknown'),resources:previous.get(s.uuid)?.resources,resourceError:previous.get(s.uuid)?.resourceError})));
          metadataAt=Date.now();
        }else if(!isLivePathFresh(statesPath)){
          const states=new Map(items(await api('/api/client?summary=overview&states=1',{signal:controller.signal})).map(s=>[s.uuid,s]));
          if(!active||controller.signal.aborted)return;
          publish(records.filter(s=>states.has(s.uuid)).map(s=>{
            const state=states.get(s.uuid)!;
            return {...s,status:state.status,is_installing:['installing','install_failed'].includes(state.status),liveState:state.status||(s.status?'unknown':s.liveState)};
          }));
        }
        setError('');
        // Resource workers have their own schedule and never hold up membership/status.
        if(!resourcePolling){clearTimeout(resourceTimer);void collectResources();}
      }catch(err){if(active&&!controller.signal.aborted){
        if([401,403,404].includes(Number((err as any)?.status)))publish([]);
        setError(err instanceof Error?err.message:String(err));
      }}
      finally{
        statePolling=false;
        if(active){setLoading(false);if(!document.hidden)stateTimer=setTimeout(poll,1000);}
      }
    }
    function stop(){
      clearTimeout(stateTimer);clearTimeout(resourceTimer);clearTimeout(flushTimer);
      flushTimer=undefined;pending.clear();stateAbort.abort();resourceAbort.abort();
    }
    function visibility(){
      stop();
      if(!document.hidden){metadataAt=0;void poll();}
    }
    document.addEventListener('visibilitychange',visibility);
    const stopStates=observeLivePath(statesPath,snapshot=>{
      if(!active||document.hidden||snapshot.status!==200)return;
      const states=new Map(items(snapshot.data).map(s=>[s.uuid,s]));
      const known=new Set(records.map(s=>s.uuid));
      if([...states.keys()].some(id=>!known.has(id)))metadataAt=0;
      publish(records.filter(s=>states.has(s.uuid)).map(s=>{
        const state=states.get(s.uuid)!;
        return {...s,status:state.status,is_installing:['installing','install_failed'].includes(state.status),liveState:state.status||(s.status?'unknown':s.liveState)};
      }));
    });
    const stopInvalidations=observeLiveNavigation(()=>{metadataAt=0;if(active&&!document.hidden){clearTimeout(stateTimer);void poll()}});
    void poll();
    return()=>{active=false;stop();stopStates?.();stopInvalidations();for(const unsubscribe of subscriptions.values())unsubscribe();document.removeEventListener('visibilitychange',visibility);};
  },[]);
  return {servers,error,loading};
}

function Meter({label,reading,ratio}:{label:string;reading:string;ratio:number}){
  return <div className={`overview-resource resource-${label.toLowerCase()}`} data-pressure={ratio>=.95?'high':ratio>=.8?'elevated':undefined}><span>{label}</span><strong title={reading}>{reading}</strong><Progress className="overview-meter" aria-label={`${label} usage`} value={Math.min(100,Math.max(0,ratio*100))}/></div>;
}
function Artwork({art,priority,onColor}:{art:ServerArtwork;priority:boolean;onColor:(color:string|undefined)=>void}){
  const [failed,setFailed]=useState(false);
  return <img className={!failed&&art.kind==='modpack'?'overview-modpack-artwork':undefined} src={failed?fallbackArtwork.src:art.src} alt="" loading={priority?'eager':'lazy'} decoding="async" width={460} height={215} onLoad={event=>onColor(artworkColor(event.currentTarget))} onError={failed?undefined:()=>setFailed(true)}/>;
}
function ServerCard({server:s,priority}:{server:ServerRecord;priority:boolean}){
  useArtworkLibrary();
  const r=s.resourceError?undefined:s.resources,art=getServerBannerArtwork(s),software=getServerSoftwareArtwork(s);
  const version=s.relationships?.variables?.data?.map((v:any)=>v.attributes??v).find((v:any)=>v.env_variable==='MINECRAFT_VERSION')?.server_value;
  const subtitle=s.artwork?.pack_name||(software?[software.name,version].filter(Boolean).join(' ? '):s.description);
  const profile=software?.src||(art.id==='minecraft'?'/game-icons/minecraft-official.png':art.src);
  const [glow,setGlow]=useState<{source:string;color:string|undefined}>();
  return <Card className="overview-server-card shadcn-card" data-state={s.liveState} data-artwork={art.id} style={{'--artwork-color':glow?.source===art.src?glow.color:undefined} as CSSProperties}>
    <Link className="overview-server-link" to={`/server/${s.identifier||s.uuid}`}>
    <div className="overview-server-art"><Artwork key={art.src} art={art} priority={priority} onColor={color=>setGlow({source:art.src,color})}/></div>
    <CardHeader className="overview-server-header">
      <CardDescription className="overview-game-label">{art.name}</CardDescription>
      <CardAction><span className={`overview-state state-${s.liveState}`}><span className="status-dot"/>{labels[s.liveState]||s.liveState.replaceAll("_"," ")}</span></CardAction>
      <div className="overview-server-heading"><div className="server-identity-heading"><ServerIdentityIcon artwork={s.artwork} lazy={!priority} fallback={profile}/><div className="overview-server-title"><CardTitle><h2>{s.name}</h2></CardTitle>{subtitle&&<CardDescription title={subtitle}>{subtitle}</CardDescription>}</div></div></div>
    </CardHeader>
    <CardContent className="overview-resources">
      <Meter label="CPU" reading={r?`${Number(r.cpu_absolute||0).toFixed(1)}%`:"—"} ratio={Number(r?.cpu_absolute||0)/(s.limits?.cpu||100)}/>
      <Meter label="Memory" reading={r?resourceReadingGB(r.memory_bytes,s.limits?.memory):"—"} ratio={s.limits?.memory?Number(r?.memory_bytes||0)/(s.limits.memory*1024**2):0}/>
      <Meter label="Disk" reading={r?resourceReadingGB(r.disk_bytes,s.limits?.disk):"—"} ratio={s.limits?.disk?Number(r?.disk_bytes||0)/(s.limits.disk*1024**2):0}/>
    </CardContent>
    <CardFooter className="overview-server-footer"><Item size="xs" className="shadcn-compact-item"><ItemMedia variant="icon"><Icon name="nodes"/></ItemMedia><ItemContent><ItemDescription title={s.node}>{s.node}</ItemDescription></ItemContent><ItemActions className="overview-open">{s.resourceError?"Live status unavailable":"Open server"}<Icon name="chevron"/></ItemActions></Item></CardFooter>
    </Link>
  </Card>;
}
export default function Overview(){
  const q=useOverview(),[search,setSearch]=useState("");
  const account=useAPI('/api/client/account');
  const administrator=!account.error&&value(account.data)?.root_admin===true;
  const navigation=useServerNavigation(),[params,setParams]=useSearchParams();
  const view=params.get('view');
  const emptySavedView=(view==='favorites'&&!navigation.servers.some(s=>s.favorite))||(view==='recent'&&!navigation.servers.some(s=>s.last_visited_at));
  const running=q.servers.filter(s=>s.liveState==="running").length;
  const preferences=new Map(navigation.servers.map(s=>[s.uuid,s]));
  const filtered=q.servers.filter(s=>{
    const preference=preferences.get(s.uuid);
    return (view!=='favorites'||preference?.favorite)&&(view!=='recent'||preference?.last_visited_at)&&`${s.name} ${s.description||''} ${s.node||''}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  filtered.sort(compareServers);
  return <div className="page workspace-page overview-page">
    <h1 className="overview-accessible-title">Servers</h1>
    {administrator?<AdminResourceSummary/>:<ResourceSummary>{(['cpu','memory','disk'] as const).map(key=>{
      const available=q.servers.filter(s=>s.resources&&!s.resourceError);
      const complete=!q.loading&&!q.error&&available.length===q.servers.length;
      const used=available.reduce((total,s)=>total+Number(s.resources?.[key==='cpu'?'cpu_absolute':key==='memory'?'memory_bytes':'disk_bytes']||0),0)/(key==='cpu'?100:1024**2);
      const limit=q.servers.reduce((total,s)=>total+Number(s.limits?.[key]||0),0)/(key==='cpu'?100:1);
      const unlimited=q.servers.some(s=>!s.limits?.[key]);
      const format=(amount:number)=>key==='cpu'?`${amount.toFixed(2)} vCPUs`:formatMiBGB(amount);
      return <ResourceMetric key={key} label={key==='cpu'?'CPU':key==='memory'?'Memory':'Storage'}
        value={complete?format(used):q.loading?'Loading':'Unavailable'}
        percent={complete&&!unlimited&&limit>0?used/limit*100:undefined}
        title="Live usage across your accessible servers. Limits are server allocations, not node capacity."
        note={!complete?`Readings from ${available.length}/${q.servers.length} servers`:<>{unlimited?'Unlimited server limits':`${format(limit)} allocated`} {"\u00b7"} {running} online / {q.servers.length} servers</>}/>;
    })}</ResourceSummary>}
    <PageError error={q.error}/>
    {(view==='favorites'||view==='recent')&&<div className="overview-view-heading"><h2>{view==='favorites'?'Favorites':'Recent servers'}</h2><Button variant="secondary" onClick={()=>setParams({})}>Show all servers</Button></div>}
    <div className="overview-search-toolbar"><div className="overview-search"><Icon name="search"/><Input type="search" className="overview-search-input" aria-label="Search servers" placeholder="Find a server or node" value={search} onChange={e=>setSearch(e.target.value)}/></div>{search.trim()&&<Button variant="secondary" onClick={()=>setSearch('')}>Clear search</Button>}</div>
    {q.loading?<div className="overview-server-grid overview-skeletons" role="status" aria-label="Loading servers">{[0,1].map(i=><div className="overview-skeleton" key={i} aria-hidden="true"><span/><span/><span/></div>)}</div>:<div className="overview-server-grid">{filtered.map((s,index)=><ServerCard key={s.uuid} server={s} priority={index<2}/>)}</div>}
    {!q.loading&&!q.error&&!filtered.length&&<Card className="workspace-empty shadcn-card"><CardHeader><span className="workspace-empty-icon"><Icon name={emptySavedView?(view==='favorites'?'star':'clock'):q.servers.length?'search':'server'}/></span><CardTitle><h2>{emptySavedView?(view==='favorites'?'No favorites yet':'No recent servers yet'):q.servers.length?"No servers in this view":"Your first server starts here"}</h2></CardTitle><CardDescription>{emptySavedView?(view==='favorites'?'Star a server to keep it in your favorites.':'Servers you open appear here.'):q.servers.length?'Try a different search.':'Choose a game from the library to create your first server.'}</CardDescription></CardHeader><CardContent>{emptySavedView?<Button variant="secondary" onClick={()=>{setParams({});setSearch('')}}>Browse servers</Button>:q.servers.length?<Button variant="secondary" onClick={()=>{setSearch('')}}>Clear search</Button>:<Link className="button" to="/game-library">Explore Game Library<Icon name="chevron"/></Link>}</CardContent></Card>}
  </div>;
}
