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
const ephemeralPeerId = "p-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return (window as unknown as { __TAURI__: { core: { invoke: (c: string, a?: Record<string, unknown>) => Promise<T> } } })
    .__TAURI__.core.invoke(cmd, args);
}

// A stable per-install peer id, persisted in localStorage.
export function myPeerId(): string {
  try {
    let id = localStorage.getItem("wte-peer-id");
    if (!id || !/^[a-z0-9_-]{8,64}$/i.test(id)) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "p-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("wte-peer-id", id);
    }
    return id;
  } catch {
    // Private browsing / disabled storage must not collapse every client onto
    // the same identity. Keep one unpredictable ID for this app lifetime.
    return ephemeralPeerId;
  }
}
export function myPeerName(): string {
  try {
    return (localStorage.getItem("wte-peer-name") || "Player").trim().slice(0, 40) || "Player";
  } catch {
    return "Player";
  }
}
export function setPeerName(name: string): void {
  try {
    localStorage.setItem("wte-peer-name", name.trim().slice(0, 40) || "Player");
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
