import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter,RouterProvider} from 'react-router-dom';
import {ThemeProvider} from '../../src/ThemeProvider';
import {PendingSettings} from '../../src/client/PendingSettings';
import {Integration,Integrations} from '../../src/admin/integrations';
import {GameLicences} from '../../src/admin/GameLicences';
import {ProxyGateways} from '../../src/admin/ProxyGateways';
import '../../src/ui/controls.css';import '../../src/styles.css';import '../../src/theme.css';import '../../src/design-system.css';import '../../src/shadcn.css';import '../../src/shadcn-app.css';import '../../src/glass-surfaces.css';import '../../src/ui/density.css';
const view=new URLSearchParams(location.search).get('view')||'/admin/integrations/2';
const wrap=(children:React.ReactNode)=><ThemeProvider account="integration-fixture"><main className="app-content" data-mira-density="compact" style={{padding:24}}><PendingSettings>{children}</PendingSettings></main></ThemeProvider>;
createRoot(document.getElementById('root')!).render(<RouterProvider router={createMemoryRouter([
 {path:'/admin/integrations',element:wrap(<Integrations/>)},
 {path:'/admin/integrations/licences',element:wrap(<GameLicences/>)},
 {path:'/admin/integrations/proxy-gateways',element:wrap(<ProxyGateways/>)},
 {path:'/admin/integrations/:id',element:wrap(<Integration/>)},
],{initialEntries:[view]})}/>);
