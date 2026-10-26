import React from "react";
import { createRoot } from "react-dom/client";
import { Schedules } from "../../src/client/Collaboration";
import { ServerContext } from "../../src/client/common";
import "../../src/styles.css";
import '../../src/theme.css';
import '../../src/design-system.css';
import '../../src/shadcn.css';
import '../../src/shadcn-app.css';
import '../../src/ui/controls.css';
const calls: unknown[] = [];
(window as any).scheduleCalls = calls;
let saved={id:7,name:"Weekly backup",is_active:true,only_when_online:false,cron:{minute:"30",hour:"9",day_of_month:"*",month:"*",day_of_week:"1"},tasks:[]};
window.fetch = async (input, init) => {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (method !== "GET") {calls.push({path:String(input),method,body});saved={...saved,...body,cron:Object.fromEntries(['minute','hour','day_of_month','month','day_of_week'].map(key=>[key,body[key]]))};}
  return new Response(JSON.stringify(method === "GET" ? {data:[{attributes:saved}]} : {attributes:body}), {headers:{"Content-Type":"application/json"}});
};
createRoot(document.getElementById("root")!).render(<ServerContext.Provider value={{base:"/api/client/servers/fixture",server:{},permissions:["*"],reload(){}}}><main style={{maxWidth:1000,margin:"40px auto",padding:20}}><Schedules /></main></ServerContext.Provider>);
