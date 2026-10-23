import {ArtworkProvider,useArtworkLibrary} from './client/ArtworkProvider';
﻿import {Suspense,lazy,useContext,useEffect,useRef,useState} from 'react';
import {Link,NavLink,useLocation} from 'react-router-dom';
import {Loading,useAPI,unwrap} from './lib';
import {AdminNavigation,NavigationGroup,PanelSwitcher,SidebarTarget} from './Navigation';
import {Icon,NavIcon} from './Icons';
import BrandMark from './BrandMark';
import SetupGate,{AccountSessionContext} from './setup';
import {ServerNavigationProvider,useServerNavigation,type NavigationServer} from './ServerNavigation';
import {fallbackArtwork,getServerArtwork} from './client/serverArtwork';
const Client=lazy(()=>import('./Client'));
const Admin=lazy(()=>import('./Admin'));
export default function App(){return <SetupGate><AuthenticatedShell/></SetupGate>}
function AuthenticatedShell(){
 const {data,error,reload}=useAPI('/api/client/account');
 const account=data?unwrap(data):null;
 if(error)return <div className="page"><p role="alert">{error}</p><button onClick={reload}>Retry</button></div>;
 if(!account)return <Loading/>;
 return <ServerNavigationProvider key={account.uuid||account.id}><ArtworkProvider><AppShell account={account}/></ArtworkProvider></ServerNavigationProvider>;
}
function ShortcutGroup({label,icon,servers,view}:{label:string;icon:'star'|'clock';servers:NavigationServer[];view:string}){
 useArtworkLibrary();
 return <section className="sidebar-section sidebar-shortcuts" data-shortcut={view}>
  <h2 className="shortcut-heading" aria-label={label} title={label}><Icon name={icon}/><span>{label}</span></h2>
  <nav className="sidebar-nav" aria-label={label}>{servers.slice(0,5).map(s=><NavLink key={s.uuid} to={`/server/${s.identifier||s.uuid}`} title={s.name} aria-label={s.name}><img className="shortcut-artwork" src={getServerArtwork(s).src} alt="" aria-hidden="true" decoding="async" onError={event=>{if(event.currentTarget.getAttribute('src')!==fallbackArtwork.src)event.currentTarget.src=fallbackArtwork.src;}}/><span>{s.name}</span>{s.status&&<span className="shortcut-status" title={s.status.replaceAll('_',' ')} aria-label={s.status.replaceAll('_',' ')}/>}</NavLink>)}</nav>
  {!servers.length&&<p className="shortcut-empty">{view==='favorites'?'Star a server to keep it here.':'Servers you open appear here.'}</p>}
 </section>;
}
function AppShell({account}:{account:Record<string,any>}){
 const location=useLocation(),nav=useServerNavigation();
 const site=useAPI('/api/client/settings');
 const name=unwrap(site.data)?.name||'Voltra';
 const admin=location.pathname==='/admin'||location.pathname.startsWith('/admin/');
 const administrator=!!(account.root_admin||account.admin);
 const serverPage=location.pathname.startsWith('/server/');
 const [sidebarTarget,setSidebarTarget]=useState<HTMLDivElement|null>(null);
 const [menuOpen,setMenuOpen]=useState(false);
 const storageKey=`voltra.sidebar.collapsed.${account.uuid||account.id}`;
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(storageKey)==='true'}catch{return false}});
 const [accountOpen,setAccountOpen]=useState(false),[logoutBusy,setLogoutBusy]=useState(false),[logoutError,setLogoutError]=useState('');
 const accountRef=useRef<HTMLDivElement>(null),accountButton=useRef<HTMLButtonElement>(null);
 const session=useContext(AccountSessionContext);
 const favorites=nav.servers.filter(s=>s.favorite);
 const recent=nav.servers.filter(s=>s.last_visited_at).sort((a,b)=>Date.parse(b.last_visited_at!)-Date.parse(a.last_visited_at!));
 useEffect(()=>{document.title=admin?`${name} · Admin`:name},[name,admin]);
 useEffect(()=>{setMenuOpen(false);setAccountOpen(false);document.getElementById('main-content')?.scrollTo(0,0)},[location.pathname,location.search]);
 useEffect(()=>{if(accountOpen)accountRef.current?.querySelector<HTMLAnchorElement>('.sidebar-account-menu a')?.focus()},[accountOpen]);
 useEffect(()=>{
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);if(accountOpen){setAccountOpen(false);accountButton.current?.focus()}}};
  const outside=(event:PointerEvent)=>{if(!accountRef.current?.contains(event.target as Node))setAccountOpen(false)};
  window.addEventListener('keydown',close);window.addEventListener('pointerdown',outside);
  return()=>{window.removeEventListener('keydown',close);window.removeEventListener('pointerdown',outside)};
 },[accountOpen]);
 useEffect(()=>{window.addEventListener('panel-settings-changed',site.reload);return()=>window.removeEventListener('panel-settings-changed',site.reload)},[site.reload]);
 function toggleCollapsed(){setCollapsed(value=>{try{localStorage.setItem(storageKey,String(!value))}catch{}return !value})}
 return <SidebarTarget.Provider value={sidebarTarget}>
  <div className={`app-shell ${admin?'app-shell--admin':'app-shell--main'}${serverPage?' app-shell--server':''}${collapsed?' is-collapsed':''}`}>
   <a className="skip-link" href="#main-content">Skip to content</a>
   <button className="sidebar-toggle secondary" aria-controls="app-sidebar" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}>{menuOpen?'Close menu':'Menu'}</button>
   {menuOpen&&<button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}/>}
   <aside id="app-sidebar" className={`app-sidebar${menuOpen?' is-open':''}`}>
    <div className="sidebar-brand">
     <div className="sidebar-brand-row"><Link className="brand" to={admin?'/admin':'/'} title={name}><BrandMark/><span className="brand-name">{name}</span></Link><button className="sidebar-collapse" onClick={toggleCollapsed} title={collapsed?'Expand sidebar':'Collapse sidebar'} aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="sidebar-scroll"><Icon name="chevron"/></button></div>
     <PanelSwitcher admin={admin} administrator={administrator}/>
    </div>
    <div className="sidebar-scroll" id="sidebar-scroll" onClick={event=>{if((event.target as Element).closest('a'))setMenuOpen(false)}}>
     {admin?administrator&&<AdminNavigation/>:serverPage?<nav className="sidebar-nav sidebar-back" aria-label="Server navigation"><Link to="/" title="All servers"><NavIcon name="back"/><span>All servers</span></Link></nav>:<NavigationGroup label="Workspace" className="sidebar-workspace">
      <NavLink end to="/" title="Overview"><NavIcon name="dashboard"/><span>Overview</span><span className="sidebar-count">{nav.servers.length}</span></NavLink>
      <NavLink to="/game-library" title="Game Library"><NavIcon name="eggs"/><span>Game Library</span></NavLink>
     </NavigationGroup>}
     <div className="sidebar-sections" ref={setSidebarTarget}/>
     {!admin&&!serverPage&&<><ShortcutGroup label="Favorites" icon="star" servers={favorites} view="favorites"/><ShortcutGroup label="Recents" icon="clock" servers={recent} view="recent"/></>}
     {nav.error&&<div className="sidebar-nav-error" role="alert"><span>{nav.error}</span><button className="text-button" onClick={nav.reload} title="Retry navigation"><Icon name="restart"/><span>Retry</span></button></div>}
    </div>
    <div className="sidebar-bottom" ref={accountRef} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setAccountOpen(false)}}>
     {accountOpen&&<div className="sidebar-account-menu" id="sidebar-account-menu" aria-label="Account menu">
      <span className="account-menu-heading">Your account</span>
      <Link to="/account"><Icon name="users"/>Profile</Link><Link to="/account"><Icon name="settings"/>Settings</Link>
      {session.canSignOut&&<button disabled={logoutBusy} className="account-signout" onClick={async()=>{setLogoutBusy(true);setLogoutError('');try{await session.signOut()}catch(e){setLogoutError(e instanceof Error?e.message:String(e))}finally{setLogoutBusy(false)}}}><Icon name="logout"/>{logoutBusy?'Signing out…':'Sign out'}</button>}
      {logoutError&&<p role="alert">{logoutError}</p>}
     </div>}
     <button ref={accountButton} className="sidebar-identity" aria-label={`Account menu for ${account.username}`} aria-expanded={accountOpen} aria-controls="sidebar-account-menu" onClick={()=>setAccountOpen(!accountOpen)}><span className="account-avatar" aria-hidden="true">{(account.username||'A').charAt(0).toUpperCase()}</span><span className="identity-copy">{account.username}<small>{administrator?'Administrator':'Member'}</small></span><Icon className="account-chevron" name="chevron"/></button>
    </div>
   </aside>
   <main id="main-content" className="app-content" tabIndex={-1}><Suspense fallback={<Loading/>}>{admin?<Admin/>:<Client/>}</Suspense></main>
  </div>
 </SidebarTarget.Provider>;
}
