# W.T.E Netplay — self-hosted server stack

Two small pieces run on **one VPS you control**, so players on different networks can
connect by room code (see [../docs/NETPLAY.md](../docs/NETPLAY.md)):

1. **Signaling** (`signaling/`) — a WebSocket relay that brokers the WebRTC handshake by
   room code. Tiny, low-traffic, no database. Game data never passes through it.
2. **TURN** (`turn/`) — `coturn`, a relay that carries the P2P data channel *only when* two
   home routers refuse a direct link (strict NAT). Low bandwidth for our traffic.

You also need a **domain** with two records pointing at the VPS, e.g.
`signal.example.com` and `turn.example.com`, so both can serve **TLS** (the app connects over
`wss://` and `turns://`).

## 1. Signaling server

```bash
# on the VPS (Ubuntu), Node 18+
sudo mkdir -p /opt/wte && sudo chown $USER /opt/wte
cp -r server/signaling /opt/wte/signaling
cd /opt/wte/signaling && npm install --omit=dev
node index.js            # quick check: "listening on :8787"; curl localhost:8787/health → ok
```

Run it as a service:
```bash
sudo useradd -r -s /usr/sbin/nologin wte || true
sudo cp /opt/wte/signaling/wte-signal.service /etc/systemd/system/
# edit User/WorkingDirectory in the unit if you changed paths
sudo systemctl daemon-reload && sudo systemctl enable --now wte-signal
```

**TLS via Caddy** (auto HTTPS → gives you `wss://signal.example.com`):
```
# /etc/caddy/Caddyfile
signal.example.com {
    reverse_proxy 127.0.0.1:8787
}
```
```bash
sudo systemctl reload caddy
```

## 2. TURN (coturn)

```bash
sudo apt install coturn
# get a cert for turn.example.com (certbot, or reuse Caddy's) then:
sudo cp server/turn/turnserver.conf /etc/turnserver.conf
sudo nano /etc/turnserver.conf     # set external-ip, realm, static-auth-secret, cert paths
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
```

Generate the shared secret once and keep it safe:
```bash
openssl rand -hex 32     # paste into static-auth-secret
```
The app derives **time-limited** TURN credentials from this secret, so no static password
ships in the client.

## 3. Firewall (ufw)

```bash
sudo ufw allow 443/tcp          # Caddy (signaling wss)
sudo ufw allow 3478             # TURN (tcp+udp)
sudo ufw allow 5349             # TURN over TLS (tcp+udp)
sudo ufw allow 49152:65535/udp  # TURN relay range
```

## 4. Point the app at your server

A later app update (netplay slice 2b) adds a Netplay settings panel where you enter:
- **Signaling:** `wss://signal.example.com`
- **TURN:** `turns:turn.example.com:5349` and `turn:turn.example.com:3478`
- the **shared secret** (used to mint ephemeral TURN credentials)

Until then this stack is dormant — hosting it early just means it's ready.

## Notes

- Keep `static-auth-secret` private; rotating it invalidates outstanding credentials.
- The signaling server holds only an in-memory room roster; restarting it just drops
  live rooms (players rejoin).
- Public STUN (`stun:stun.l.google.com:19302`) is used for candidate discovery — no hosting
  needed for that part.
