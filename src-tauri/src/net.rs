// Zero-config LAN discovery for W.T.E netplay (Phase 7b, slice 2a).
// Advertises + browses an mDNS service so devices on the same Wi-Fi find each
// other's rooms with no server and no setup. The WebRTC data channel + internet
// signaling ride on top of this later — see docs/NETPLAY.md.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::State;

const SERVICE_TYPE: &str = "_wte._tcp.local.";

#[derive(Clone, Serialize)]
pub struct DiscoveredHost {
    pub fullname: String,
    pub room: String,
    pub peer: String,
    pub port: u16,
    pub addrs: Vec<String>,
}

pub struct NetState {
    daemon: Mutex<Option<ServiceDaemon>>,
    advertised: Mutex<Option<String>>,
    discovered: Arc<Mutex<HashMap<String, DiscoveredHost>>>,
}

impl Default for NetState {
    fn default() -> Self {
        NetState {
            daemon: Mutex::new(None),
            advertised: Mutex::new(None),
            discovered: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl NetState {
    // Get-or-create the mDNS daemon, spawning the background browser on first use.
    fn ensure(&self) -> Result<ServiceDaemon, String> {
        let mut guard = self.daemon.lock().map_err(|e| e.to_string())?;
        if let Some(d) = guard.as_ref() {
            return Ok(d.clone());
        }
        let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
        let receiver = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
        let discovered = self.discovered.clone();
        std::thread::spawn(move || {
            while let Ok(event) = receiver.recv() {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let host = DiscoveredHost {
                            fullname: info.get_fullname().to_string(),
                            room: info.get_property_val_str("room").unwrap_or("").to_string(),
                            peer: info.get_property_val_str("peer").unwrap_or("").to_string(),
                            port: info.get_port(),
                            addrs: info.get_addresses().iter().map(|a| a.to_string()).collect(),
                        };
                        if let Ok(mut map) = discovered.lock() {
                            map.insert(host.fullname.clone(), host);
                        }
                    }
                    ServiceEvent::ServiceRemoved(_ty, fullname) => {
                        if let Ok(mut map) = discovered.lock() {
                            map.remove(&fullname);
                        }
                    }
                    _ => {}
                }
            }
        });
        *guard = Some(daemon.clone());
        Ok(daemon)
    }
}

// Sanitize a peer id into a valid DNS label for the mDNS host name.
fn host_label(peer: &str) -> String {
    let safe: String = peer
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    format!("wte-{}.local.", safe)
}

#[tauri::command]
pub fn net_advertise(state: State<'_, NetState>, room: String, peer: String, port: u16) -> Result<(), String> {
    let daemon = state.ensure()?;
    let props: [(&str, &str); 2] = [("room", room.as_str()), ("peer", peer.as_str())];
    let info = ServiceInfo::new(SERVICE_TYPE, &room, &host_label(&peer), "", port, &props[..])
        .map_err(|e| e.to_string())?
        .enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    daemon.register(info).map_err(|e| e.to_string())?;
    *state.advertised.lock().map_err(|e| e.to_string())? = Some(fullname);
    Ok(())
}

#[tauri::command]
pub fn net_unadvertise(state: State<'_, NetState>) -> Result<(), String> {
    let fullname = state.advertised.lock().map_err(|e| e.to_string())?.take();
    if let Some(fullname) = fullname {
        let daemon = state.ensure()?;
        daemon.unregister(&fullname).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Start browsing (idempotent) and return the currently-known hosts.
#[tauri::command]
pub fn net_discovered(state: State<'_, NetState>) -> Result<Vec<DiscoveredHost>, String> {
    state.ensure()?;
    let map = state.discovered.lock().map_err(|e| e.to_string())?;
    Ok(map.values().cloned().collect())
}
