// MIT. Voltra's server-only compatibility plugin for the publisher IPuckPlugin API.
// Puck and Harmony assemblies are referenced from the legal dedicated-server
// installation, never redistributed or patched on disk. No client plugin.
using System;
using System.Collections;
using System.Reflection;
using HarmonyLib;
using Newtonsoft.Json;
using Unity.Netcode;
using UnityEngine;

namespace Voltra.PuckCompatibility
{
 public sealed class LegacyControls : IPuckPlugin
 {
  const string PatchId="voltra.puck.legacy-controls.v1";
  static Harmony patches;
  static TCPServer query;
  static GameObject reporter;
  static int serverTick,clientTick,frameRate,kickTimeout,queryPort;
  [ThreadStatic] static bool kickContext;
  static float? probedKickDuration;
  static string failure;
  static string lastProof;
  static int Setting(string name,int minimum,int maximum)
  {
   if(!int.TryParse(Environment.GetEnvironmentVariable(name),out int value)||value<minimum||value>maximum)throw new InvalidOperationException("Invalid compatibility setting "+name);
   return value;
  }
  public bool OnEnable()
  {
   try
   {
    if(!ApplicationManager.IsDedicatedGameServer)throw new InvalidOperationException("Voltra legacy controls are dedicated-server only");
    serverTick=Setting("SERVER_TICK_RATE",1,360);clientTick=Setting("CLIENT_TICK_RATE",1,720);frameRate=Setting("FRAME_RATE",1,380);kickTimeout=Setting("KICK_TIMEOUT",0,int.MaxValue);queryPort=Setting("QUERY_PORT",1025,65535);
    patches=new Harmony(PatchId);
    Patch(typeof(ApplicationManager),"SetTargetFrameRate",nameof(FramePrefix));
    Patch(typeof(PhysicsManager),"Awake",null,nameof(PhysicsAfterAwake));
    Patch(typeof(ServerManagerController),"Event_Server_OnServerStarted",null,nameof(ServerStarted));
    Patch(typeof(ServerManager),"Server_KickPlayer",nameof(KickPrefix),null,nameof(KickFinalizer));
    Patch(typeof(TimeoutManager),"AddSteamIdTimeout",nameof(TimeoutPrefix));
    Patch(typeof(ServerManager),"StopTcpServer",nameof(StopQuery));
    Patch(typeof(ServerManager),"StartPortForwarding",nameof(DisableUnmanagedForwarding));
    reporter=new GameObject("VoltraLegacyControls");UnityEngine.Object.DontDestroyOnLoad(reporter);reporter.AddComponent<NativeReporter>();
    // The publisher loads local plugins after its first server-start event.
    // Attach to that already-running native session as well as future starts.
    if(NetworkManager.Singleton!=null&&NetworkManager.Singleton.IsServer)
    {
     NetworkBehaviourSingleton<ServerManager>.Instance.StopPortForwarding();
     ServerStarted();
    }
    if(failure!=null)return false;
    Debug.Log("[VoltraLegacyControls] Publisher IPuckPlugin enabled; no client mod required");
    return true;
   }
   catch(Exception exception)
   {
    failure=exception.GetType().Name+": "+exception.Message;
    Debug.LogError("[VoltraLegacyControls] Compatibility initialization failed: "+failure);
    patches?.UnpatchSelf();Application.Quit(1);return false;
   }
  }
  static void Patch(Type type,string method,string prefix=null,string postfix=null,string finalizer=null)
  {
   MethodInfo target=AccessTools.Method(type,method)??throw new MissingMethodException(type.FullName,method);
   HarmonyMethod Callback(string name)=>name==null?null:new HarmonyMethod(AccessTools.Method(typeof(LegacyControls),name)??throw new MissingMethodException(name));
   patches.Patch(target,Callback(prefix),Callback(postfix),null,Callback(finalizer),null);
  }
  static void FramePrefix(ref int __0){if(ApplicationManager.IsDedicatedGameServer)__0=frameRate;}
  static void PhysicsAfterAwake(PhysicsManager __instance){if(ApplicationManager.IsDedicatedGameServer)__instance.TickRate=serverTick;}
  static bool DisableUnmanagedForwarding(){Debug.Log("[VoltraLegacyControls] Using managed allocations; native uPnP forwarding disabled");return false;}
  static void KickPrefix(out bool __state){__state=kickContext;kickContext=true;}
  static Exception KickFinalizer(Exception __exception,bool __state){kickContext=__state;return __exception;}
  static void TimeoutPrefix(ref float __1){if(kickContext)__1=kickTimeout;}
  static void ServerStarted()
  {
   try
   {
    var manager=NetworkBehaviourSingleton<ServerManager>.Instance;
    if(!NetworkManager.Singleton.IsServer)throw new InvalidOperationException("Expected dedicated server context");
    if(manager.Server.Value.TickRate!=clientTick)throw new InvalidOperationException("Publisher advertised client input tick differs from requested value");
    MonoBehaviourSingleton<PhysicsManager>.Instance.TickRate=serverTick;
    ApplicationManager.SetTargetFrameRate(frameRate);
    if(query!=null)throw new InvalidOperationException("Duplicate compatibility query listener");
    query=new TCPServer((ushort)queryPort);
    query.OnMessageReceived+=(peer,message)=>
    {
     try
     {
      if(message.Length>4096)return;
      var request=JsonConvert.DeserializeObject<TCPServerMessage>(message);
      if(request==null||request.type!=TCPServerMessageType.PreviewRequest)return;
      var response=new TCPServerPreviewResponse {name=manager.ServerConfig.name,players=NetworkManager.Singleton.ConnectedClientsList.Count,maxPlayers=manager.ServerConfig.maxPlayers,isPasswordProtected=!string.IsNullOrEmpty(manager.ServerConfig.password),clientRequiredModIds=manager.ServerConfig.ClientRequiredModIds};
      query.SendMessageAsync(peer,JsonConvert.SerializeObject(response));
     }
     catch(Exception e){Debug.LogWarning("[VoltraLegacyControls] Invalid native preview request: "+e.GetType().Name);}
    };
    query.OnServerStartFailed+=e=>{failure="Native query listener failed: "+e.GetType().Name;Debug.LogError("[VoltraLegacyControls] "+failure);Application.Quit(1);};
    query.Start();
    if(!query.Server.IsListening)throw new InvalidOperationException("Native query listener did not start");
    Debug.Log("[VoltraLegacyControls] Native preview listener ready on TCP "+queryPort);
   }
   catch(Exception e){failure=e.GetType().Name+": "+e.Message;Debug.LogError("[VoltraLegacyControls] "+failure);Application.Quit(1);}
  }
  static void StopQuery(){if(query!=null){query.Stop();query=null;}}
  public bool OnDisable(){StopQuery();patches?.UnpatchSelf();if(reporter!=null)UnityEngine.Object.Destroy(reporter);return true;}
  public static void Report()
  {
   if(NetworkManager.Singleton==null||!NetworkManager.Singleton.IsServer||query==null)return;
   var manager=NetworkBehaviourSingleton<ServerManager>.Instance;
   var physics=MonoBehaviourSingleton<PhysicsManager>.Instance;
   if(probedKickDuration==null)
   {
    var timeout=MonoBehaviourSingleton<TimeoutManager>.Instance;
    string id="voltra-native-probe-"+Guid.NewGuid().ToString("N");bool previous=kickContext;
    try
    {
     kickContext=true;timeout.AddSteamIdTimeout(id,60f);
     var map=(IDictionary)(AccessTools.Field(typeof(TimeoutManager),"steamIdTweenMap")??throw new MissingFieldException("steamIdTweenMap")).GetValue(timeout);
     object tween=map[id];probedKickDuration=Convert.ToSingle((AccessTools.Field(tween.GetType(),"duration")??throw new MissingFieldException("Tween.duration")).GetValue(tween));
     if(Math.Abs(probedKickDuration.Value-kickTimeout)>0.01f)throw new InvalidOperationException("Native kick timeout probe differs");
    }
    finally{kickContext=previous;timeout.RemoveSteamIdTimeout(id);}
   }
   var proof=new {plugin="VoltraLegacyControls-v1",serverPhysicsTick=physics.TickRate,physicsFixedDeltaTime=Time.fixedDeltaTime,advertisedClientInputTick=manager.Server.Value.TickRate,engineTargetFrameRate=Application.targetFrameRate,configuredKickTimeout=kickTimeout,probedNativeKickTweenSeconds=probedKickDuration,nativeQueryPort=queryPort,nativeQueryListening=query.Server.IsListening,clientPluginRequired=false,clientGameplayTested=false,failure};
   string payload=JsonConvert.SerializeObject(proof);
   if(payload!=lastProof){Debug.Log("[VoltraLegacyControls] Native proof "+payload);lastProof=payload;}
  }
 }
 public sealed class NativeReporter:MonoBehaviour
 {
  float next;
  void Update()
  {
   if(Time.unscaledTime<next)return;next=Time.unscaledTime+1f;
   try{LegacyControls.Report();}catch(Exception e){Debug.LogError("[VoltraLegacyControls] Native control probe failed: "+e.GetType().Name+": "+e.Message);Application.Quit(1);}
  }
 }
}
