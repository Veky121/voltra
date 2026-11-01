import {createRoot} from 'react-dom/client';
import {createBrowserRouter,RouterProvider,useSearchParams} from 'react-router-dom';
import {ThemeProvider} from '../../src/ThemeProvider';
import {PendingSettings} from '../../src/client/PendingSettings';
import {Network} from '../../src/client/Operations';
import ServerAdminTools from '../../src/client/ServerAdminTools';
import SteamMaintenance from '../../src/client/SteamMaintenance';
import {ServerContext} from '../../src/client/common';
import {ConfirmActionLayer} from '../../src/ui/ConfirmAction';
import '../../src/ui/controls.css';import '../../src/styles.css';import '../../src/theme.css';import '../../src/design-system.css';import '../../src/shadcn.css';import '../../src/shadcn-app.css';import '../../src/glass-surfaces.css';import '../../src/ui/density.css';
const allocation={id:1,ip:'192.0.2.10',port:25565,is_default:true,notes:''};
const server={internal_id:7,uuid:'fixture',identifier:'fixture',name:'Fixture server',feature_limits:{allocations:5},relationships:{allocations:{data:[{attributes:allocation}]}}};
function Fixture(){
 const [search]=useSearchParams();
 return <ThemeProvider account="minimal-settings-fixture"><main className="app-content" data-mira-density="compact" style={{padding:24}}><ServerContext.Provider value={{server,permissions:search.has('readonly')?['allocation.read','startup.read']:['*'],base:'/api/client/servers/fixture',reload:()=>{}}}><PendingSettings>{search.get('view')==='runtime'?<ServerAdminTools/>:search.get('view')==='steam'?<SteamMaintenance/>:<Network/>}</PendingSettings></ServerContext.Provider><ConfirmActionLayer/></main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<RouterProvider router={createBrowserRouter([{path:'*',element:<Fixture/>}])}/>);
