import {useEffect} from 'react';
import {api, unwrap} from '../lib';
import {useAPIRequest} from '../hooks/useAPIRequest';

export function useGameRequest<T>(path:string|null,poll=0){
  const result=useAPIRequest<any>(path,api);
  // Schedule after completion, so a slow response never overlaps the next poll.
  useEffect(()=>{
    if(!path||!poll||result.loading)return;
    const timer=setTimeout(result.reload,poll);
    return()=>clearTimeout(timer);
  },[path,poll,result.loading,result.data,result.error,result.reload]);
  return {...result,data:result.data===null?null:unwrap(result.data) as T};
}
