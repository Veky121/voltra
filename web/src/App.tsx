import {Feedback} from './notifications';
import {ActionButton as MiraAction} from './ui/ActionButton';
import {ArtworkProvider} from './client/ArtworkProvider';
import {Suspense,lazy,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {useLocation} from 'react-router-dom';
import {Loading,useAPI,unwrap} from './lib';
import {SidebarTarget} from './Navigation';
import SetupGate from './setup';
import RouteRecovery from './RouteRecovery';
import {ServerNavigationProvider} from './ServerNavigation';
import {ThemeProvider} from './ThemeProvider';
import AppSidebar,{SidebarRouteEffects} from './components/AppSidebar';
import {SidebarProvider,SidebarInset,SidebarTrigger} from './components/ui/sidebar';
import {TooltipProvider} from './components/ui/tooltip';
import {preloadRoute} from './hooks/preloadRoute';
const loadClient=preloadRoute(()=>import('./Client'));
const loadAdmin=preloadRoute(()=>import('./Admin'));
const Client=lazy(loadClient);
const Admin=lazy(loadAdmin);
export default function App(){
 const location=useLocation();
 const admin=location.pathname==='/admin'||location.pathname.startsWith('/admin/');
 useEffect(()=>{void (admin?loadAdmin:loadClient)().catch(()=>{})},[admin]);
 return <SetupGate><AuthenticatedShell/></SetupGate>
}
function AuthenticatedShell(){
 const {data,error,reload}=useAPI('/api/client/account');
 useEffect(()=>{window.addEventListener('account-profile-updated',reload);return()=>window.removeEventListener('account-profile-updated',reload)},[reload]);
 const account=data?unwrap(data):null;
 if(error&&!account)return <div className="page"><Feedback tone="error" message={<>{error}</>}/><MiraAction onClick={reload}>Retry</MiraAction></div>;
 if(!account)return <Loading/>;
 return <ThemeProvider key={account.uuid||account.id} account={String(account.uuid||account.id)}><ServerNavigationProvider><ArtworkProvider><AppShell account={account}/></ArtworkProvider></ServerNavigationProvider></ThemeProvider>;
}
function AppShell({account}:{account:Record<string,any>}){
 const location=useLocation(),site=useAPI('/api/client/settings');
 const contentRef=useRef<HTMLElement|null>(null);
 useLayoutEffect(()=>{
  const content=contentRef.current;
  if(!content||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // Animate layout sections, preserving their DOM, drafts and live subscriptions.
  const sections=(parent:HTMLElement,depth=0):HTMLElement[]=>{
   const children=Array.from(parent.children).filter((child):child is HTMLElement=>child instanceof HTMLElement&&!child.hidden&&child.getBoundingClientRect().height>0);
   if(depth>=5)return children;
   return children.flatMap(child=>{
    const layout=child.matches('.page,.server-dashboard,.admin-page,.dashboard-charts,.operations-page,[data-slot=tabs-content]')||children.length===1;
    return layout&&child.children.length?sections(child,depth+1):[child];
   });
  };
  const targets=sections(content).filter(section=>!section.matches('.voltra-mobile-toolbar'));
  const ordered=targets.map(element=>({element,top:element.getBoundingClientRect().top})).sort((a,b)=>a.top-b.top);
  let row=-1,lastTop=-Infinity;
  const animations=ordered.map(({element,top})=>{
   if(top-lastTop>12){row++;lastTop=top;}
   return element.animate([{opacity:0},{opacity:1}],{duration:120,delay:Math.min(row,5)*35,easing:'ease-out',fill:'backwards'});
  });
  return()=>animations.forEach(animation=>animation.cancel());
 },[location.pathname]);
 const name=unwrap(site.data)?.name||'Voltra';
 const admin=location.pathname==='/admin'||location.pathname.startsWith('/admin/');
 const serverPage=location.pathname.startsWith('/server/');
 const preserveDensity=location.pathname==='/'||/^\/server\/[^/]+(?:\/(?:files|console)(?:\/.*)?)?\/?$/.test(location.pathname);
 const [sidebarTarget,setSidebarTarget]=useState<HTMLDivElement|null>(null);
 const storageKey=`voltra.sidebar.width.${account.uuid||account.id}`;
 const [sidebarWidth,setSidebarWidth]=useState(()=>{try{const saved=Number(localStorage.getItem(storageKey));return saved?Math.max(220,Math.min(420,saved)):260}catch{return 260}});
 useEffect(()=>{document.title=admin?`${name} | Admin`:name},[name,admin]);
 useEffect(()=>{window.addEventListener('panel-settings-changed',site.reload);return()=>window.removeEventListener('panel-settings-changed',site.reload)},[site.reload]);
 function changeWidth(width:number){setSidebarWidth(width);try{localStorage.setItem(storageKey,String(width))}catch{}}
 return <SidebarTarget.Provider value={sidebarTarget}><TooltipProvider delay={250}>
  <SidebarProvider open={true} allowDesktopCollapse={false} style={{'--sidebar-width':`${sidebarWidth}px`,'--sidebar-width-icon':'56px'} as CSSProperties} className={`app-shell voltra-shadcn-shell ${admin?'app-shell--admin':'app-shell--main'}${serverPage?' app-shell--server':''}`}>
   <SidebarRouteEffects/>
   <a className="skip-link" href="#main-content">Skip to content</a>
   <AppSidebar account={account} name={name} setTarget={setSidebarTarget} width={sidebarWidth} onWidthChange={changeWidth}/>
   <SidebarInset ref={contentRef} data-mira-density={preserveDensity?undefined:'compact'} id="main-content" className="app-content voltra-shadcn-content" tabIndex={-1}>
    <div className="voltra-mobile-toolbar"><SidebarTrigger aria-label="Open navigation"/><span>{name}</span></div>
    <RouteRecovery resetKey={location.pathname}><Suspense fallback={<Loading/>}>{admin?<Admin/>:<Client/>}</Suspense></RouteRecovery>
   </SidebarInset>
  </SidebarProvider>
 </TooltipProvider></SidebarTarget.Provider>;
}
