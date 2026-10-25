import {useState} from 'react';
import {api,Button,Input,useAPI} from '../lib';
import {SettingsRow,SettingsSection} from '../ui/Settings';
import {json,Notice,PageError,useAction,value} from './common';

export default function SFTPPassword({userID}:{userID?:string}) {
  const admin=!!userID;
  const q=useAPI(admin?`/api/admin/users/${userID}`:'/api/client/account');
  const user=value(q.data);
  const a=useAction();
  const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  return <section className="operations-page settings-page sftp-password">
    <div className="operations-heading"><h2>SFTP password</h2>
    <p>Connect to servers where you have SFTP access. This password is separate from your panel sign-in password.</p></div>
    <PageError error={q.error}/><Notice action={a}/>
    {q.loading&&!user?<p role="status">Loading password status...</p>:user&&<>
      <SettingsSection title={admin?'Reset password':'Change password'}>
      <SettingsRow label="Password status" description={admin?'Set a replacement if the user has forgotten their password. Saved passwords cannot be viewed.':undefined}
        control={<span className="badge">{user.sftp_password_set?'Password set':'Not set'}</span>}/>
      <form onSubmit={e=>{
        e.preventDefault();
        a.run(async()=>{
          if(password!==confirmation)throw new Error('The passwords do not match.');
          if(new TextEncoder().encode(password).length<12||new TextEncoder().encode(password).length>72)throw new Error('Use a password between 12 and 72 bytes.');
          await api(admin?`/api/admin/users/${userID}/sftp-password`:'/api/client/account/sftp-password',json('PUT',{password,current_password:current}));
        },()=>{setCurrent('');setPassword('');setConfirmation('');q.reload();a.setSuccess('SFTP password saved. Use it for new SFTP connections.');});
      }}>
        {!admin&&user.sftp_password_set&&<SettingsRow label="Current SFTP password" description="Ask an administrator to reset it if you have forgotten it." control={<Input aria-label="Current SFTP password" type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)}/>}/>}
        <SettingsRow label="New SFTP password" description="12 to 72 bytes." control={<Input aria-label="New SFTP password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/>}/>
        <SettingsRow label="Confirm SFTP password" control={<Input aria-label="Confirm SFTP password" type="password" autoComplete="new-password" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>}/>
        <div className="settings-actions">
        <Button type="submit" disabled={a.busy||q.loading}>{a.busy?'Saving...':admin?'Set SFTP password':'Save SFTP password'}</Button>
        </div>
      </form>
      </SettingsSection>
    </>}
  </section>;
}
