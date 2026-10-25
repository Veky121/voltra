import {ArtworkProvider} from './client/ArtworkProvider';
import {Suspense,lazy,useEffect,useState,type CSSProperties} from 'react';
import {useLocation} from 'react-router-dom';
import {Loading,useAPI,unwrap} from './lib';
import {SidebarTarget} from './Navigation';
import SetupGate from './setup';
import {ServerNavigationProvider} from './ServerNavigation';
import {ThemeProvider} from './ThemeProvider';
import AppSidebar,{SidebarRouteEffects} from './components/AppSidebar';
import {SidebarProvider,SidebarInset,SidebarTrigger} from './components/ui/sidebar';
import {TooltipProvider} from './components/ui/tooltip';
const Client=lazy(()=>import('./Client'));
const Admin=lazy(()=>import('./Admin'));
export default function App(){return <SetupGate><AuthenticatedShell/></SetupGate>}
function AuthenticatedShell(){
 const {data,error,reload}=useAPI('/api/client/account');
 useEffect(()=>{window.addEventListener('account-profile-updated',reload);return()=>window.removeEventListener('account-profile-updated',reload)},[reload]);
 const account=data?unwrap(data):null;
 if(error)return <div className="page"><p role="alert">{error}</p><button onClick={reload}>Retry</button></div>;
 if(!account)return <Loading/>;
 return <ThemeProvider key={account.uuid||account.id} account={String(account.uuid||account.id)}><ServerNavigationProvider><ArtworkProvider><AppShell account={account}/></ArtworkProvider></ServerNavigationProvider></ThemeProvider>;
}
function AppShell({account}:{account:Record<string,any>}){
 const location=useLocation(),site=useAPI('/api/client/settings');
 const name=unwrap(site.data)?.name||'Voltra';
 const admin=location.pathname==='/admin'||location.pathname.startsWith('/admin/');
 const serverPage=location.pathname.startsWith('/server/');
 const [sidebarTarget,setSidebarTarget]=useState<HTMLDivElement|null>(null);
 const storageKey=`voltra.sidebar.collapsed.${account.uuid||account.id}`;
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(storageKey)==='true'}catch{return false}});
 useEffect(()=>{document.title=admin?`${name} | Admin`:name},[name,admin]);
 useEffect(()=>{window.addEventListener('panel-settings-changed',site.reload);return()=>window.removeEventListener('panel-settings-changed',site.reload)},[site.reload]);
 function changeOpen(open:boolean){setCollapsed(!open);try{localStorage.setItem(storageKey,String(!open))}catch{}}
 return <SidebarTarget.Provider value={sidebarTarget}><TooltipProvider delay={250}>
  <SidebarProvider open={!collapsed} onOpenChange={changeOpen} style={{'--sidebar-width':'15rem','--sidebar-width-icon':'3rem'} as CSSProperties} className={`app-shell voltra-shadcn-shell ${admin?'app-shell--admin':'app-shell--main'}${serverPage?' app-shell--server':''}${collapsed?' is-collapsed':''}`}>
   <SidebarRouteEffects/>
   <a className="skip-link" href="#main-content">Skip to content</a>
   <AppSidebar account={account} name={name} setTarget={setSidebarTarget}/>
   <SidebarInset id="main-content" className="app-content voltra-shadcn-content" tabIndex={-1}>
    <div className="voltra-mobile-toolbar"><SidebarTrigger aria-label="Open navigation"/><span>{name}</span></div>
    <Suspense fallback={<Loading/>}>{admin?<Admin/>:<Client/>}</Suspense>
   </SidebarInset>
  </SidebarProvider>
 </TooltipProvider></SidebarTarget.Provider>;
}
