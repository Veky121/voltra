import {Component, type ReactNode} from 'react';

// React.lazy caches rejected imports. A document reload creates a fresh module
// graph; resetting this boundary would only throw the same rejection again.
export default class RouteRecovery extends Component<{children:ReactNode; resetKey?:string}, {failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  componentDidUpdate(previous:Readonly<{children:ReactNode; resetKey?:string}>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({failed:false});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="page" role="alert" aria-labelledby="route-recovery-title">
      <h1 id="route-recovery-title">This page could not open</h1>
      <p>Use navigation to open another page, or reload to try this page again. Reloading discards unsaved changes.</p>
      <button type="button" className="button" onClick={()=>window.location.reload()}>Reload page</button>
    </section>;
  }
}
