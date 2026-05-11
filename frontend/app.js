const API = "";
let pc = null;
let pollId = null;

const root = document.body;
const elFreq = document.getElementById("freq-mhz");
const elMode = document.getElementById("mode-select");
const elModeLive = document.getElementById("mode-live");
const elPtt = document.getElementById("ptt-badge");
const elSmeter = document.getElementById("smeter");
const elSmeterFill = document.getElementById("smeter-fill");
const elSmVal = document.getElementById("smeter-val");
const elSignalQuality = document.getElementById("signal-quality");
const elConn = document.getElementById("conn-state");
const elAudio = document.getElementById("rx-audio");
const elAudioState = document.getElementById("audio-state");
const btnConn = document.getElementById("btn-connect");
const btnDisc = document.getElementById("btn-disconnect");

function setConnBadge(state) {
  const labels = {
    disconnected: "Offline",
    connecting: "Linking",
    connected: "Live",
    error: "Fault",
  };

  root.dataset.connectionState = state;
  elConn.className = "badge badge--" + state;
  elConn.textContent = labels[state] ?? state;
}

function setAudioState(text) {
  elAudioState.textContent = text;
}

function setPttBadge(isTx) {
  root.dataset.pttState = isTx ? "tx" : "rx";
  elPtt.textContent = isTx ? "TX" : "RX";
  elPtt.className = "badge " + (isTx ? "badge--tx" : "badge--rx");
}

function fmtFreq(hz) {
  if (!Number.isFinite(hz)) return "---.---";
  return (hz / 1e6).toFixed(3);
}

function ensureModeOption(mode) {
  if (!mode) return;

  const exists = Array.from(elMode.options).some((option) => option.value === mode);
  if (!exists) {
    elMode.add(new Option(mode, mode));
  }
}

function syncModeUI(mode) {
  if (!mode) return;
  ensureModeOption(mode);
  if (elMode.value !== mode) elMode.value = mode;
  elModeLive.textContent = mode;
}

function describeSignal(dbm) {
  if (!Number.isFinite(dbm)) return "No telemetry";
  if (dbm >= -45) return "Crushing";
  if (dbm >= -60) return "Strong";
  if (dbm >= -75) return "Clean";
  if (dbm >= -90) return "Usable";
  if (dbm >= -105) return "Weak";
  return "Noise floor";
}

function dbmToPercent(dbm) {
  if (!Number.isFinite(dbm)) return 0;
  const bounded = Math.max(-127, Math.min(0, dbm));
  return ((bounded + 127) / 127) * 100;
}

function updateSignalState(dbm) {
  const bounded = Number.isFinite(dbm) ? Math.max(-127, Math.min(0, dbm)) : -127;
  elSmeter.value = bounded;
  elSmVal.textContent = `${bounded.toFixed(1)} dBm`;
  elSignalQuality.textContent = describeSignal(dbm);
  elSmeterFill.style.width = `${dbmToPercent(dbm)}%`;
}

async function pollStatus() {
  try {
    const response = await fetch(`${API}/api/rig/status`);
    if (!response.ok) return;

    const data = await response.json();
    elFreq.textContent = fmtFreq(data.frequency_hz);
    updateSignalState(data.strength_db);
    setPttBadge(Boolean(data.ptt));
    syncModeUI(data.mode);
  } catch (_) {
    // Backend may be restarting; keep the current UI state.
  }
}

elMode.addEventListener("change", async () => {
  syncModeUI(elMode.value);

  try {
    await fetch(`${API}/api/rig/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: elMode.value, passband_hz: 0 }),
    });
  } catch (error) {
    console.error("set_mode:", error);
  }
});

btnConn.addEventListener("click", connectRx);
btnDisc.addEventListener("click", disconnectRx);

async function connectRx() {
  btnConn.disabled = true;
  btnDisc.disabled = true;
  setConnBadge("connecting");
  setAudioState("Negotiating secure audio link");

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.ontrack = (event) => {
    elAudio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    setAudioState("Audio stream received");
  };

  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();

    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
  });

  try {
    const response = await fetch(`${API}/api/webrtc/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type,
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const answer = await response.json();
    await pc.setRemoteDescription(answer);
  } catch (error) {
    console.error("WebRTC offer:", error);
    if (pc) {
      pc.close();
      pc = null;
    }
    setConnBadge("error");
    setAudioState("Audio link failed");
    btnConn.disabled = false;
    return;
  }

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;

    if (state === "connecting") {
      setConnBadge("connecting");
      setAudioState("Finalising audio session");
      return;
    }

    if (state === "connected") {
      clearInterval(pollId);
      pollStatus();
      pollId = setInterval(pollStatus, 1000);
      setConnBadge("connected");
      setAudioState("Receive audio live");
      btnDisc.disabled = false;
      return;
    }

    if (["failed", "closed", "disconnected"].includes(state)) {
      clearInterval(pollId);
      pollId = null;
      setConnBadge(state === "failed" ? "error" : "disconnected");
      setAudioState(state === "failed" ? "Audio session dropped" : "Audio link offline");
      btnConn.disabled = false;
      btnDisc.disabled = true;
    }
  };
}

async function disconnectRx() {
  clearInterval(pollId);
  pollId = null;

  if (pc) {
    pc.close();
    pc = null;
  }

  try {
    await fetch(`${API}/api/webrtc/close`, { method: "POST" });
  } catch (_) {
    // Ignore backend close errors during UI teardown.
  }

  elAudio.srcObject = null;
  setConnBadge("disconnected");
  setAudioState("Audio link offline");
  btnConn.disabled = false;
  btnDisc.disabled = true;
}

setConnBadge("disconnected");
setPttBadge(false);
syncModeUI(elMode.value);
updateSignalState(-127);
setAudioState("Audio link offline");
pollStatus();
