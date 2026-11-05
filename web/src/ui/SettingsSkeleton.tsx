import {SettingsSection,SettingsRow,SettingsField} from './Settings';
import {SkeletonLine,SkeletonControl} from './CollectionSkeleton';
import './settingsSkeleton.css';

export function SettingsSkeleton({rows=4,label='Loading settings',variant='rows',title}:{rows?:number;label?:string;variant?:'rows'|'general';title?:string}) {
  return <div className={`settings-skeleton server-skeleton${variant==='general'?' operations-page settings-page server-general-settings':''}`} role="status" aria-label={label} aria-busy="true">
    <span className="button-feedback-sr">{label}</span>
    {variant==='general'?<div aria-hidden="true" className="server-general-grid">
      <SettingsSection title="Server details" className="settings-panel"><div className="settings-fields" data-slot="field-group">{['Name','Description','Owner','External ID'].map(name=><SettingsField key={name} label={name}><SkeletonControl wide tall={name==='Description'}/></SettingsField>)}</div></SettingsSection>
      <SettingsSection title="SFTP"><SettingsRow label="Address" control={<SkeletonControl wide/>}/><SettingsRow label="Username" control={<SkeletonControl wide/>}/><div className="settings-actions settings-actions--split"><SkeletonLine width={112} small/><SkeletonControl/></div></SettingsSection>
      <SettingsSection title="Server information"><SettingsRow label="Node" control={<SkeletonLine width={90}/>}/><SettingsRow label="UUID" control={<SkeletonControl wide/>}/></SettingsSection>
    </div>:<div className="settings-skeleton-section" aria-hidden="true">{title&&<div className="settings-section-heading"><h2>{title}</h2></div>}<div className="settings-group" data-settings-group="" data-slot="card">{Array.from({length:rows},(_,index)=><SettingsRow key={index} label={<SkeletonLine width={index%2?112:84}/>} control={<SkeletonControl wide/>}/>)}</div></div>}
  </div>;
}
