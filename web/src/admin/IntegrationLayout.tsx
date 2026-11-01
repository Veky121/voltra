import type {ReactNode} from 'react';
import {SettingsField,SettingsLayout} from '../ui/Settings';
import './integrations.css';

export function IntegrationLayout({children,className=''}:{children:ReactNode;className?:string}){
 return <SettingsLayout><div className={`admin-infrastructure integrations-page integrations-layout settings-responsive ${className}`}>{children}</div></SettingsLayout>;
}
export function IntegrationField({label,hint,children}:{label:ReactNode;hint?:ReactNode;children:ReactNode}){
 return <SettingsField label={label} description={hint}>{children}</SettingsField>;
}
