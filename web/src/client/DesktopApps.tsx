import {useState} from 'react';
import {api,Button,Input,useAPI,unwrap} from '../lib';
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {date,items,json,Notice,PageError,useAction} from './common';
import {desktopPairingString} from '../desktopPairing';

export default function DesktopApps(){
  const devices=useAPI('/api/client/account/desktop/devices');
  const action=useAction();
  const [pairing,setPairing]=useState<{code:string;panel_url:string;expires_at:string}|null>(null);
  return <section className="operations-page desktop-apps">
    <div className="operations-heading"><h2>Desktop apps</h2>
    <p>Use your account in the Windows app. Each device has the same permissions as your account.</p></div>
    <Notice action={action}/><PageError error={devices.error}/>
    <div className="grid grid-2">
      <SettingsSection title="Link a desktop app">
        <SettingsRow label="Pair with Voltra.exe" description="Create a connection string, then paste it into the Windows app." control={
        <Button disabled={action.busy} onClick={()=>action.run(()=>api('/api/client/account/desktop/pairing',json('POST',{})),result=>setPairing(unwrap(result)))}>Create pairing code</Button>
        }/>
        {pairing&&<SettingsRow label="Connection string" description={`Expires ${date(pairing.expires_at)}. This code works once. Creating another code replaces it. Share it only with your desktop app.`} control={
          <Input aria-label="Desktop connection string" readOnly spellCheck={false} autoComplete="off" value={desktopPairingString(pairing.panel_url,pairing.code)} onFocus={e=>e.target.select()}/>}>
          <div className="actions">
          <Button variant="secondary" onClick={()=>action.run(()=>navigator.clipboard.writeText(desktopPairingString(pairing.panel_url,pairing.code)),()=>action.setSuccess('Connection string copied.'))}>Copy connection string</Button>
          </div>
        </SettingsRow>}
      </SettingsSection>
      <SettingsSection title="Linked devices" action={<Button variant="secondary" onClick={devices.reload}>Refresh</Button>}>
        {devices.loading&&<p className="operations-empty" role="status">Loading devices...</p>}
        {!devices.loading&&!items(devices.data).length&&<p className="operations-empty">No desktop apps linked yet.</p>}
        {items(devices.data).map(device=><SettingsRow key={device.id} label={device.name}
          description={`Linked ${date(device.created_at)}. Last used ${date(device.last_used_at)}.`}
          control={device.revoked_at?<span className="badge">Access revoked</span>:<Button variant="danger" disabled={action.busy} onClick={()=>{if(confirm(`Revoke desktop access for ${device.name}?`))action.run(()=>api(`/api/client/account/desktop/devices/${device.id}`,json('DELETE')),devices.reload)}}>Revoke access</Button>}>
          {!device.revoked_at&&<p className="settings-note">Access expires {date(device.expires_at)}</p>}
        </SettingsRow>)}
      </SettingsSection>
    </div>
  </section>;
}
