/* global state */
const API = "";   // mesmo origin; ajustar se backend noutro host
let pc    = null;
let pollId = null;

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const elFreq    = document.getElementById("freq-mhz");
const elMode    = document.getElementById("mode-select");
const elPtt     = document.getElementById("ptt-badge");
const elSmeter  = document.getElementById("smeter");
const elSmVal   = document.getElementById("smeter-val");
const elConn    = document.getElementById("conn-state");
const elAudio   = document.getElementById("rx-audio");
const btnConn   = document.getElementById("btn-connect");
const btnDisc   = document.getElementById("btn-disconnect");

/* ── helpers ──────────────────────────────────────────────────────────────── */
function setConnBadge(state) {
  elConn.className = "badge badge--" + state;
  elConn.textContent = state.charAt(0).toUpperCase() + state.slice(1);
}

function fmtFreq(hz) {
  return (hz / 1e6).toFixed(3).padStart(8, " ");
}

/* ── polling de status ──────────────────────────────────────────────────────── */
async function pollStatus() {
  try {
    const r = await fetch(`${API}/api/rig/status`);
    if (!r.ok) return;
    const d = await r.json();
    elFreq.textContent   = fmtFreq(d.frequency_hz);
    elSmeter.value       = d.strength_db;
    elSmVal.textContent  = d.strength_db.toFixed(1) + " dBm";
    elPtt.textContent    = d.ptt ? "TX" : "RX";
    elPtt.className      = "badge " + (d.ptt ? "badge--tx" : "badge--rx");
    /* sincronizar selector de modo sem disparar o listener */
    if (elMode.value !== d.mode) elMode.value = d.mode;
  } catch (_) { /* silencioso — backend pode estar a reiniciar */ }
}

/* ── modo ──────────────────────────────────────────────────────────────────── */
elMode.addEventListener("change", async () => {
  try {
    await fetch(`${API}/api/rig/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: elMode.value, passband_hz: 0 }),
    });
  } catch (e) { console.error("set_mode:", e); }
});

/* ── WebRTC RX ──────────────────────────────────────────────────────────────── */
btnConn.addEventListener("click", connectRx);
btnDisc.addEventListener("click", disconnectRx);

async function connectRx() {
  btnConn.disabled = true;
  setConnBadge("connecting");

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  /* receber a track de áudio */
  pc.ontrack = (ev) => {
    elAudio.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
  };

  /* apenas receção de áudio — sendrecv no offer para que o servidor possa enviar */
  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  /* aguardar gathering completo (simplifica o signalling) */
  await new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
  });

  try {
    const res = await fetch(`${API}/api/webrtc/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const answer = await res.json();
    await pc.setRemoteDescription(answer);
  } catch (e) {
    console.error("WebRTC offer:", e);
    setConnBadge("error");
    btnConn.disabled = false;
    return;
  }

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "connected") {
      setConnBadge("connected");
      btnDisc.disabled = false;
      pollId = setInterval(pollStatus, 1000);
    } else if (["failed", "closed", "disconnected"].includes(s)) {
      setConnBadge("disconnected");
      btnConn.disabled = false;
      btnDisc.disabled = true;
      clearInterval(pollId);
    }
  };
}

async function disconnectRx() {
  clearInterval(pollId);
  if (pc) { pc.close(); pc = null; }
  try { await fetch(`${API}/api/webrtc/close`, { method: "POST" }); } catch (_) {}
  elAudio.srcObject = null;
  setConnBadge("disconnected");
  btnConn.disabled = false;
  btnDisc.disabled = true;
}

/* arranque: polling imediato sem áudio */
pollStatus();
