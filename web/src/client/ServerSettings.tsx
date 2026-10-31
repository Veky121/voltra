import {Navigate, Route, Routes, useParams} from 'react-router-dom';
import {SectionTabs} from '../ui/SectionTabs';
import type {ReactNode} from 'react';
import {can, useServer} from './common';
import {Network} from './Operations';
import {Databases} from './Collaboration';
import GameQuickSetup from './GameQuickSetup';

function Permitted({permission,children}:{permission:string;children:ReactNode}) {
  const {permissions}=useServer();
  return can(permissions,permission)?children:<p role="alert">You do not have permission to view these settings.</p>;
}

export default function ServerSettings() {
  const {id}=useParams();
  const {permissions}=useServer();
  const root=`/server/${id}/settings`;
  const tabs=[['','Game',''],['network','Network','allocation.read'],['databases','Databases','database.read']];
  return <div className="server-settings-shell">
    <SectionTabs label="Server settings" items={tabs.filter(([, ,permission])=>!permission||can(permissions,permission)).map(([path,label])=>({id:path,label,to:`${root}${path?`/${path}`:''}`,end:!path}))}/>
    <Routes>
      <Route index element={<GameQuickSetup/>}/>
      <Route path="general" element={<Navigate to={`/server/${id}/runtime?tab=general`} replace/>}/>
      <Route path="network" element={<Permitted permission="allocation.read"><Network/></Permitted>}/>
      <Route path="startup" element={<Navigate to={`/server/${id}/runtime`} replace/>}/>
      <Route path="databases" element={<Permitted permission="database.read"><Databases/></Permitted>}/>
      <Route path="*" element={<p>Settings page not found.</p>}/>
    </Routes>
  </div>;
}
