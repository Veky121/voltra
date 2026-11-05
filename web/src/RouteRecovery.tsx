import {Feedback} from './notifications';
import {ActionButton as MiraAction} from './ui/ActionButton';
import {Component, type ReactNode} from 'react';
import './routeEntry.css';

// React.lazy caches rejected imports. A document reload creates a fresh module
// graph; resetting this boundary would only throw the same rejection again.
export default class RouteRecovery extends Component<{children:ReactNode; resetKey?:string}, {failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }

  componentDidUpdate(previous:Readonly<{children:ReactNode; resetKey?:string}>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({failed:false});
  }
  render() {
    // Keep route content at its existing DOM depth and preserve every child key.
    // A hidden marker scopes entry motion without remounting drafts or editors.
    if (!this.state.failed) return <><span className="route-entry-marker" hidden aria-hidden="true"/>{this.props.children}</>;
    return <><Feedback tone="error" message={<><h1 id="route-recovery-title">This page could not open</h1> <p>Use navigation to open another page, or reload to try this page again. Reloading discards unsaved changes.</p></>}/><MiraAction type="button" className="button" onClick={()=>window.location.reload()}>Reload page</MiraAction></>;
  }
}
