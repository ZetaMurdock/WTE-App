// Frontend wrappers for the Rust mDNS commands (Phase 7b, slice 2a). LAN-only,
// desktop-only. The WebRTC connect + internet signaling layer on top later.
import { isTauri } from "../lib/tauri";

export interface DiscoveredHost {
  fullname: string;
  room: string;
  peer: string;
  port: number;
  addrs: string[];
}

// Nominal port advertised in the SRV record; the signaling server binds it in slice 2b.
export const SIGNAL_PORT = 45333;

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (window as unknown as { __TAURI__: { core: { invoke: (c: string, a?: Record<string, unknown>) => Promise<T> } } })
    .__TAURI__.core.invoke(cmd, args);
}

// A stable per-install peer id, persisted in localStorage.
export function myPeerId(): string {
  try {
    let id = localStorage.getItem("wte-peer-id");
    if (!id) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "p-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("wte-peer-id", id);
    }
    return id;
  } catch {
    return "p-anon";
  }
}
export function myPeerName(): string {
  try {
    return localStorage.getItem("wte-peer-name") || "Player";
  } catch {
    return "Player";
  }
}
export function setPeerName(name: string): void {
  try {
    localStorage.setItem("wte-peer-name", name);
  } catch {
    /* ignore */
  }
}

export async function advertise(room: string, port = SIGNAL_PORT): Promise<void> {
  if (!isTauri()) return;
  await invoke("net_advertise", { room, peer: myPeerId(), port });
}
export async function unadvertise(): Promise<void> {
  if (!isTauri()) return;
  await invoke("net_unadvertise");
}
export async function discovered(): Promise<DiscoveredHost[]> {
  if (!isTauri()) return [];
  return invoke<DiscoveredHost[]>("net_discovered").catch(() => [] as DiscoveredHost[]);
}
