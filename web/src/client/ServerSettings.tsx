import {Navigate, Route, Routes, useParams, useLocation} from 'react-router-dom';
import {SectionTabs} from '../ui/SectionTabs';
import type {ReactNode} from 'react';
import {can, useServer} from './common';
import {settingsTabSearch} from './settingsNavigation';
import {Databases} from './Collaboration';
import GameQuickSetup from './GameQuickSetup';

function Permitted({permission,children}:{permission:string;children:ReactNode}) {
  const {permissions}=useServer();
  return can(permissions,permission)?children:<p role="alert">You do not have permission to view these settings.</p>;
}

export default function ServerSettings() {
  const {id}=useParams();
  const location=useLocation();
  const {permissions,server}=useServer();
  const databasesEnabled=Number(server.feature_limits?.databases)>0;
  const root=`/server/${id}/settings`;
  const tabs=[['','Game Config',''],...(databasesEnabled?[['databases','Databases','database.read']]:[])];
  return <div className="server-settings-shell">
    <SectionTabs label="Server settings" items={tabs.filter(([, ,permission])=>!permission||can(permissions,permission)).map(([path,label])=>({id:path,label,to:`${root}${path?`/${path}`:''}`,end:!path}))}/>
    <Routes>
      <Route index element={<GameQuickSetup/>}/>
      <Route path="general" element={<Navigate to={`/server/${id}/runtime?tab=general`} replace/>}/>
      <Route path="network" element={<Navigate to={`/server/${id}/runtime?${settingsTabSearch(new URLSearchParams(location.search),'network')}${location.hash}`} replace/>}/>
      <Route path="startup" element={<Navigate to={`/server/${id}/runtime?tab=runtime`} replace/>}/>
      <Route path="databases" element={databasesEnabled?<Permitted permission="database.read"><Databases/></Permitted>:<Navigate to={root} replace/>}/>
      <Route path="*" element={<p>Settings page not found.</p>}/>
    </Routes>
  </div>;
}
