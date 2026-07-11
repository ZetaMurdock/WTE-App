// Local verification: start the server, connect a host + two players, and check
// the roster handshake, SDP/ICE relay, and peer-leave broadcast.
const { createSignalingServer } = require("./index");
const WebSocket = require("ws");

const PORT = 8799;
const URL = `ws://127.0.0.1:${PORT}`;
let fail = 0;
const check = (label, cond) => {
  console.log(`${cond ? "OK " : "FAIL"}  ${label}`);
  if (!cond) fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (ws) => new Promise((r) => ws.on("open", r));
const nextMsg = (ws) => new Promise((r) => ws.once("message", (b) => r(JSON.parse(b.toString()))));

async function main() {
  const srv = createSignalingServer(PORT);
  await wait(150);

  const host = new WebSocket(URL);
  await open(host);
  const hostMsgs = [];
  host.on("message", (b) => hostMsgs.push(JSON.parse(b.toString())));
  host.send(JSON.stringify({ t: "join", room: "TABLE1", peer: "host", role: "host", name: "GM" }));

  const ana = new WebSocket(URL);
  await open(ana);
  ana.send(JSON.stringify({ t: "join", room: "TABLE1", peer: "ana", role: "player", name: "Ana" }));
  const anaJoined = await nextMsg(ana);
  check("ana gets joined with host in roster", anaJoined.t === "joined" && anaJoined.peers.some((p) => p.peer === "host"));

  await wait(50);
  check("host was told ana joined", hostMsgs.some((m) => m.t === "peer-join" && m.peer === "ana"));

  // SDP/ICE relay: host → ana
  const anaSignalP = nextMsg(ana);
  host.send(JSON.stringify({ t: "signal", to: "ana", data: { sdp: "OFFER-SDP" } }));
  const anaSignal = await anaSignalP;
  check("ana receives host's signal (from tagged)", anaSignal.t === "signal" && anaSignal.from === "host" && anaSignal.data.sdp === "OFFER-SDP");

  // A third peer joins; host + ana both hear it.
  const bo = new WebSocket(URL);
  await open(bo);
  bo.send(JSON.stringify({ t: "join", room: "TABLE1", peer: "bo", role: "player", name: "Bo" }));
  await wait(80);
  check("host heard bo join", hostMsgs.some((m) => m.t === "peer-join" && m.peer === "bo"));

  // Wrong room is isolated.
  const solo = new WebSocket(URL);
  await open(solo);
  solo.send(JSON.stringify({ t: "join", room: "OTHER", peer: "solo", role: "host", name: "Solo" }));
  const soloJoined = await nextMsg(solo);
  check("separate room is isolated", soloJoined.t === "joined" && soloJoined.peers.length === 0);

  // Leave broadcast.
  const anaLeaveP = nextMsg(ana);
  bo.close();
  const anaLeave = await anaLeaveP;
  check("ana hears bo leave", anaLeave.t === "peer-leave" && anaLeave.peer === "bo");

  host.close();
  ana.close();
  solo.close();
  await srv.close();
  console.log("\n" + (fail ? `${fail} FAILURES` : "ALL OK"));
  process.exit(fail ? 1 : 0);
}
main();
