import {NavLink, Route, Routes, useParams} from 'react-router-dom';
import type {ReactNode} from 'react';
import {can, useServer} from './common';
import {Network, Settings} from './Operations';
import {Databases} from './Collaboration';
import ServerStartup from './ServerStartup';

function Permitted({permission,children}:{permission:string;children:ReactNode}) {
  const {permissions}=useServer();
  return can(permissions,permission)?children:<p role="alert">You do not have permission to view these settings.</p>;
}

export default function ServerSettings() {
  const {id}=useParams();
  const {permissions}=useServer();
  const root=`/server/${id}/settings`;
  const tabs=[['','General',''],['network','Network','allocation.read'],['startup','Startup & runtime','startup.read'],['databases','Databases','database.read']];
  return <>
    <nav className="tabs" aria-label="Server settings">
      {tabs.filter(([, ,permission])=>!permission||can(permissions,permission)).map(([path,label])=><NavLink key={path} to={`${root}${path?`/${path}`:''}`} end={!path}>{label}</NavLink>)}
    </nav>
    <Routes>
      <Route index element={<Settings/>}/>
      <Route path="network" element={<Permitted permission="allocation.read"><Network/></Permitted>}/>
      <Route path="startup" element={<Permitted permission="startup.read"><ServerStartup/></Permitted>}/>
      <Route path="databases" element={<Permitted permission="database.read"><Databases/></Permitted>}/>
      <Route path="*" element={<p>Settings page not found.</p>}/>
    </Routes>
  </>;
}
