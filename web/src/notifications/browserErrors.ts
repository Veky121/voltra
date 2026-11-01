import {captureErrorContext,reportPanelError,resetNotificationSession} from './store';

export function observeBrowserErrors(){
 const error=(event:ErrorEvent)=>{if(event.message)reportPanelError(event.error||event.message,captureErrorContext('Browser',{quiet:/^ResizeObserver loop/.test(event.message)}))};
 const rejection=(event:PromiseRejectionEvent)=>reportPanelError(event.reason,captureErrorContext('Browser'));
 window.addEventListener('error',error);window.addEventListener('unhandledrejection',rejection);
 window.addEventListener('panel-auth-changed',resetNotificationSession);window.addEventListener('desktop-session-rejected',resetNotificationSession);
 return()=>{window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',rejection);window.removeEventListener('panel-auth-changed',resetNotificationSession);window.removeEventListener('desktop-session-rejected',resetNotificationSession)};
}
