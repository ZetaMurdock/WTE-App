# W.T.E Netplay — Zero-Config P2P (Phase 7b)

Real multiplayer with no Firebase: players discover a lobby and sync the VTT + character
sheets peer-to-peer, on the same Wi-Fi **or across the internet**.

## Goals

- **Zero-config on a LAN** — same Wi-Fi peers find each other with no server, no setup.
- **Works across the world** — internet rooms via a room code.
- **Ease of access** — host a room / join a room; nothing else to configure.
- **Not barebones** — a transport-agnostic core we *extend*, never rebuild.

## Architecture

```
 App (React)  ─────────────►  NetSession  ─────────────►  Transport
 rolls, sheets, VTT state     host-authoritative          WebRTC data channels
 (typed pub/sub)              room + peer roster           (LAN + internet)
                                                            │
                              Signaling ───────────────────┤
                              • mDNS (LAN, serverless)      │
                              • signaling server (internet) │
                              • STUN (public) + TURN (NAT)  │
```

- **Transport** (`src/net/transport.ts`) moves opaque `Envelope`s between endpoints. The rest of
  the app is unaware of whether WebRTC/mDNS/loopback sits underneath. Interfaces first; the WebRTC
  implementation plugs in without touching layers above.
- **NetSession** (`src/net/session.ts`) is **host-authoritative**: one host (the GM) owns the room
  and the peer roster; players connect to the host, which relays shared messages. App code
  `publish()`es intents and subscribes to typed events — it never sees the wire.
- **Protocol** (`src/net/protocol.ts`) is a small, versioned message set. VTT/sheet sync are already
  reserved message types (`vtt-patch`, `sheet-patch`, `snapshot`) so wiring them later **extends
  payloads, not the envelope**.

## Topology & authority

Star, host-authoritative. Players open one WebRTC connection to the host. The host validates and
rebroadcasts shared events (rolls, chat, presence, patches) and is the source of truth for state;
late joiners get a `snapshot` then incremental patches. This mirrors how a GM runs the table and
avoids mesh/merge complexity.

## Signaling

- **LAN:** Rust advertises/browses an mDNS service (`_wte._tcp.local`); the SDP/ICE handshake rides
  mDNS TXT/records or a tiny local exchange. No server.
- **Internet:** a lightweight signaling server brokers offer/answer by room code; public STUN for
  candidate discovery; a TURN relay as fallback for symmetric NATs. Signaling only brokers the
  connection — game traffic stays P2P on the data channel.

## Roadmap (slices)

1. **Foundation (this slice):** protocol + host-authoritative `NetSession` + `Transport` interface +
   an in-process `LoopbackTransport`, verified with a 2-peer handshake + roll broadcast. No WebRTC yet.
2. **WebRTC transport + mDNS (LAN):** `WebRtcTransport` (RTCPeerConnection data channels) + Rust mDNS
   discovery; host/join a LAN room, presence + rolls live. Lobby UI.
3. **Signaling server (internet):** room codes, STUN/TURN; join across networks.
4. **State sync:** wire VTT map/tokens + character sheets onto `snapshot` + `*-patch`; the legacy
   Firebase table sync retires.

## Non-goals (for now)

Anti-cheat, server-side persistence, spectator scaling. The host is trusted (it's the GM's machine).
