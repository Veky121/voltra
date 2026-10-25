import {useContext,useEffect,useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {ChevronsUpDown,ArrowLeft,Check} from 'lucide-react';
import BrandMark from '../BrandMark';
import {AdminNavigation,NavigationGroup,PanelSwitcher} from '../Navigation';
import {Icon,NavIcon} from '../Icons';
import {AccountSessionContext} from '../setup';
import {useServerNavigation,type NavigationServer} from '../ServerNavigation';
import {accountNickname} from '../client/accountProfile';
import {useArtworkLibrary} from '../client/ArtworkProvider';
import {fallbackArtwork,getServerArtwork} from '../client/serverArtwork';
import {Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger,useSidebar} from './ui/sidebar';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuGroup,DropdownMenuLabel,DropdownMenuItem,DropdownMenuSeparator} from './ui/dropdown-menu';

function ServerPickerArtwork({server}:{server:NavigationServer}){
 const artwork=getServerArtwork(server);
 return <img key={artwork.src} className="voltra-server-picker-artwork" src={artwork.src} alt="" aria-hidden="true" onError={event=>{if(event.currentTarget.getAttribute('src')!==fallbackArtwork.src)event.currentTarget.src=fallbackArtwork.src}}/>;
}

function ServerPicker({servers}:{servers:NavigationServer[]}){
 useArtworkLibrary();
 const {pathname}=useLocation(),{isMobile}=useSidebar();
 const identifier=pathname.split('/')[2];
 const current=servers.find(server=>server.identifier===identifier||server.uuid===identifier);
 return <SidebarMenu className="voltra-server-menu"><SidebarMenuItem><DropdownMenu>
  <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip="Switch server" className="voltra-server-picker"/>} aria-label="Switch server">
   <span className="voltra-server-picker-icon">{current?<ServerPickerArtwork server={current}/>:<Icon name="server"/>}</span><span className="voltra-server-picker-copy"><strong>{current?.name||'Server workspace'}</strong><small>{current?.egg_name||'Servers'}</small></span><ChevronsUpDown className="voltra-picker-chevron"/>
  </DropdownMenuTrigger>
  <DropdownMenuContent side={isMobile?'bottom':'right'} align="start" sideOffset={8} className="voltra-dropdown voltra-server-dropdown">
   <DropdownMenuGroup><DropdownMenuLabel>Servers</DropdownMenuLabel><DropdownMenuItem render={<Link to="/"/>}><ArrowLeft/>All servers</DropdownMenuItem></DropdownMenuGroup>
   {servers.length>0&&<><DropdownMenuSeparator/><DropdownMenuGroup>{servers.map(server=><DropdownMenuItem key={server.uuid} render={<Link to={`/server/${server.identifier||server.uuid}`}/> }><ServerPickerArtwork server={server}/><span className="voltra-picker-name">{server.name}</span>{current?.uuid===server.uuid&&<Check/>}</DropdownMenuItem>)}</DropdownMenuGroup></>}
  </DropdownMenuContent>
 </DropdownMenu></SidebarMenuItem></SidebarMenu>;
}

function Shortcuts({label,servers,view}:{label:string;servers:NavigationServer[];view:'favorites'|'recent'}){
 useArtworkLibrary();
 return <div className="voltra-shortcuts" data-shortcut={view}><NavigationGroup label={label}>{servers.slice(0,5).map(server=><Link key={server.uuid} to={`/server/${server.identifier||server.uuid}`} title={server.name}><img className="voltra-shortcut-artwork" src={getServerArtwork(server).src} alt="" aria-hidden="true" loading="lazy" onError={event=>{if(event.currentTarget.getAttribute('src')!==fallbackArtwork.src)event.currentTarget.src=fallbackArtwork.src}}/><span>{server.name}</span>{server.status&&<span className="voltra-shortcut-status" title={server.status.replaceAll('_',' ')} aria-label={server.status.replaceAll('_',' ')}/>}</Link>)}</NavigationGroup>{!servers.length&&<p className="voltra-shortcut-empty">{view==='favorites'?'No favorites yet':'No recent servers'}</p>}</div>;
}

function AccountMenu({account}:{account:Record<string,any>}){
 const nickname=accountNickname(account),administrator=!!(account.root_admin||account.admin);
 const session=useContext(AccountSessionContext),{isMobile,state}=useSidebar();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <><SidebarMenu><SidebarMenuItem><DropdownMenu>
  <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="voltra-account-trigger" tooltip={nickname}/>} aria-label={`Account menu for ${nickname}`}>
   <span className="voltra-account-avatar" aria-hidden="true">{(nickname||'A').charAt(0).toUpperCase()}</span><span className="voltra-account-copy"><strong>{nickname}</strong><small>{administrator?'Administrator':'Member'}</small></span><ChevronsUpDown className="voltra-picker-chevron"/>
  </DropdownMenuTrigger>
  <DropdownMenuContent side={isMobile?'top':state==='collapsed'?'right':'top'} align="end" sideOffset={8} className="voltra-dropdown voltra-account-dropdown">
   <DropdownMenuGroup><DropdownMenuLabel>Your account</DropdownMenuLabel><DropdownMenuItem render={<Link to="/account"/>}><Icon name="settings"/>Settings</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator/>
   <DropdownMenuItem variant="destructive" disabled={busy||!session.canSignOut} onClick={async()=>{if(busy||!session.canSignOut)return;setBusy(true);setError('');try{await session.signOut()}catch(failure){setError(failure instanceof Error?failure.message:String(failure))}finally{setBusy(false)}}}><Icon name="logout"/>{busy?'Logging out…':'Logout'}</DropdownMenuItem>
  </DropdownMenuContent>
 </DropdownMenu></SidebarMenuItem></SidebarMenu>{error&&<p className="voltra-account-error" role="alert">{error}</p>}</>;
}

export function SidebarRouteEffects(){
 const location=useLocation(),{setOpenMobile}=useSidebar();
 useEffect(()=>{setOpenMobile(false);document.getElementById('main-content')?.scrollTo(0,0)},[location.pathname,location.search,setOpenMobile]);
 return null;
}

export default function AppSidebar({account,name,setTarget}:{account:Record<string,any>;name:string;setTarget:(target:HTMLDivElement|null)=>void}){
 const {pathname}=useLocation(),nav=useServerNavigation(),{state,isMobile,setOpenMobile}=useSidebar();
 const admin=pathname==='/admin'||pathname.startsWith('/admin/'),serverPage=pathname.startsWith('/server/');
 const administrator=!!(account.root_admin||account.admin),collapsed=state==='collapsed';
 const favorites=nav.servers.filter(server=>server.favorite);
 const recents=nav.servers.filter(server=>server.last_visited_at).sort((a,b)=>Date.parse(b.last_visited_at!)-Date.parse(a.last_visited_at!));
 return <Sidebar variant="inset" collapsible="icon" className="voltra-sidebar" aria-label="Main navigation">
  <SidebarHeader className="voltra-sidebar-header"><div className="voltra-sidebar-brand-row"><Link className="voltra-sidebar-brand" to={admin?'/admin':'/'} title={name}><BrandMark/><span>{name}</span></Link>{isMobile?<button type="button" className="voltra-sidebar-close" aria-label="Close navigation" onClick={()=>setOpenMobile(false)}><Icon name="close"/></button>:<SidebarTrigger className="voltra-sidebar-collapse" title={collapsed?'Expand sidebar':'Collapse sidebar'} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!collapsed}/>}</div><PanelSwitcher admin={admin} administrator={administrator}/>{serverPage&&!admin&&<ServerPicker servers={nav.servers}/>}</SidebarHeader>
  <SidebarContent className="voltra-sidebar-scroll" id="sidebar-scroll">
   {admin?administrator&&<AdminNavigation/>:serverPage?<SidebarMenu className="voltra-sidebar-back"><SidebarMenuItem><SidebarMenuButton render={<Link to="/"/>} tooltip="All servers"><ArrowLeft/><span>All servers</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>:<NavigationGroup label="Workspace"><Link to="/" title="Overview"><NavIcon name="dashboard"/><span>Overview</span><span className="voltra-sidebar-count">{nav.servers.length}</span></Link><Link to="/game-library" title="Game Library"><NavIcon name="eggs"/><span>Game Library</span></Link></NavigationGroup>}
   <div className="voltra-sidebar-sections" ref={setTarget}/>
   {!admin&&!serverPage&&<><Shortcuts label="Favorites" servers={favorites} view="favorites"/><Shortcuts label="Recents" servers={recents} view="recent"/></>}
   {nav.error&&<div className="voltra-navigation-error" role="alert"><span>{nav.error}</span><button type="button" onClick={nav.reload}><Icon name="restart"/>Retry</button></div>}
  </SidebarContent>
  <SidebarFooter className="voltra-sidebar-footer"><AccountMenu account={account}/></SidebarFooter>
 </Sidebar>;
}
