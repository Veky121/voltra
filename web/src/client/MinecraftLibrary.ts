import {useCallback, useEffect, useState} from "react";
import {api, unwrap} from "../lib";

export const minecraftAPI = "/api/client/game-library/minecraft";
export type MinecraftRuntime = {id: string | number; name: string; major: number; distribution: string; image: string; enabled: boolean};
export type MinecraftOptions = {
  latest: string; versions: string[]; can_install: boolean;
  nodes: {id: string | number; name: string; free_allocations: number; automatic_ports?: boolean; setup_available?: boolean}[];
  loaders: {id: string; name: string}[]; runtimes?: MinecraftRuntime[];
};
export type PackProvider = "curseforge" | "modrinth";
export type MinecraftPack = {id: string; name: string; summary: string; icon_url?: string; downloads?: number; author?: string};
export type MinecraftPackVersion = {id: string; name: string; game_versions: string[]; loaders: string[]; server_supported: boolean};
export type MinecraftPackSelection = {provider: PackProvider; project: MinecraftPack; version: MinecraftPackVersion};

// Associate data with its URL so changing filters cannot display a previous request's result.
export function useMinecraftRequest<T>(path: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{path: string | null; data: T | null; loading: boolean; error: string}>({path: null, data: null, loading: false, error: ""});
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({path, data: null, loading: true, error: ""});
    api(path, {signal: controller.signal}).then(result => {
      if (!controller.signal.aborted) setState({path, data: unwrap(result) as T, loading: false, error: ""});
    }).catch(error => {
      if (!controller.signal.aborted) setState({path, data: null, loading: false, error: error instanceof Error ? error.message : String(error)});
    });
    return () => controller.abort();
  }, [path, attempt]);
  return {...(path && state.path === path ? state : {data: null, loading: !!path, error: ""}), reload};
}

export function gibToMiB(input: string): number | null {
  if (!input.trim()) return null;
  const gib = Number(input), mib = gib * 1024;
  return Number.isFinite(gib) && gib >= 0 && Number.isSafeInteger(mib) ? mib : null;
}
