import {PendingSettings} from './client/PendingSettings';
import {ConfirmActionLayer} from './ui/ConfirmAction';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {createBrowserRouter,RouterProvider} from 'react-router-dom';
import App from './App';
import DesktopGate from './desktop';
import './styles.css';
import './theme.css';
import './sidebar.css';
import './user-theme.css';
import './design-system.css';
import './shell-ui.css';
import './shadcn.css';
import './shadcn-app.css';
import './ui/controls.css';
import './glass-surfaces.css';
import './ui/density.css';
const desktop=import.meta.env.VITE_DESKTOP==='true';
if(desktop)document.body.classList.add('voltra-desktop');
function mount(){
 const router=createBrowserRouter([{path:'*',element:<><ConfirmActionLayer/><PendingSettings>{desktop?<DesktopGate><App/></DesktopGate>:<App/>}</PendingSettings></>}]);
 ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router}/></React.StrictMode>);
}
mount();
