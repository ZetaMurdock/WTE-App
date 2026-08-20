// W.T.E signaling server — room-code WebRTC rendezvous for cross-network play.
// A dumb relay: it only brokers the SDP/ICE handshake between peers sharing a room
// code. Game data (rolls, tokens, sheets) NEVER touches this server — that flows
// peer-to-peer over the WebRTC data channel (or via your TURN relay as a fallback).
// Self-hosted: run on your VPS behind TLS (see README.md). No database, no state
// beyond the in-memory room roster.
const http = require("http");
const { WebSocketServer } = require("ws");

const MAX_PEERS_PER_ROOM = 12;
const MAX_MSG = 64 * 1024;

function createSignalingServer(port = Number(process.env.PORT) || 8787) {
  const rooms = new Map(); // room -> Map<peerId, { ws, role, name }>

  const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(426);
    res.end("upgrade required");
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG });
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    });
  }, 30000);

  const send = (ws, obj) => {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* client gone */
    }
  };

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    let room = null;
    let peer = null;

    const cleanup = () => {
      if (!room || !peer) return;
      const r = rooms.get(room);
      if (r && r.get(peer)?.ws === ws) {
        r.delete(peer);
        for (const [, p] of r) send(p.ws, { t: "peer-leave", peer });
        if (r.size === 0) rooms.delete(room);
      }
      room = peer = null;
    };

    ws.on("message", (buf) => {
      let m;
      try {
        m = JSON.parse(buf.toString());
      } catch {
        return;
      }

      if (m.t === "join") {
        if (room || peer) {
          send(ws, { t: "error", message: "socket already joined" });
          return;
        }
        const requestedRoom = String(m.room || "").slice(0, 64);
        const requestedPeer = String(m.peer || "").slice(0, 64);
        const role = m.role === "host" ? "host" : "player";
        const name = String(m.name || "Player").slice(0, 40);
        if (!requestedRoom || !requestedPeer) return send(ws, { t: "error", message: "room and peer required" });
        let r = rooms.get(requestedRoom);
        if (!r) rooms.set(requestedRoom, (r = new Map()));
        let existing = r.get(requestedPeer);
        if (existing && existing.ws !== ws) {
          if (existing.ws.readyState !== 1 || existing.ws.isAlive === false) {
            try {
              existing.ws.terminate();
            } catch {
              /* ignore */
            }
            r.delete(requestedPeer);
            existing = null;
          } else {
            send(ws, { t: "error", message: "peer id already connected" });
            ws.close(1008, "duplicate peer id");
            return;
          }
        }
        if (role === "host") {
          for (const [id, entry] of r.entries()) {
            if (entry.role === "host" && entry.ws !== ws) {
              if (entry.ws.readyState !== 1 || entry.ws.isAlive === false) {
                try {
                  entry.ws.terminate();
                } catch {
                  /* ignore */
                }
                r.delete(id);
              } else {
                send(ws, { t: "error", message: "room already has a host" });
                ws.close(1008, "duplicate host");
                return;
              }
            }
          }
        }
        if (r.size >= MAX_PEERS_PER_ROOM && !existing) return send(ws, { t: "error", message: "room full" });
        room = requestedRoom;
        peer = requestedPeer;
        r.set(peer, { ws, role, name });
        // Tell the joiner who's already in the room…
        const peers = [...r.entries()]
          .filter(([id]) => id !== peer)
          .map(([id, p]) => ({ peer: id, role: p.role, name: p.name }));
        send(ws, { t: "joined", room, self: peer, peers });
        // …and tell the others about the joiner.
        for (const [id, p] of r) if (id !== peer) send(p.ws, { t: "peer-join", peer, role, name });
        return;
      }

      if (!room || !peer) return;
      const r = rooms.get(room);
      if (!r) return;

      if (m.t === "signal") {
        // Relay an SDP offer/answer or ICE candidate to one peer in the room.
        const sender = r.get(peer);
        const target = r.get(String(m.to));
        const validRoute = sender && target && sender.role !== target.role && (sender.role === "host" || target.role === "host");
        if (validRoute) send(target.ws, { t: "signal", from: peer, data: m.data });
        return;
      }
      if (m.t === "leave") cleanup();
    });

    ws.on("close", cleanup);
    ws.on("error", () => {});
  });

  httpServer.listen(port, () => console.log(`W.T.E signaling server listening on :${port}`));
  return {
    httpServer,
    wss,
    rooms,
    close: () => {
      clearInterval(heartbeatInterval);
      return new Promise((res) => httpServer.close(res));
    },
  };
}

module.exports = { createSignalingServer };

if (require.main === module) createSignalingServer();
