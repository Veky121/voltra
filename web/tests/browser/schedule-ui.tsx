import React from "react";
import { createRoot } from "react-dom/client";
import { Schedules } from "../../src/client/Collaboration";
import { ServerContext } from "../../src/client/common";
import "../../src/styles.css";
const calls: unknown[] = [];
(window as any).scheduleCalls = calls;
window.fetch = async (input, init) => {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (method !== "GET") calls.push({path:String(input),method,body});
  return new Response(JSON.stringify(method === "GET" ? {data:[{attributes:{id:7,name:"Custom weekly backup",is_active:true,only_when_online:false,cron:{minute:"30",hour:"9",day_of_month:"*",month:"*",day_of_week:"1"},tasks:[]}}]} : {attributes:body}), {headers:{"Content-Type":"application/json"}});
};
createRoot(document.getElementById("root")!).render(<ServerContext.Provider value={{base:"/api/client/servers/fixture",server:{},permissions:["*"],reload(){}}}><main style={{maxWidth:1000,margin:"40px auto",padding:20}}><Schedules /></main></ServerContext.Provider>);
