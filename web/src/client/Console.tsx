import { useEffect, useRef, useState } from "react";
import { api, Button, Input, Select, Field, Modal } from "../lib";
import {useServerTelemetry} from "./ServerDashboard";
import Terminal from './Terminal';
import {consoleOutput} from './consoleOutput';
import {consoleStateLine} from './consoleLifecycle';
import {requestServerPower, consolePowerEvent, type ConsolePowerEvent} from './serverPower';
import {appendConsoleHistory, emptyConsoleHistory} from './consoleHistory';
import {ConsoleLineQueue,CONSOLE_QUEUE_FRAME_MS} from './consoleQueue';
import {ConsoleReplayOverlap} from './consoleReplay';
import './console.css';
import {
  can,
  json,
  Notice,
  PageError,
  useAction,
  useServer,
  value,
} from "./common";

const featureErrors: Record<string, string[]> = {
  eula: ["you need to agree to the eula in order to run the server"],
  java_version: [
    "minecraft 1.17 requires running the server with java 16 or above",
    "minecraft 1.18 requires running the server with java 17 or above",
    "java.lang.unsupportedclassversionerror",
    "unsupported major.minor version",
    "has been compiled by a more recent version of the java runtime",
  ],
  gsl_token: ["(gsl token expired)", "(account not found)"],
  pid_limit: [
    "pthread_create failed",
    "failed to create thread",
    "unable to create thread",
    "unable to create native thread",
    "unable to create new native thread",
    'exception in thread "craft async scheduler management thread"',
  ],
  steam_disk_space: [
    "steamcmd needs 250mb of free disk space to update",
    "0x202 after update job",
  ],
};
export default function Console() {
  const { base, server, permissions } = useServer();
  const a = useAction();
  const featureAction = useAction();
  const telemetry=useServerTelemetry();
  const [history, setHistory] = useState(emptyConsoleHistory),
    [status, setStatus] = useState("unknown"),
    [connection, setConnection] = useState("Connecting"),
    [socketError, setSocketError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [feature, setFeature] = useState(""),
    [oauth, setOAuth] = useState(""),
    [token, setToken] = useState(""),
    [image, setImage] = useState(""),
    [images, setImages] = useState<Record<string, string>>({});
  useEffect(()=>{if(telemetry.state!=='unknown')setStatus(telemetry.state)},[telemetry.state]);
  const socket = useRef<WebSocket | null>(null),
    pendingLines = useRef(new ConsoleLineQueue()),
    statusRef = useRef(status),
    features = useRef<string[]>([]);
  statusRef.current = status;
  features.current = (server.egg_features || server.features || []).map(
    (s: string) => s.toLowerCase()
  );
  useEffect(() => {
    pendingLines.current.clear();
    setHistory(emptyConsoleHistory());
    let active = true,
      timer: ReturnType<typeof setTimeout>,
      retry = 0;
    let current: WebSocket | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scheduleDrain = () => {
      if (!active || drainTimer !== undefined || !pendingLines.current.size) return;
      drainTimer = setTimeout(drain, document.hidden || reducedMotion.matches ? 0 : CONSOLE_QUEUE_FRAME_MS);
    };
    const drain = () => {
      drainTimer = undefined;
      if (!active) return;
      const incoming = pendingLines.current.take(performance.now(), document.hidden || reducedMotion.matches);
      if (incoming.length) setHistory(old => active ? appendConsoleHistory(old, incoming) : old);
      scheduleDrain();
    };
    const queueLines = (...lines: string[]) => { pendingLines.current.enqueue(lines); scheduleDrain(); };
    const visibilityChanged = () => {
      clearTimeout(drainTimer); drainTimer = undefined;
      scheduleDrain();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    let observedState = "unknown";
    let historyMode: "loading" | "persistent" | "live" | "legacy" = "loading";
    let replayTimer: ReturnType<typeof setTimeout>;
    const replayAbort = new AbortController();
    const overlap = new ConsoleReplayOverlap();
    const savedOverlap = new ConsoleReplayOverlap();
    let cursor = "0", socketReady = false, replayedSaved = false, requestedLiveLogs = false;
    const showingLive = () => historyMode === "live" || historyMode === "legacy";
    const requestLiveLogs = () => {
      if (socketReady && historyMode === "legacy" && !requestedLiveLogs) {
        current?.send(JSON.stringify({event:"send logs", args:[]}));
        requestedLiveLogs = true;
      }
    };
    // Modern fallback keeps polling from the last successful saved cursor.
    // Only legacy servers request the unnumbered Wings log snapshot.
    const useLiveFallback = () => { historyMode = "live"; requestLiveLogs(); };
    const replay = async () => {
      let delay = 1000;
      try {
        const saved = await api(`${base}/console-history?after=${cursor}`, {signal: replayAbort.signal});
        if (!active) return;
        historyMode = saved.capture?.connected ? "persistent" : "live";
        if (historyMode === 'persistent') savedOverlap.clear();
        if (saved.reset) {
          overlap.clear();
          savedOverlap.clear();
          pendingLines.current.clear();
          setHistory(emptyConsoleHistory());
        }
        if (saved.truncated) queueLines("\x1b[0m\x1b[93m[Voltra]: Older output expired from the saved buffer while this console was disconnected.\x1b[0m");
        const restored: string[] = [];
        for (const entry of saved.data ?? []) {
          const text = consoleOutput(String(entry.line ?? ""), entry.event, true);
          if (!text) continue;
          const at = new Date(entry.created_at);
          const stamp = (entry.event === "panel message" || entry.event === "steam output") && !Number.isNaN(at.getTime()) ? `[${at.toLocaleTimeString([], {hour12:false})}] ` : "";
          for (const line of text.split(/\r?\n/)) {
            if (overlap.consume(entry.event, line)) continue;
            if (historyMode === 'live') savedOverlap.record(entry.event, line);
            if (!replayedSaved) restored.push(stamp + line);
            else queueLines(stamp + line);
          }
        }
        if (restored.length) setHistory(old => active ? appendConsoleHistory(old, restored) : old);
        replayedSaved = true;
        cursor = saved.cursor;
        setHistoryError("");
        if (saved.more) delay = 10;
      } catch (error) {
        if (!active || replayAbort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (historyMode === "loading" && message.trim() === "404 page not found") {
          historyMode = "legacy";
          requestLiveLogs();
          return;
        }
        if (historyMode !== "legacy") useLiveFallback();
        setHistoryError("Saved history is unavailable. Showing live output and retrying.");
        delay = 3000;
      }
      if (active) replayTimer = setTimeout(replay, delay);
    };
    void replay();
    const observeState = (next: string) => {
      const line = consoleStateLine(observedState, next);
      if (line) {
        if (historyMode === "legacy") queueLines(line);
        observedState = next;
      }
      statusRef.current = next;
      setStatus(next);
    };
    const powerMessage = (event: Event) => {
      const detail = (event as CustomEvent<ConsolePowerEvent>).detail;
      if (detail?.base === base && historyMode === "legacy") queueLines(detail.line);
    };
    window.addEventListener(consolePowerEvent, powerMessage);
    const append = (s: string, event: string) => {
      const clean = consoleOutput(s, event);
      if (!clean) return;
      const colored = consoleOutput(s, event, true);
      if (showingLive()) for (const line of colored.split(/\r?\n/)) {
        if (historyMode !== 'legacy' && savedOverlap.consume(event, line)) continue;
        if (historyMode !== "legacy") overlap.record(event, line);
        queueLines(line);
      }
      if (statusRef.current === "running") return;
      const f = features.current.find((f) =>
        featureErrors[f]?.some((e) => clean.toLowerCase().includes(e))
      );
      if (f) setFeature(f);
      if (features.current.includes("hytale_oauth")) {
        const link = clean.match(
          /https:\/\/oauth\.accounts\.hytale\.com\/oauth2\/device\/verify\?user_code=[A-Za-z0-9_-]+/i
        )?.[0];
        if (link) {
          setOAuth(link);
          setFeature("hytale_oauth");
        }
      }
    };
    const connect = async () => {
      if (!active) return;
      setConnection(retry ? "Reconnecting" : "Connecting");
      try {
        const response = await api(`${base}/websocket`);
        if (!active) return;
        const d = value(response);
        const u = new URL(d.socket, location.href);
        if (u.protocol === "http:") u.protocol = "ws:";
        if (u.protocol === "https:") u.protocol = "wss:";
        current = new WebSocket(u);
        socket.current = current;
        current.onopen = () =>
          current?.send(JSON.stringify({ event: "auth", args: [d.token] }));
        current.onmessage = (e) => {
          if (!active) return;
          try {
            const message = JSON.parse(e.data),
              args = message.args || [];
            switch (message.event) {
              case "auth success":
                retry = 0;
                setSocketError("");
                setConnection("Connected");
                socketReady = true;
                requestLiveLogs();
                current?.send(
                  JSON.stringify({ event: "send stats", args: [] })
                );
                break;
              case "console output":
              case "install output":
              case "daemon message":
                append(String(args[0] || ""), message.event);
                break;
              case "status":
                observeState(String(args[0]));
                break;
              case "stats": {
                const v =
                  typeof args[0] === "string" ? JSON.parse(args[0]) : args[0];
                if (v?.state) observeState(String(v.state));
                break;
              }
              case "token expiring":
              case "token expired":
                api(`${base}/websocket`)
                  .then((r) =>
                    current?.send(
                      JSON.stringify({ event: "auth", args: [value(r).token] })
                    )
                  )
                  .catch((e) => setSocketError(e.message));
                break;
              case "jwt error":
              case "daemon error":
                setSocketError(
                  String(args[0] || "Daemon rejected the request")
                );
                break;
            }
          } catch {
            setSocketError("Received an invalid daemon event.");
          }
        };
        current.onerror = () =>
          setSocketError(
            "The console connection failed. Check the node address and Wings service."
          );
        current.onclose = () => {
          socketReady = false;
          requestedLiveLogs = false;
          if (active) {
            setConnection("Disconnected");
            timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
          }
        };
      } catch (e) {
        if (active) {
          setSocketError(e instanceof Error ? e.message : String(e));
          setConnection("Disconnected");
          timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
        }
      }
    };
    connect();
    return () => {
      active = false;
      clearTimeout(drainTimer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener(consolePowerEvent, powerMessage);
      pendingLines.current.clear();
      clearTimeout(timer);
      clearTimeout(replayTimer);
      replayAbort.abort();
      current?.close();
      socket.current = null;
    };
  }, [base]);
  useEffect(() => {
    if (feature === "java_version")
      api(`${base}/startup`)
        .then((r) => {
          const d = r.meta?.docker_images || value(r)?.docker_images || {};
          setImages(d);
          setImage((Object.values(d)[0] as string) || "");
        })
        .catch((e) => featureAction.run(() => Promise.reject(e)));
  }, [feature, base]);
  const acceptFeature = () =>
    featureAction.run(
      async () => {
        if (feature === "eula") {
          await api(
            `${base}/files/write?file=${encodeURIComponent("/eula.txt")}`,
            {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: "eula=true",
            }
          );
          if (status === "offline")
            await requestServerPower(base, "restart");
        }
        if (feature === "java_version") {
          await api(
            `${base}/settings/docker-image`,
            json("PUT", { docker_image: image })
          );
          if (status === "offline")
            await requestServerPower(base, "restart");
        }
        if (feature === "gsl_token") {
          await api(
            `${base}/startup/variable`,
            json("PUT", { key: "STEAM_ACC", value: token })
          );
          await requestServerPower(base, "restart");
        }
      },
      () => setFeature("")
    );
  return (
    <section className="console-view" aria-label="Server console">
      <Notice action={a}/>
      <PageError error={socketError}/>
      <PageError error={historyError}/>
      {features.current.includes('voltra_fs25') && can(permissions,'control.console') && <Button disabled={a.busy || status!=='running'} onClick={()=>void a.run(()=>api(`${base}/fs25/save`,json('POST',{})))}>Save game</Button>}
      <Terminal history={history} status={status} connection={connection} busy={a.busy} onClear={()=>{pendingLines.current.clear();setHistory(emptyConsoleHistory())}} onSend={(command,done)=>{void a.run(()=>api(`${base}/command`,json('POST',{command})),done)}}/>
      {feature && (
        <Modal
          title={
            {
              eula: "Accept Minecraft EULA",
              java_version: "Unsupported Java version",
              gsl_token: "Invalid GSL token",
              pid_limit: "Memory or process limit reached",
              steam_disk_space: "Out of available disk space",
              hytale_oauth: "Hytale authentication required",
            }[feature] || feature
          }
          onClose={() => setFeature("")}
        >
          <div className="console-feature-content">
            <Notice action={featureAction} />
            {feature === "eula" && (
              <p>
                To run this server you must agree to the{" "}
                <a
                  href="https://www.minecraft.net/eula"
                  target="_blank"
                  rel="noreferrer"
                >
                  Minecraft EULA
                </a>
                . Accepting writes eula=true to eula.txt.
              </p>
            )}
            {feature === "java_version" && (
              <>
                <p>
                  The server requires a different Java runtime. Select an image
                  provided by this egg.
                </p>
                {can(permissions, "startup.docker-image") && (
                  <Field label="Docker image">
                    <Select
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                    >
                      {Object.entries(images).map(([name, v]) => (
                        <option key={v} value={v}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </>
            )}
            {feature === "gsl_token" && (
              <>
                <p>
                  Your Gameserver Login Token is invalid or expired.{" "}
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href="https://steamcommunity.com/dev/managegameservers"
                  >
                    Generate a Steam token
                  </a>
                  , or leave this empty to remove it.
                </p>
                <Field label="GSL token">
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </Field>
              </>
            )}
            {feature === "pid_limit" && (
              <p>
                The server cannot create more threads. Check its memory allowance
                and container_pid_limit in Wings config.yml. Restart Wings after
                changing its process limit.
              </p>
            )}
            {feature === "steam_disk_space" && (
              <p>
                The install or update cannot complete because the node has
                insufficient disk space. Check df -h on the node, remove unneeded
                files, or increase disk capacity.
              </p>
            )}
            {feature === "hytale_oauth" && (
              <>
                <p>
                  Authenticate your Hytale account to download or update the
                  server files.
                </p>
                <a
                  className="button"
                  href={oauth}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setFeature("")}
                >
                  Authenticate with Hytale
                </a>
              </>
            )}
            <div className="actions">
              <Button variant="secondary" onClick={() => setFeature("")}>
                Close
              </Button>
              {feature === "eula" && can(permissions, "file.update") && (
                <Button disabled={featureAction.busy} onClick={acceptFeature}>
                  I accept
                </Button>
              )}
              {feature === "java_version" &&
                can(permissions, "startup.docker-image") && (
                  <Button
                    disabled={featureAction.busy || !image}
                    onClick={acceptFeature}
                  >
                    Update Docker image
                  </Button>
                )}
              {feature === "gsl_token" && can(permissions, "startup.update") && (
                <Button disabled={featureAction.busy} onClick={acceptFeature}>
                  Update GSL token
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
