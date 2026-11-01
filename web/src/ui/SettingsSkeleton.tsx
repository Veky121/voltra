import {Skeleton} from '../components/ui/skeleton';
import './settingsSkeleton.css';

export function SettingsSkeleton({rows=4}:{rows?:number}) {
  return <div className="settings-skeleton" role="status" aria-label="Loading settings">
    <span className="button-feedback-sr">Loading settings</span>
    {Array.from({length:rows},(_,index)=><div key={index} aria-hidden="true"><Skeleton className="settings-skeleton-label"/><Skeleton className="settings-skeleton-control"/></div>)}
  </div>;
}
