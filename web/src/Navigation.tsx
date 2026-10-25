import {Children,cloneElement,createContext,isValidElement,useContext,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Link,NavLink,useLocation,type NavLinkRenderProps,type To} from 'react-router-dom';
import {NavIcon,type IconName} from './Icons';
import {SidebarGroup,SidebarGroupContent,SidebarGroupLabel,SidebarMenu,SidebarMenuButton,SidebarMenuItem} from './components/ui/sidebar';

export const SidebarTarget=createContext<HTMLDivElement|null>(null);

export function PanelSwitcher({admin,administrator}:{admin:boolean;administrator:boolean}){
  const canSwitch=admin||administrator;
  return <nav className="panel-switcher" data-panel={admin?'admin':'servers'} data-single={!canSwitch||undefined} aria-label="Panel switcher">
    <span className="panel-switcher-indicator" aria-hidden="true"/>
    {canSwitch&&<Link to="/admin" title="Admin" aria-label="Admin" aria-current={admin?'page':undefined} className={admin?'is-selected':''}><NavIcon name="settings"/><span>Admin</span></Link>}
    <Link to="/" title="Servers" aria-label="Servers" aria-current={!admin?'page':undefined} className={!admin?'is-selected':''}><NavIcon name="server"/><span>Servers</span></Link>
  </nav>;
}

type GroupProps={label:string;description?:string;children:ReactNode;detail?:boolean;className?:string};

export function NavigationGroup({label,description,children,detail=false,className=''}:GroupProps){
  const links=detail?Children.map(children,child=>{
    if(!isValidElement<{children:ReactNode;title?:string}>(child)||typeof child.props.children!=='string')return child;
    const text=child.props.children;
    const icon:IconName=({overview:'dashboard',details:'info',build:'cpu',startup:'startup',databases:'databases',mounts:'mounts',manage:'wrench',delete:'trash',configuration:'settings',java:'startup',variables:'settings',installation:'download',import:'upload'} as Record<string,IconName>)[text]||'settings';
    return cloneElement(child,{title:text},<><NavIcon name={icon}/><span>{text.charAt(0).toUpperCase()+text.slice(1)}</span></>);
  }):children;
  return <SidebarGroup className={`voltra-nav-group ${className}`}>
    <SidebarGroupLabel>{label}</SidebarGroupLabel>
    <SidebarGroupContent><nav aria-label={label}><SidebarMenu>{Children.map(links,child=><NavigationItem>{child}</NavigationItem>)}</SidebarMenu></nav></SidebarGroupContent>
  </SidebarGroup>;
}

type LinkChild={to?:To;end?:boolean;title?:string;children?:ReactNode;className?:string|((state:NavLinkRenderProps)=>string|undefined)};
function NavigationItem({children}:{children:ReactNode}){
  const {pathname}=useLocation();
  if(!isValidElement<LinkChild>(children)||(!children.props.to&&children.type!=='button'))return children;
  const props=children.props,to=typeof props.to==='string'?props.to:props.to?.pathname||'';
  const path=to.split(/[?#]/)[0].replace(/\/$/,'')||'/';
  const matches=!!props.to&&(pathname===path||(!props.end&&path!=='/'&&pathname.startsWith(path+'/')));
  const className=typeof props.className==='function'?props.className({isActive:matches,isPending:false,isTransitioning:false}):props.className;
  const active=matches||!!className?.split(/\s+/).includes('active');
  const render=cloneElement(children,{className});
  return <SidebarMenuItem><SidebarMenuButton render={render} isActive={active} tooltip={props.title} className="voltra-nav-link">{props.children}</SidebarMenuButton></SidebarMenuItem>;
}

export function AdminNavigation(){
  const {pathname}=useLocation();
  const groups=[
    {label:'Basic administration',description:'Panel settings and integrations',links:[
      ['/admin','Overview'],['/admin/settings','Settings'],['/admin/integrations','Integrations'],
    ]},
    {label:'Management',description:'Servers, people and infrastructure',links:[
      ['/admin/servers','Manage servers'],['/admin/users','Users'],['/admin/nodes','Nodes'],['/admin/database-hosts','Database hosts'],
    ]},
    {label:'Service management',description:'Game templates and Java runtimes',links:[
      ['/admin/nests','Nests & eggs'],['/admin/java-runtimes','Java runtimes'],
    ]},
  ];
  return <div className="sidebar-admin-groups">{groups.map(group=><NavigationGroup key={group.label} label={group.label} description={group.description}>
    {group.links.map(([to,label])=><NavLink key={to} to={to} title={label} end={to==='/admin'} className={({isActive})=>isActive||(to==='/admin/nests'&&pathname.startsWith('/admin/eggs/'))?'active':''}><NavIcon name={({'/admin/proxy-gateways':'network','/admin':'dashboard','/admin/settings':'settings','/admin/integrations':'key','/admin/api-keys':'key','/admin/servers':'server','/admin/users':'users','/admin/nodes':'nodes','/admin/locations':'locations','/admin/database-hosts':'databases','/admin/nests':'eggs','/admin/java-runtimes':'startup','/admin/mounts':'mounts'} as Record<string,IconName>)[to]}/><span>{label}</span></NavLink>)}
  </NavigationGroup>)}
    <details className="voltra-sidebar-advanced" open={pathname.startsWith('/admin/api-keys')||pathname.startsWith('/admin/mounts')||pathname.startsWith('/admin/locations')}>
      <summary title="Advanced administration">Advanced</summary>
      <NavigationGroup label="Advanced" className="voltra-advanced-group">
        <NavLink to="/admin/locations" title="Groups" className={({isActive})=>isActive?'active':''}><NavIcon name="locations"/><span>Groups</span></NavLink>
        <NavLink to="/admin/api-keys" title="Application API" className={({isActive})=>isActive?'active':''}><NavIcon name="key"/><span>Application API</span></NavLink>
        <NavLink to="/admin/mounts" title="Mounts" className={({isActive})=>isActive?'active':''}><NavIcon name="mounts"/><span>Mounts</span></NavLink>
      </NavigationGroup>
    </details>
  </div>;
}

// Keep navigation with its page so permission checks and tab state stay local.
export function SidebarSection(props:GroupProps){
  const target=useContext(SidebarTarget);
  if(!target)return null;
  return createPortal(<NavigationGroup {...props}/>,target);
}
