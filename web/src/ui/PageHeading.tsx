import {Children,type ReactNode} from 'react';
import './pageHeading.css';

// Keep route names accessible without a visible title block or reserved space.
export function PageHeading({title,children}:{title:ReactNode;children?:ReactNode}){
 const actions=Children.toArray(children);
 return <><h1 className="page-heading-accessible">{title}</h1>{actions.length>0&&<div className="page-heading-actions actions">{actions}</div>}</>;
}
