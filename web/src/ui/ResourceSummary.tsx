import type {ReactNode} from 'react';
import {Card, CardContent} from '../components/ui/card';
import {Progress} from '../components/ui/progress';
import './resourceSummary.css';

export function ResourceSummary({children,label='Server resources'}:{children:ReactNode;label?:string}) {
  return <Card as="section" size="sm" className="resource-summary" aria-label={label}><CardContent className="resource-summary-grid">{children}</CardContent></Card>;
}
export function ResourceMetric({label,value,note,percent,meter,title,className=''}:{label:string;value:ReactNode;note:ReactNode;percent?:number;meter?:ReactNode;title?:string;className?:string}) {
  return <div className={`resource-metric ${className}`} title={title}>
    <div className="resource-metric-heading"><span>{label}</span><strong>{value}</strong></div>
    {meter??(percent===undefined?<div className="resource-meter resource-meter-unavailable" aria-hidden="true"/>:<Progress className="resource-meter" aria-label={`${label} usage`} value={Math.min(100,Math.max(0,percent))}/>)}
    <span className="resource-metric-note">{note}</span>
  </div>;
}
