const API = "";
const MAX_FREQUENCY_HZ = 999999999;
const STEP_PRESETS = [10, 100, 1000, 10000, 100000, 1000000];
const DIGIT_STEPS = [100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1];

let pc = null;
let pollId = null;
let currentFrequencyHz = null;
let selectedTuneStep = 100;
let tuneLockUntil = 0;
let freqCommitTimer = null;
let knobAngle = 0;
let knobDrag = null;

const root = document.body;
const elFreq = document.getElementById("freq-mhz");
const elMode = document.getElementById("mode-select");
const elPtt = document.getElementById("ptt-badge");
const elSmeter = document.getElementById("smeter");
const elSmeterFill = document.getElementById("smeter-fill");
const elSmVal = document.getElementById("smeter-val");
const elSignalQuality = document.getElementById("signal-quality");
const elConn = document.getElementById("conn-state");
const elAudio = document.getElementById("rx-audio");
const elPassband = document.getElementById("passband-readout");
const elKnob = document.getElementById("vfo-knob");
const btnConn = document.getElementById("btn-connect");
const btnDisc = document.getElementById("btn-disconnect");
const modeReadouts = Array.from(document.querySelectorAll("[data-mode-readout]"));
const audioReadouts = Array.from(document.querySelectorAll("[data-audio-readout]"));
const stepReadouts = Array.from(document.querySelectorAll("[data-step-readout]"));
const stepCaptions = Array.from(document.querySelectorAll("[data-step-caption]"));
const stepButtons = Array.from(document.querySelectorAll(".step-btn"));
const softkeys = Array.from(document.querySelectorAll(".softkey[data-multiplier]"));

function clampFrequency(hz) {
  return Math.max(1, Math.min(MAX_FREQUENCY_HZ, Math.round(hz)));
}

function formatStepLabel(step) {
  if (step >= 1000000) return `${step / 1000000} MHz`;
  if (step >= 1000) return `${step / 1000} kHz`;
  return `${step} Hz`;
}

function formatPassband(passbandHz) {
  if (!Number.isFinite(passbandHz) || passbandHz <= 0) return "Auto";
  if (passbandHz >= 1000) {
    const khz = passbandHz / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
  }
  return `${passbandHz} Hz`;
}

function setConnBadge(state) {
  const labels = {
    disconnected: "Offline",
    connecting: "Sync",
    connected: "Live",
    error: "Fault",
  };

  root.dataset.connectionState = state;
  elConn.className = `badge badge--${state}`;
  elConn.textContent = labels[state] ?? state;
}

function setAudioState(text) {
  audioReadouts.forEach((node) => {
    node.textContent = text;
  });
}

function setModeReadout(mode) {
  modeReadouts.forEach((node) => {
    node.textContent = mode;
  });
}

function setTuneStep(step) {
  selectedTuneStep = step;
  const label = formatStepLabel(step);

  stepReadouts.forEach((node) => {
    node.textContent = label;
  });

  stepCaptions.forEach((node) => {
    node.textContent = `${label} digit selected`;
  });

  stepButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.step) === step);
  });

  renderFrequency(currentFrequencyHz);
}

function setPttBadge(isTx) {
  root.dataset.pttState = isTx ? "tx" : "rx";
  elPtt.textContent = isTx ? "TX" : "RX";
  elPtt.className = `badge ${isTx ? "badge--tx" : "badge--rx"}`;
}

function ensureModeOption(mode) {
  if (!mode) return;

  const exists = Array.from(elMode.options).some((option) => option.value === mode);
  if (!exists) elMode.add(new Option(mode, mode));
}

function syncModeUI(mode) {
  if (!mode) return;
  ensureModeOption(mode);
  if (elMode.value !== mode) elMode.value = mode;
  setModeReadout(mode);
}

function describeSignal(dbm) {
  if (!Number.isFinite(dbm)) return "Standby";
  if (dbm >= -45) return "Broadcast";
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

function setKnobAngle(angle) {
  knobAngle = angle;
  elKnob.style.setProperty("--knob-angle", `${angle}deg`);
}

function spinKnob(detents) {
  if (!Number.isFinite(detents) || detents === 0) return;
  setKnobAngle((knobAngle + detents * 14) % 360);
}

function renderFrequency(frequencyHz) {
  const hasValue = Number.isFinite(frequencyHz);
  const digits = hasValue
    ? String(clampFrequency(frequencyHz)).padStart(9, "0").slice(-9).split("")
    : ["-", "-", "-", "-", "-", "-", "-", "-", "-"];

  const html = [0, 3, 6].map((start, groupIndex) => {
    const group = digits.slice(start, start + 3).map((digit, offset) => {
      const step = DIGIT_STEPS[start + offset];
      const selectedClass = step === selectedTuneStep ? " is-selected" : "";
      const content = digit === "-" ? "&mdash;" : digit;

      return `<button type="button" class="freq-digit${selectedClass}" data-step="${step}" aria-label="Tune ${formatStepLabel(step)} digit">${content}</button>`;
    }).join("");

    const separator = groupIndex < 2 ? '<span class="freq-separator">.</span>' : "";
    return `<span class="digit-group">${group}</span>${separator}`;
  }).join("");

  elFreq.innerHTML = html;
}

function scheduleFrequencyCommit() {
  clearTimeout(freqCommitTimer);
  freqCommitTimer = window.setTimeout(commitFrequency, 110);
}

async function commitFrequency() {
  freqCommitTimer = null;

  if (!Number.isFinite(currentFrequencyHz)) return;

  try {
    await fetch(`${API}/api/rig/freq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frequency_hz: clampFrequency(currentFrequencyHz) }),
    });
  } catch (error) {
    console.error("set_freq:", error);
  }
}

function applyLocalFrequency(nextFrequencyHz, step = selectedTuneStep) {
  const clamped = clampFrequency(nextFrequencyHz);
  if (currentFrequencyHz === clamped) return;

  const previousFrequencyHz = currentFrequencyHz ?? clamped;
  currentFrequencyHz = clamped;
  tuneLockUntil = Date.now() + 700;
  renderFrequency(currentFrequencyHz);
  scheduleFrequencyCommit();

  const detents = Math.round((clamped - previousFrequencyHz) / (step || 1));
  spinKnob(detents || Math.sign(clamped - previousFrequencyHz));
}

function nudgeFrequency(deltaHz, step = selectedTuneStep) {
  if (!Number.isFinite(currentFrequencyHz)) return;
  applyLocalFrequency(currentFrequencyHz + deltaHz, step);
}

async function pollStatus() {
  try {
    const response = await fetch(`${API}/api/rig/status`);
    if (!response.ok) return;

    const data = await response.json();

    if (currentFrequencyHz === null || Date.now() >= tuneLockUntil) {
      currentFrequencyHz = clampFrequency(data.frequency_hz);
      renderFrequency(currentFrequencyHz);
    }

    updateSignalState(data.strength_db);
    setPttBadge(Boolean(data.ptt));
    syncModeUI(data.mode);
    elPassband.textContent = formatPassband(data.passband_hz);
  } catch (_) {
    // Keep the UI stable if the backend is briefly unavailable.
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

stepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setTuneStep(Number(button.dataset.step));
  });
});

softkeys.forEach((button) => {
  button.addEventListener("click", () => {
    nudgeFrequency(Number(button.dataset.multiplier) * selectedTuneStep, selectedTuneStep);
  });
});

elFreq.addEventListener("click", (event) => {
  const digit = event.target.closest(".freq-digit");
  if (!digit) return;
  setTuneStep(Number(digit.dataset.step));
});

elFreq.addEventListener("wheel", (event) => {
  const digit = event.target.closest(".freq-digit");
  if (!digit || !Number.isFinite(currentFrequencyHz)) return;

  event.preventDefault();
  const step = Number(digit.dataset.step);
  setTuneStep(step);
  nudgeFrequency(event.deltaY < 0 ? step : -step, step);
}, { passive: false });

elKnob.addEventListener("wheel", (event) => {
  if (!Number.isFinite(currentFrequencyHz)) return;
  event.preventDefault();
  nudgeFrequency(event.deltaY < 0 ? selectedTuneStep : -selectedTuneStep, selectedTuneStep);
}, { passive: false });

elKnob.addEventListener("pointerdown", (event) => {
  if (!Number.isFinite(currentFrequencyHz)) return;

  knobDrag = { pointerId: event.pointerId, lastY: event.clientY, carry: 0 };
  root.dataset.knobActive = "true";
  elKnob.setPointerCapture(event.pointerId);
});

elKnob.addEventListener("pointermove", (event) => {
  if (!knobDrag || knobDrag.pointerId !== event.pointerId || !Number.isFinite(currentFrequencyHz)) return;

  const deltaY = knobDrag.lastY - event.clientY;
  knobDrag.lastY = event.clientY;
  knobDrag.carry += deltaY;

  const detents = knobDrag.carry > 0
    ? Math.floor(knobDrag.carry / 12)
    : Math.ceil(knobDrag.carry / 12);

  if (detents !== 0) {
    knobDrag.carry -= detents * 12;
    nudgeFrequency(detents * selectedTuneStep, selectedTuneStep);
  }
});

function releaseKnob(event) {
  if (!knobDrag || knobDrag.pointerId !== event.pointerId) return;
  root.dataset.knobActive = "false";
  knobDrag = null;
  if (elKnob.hasPointerCapture(event.pointerId)) {
    elKnob.releasePointerCapture(event.pointerId);
  }
}

elKnob.addEventListener("pointerup", releaseKnob);
elKnob.addEventListener("pointercancel", releaseKnob);

btnConn.addEventListener("click", connectRx);
btnDisc.addEventListener("click", disconnectRx);

async function connectRx() {
  if (pc) return;

  btnConn.disabled = true;
  btnDisc.disabled = true;
  setConnBadge("connecting");
  setAudioState("Negotiating RX link");

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.ontrack = (event) => {
    elAudio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    setAudioState("RX stream received");
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
    setAudioState("RX link fault");
    btnConn.disabled = false;
    return;
  }

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;

    if (state === "connecting") {
      setConnBadge("connecting");
      setAudioState("Finalising RX link");
      return;
    }

    if (state === "connected") {
      setConnBadge("connected");
      setAudioState("RX stream live");
      btnConn.disabled = true;
      btnDisc.disabled = false;
      return;
    }

    if (["failed", "closed", "disconnected"].includes(state)) {
      setConnBadge(state === "failed" ? "error" : "disconnected");
      setAudioState(state === "failed" ? "RX session dropped" : "RX link offline");
      btnConn.disabled = false;
      btnDisc.disabled = true;

      if (state !== "closed") {
        elAudio.srcObject = null;
      }

      if (state === "closed" || state === "failed") {
        pc = null;
      }
    }
  };
}

async function disconnectRx() {
  if (pc) {
    pc.close();
    pc = null;
  }

  try {
    await fetch(`${API}/api/webrtc/close`, { method: "POST" });
  } catch (_) {
    // Ignore teardown errors.
  }

  elAudio.srcObject = null;
  setConnBadge("disconnected");
  setAudioState("RX link offline");
  btnConn.disabled = false;
  btnDisc.disabled = true;
}

setConnBadge("disconnected");
setPttBadge(false);
setAudioState("Standby");
syncModeUI(elMode.value);
setTuneStep(selectedTuneStep);
updateSignalState(-127);
elPassband.textContent = "Auto";
pollStatus();
pollId = window.setInterval(pollStatus, 1000);
