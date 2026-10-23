import {useState} from 'react';
import {api,Button,Card,Field,Input,useAPI,unwrap} from '../lib';
import {date,items,json,Notice,PageError,useAction} from './common';
import {desktopPairingString} from '../desktopPairing';

export default function DesktopApps(){
  const devices=useAPI('/api/client/account/desktop/devices');
  const action=useAction();
  const [pairing,setPairing]=useState<{code:string;panel_url:string;expires_at:string}|null>(null);
  return <section>
    <h2>Desktop apps</h2>
    <p className="muted">Use your Voltra account in the Windows app. Each device has its own connection, with the same permissions as your account.</p>
    <Notice action={action}/><PageError error={devices.error}/>
    <div className="grid grid-2">
      <Card>
        <h3>Link a desktop app</h3>
        <p>Open Voltra.exe and paste the connection string below. It includes the panel address and pairing code.</p>
        <Button disabled={action.busy} onClick={()=>action.run(()=>api('/api/client/account/desktop/pairing',json('POST',{})),result=>setPairing(unwrap(result)))}>Create pairing code</Button>
        {pairing&&<div className="desktop-pairing">
          <Field label="Desktop connection string"><Input readOnly spellCheck={false} autoComplete="off" value={desktopPairingString(pairing.panel_url,pairing.code)} onFocus={e=>e.target.select()}/></Field>
          <Button variant="secondary" onClick={()=>action.run(()=>navigator.clipboard.writeText(desktopPairingString(pairing.panel_url,pairing.code)),()=>action.setSuccess('Connection string copied.'))}>Copy connection string</Button>
          <p className="muted">Expires {date(pairing.expires_at)}. This code works once. Creating another code replaces it. Share it only with your desktop app.</p>
        </div>}
      </Card>
      <Card>
        <div className="toolbar"><h3>Linked devices</h3><Button variant="secondary" onClick={devices.reload}>Refresh</Button></div>
        {devices.loading&&<p role="status">Loading devices...</p>}
        {!devices.loading&&!items(devices.data).length&&<p className="muted">No desktop apps linked yet.</p>}
        {items(devices.data).map(device=><section key={device.id} className="desktop-device">
          <h4>{device.name}</h4>
          <p className="muted">Linked {date(device.created_at)}. Last used {date(device.last_used_at)}.</p>
          <p className="muted">{device.revoked_at?'Access revoked':`Access expires ${date(device.expires_at)}`}</p>
          {!device.revoked_at&&<Button variant="danger" disabled={action.busy} onClick={()=>{if(confirm(`Revoke desktop access for ${device.name}?`))action.run(()=>api(`/api/client/account/desktop/devices/${device.id}`,json('DELETE')),devices.reload)}}>Revoke access</Button>}
        </section>)}
      </Card>
    </div>
  </section>;
}
