import {Icon} from '../Icons';
import {bytes,can,useServer} from './common';
import {useServerTelemetry} from './ServerDashboard';
import {reportedStorage} from './fileMetadata';

export default function FileStorageSummary(){
  const {server,permissions}=useServer(),telemetry=useServerTelemetry();
  const used=reportedStorage(telemetry.resources,telemetry.updated,telemetry.error);
  const limit=Number(server.limits?.disk);
  return <div className="fm-storage" aria-label="Server storage usage">
    <span><Icon name="disk"/>Storage used: {used===null?'Unavailable':bytes(used)}{Number.isFinite(limit)&&limit>0?` / ${bytes(limit*1024**2)}`:limit===0?' · No storage limit':''}</span>
    <span>{!can(permissions,'control.console')?'Storage usage requires console access.':used===null?'Waiting for a storage reading from Wings.':'Total server storage reported by Wings.'} Folder sizes are not calculated.</span>
  </div>;
}
