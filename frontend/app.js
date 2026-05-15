const API = "";
const MAX_FREQUENCY_HZ = 999999999;
const DEFAULT_FREQUENCY_HZ = 7100000;
const LAST_FREQUENCY_STORAGE_KEY = "4ham.lastFrequencyHz";
const MIC_DEVICE_STORAGE_KEY     = "4ham.micDeviceId";
const OUTPUT_DEVICE_STORAGE_KEY  = "4ham.outputDeviceId";
const STEP_PRESETS = [10, 100, 1000, 10000, 100000, 1000000];
const DIGIT_STEPS = [100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1];

let pc = null;
let audioCtx = null;
let gainNode = null;
let pollId = null;
let currentFrequencyHz = loadInitialFrequency();
let selectedTuneStep = 100;
let tuneLockUntil = 0;
let freqCommitTimer = null;
let knobAngle = 0;
let knobDrag = null;
let txHoldActive = false;
let micTrack = null;   // MediaStreamTrack do microfone; null se não autorizado

// ── VOX ──────────────────────────────────────────────────────────────────────
let voxEnabled = false;
let voxRafId   = null;
let voxHangTimer = null;
let voxAnalyser = null;
let voxDataBuf  = null;
const VOX_HANG_MS = 600;
let rigConnected = false;
let _rigOfflineShown = false;   // só mostrar o modal uma vez até ao próximo reconnect
let _firstPoll = true;          // esconder o overlay de ligação após o primeiro poll
let _audioKey    = "audio_standby";
let _waterfallKey = "wf_offline";
let _lastStrengthDb = -127;
let waterfallSocket = null;
let waterfallReconnectTimer = null;
let waterfallCtx = null;
let spectrumCtx = null;
let specSmooth = null;          // Float32Array — buffer de suavização por pixel
const SPEC_SMOOTH_ALPHA = 0.18; // 0 = máximo smooth, 1 = instantaneo

const WATERFALL_PALETTE = [
  { stop: 0.0, color: [4, 9, 15] },
  { stop: 0.18, color: [12, 44, 82] },
  { stop: 0.36, color: [10, 112, 148] },
  { stop: 0.58, color: [82, 182, 165] },
  { stop: 0.78, color: [247, 196, 109] },
  { stop: 1.0, color: [255, 128, 91] },
];

const root = document.body;
const elFreq = document.getElementById("freq-mhz");
const elMode = document.getElementById("mode-select");
const elPtt = document.getElementById("ptt-badge");
const elSmeter = document.getElementById("smeter");
const elSmeterFill = document.getElementById("smeter-fill");
const elSmVal = document.getElementById("smeter-val");
const elSignalQuality = document.getElementById("signal-quality");
const elSwrFill = document.getElementById("swr-fill");
const elSwrVal = document.getElementById("swr-val");
const elSwrQuality = document.getElementById("swr-quality");
const elConn = document.getElementById("conn-state");
const elAudio = document.getElementById("rx-audio");
const elVolume = document.getElementById("rx-volume");
const elVolumeVal = document.getElementById("rx-volume-val");
const elPassband = document.getElementById("passband-readout");
const elKnob = document.getElementById("vfo-knob");
const elWaterfall = document.getElementById("waterfall-canvas");
const elSpectrum = document.getElementById("spectrum-canvas");
const elWaterfallState = document.getElementById("waterfall-state");
const elQsoFrequency = document.getElementById("qso-frequency");
const elQsoMode = document.getElementById("qso-mode");
const elQsoBand = document.getElementById("qso-band");
const elQsoTime = document.getElementById("qso-time");
const btnConn = document.getElementById("btn-connect");
const btnDisc = document.getElementById("btn-disconnect");
const btnTx  = document.getElementById("btn-tx");
const btnVox = document.getElementById("btn-vox");
const btnRigConnect       = document.getElementById("btn-rig-connect");
const dlgRigOffline       = document.getElementById("dlg-rig-offline");
const elConnectingOverlay = document.getElementById("connecting-overlay");
const dlgBtnConnect  = document.getElementById("dlg-btn-connect");
const dlgBtnDismiss  = document.getElementById("dlg-btn-dismiss");
const btnAudioSettings  = document.getElementById("btn-audio-settings");
const dlgAudioSettings  = document.getElementById("dlg-audio-settings");
const selMic            = document.getElementById("sel-mic");
const selOutput         = document.getElementById("sel-output");
const dlgAudioApply     = document.getElementById("dlg-audio-apply");
const dlgAudioClose     = document.getElementById("dlg-audio-close");
const elVoxThreshold = document.getElementById("vox-threshold");
const elVoxLevel     = document.getElementById("vox-level");
const modeReadouts = Array.from(document.querySelectorAll("[data-mode-readout]"));
const audioReadouts = Array.from(document.querySelectorAll("[data-audio-readout]"));
const stepReadouts = Array.from(document.querySelectorAll("[data-step-readout]"));
const stepCaptions = Array.from(document.querySelectorAll("[data-step-caption]"));
const stepButtons = Array.from(document.querySelectorAll(".step-btn"));
const softkeys = Array.from(document.querySelectorAll(".softkey[data-multiplier]"));
const bandPlanRows = Array.from(document.querySelectorAll("[data-band]"));

function clampFrequency(hz) {
  return Math.max(1, Math.min(MAX_FREQUENCY_HZ, Math.round(hz)));
}

function loadInitialFrequency() {
  try {
    const rawValue = window.localStorage.getItem(LAST_FREQUENCY_STORAGE_KEY);
    const parsedValue = Number(rawValue);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return clampFrequency(parsedValue);
    }
  } catch (_) {
    // Ignore storage access problems and fall back to the default VFO.
  }

  return DEFAULT_FREQUENCY_HZ;
}

function persistFrequency(frequencyHz) {
  if (!Number.isFinite(frequencyHz)) return;

  try {
    window.localStorage.setItem(LAST_FREQUENCY_STORAGE_KEY, String(clampFrequency(frequencyHz)));
  } catch (_) {
    // Ignore storage access problems; tuning should remain functional.
  }
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

function formatLogFrequency(frequencyHz) {
  /* Formato: 14.200 (MHz, 3 casas decimais, sem zeros à esquerda no MHz) */
  return (clampFrequency(frequencyHz) / 1000000).toFixed(3);
}

function getBandLabel(frequencyHz) {
  if (!Number.isFinite(frequencyHz)) return "";
  if (frequencyHz >= 3500000 && frequencyHz < 4000000) return "80m";
  if (frequencyHz >= 7000000 && frequencyHz < 7300000) return "40m";
  if (frequencyHz >= 10100000 && frequencyHz < 10150000) return "30m";
  if (frequencyHz >= 14000000 && frequencyHz < 14350000) return "20m";
  if (frequencyHz >= 18068000 && frequencyHz < 18168000) return "17m";
  if (frequencyHz >= 21000000 && frequencyHz < 21450000) return "15m";
  if (frequencyHz >= 24890000 && frequencyHz < 24990000) return "12m";
  if (frequencyHz >= 28000000 && frequencyHz < 29700000) return "10m";
  if (frequencyHz >= 50000000 && frequencyHz < 54000000) return "6m";
  return "General";
}

function syncQsoFrequencyContext(frequencyHz) {
  if (elQsoFrequency && Number.isFinite(frequencyHz)) {
    elQsoFrequency.value = formatLogFrequency(frequencyHz);
  }

  const bandLabel = getBandLabel(frequencyHz);
  if (elQsoBand) {
    elQsoBand.value = bandLabel;
  }

  bandPlanRows.forEach((row) => {
    row.classList.toggle("is-active", row.dataset.band === bandLabel);
  });
}

function syncUtcField() {
  if (!elQsoTime) return;
  const now = new Date();
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  elQsoTime.value = `${hours}:${minutes}Z`;
}

function setConnBadge(state) {
  const labels = {
    disconnected: t("conn_offline"),
    connecting:   t("conn_connecting"),
    connected:    t("conn_connected"),
    error:        t("conn_error"),
  };

  root.dataset.connectionState = state;
  elConn.className = `badge badge--${state}`;
  elConn.textContent = labels[state] ?? state;
}

function setAudioState(key) {
  _audioKey = key;
  audioReadouts.forEach((node) => {
    node.textContent = t(key);
  });
}

function setModeReadout(mode) {
  modeReadouts.forEach((node) => {
    node.textContent = mode;
  });

  if (elQsoMode) {
    elQsoMode.value = mode ?? "";
  }
}

function setTuneStep(step) {
  selectedTuneStep = step;
  const label = formatStepLabel(step);

  stepReadouts.forEach((node) => {
    node.textContent = label;
  });

  stepCaptions.forEach((node) => {
    node.textContent = t("step_caption").replace("{step}", label);
  });

  stepButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.step) === step);
  });

  renderFrequency(currentFrequencyHz);
}

function setTxButtonState(isActive) {
  if (!btnTx) return;
  btnTx.classList.toggle("is-active", isActive);
  btnTx.textContent = isActive ? t("btn_tx_live") : t("btn_tx_hold");
}

function setPttBadge(isTx) {
  root.dataset.pttState = isTx ? "tx" : "rx";
  elPtt.textContent = isTx ? "TX" : "RX";
  elPtt.className = `badge ${isTx ? "badge--tx" : "badge--rx"}`;
  setTxButtonState(isTx || txHoldActive);
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

// rigctld `l STRENGTH` devolve dB relativos a S9: 0 = S9, −6 dB por unidade S abaixo.
// Referência IARU HF: S9 = −73 dBm.
const _S9_DBM = -73;
const _STR_MIN = -54;  // Hamlib noise floor (≈ S0/S1)
const _STR_MAX = 60;   // Hamlib máximo (≈ S9+60 dB)

function strengthToSUnit(db) {
  if (!Number.isFinite(db)) return "--";
  if (db >= 0) return `S9+${Math.round(db)}`;
  const s = Math.max(1, Math.min(9, Math.round(9 + db / 6)));
  return `S${s}`;
}

function strengthToPercent(db) {
  if (!Number.isFinite(db)) return 0;
  const bounded = Math.max(_STR_MIN, Math.min(_STR_MAX, db));
  return ((bounded - _STR_MIN) / (_STR_MAX - _STR_MIN)) * 100;
}

function updateSignalState(db) {
  _lastStrengthDb = db;
  const bounded = Number.isFinite(db)
    ? Math.max(_STR_MIN, Math.min(_STR_MAX, db))
    : _STR_MIN;
  elSmeter.value = bounded;
  elSmVal.textContent = Number.isFinite(db) ? `${Math.round(db)} dB` : "-- dB";
  elSignalQuality.textContent = Number.isFinite(db) ? strengthToSUnit(db) : t("smeter_standby");
  elSmeterFill.style.width = `${strengthToPercent(db)}%`;
}

// rigctld `l SWR` devolve a relação de ondas estacionárias: 1.0 = correspondência perfeita.
// Apenas significativo durante TX (PTT activo); em RX o valor é 0 ou indefinido.
const _SWR_MIN = 1.0;
const _SWR_MAX = 5.0;  // Acima de 5:1 considera-se crítico

function swrToPercent(swr) {
  if (!Number.isFinite(swr) || swr <= 0) return 0;
  const bounded = Math.max(_SWR_MIN, Math.min(_SWR_MAX, swr));
  return ((bounded - _SWR_MIN) / (_SWR_MAX - _SWR_MIN)) * 100;
}

function updateSwr(swr, ptt) {
  const active = ptt && Number.isFinite(swr) && swr >= 1.0;
  const pct    = active ? swrToPercent(swr) : 0;
  const txt    = active ? `${swr.toFixed(1)}:1` : "—";
  let cls = "swr-fill";
  if (active) {
    if (swr <= 1.5)      cls += " swr-fill--ok";
    else if (swr <= 2.5) cls += " swr-fill--warn";
    else                 cls += " swr-fill--bad";
  }
  elSwrFill.className = cls;
  elSwrFill.style.width = `${pct}%`;
  elSwrVal.textContent = txt;
  elSwrQuality.textContent = active
    ? (swr <= 1.5 ? t("swr_ok") : t("swr_warn"))
    : t("swr_standby");
}

function setWaterfallState(key) {
  _waterfallKey = key;
  if (elWaterfallState) {
    elWaterfallState.textContent = t(key);
  }
}

function getWaterfallContext() {
  if (!elWaterfall) return null;
  if (!waterfallCtx) {
    waterfallCtx = elWaterfall.getContext("2d", { alpha: false, desynchronized: true });
    if (waterfallCtx) {
      waterfallCtx.imageSmoothingEnabled = false;
    }
  }
  return waterfallCtx;
}

function resizeWaterfallCanvas() {
  const ctx = getWaterfallContext();
  if (!ctx || !elWaterfall) return;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(elWaterfall.clientWidth));
  const height = Math.max(1, Math.floor(elWaterfall.clientHeight));
  const targetWidth = Math.floor(width * dpr);
  const targetHeight = Math.floor(height * dpr);

  if (elWaterfall.width === targetWidth && elWaterfall.height === targetHeight) return;

  elWaterfall.width = targetWidth;
  elWaterfall.height = targetHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#060b10";
  ctx.fillRect(0, 0, width, height);
}

function interpolateColor(a, b, ratio) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * ratio));
}

function waterfallColor(value) {
  const normalized = Math.max(0, Math.min(1, value));

  for (let index = 1; index < WATERFALL_PALETTE.length; index += 1) {
    const prev = WATERFALL_PALETTE[index - 1];
    const next = WATERFALL_PALETTE[index];
    if (normalized <= next.stop) {
      const span = next.stop - prev.stop || 1;
      return interpolateColor(prev.color, next.color, (normalized - prev.stop) / span);
    }
  }

  return WATERFALL_PALETTE[WATERFALL_PALETTE.length - 1].color;
}

function decodeSpectrumFrame(payload) {
  if (!payload || payload.encoding !== "delta_int8" || !Array.isArray(payload.fft_delta)) {
    return [];
  }

  const ref = Number(payload.fft_ref_db ?? 0);
  const step = Number(payload.fft_step_db ?? 0.5);
  return payload.fft_delta.map((delta) => ref + (Number(delta) + 128) * step);
}

function drawWaterfallRow(values, minDb, maxDb) {
  const ctx = getWaterfallContext();
  if (!ctx || !elWaterfall || !values.length) return;

  resizeWaterfallCanvas();

  const width = Math.max(1, Math.floor(elWaterfall.clientWidth));
  const height = Math.max(1, Math.floor(elWaterfall.clientHeight));
  const shiftHeight = Math.max(0, height - 1);

  if (shiftHeight > 0) {
    const existing = ctx.getImageData(0, 0, width, shiftHeight);
    ctx.putImageData(existing, 0, 1);
  }

  const row = ctx.createImageData(width, 1);
  const range = Math.max(1, Number(maxDb) - Number(minDb));

  for (let x = 0; x < width; x += 1) {
    const index = Math.min(values.length - 1, Math.floor((x / Math.max(1, width - 1)) * (values.length - 1)));
    const normalized = (values[index] - minDb) / range;
    const [r, g, b] = waterfallColor(normalized);
    const offset = x * 4;
    row.data[offset] = r;
    row.data[offset + 1] = g;
    row.data[offset + 2] = b;
    row.data[offset + 3] = 255;
  }

  ctx.putImageData(row, 0, 0);
}

function getSpectrumContext() {
  if (!elSpectrum) return null;
  if (!spectrumCtx) {
    spectrumCtx = elSpectrum.getContext("2d", { alpha: false });
  }
  return spectrumCtx;
}

function drawSpectrum(values, minDb, maxDb) {
  const ctx = getSpectrumContext();
  if (!ctx || !elSpectrum || !values.length) return;

  const W = elSpectrum.offsetWidth > 0 ? elSpectrum.offsetWidth : (elSpectrum.width || 640);
  const H = elSpectrum.height || 80;
  if (elSpectrum.width !== W) elSpectrum.width = W;

  const range = Math.max(1, Number(maxDb) - Number(minDb));

  // Inicializar ou redimensionar o buffer de suavização
  if (!specSmooth || specSmooth.length !== W) {
    specSmooth = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const idx = Math.min(values.length - 1, Math.floor((x / Math.max(1, W - 1)) * (values.length - 1)));
      specSmooth[x] = Math.max(0, Math.min(1, (values[idx] - minDb) / range));
    }
  }

  // Actualizar buffer com suavização exponencial
  for (let x = 0; x < W; x++) {
    const idx = Math.min(values.length - 1, Math.floor((x / Math.max(1, W - 1)) * (values.length - 1)));
    const v = Math.max(0, Math.min(1, (values[idx] - minDb) / range));
    specSmooth[x] = specSmooth[x] * (1 - SPEC_SMOOTH_ALPHA) + v * SPEC_SMOOTH_ALPHA;
  }

  // Fundo
  ctx.fillStyle = "#060b10";
  ctx.fillRect(0, 0, W, H);

  // Linhas de grelha subtis
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const y = Math.round(H * g / 4) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Área preenchida com gradiente de cor (paleta igual à waterfall)
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  for (let s = 0; s <= 8; s++) {
    const [r, g, b] = waterfallColor(1 - s / 8);
    grad.addColorStop(s / 8, `rgba(${r},${g},${b},${Math.max(0, 0.48 - s * 0.05)})`);
  }
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x < W; x++) ctx.lineTo(x, H - specSmooth[x] * (H - 3));
  ctx.lineTo(W - 1, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Contorno brilhante no topo
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    const y = H - specSmooth[x] * (H - 3);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  const [lr, lg, lb] = waterfallColor(0.85);
  ctx.strokeStyle = `rgba(${lr},${lg},${lb},0.88)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function clearSpectrum() {
  const ctx = getSpectrumContext();
  if (!ctx || !elSpectrum) return;
  ctx.fillStyle = "#060b10";
  ctx.fillRect(0, 0, elSpectrum.width || 640, elSpectrum.height || 80);
  specSmooth = null;
}

function scheduleWaterfallReconnect() {
  if (waterfallReconnectTimer || location.protocol === "file:") return;
  waterfallReconnectTimer = window.setTimeout(() => {
    waterfallReconnectTimer = null;
    connectWaterfall();
  }, 1500);
}

function connectWaterfall() {
  if (!elWaterfall) return;

  resizeWaterfallCanvas();

  if (location.protocol === "file:") {
    setWaterfallState("wf_preview");
    return;
  }

  if (waterfallSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(waterfallSocket.readyState)) {
    return;
  }

  const scheme = location.protocol === "https:" ? "wss" : "ws";
  waterfallSocket = new WebSocket(`${scheme}://${location.host}/ws/spectrum`);
  setWaterfallState("wf_linking");

  waterfallSocket.addEventListener("open", () => {
    setWaterfallState("wf_live");
  });

  waterfallSocket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      const frame = decodeSpectrumFrame(payload);
      const minDb = Number(payload.min_db ?? -140);
      const maxDb = Number(payload.max_db ?? -10);
      drawSpectrum(frame, minDb, maxDb);
      drawWaterfallRow(frame, minDb, maxDb);
    } catch (error) {
      console.error("waterfall frame:", error);
    }
  });

  waterfallSocket.addEventListener("error", () => {
    setWaterfallState("wf_fault");
  });

  waterfallSocket.addEventListener("close", () => {
    waterfallSocket = null;
    setWaterfallState("wf_offline");
    clearSpectrum();
    scheduleWaterfallReconnect();
  });
}

function setKnobAngle(angle) {
  knobAngle = angle;
  elKnob.style.setProperty("--knob-angle", `${angle}deg`);
}

function spinKnob(detents) {
  if (!Number.isFinite(detents) || detents === 0) return;
  setKnobAngle(knobAngle + detents * 14);
}

function renderFrequency(frequencyHz) {
  const hasValue = Number.isFinite(frequencyHz);
  const digits = hasValue
    ? String(clampFrequency(frequencyHz)).padStart(9, "0").slice(-9).split("")
    : ["-", "-", "-", "-", "-", "-", "-", "-", "-"];

  /* Format: MM.KKK.HH (14.166.00) — skips 100 MHz and 1 Hz digits */
  const GROUPS = [
    { start: 1, len: 2 },  /* 10 MHz, 1 MHz */
    { start: 3, len: 3 },  /* 100 kHz, 10 kHz, 1 kHz */
    { start: 6, len: 2 },  /* 100 Hz, 10 Hz */
  ];
  const html = GROUPS.map(({ start, len }, groupIndex) => {
    const group = digits.slice(start, start + len).map((digit, offset) => {
      const step = DIGIT_STEPS[start + offset];
      const selectedClass = step === selectedTuneStep ? " is-selected" : "";
      const content = digit === "-" ? "&mdash;" : digit;

      return `<button type="button" class="freq-digit${selectedClass}" data-step="${step}" aria-label="${t('tune_digit_aria').replace('{step}', formatStepLabel(step))}">${content}</button>`;
    }).join("");

    const separator = groupIndex < 2 ? '<span class="freq-separator">.</span>' : "";
    return `<span class="digit-group">${group}</span>${separator}`;
  }).join("");

  elFreq.innerHTML = html;
  syncQsoFrequencyContext(hasValue ? frequencyHz : null);
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
  persistFrequency(currentFrequencyHz);
  tuneLockUntil = Date.now() + 700;
  renderFrequency(currentFrequencyHz);
  scheduleFrequencyCommit();
  document.dispatchEvent(new CustomEvent("4ham:freqchange", { detail: currentFrequencyHz }));

  const detents = Math.round((clamped - previousFrequencyHz) / (step || 1));
  spinKnob(detents || Math.sign(clamped - previousFrequencyHz));
}

function nudgeFrequency(deltaHz, step = selectedTuneStep) {
  if (!Number.isFinite(currentFrequencyHz)) return;
  applyLocalFrequency(currentFrequencyHz + deltaHz, step);
}

function getKnobPointerAngle(clientX, clientY) {
  const rect = elKnob.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
}

function normalizeAngleDelta(delta) {
  let adjusted = delta;
  while (adjusted > 180) adjusted -= 360;
  while (adjusted < -180) adjusted += 360;
  return adjusted;
}

// ── Ligação ao rádio ─────────────────────────────────────────────────────────

function showRigOfflineDialog() {
  if (!dlgRigOffline || _rigOfflineShown) return;
  _rigOfflineShown = true;
  // Actualizar textos i18n no modal
  dlgRigOffline.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t(key) !== key) el.textContent = t(key);
  });
  dlgRigOffline.showModal();
}

function closeRigOfflineDialog() {
  if (dlgRigOffline && dlgRigOffline.open) dlgRigOffline.close();
}

// ── Configuração de áudio ────────────────────────────────────────────────────

function _addDeviceOption(selectEl, deviceId, label, savedId) {
  const opt = document.createElement("option");
  opt.value = deviceId;
  opt.textContent = label || t("audio_settings_default");
  if (deviceId === savedId) opt.selected = true;
  selectEl.appendChild(opt);
}

async function openAudioSettings() {
  if (!dlgAudioSettings) return;

  // Actualizar textos i18n
  dlgAudioSettings.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t(key) !== key) el.textContent = t(key);
  });

  if (selMic)    selMic.innerHTML    = "";
  if (selOutput) selOutput.innerHTML = "";

  const savedMic    = localStorage.getItem(MIC_DEVICE_STORAGE_KEY)    || "";
  const savedOutput = localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY) || "";

  // Se já existe uma track activa, mostrar o dispositivo real em vez de "default"
  const activeMicId = micTrack ? (micTrack.getSettings().deviceId || savedMic) : savedMic;
  const selectedMic = savedMic || activeMicId;

  // Opção "predefinido do sistema"
  if (selMic)    _addDeviceOption(selMic,    "", t("audio_settings_default"), selectedMic);
  if (selOutput) _addDeviceOption(selOutput, "", t("audio_settings_default"), savedOutput);

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.forEach(d => {
      const label = d.label || `${d.kind} (${d.deviceId.slice(0, 8)}…)`;
      if (d.kind === "audioinput"  && selMic)
        _addDeviceOption(selMic,    d.deviceId, label, selectedMic);
      if (d.kind === "audiooutput" && selOutput)
        _addDeviceOption(selOutput, d.deviceId, label, savedOutput);
    });
  } catch (err) {
    console.warn("enumerateDevices:", err);
  }

  // Esconder saída de áudio se setSinkId não suportado
  if (selOutput && typeof HTMLMediaElement.prototype.setSinkId !== "function") {
    selOutput.closest("label") && (selOutput.previousElementSibling.style.display = "none");
    selOutput.style.display = "none";
  }

  dlgAudioSettings.showModal();
}

function applyAudioSettings() {
  if (!dlgAudioSettings) return;
  const micId    = selMic    ? selMic.value    : "";
  const outputId = selOutput ? selOutput.value : "";

  if (micId)    localStorage.setItem(MIC_DEVICE_STORAGE_KEY,    micId);
  else          localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);

  if (outputId) localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, outputId);
  else          localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);

  // Aplicar saída de áudio imediatamente se o stream RX já estiver activo
  if (outputId) {
    // AudioContext.setSinkId (Chrome 110+)
    if (audioCtx && typeof audioCtx.setSinkId === "function") {
      audioCtx.setSinkId(outputId).catch(err => console.warn("audioCtx.setSinkId:", err));
    }
    // Fallback: elAudio directo
    if (elAudio && typeof elAudio.setSinkId === "function") {
      elAudio.setSinkId(outputId).catch(err => console.warn("elAudio.setSinkId:", err));
    }
  }

  dlgAudioSettings.close();
}

if (btnAudioSettings) btnAudioSettings.addEventListener("click", openAudioSettings);
if (dlgAudioApply)    dlgAudioApply.addEventListener("click", applyAudioSettings);
if (dlgAudioClose)    dlgAudioClose.addEventListener("click", () => dlgAudioSettings?.close());

function setRigConnected(connected) {
  if (rigConnected === connected) return;
  rigConnected = connected;
  if (connected) {
    closeRigOfflineDialog();
    _rigOfflineShown = false;  // nova ligação — permitir mostrar modal de novo se cair
  }
  if (btnRigConnect) {
    btnRigConnect.classList.toggle("is-connected", connected);
    const key = connected ? "btn_rig_connect_on" : "btn_rig_connect_off";
    btnRigConnect.textContent = t(key);
    btnRigConnect.title = connected ? t("btn_rig_connect_on_title") : t("btn_rig_connect_off_title");
  }
}

async function connectRig() {
  if (btnRigConnect) {
    btnRigConnect.disabled = true;
    btnRigConnect.textContent = t("btn_rig_connecting");
  }
  try {
    const res = await fetch(`${API}/api/rig/connect`, { method: "POST" });
    if (res.ok) {
      setRigConnected(true);
      pollStatus();
    } else {
      const body = await res.json().catch(() => ({}));
      console.warn("Falha ao ligar ao rádio:", body.detail ?? res.status);
      setRigConnected(false);
    }
  } catch (err) {
    console.warn("Falha ao ligar ao rádio:", err);
    setRigConnected(false);
  } finally {
    if (btnRigConnect) {
      btnRigConnect.disabled = false;
      btnRigConnect.textContent = t(rigConnected ? "btn_rig_connect_on" : "btn_rig_connect_off");
    }
  }
}

if (btnRigConnect) {
  btnRigConnect.addEventListener("click", connectRig);
}
if (dlgBtnConnect) {
  dlgBtnConnect.addEventListener("click", async () => {
    dlgBtnConnect.disabled = true;
    dlgBtnConnect.textContent = t("btn_rig_connecting");
    await connectRig();
    dlgBtnConnect.disabled = false;
    dlgBtnConnect.textContent = t("btn_rig_connect_off");
  });
}
if (dlgBtnDismiss) {
  dlgBtnDismiss.addEventListener("click", closeRigOfflineDialog);
}

async function pollStatus() {
  try {
    const response = await fetch(`${API}/api/rig/status`);
    if (_firstPoll) {
      _firstPoll = false;
      if (elConnectingOverlay) elConnectingOverlay.hidden = true;
    }
    if (!response.ok) {
      setRigConnected(false);
      showRigOfflineDialog();
      return;
    }

    setRigConnected(true);
    const data = await response.json();

    if (currentFrequencyHz === null || Date.now() >= tuneLockUntil) {
      currentFrequencyHz = clampFrequency(data.frequency_hz);
      persistFrequency(currentFrequencyHz);
      renderFrequency(currentFrequencyHz);
    }

    updateSignalState(data.strength_db);
    updateSwr(data.swr ?? 0, Boolean(data.ptt));
    setPttBadge(Boolean(data.ptt));
    syncModeUI(data.mode);
    elPassband.textContent = formatPassband(data.passband_hz);
  } catch (_) {
    if (_firstPoll) {
      _firstPoll = false;
      if (elConnectingOverlay) elConnectingOverlay.hidden = true;
    }
    setRigConnected(false);
    showRigOfflineDialog();
  }
}

async function sendPtt(enabled) {
  try {
    const response = await fetch(`${API}/api/rig/ptt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setPttBadge(enabled);
  } catch (error) {
    console.error("set_ptt:", error);
    txHoldActive = false;
    setTxButtonState(false);
    pollStatus();
  }
}

function beginTxHold(event) {
  if (txHoldActive) return;
  event?.preventDefault();
  txHoldActive = true;
  setTxButtonState(true);
  if (micTrack) micTrack.enabled = true;
  sendPtt(true);
}

function endTxHold() {
  if (!txHoldActive) return;
  txHoldActive = false;
  setTxButtonState(false);
  if (micTrack) micTrack.enabled = false;
  sendPtt(false);
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

  event.preventDefault();

  knobDrag = {
    pointerId: event.pointerId,
    lastAngle: getKnobPointerAngle(event.clientX, event.clientY),
    accumulatedAngle: 0,
    moved: false,
    startX: event.clientX,
    startY: event.clientY,
  };
  root.dataset.knobActive = "true";
  try {
    elKnob.setPointerCapture(event.pointerId);
  } catch (_) {
    // Some browsers or synthetic pointer flows may reject pointer capture.
  }
});

function handleKnobPointerMove(event) {
  if (!knobDrag || knobDrag.pointerId !== event.pointerId || !Number.isFinite(currentFrequencyHz)) return;

  const nextAngle = getKnobPointerAngle(event.clientX, event.clientY);
  const deltaAngle = normalizeAngleDelta(nextAngle - knobDrag.lastAngle);
  knobDrag.lastAngle = nextAngle;
  knobDrag.accumulatedAngle += deltaAngle;

  if (!knobDrag.moved) {
    const dx = event.clientX - knobDrag.startX;
    const dy = event.clientY - knobDrag.startY;
    knobDrag.moved = Math.hypot(dx, dy) > 6;
  }

  const detents = knobDrag.accumulatedAngle > 0
    ? Math.floor(knobDrag.accumulatedAngle / 10)
    : Math.ceil(knobDrag.accumulatedAngle / 10);

  if (detents !== 0) {
    knobDrag.accumulatedAngle -= detents * 10;
    nudgeFrequency(detents * selectedTuneStep, selectedTuneStep);
  }
}

function releaseKnob(event) {
  if (!knobDrag || knobDrag.pointerId !== event.pointerId) return;

  if (!knobDrag.moved && Number.isFinite(currentFrequencyHz)) {
    const rect = elKnob.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const direction = relativeX >= rect.width / 2 ? 1 : -1;
    nudgeFrequency(direction * selectedTuneStep, selectedTuneStep);
  }

  root.dataset.knobActive = "false";
  knobDrag = null;
  try {
    if (elKnob.hasPointerCapture(event.pointerId)) {
      elKnob.releasePointerCapture(event.pointerId);
    }
  } catch (_) {
    // Ignore capture release problems; drag lifecycle is already closed.
  }
}

window.addEventListener("pointermove", handleKnobPointerMove);
window.addEventListener("pointerup", releaseKnob);
window.addEventListener("pointercancel", releaseKnob);
window.addEventListener("resize", resizeWaterfallCanvas);
window.addEventListener("blur", endTxHold);

btnConn.addEventListener("click", connectRx);
btnDisc.addEventListener("click", disconnectRx);

document.getElementById("lang-toggle")?.addEventListener("click", () => {
  const next = getLang() === "pt" ? "en" : "pt";
  applyLocale(next);
  /* re-render dynamic state with new locale */
  setConnBadge(root.dataset.connectionState || "disconnected");
  setAudioState(_audioKey);
  setWaterfallState(_waterfallKey);
  setTuneStep(selectedTuneStep);
  setTxButtonState(txHoldActive);
  updateSignalState(_lastStrengthDb);
});

elVolume.addEventListener("input", () => {
  const pct = parseInt(elVolume.value, 10);
  elVolumeVal.textContent = `${pct}%`;
  if (gainNode) gainNode.gain.value = pct / 100;
});
btnTx.addEventListener("pointerdown", beginTxHold);
btnTx.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.key === "Enter") beginTxHold(event);
});
btnTx.addEventListener("keyup", (event) => {
  if (event.key === "Enter") { event.preventDefault(); endTxHold(); }
});

// ── VOX ──────────────────────────────────────────────────────────────────────

function voxStartAnalyser() {
  if (voxAnalyser || !micTrack || !audioCtx) return;
  try {
    const micStream = new MediaStream([micTrack]);
    const src = audioCtx.createMediaStreamSource(micStream);
    voxAnalyser = audioCtx.createAnalyser();
    voxAnalyser.fftSize = 256;
    voxDataBuf = new Uint8Array(voxAnalyser.frequencyBinCount);
    src.connect(voxAnalyser);
  } catch (_) {
    voxAnalyser = null;
  }
}

function voxStopAnalyser() {
  voxAnalyser = null;
  voxDataBuf  = null;
  if (voxRafId !== null) { cancelAnimationFrame(voxRafId); voxRafId = null; }
  if (voxHangTimer !== null) { clearTimeout(voxHangTimer); voxHangTimer = null; }
}

function voxLoop() {
  if (!voxEnabled || !voxAnalyser) { voxRafId = null; return; }
  voxAnalyser.getByteTimeDomainData(voxDataBuf);

  // RMS da janela temporal
  let sum = 0;
  for (let i = 0; i < voxDataBuf.length; i++) {
    const s = (voxDataBuf[i] - 128) / 128;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / voxDataBuf.length);  // 0..1
  const pct = Math.min(100, Math.round(rms * 400)); // escalar para visual

  // atualizar barra de nível (CSS custom property)
  if (elVoxLevel) elVoxLevel.style.setProperty("--vox-pct", `${pct}%`);

  const threshold = parseInt(elVoxThreshold?.value ?? "15", 10) / 100; // 0.01..0.50

  if (rms > threshold) {
    // sinal detectado — cancelar hang, activar PTT se não activo
    if (voxHangTimer !== null) { clearTimeout(voxHangTimer); voxHangTimer = null; }
    if (!txHoldActive) {
      txHoldActive = true;
      setTxButtonState(true);
      if (micTrack) micTrack.enabled = true;
      sendPtt(true);
    }
  } else if (txHoldActive && voxHangTimer === null) {
    // silêncio — iniciar hang time
    voxHangTimer = setTimeout(() => {
      voxHangTimer = null;
      if (txHoldActive) {
        txHoldActive = false;
        setTxButtonState(false);
        if (micTrack) micTrack.enabled = false;
        sendPtt(false);
      }
    }, VOX_HANG_MS);
  }

  voxRafId = requestAnimationFrame(voxLoop);
}

function setVoxEnabled(active) {
  voxEnabled = active;
  btnVox?.classList.toggle("is-active", active);
  if (active) {
    voxStartAnalyser();
    if (voxAnalyser) voxRafId = requestAnimationFrame(voxLoop);
  } else {
    voxStopAnalyser();
    // PTT OFF imediato se estava em VOX TX
    if (txHoldActive) endTxHold();
    if (elVoxLevel) elVoxLevel.style.setProperty("--vox-pct", "0%");
  }
}

btnVox?.addEventListener("click", () => setVoxEnabled(!voxEnabled));

// ─────────────────────────────────────────────────────────────────────────────

// F8 global — PTT independente do foco, mas não quando o cursor está num input de texto
window.addEventListener("keydown", (event) => {
  if (event.key !== "F8" || event.repeat) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
  event.preventDefault();
  beginTxHold(event);
});
window.addEventListener("keyup", (event) => {
  if (event.key !== "F8") return;
  event.preventDefault();
  endTxHold();
});
window.addEventListener("pointerup", endTxHold);
window.addEventListener("pointercancel", endTxHold);

async function connectRx() {
  if (pc) return;

  btnConn.disabled = true;
  btnDisc.disabled = true;
  setConnBadge("connecting");
  setAudioState("audio_negotiating");

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.ontrack = (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    // WebAudio GainNode — permite amplificar além de 100%
    try {
      const savedOutputId = localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY);
      const ctxOptions = savedOutputId ? { sinkId: savedOutputId } : {};
      audioCtx = new (window.AudioContext || window.webkitAudioContext)(ctxOptions);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = parseFloat(elVolume.value) / 100;
      const src = audioCtx.createMediaStreamSource(stream);
      src.connect(gainNode);
      gainNode.connect(audioCtx.destination);
    } catch (_) {
      // fallback para audio element directo se WebAudio não disponível
      elAudio.srcObject = stream;
      const savedOutputId = localStorage.getItem(OUTPUT_DEVICE_STORAGE_KEY);
      if (savedOutputId && typeof elAudio.setSinkId === "function") {
        elAudio.setSinkId(savedOutputId).catch(() => {});
      }
    }
    setAudioState("audio_stream_received");
    // Se VOX já estava activo, ligar o analyser agora que audioCtx existe
    if (voxEnabled) { voxStartAnalyser(); voxRafId = requestAnimationFrame(voxLoop); }
  };

  // Tentar obter microfone para TX; se negado, operar em modo RX apenas
  micTrack = null;
  try {
    const savedMicId = localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
    const audioConstraints = savedMicId
      ? { deviceId: { exact: savedMicId } }
      : true;
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    micTrack = micStream.getAudioTracks()[0];
    micTrack.enabled = false;  // silencioso até PTT activo
    pc.addTrack(micTrack, micStream);
  } catch (_) {
    console.warn("Microfone não disponível — TX desactivado (modo RX apenas)");
    pc.addTransceiver("audio", { direction: "recvonly" });
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timeout = setTimeout(resolve, 8000);  // fallback: 8s
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
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
    setAudioState("audio_link_fault");
    btnConn.disabled = false;
    return;
  }

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;

    if (state === "connecting") {
      setConnBadge("connecting");
      setAudioState("audio_finalising");
      return;
    }

    if (state === "connected") {
      setConnBadge("connected");
      setAudioState("audio_stream_live");
      btnConn.disabled = true;
      btnDisc.disabled = false;
      return;
    }

    if (["failed", "closed", "disconnected"].includes(state)) {
      setConnBadge(state === "failed" ? "error" : "disconnected");
      setAudioState(state === "failed" ? "audio_session_dropped" : "audio_link_offline");
      btnConn.disabled = false;
      btnDisc.disabled = true;

      if (state !== "closed") {
        elAudio.srcObject = null;
      }

      if (state === "closed" || state === "failed") {
        if (micTrack) { micTrack.stop(); micTrack = null; }
        pc = null;
      }
    }
  };
}

async function disconnectRx() {
  endTxHold();   // PTT OFF imediato antes de fechar
  voxStopAnalyser();

  if (micTrack) {
    micTrack.stop();
    micTrack = null;
  }

  if (pc) {
    pc.close();
    pc = null;
  }

  if (audioCtx) {
    await audioCtx.close().catch(() => {});
    audioCtx = null;
    gainNode = null;
  }

  try {
    await fetch(`${API}/api/webrtc/close`, { method: "POST" });
  } catch (_) {
    // Ignore teardown errors.
  }

  elAudio.srcObject = null;
  setConnBadge("disconnected");
  setAudioState("audio_link_offline");
  btnConn.disabled = false;
  btnDisc.disabled = true;
}

setConnBadge("disconnected");
setPttBadge(false);
setAudioState("audio_standby");
syncModeUI(elMode.value);
setTuneStep(selectedTuneStep);
updateSignalState(-127);
elPassband.textContent = "Auto";
syncUtcField();
window.setInterval(syncUtcField, 30000);
resizeWaterfallCanvas();
connectWaterfall();
pollStatus();
pollId = window.setInterval(pollStatus, 1000);

/* ── Freq Ruler (DX Spots column) ───────────────────────────────────────── */
(function () {
  const BAND_RANGES = [
    { label: "80 m", lo: 3500000,  hi: 3800000  },
    { label: "40 m", lo: 7000000,  hi: 7200000  },
    { label: "30 m", lo: 10100000, hi: 10150000 },
    { label: "20 m", lo: 14000000, hi: 14350000 },
    { label: "17 m", lo: 18068000, hi: 18168000 },
    { label: "15 m", lo: 21000000, hi: 21450000 },
    { label: "12 m", lo: 24890000, hi: 24990000 },
    { label: "10 m", lo: 28000000, hi: 29700000 },
  ];

  /* Spots simulados — serão substituídos por dados reais do cluster */
  const DEMO_SPOTS = [
    { call: "VK2GR",   freqHz: 14195000, type: "dx"   },
    { call: "PY5EG",   freqHz: 14225000, type: "dx"   },
    { call: "ZL2IFB",  freqHz: 14152000, type: "rare" },
    { call: "EA8TL",   freqHz: 14070000, type: "dx"   },
    { call: "OH2BH",   freqHz: 14260000, type: "dx"   },
    { call: "G3LHJ",   freqHz: 14178000, type: ""     },
    { call: "W6RJ",    freqHz: 14030000, type: ""     },
    { call: "JA1NVF",  freqHz: 14020000, type: "rare" },
    { call: "LU5HTV",  freqHz: 14310000, type: "dx"   },
    { call: "CT1BFV",  freqHz: 14195000, type: ""     },
  ];

  const elRuler     = document.getElementById("freq-ruler");
  const elScale     = document.getElementById("freq-ruler-scale");
  const elSpots     = document.getElementById("freq-ruler-spots");
  const elCursor    = document.getElementById("freq-ruler-cursor");
  const elCursorLbl = document.getElementById("freq-ruler-cursor-label");
  const elBandLbl   = document.getElementById("dx-band-label");

  if (!elRuler) return;

  /* Canvas de altura fixa em px — garante overflow → scroll no contentor */
  const RULER_PX = 1400;

  let rulerBand = null;
  let lastHz = currentFrequencyHz;

  function freqToMhzLabel(hz) {
    return (hz / 1e6).toFixed(3);
  }

  function buildRuler(band) {
    rulerBand = band;
    elScale.innerHTML = "";
    elSpots.innerHTML = "";
    if (elBandLbl) elBandLbl.textContent = band.label;

    /* Impor altura fixa ao canvas — isto cria overflow no .freq-ruler */
    elScale.style.height = RULER_PX + 'px';
    elSpots.style.height = RULER_PX + 'px';

    const span = band.hi - band.lo;

    /* Scale ticks: every 10/25/50 kHz minor, every 2nd is major */
    const step = span <= 200000 ? 10000 : span <= 500000 ? 25000 : 50000;
    const majorEvery = 2;
    let tick = Math.ceil(band.lo / step) * step;
    let idx = 0;
    while (tick <= band.hi) {
      const px = ((tick - band.lo) / span) * RULER_PX;
      const major = (idx % majorEvery === 0);
      const el = document.createElement("div");
      el.className = "freq-ruler__scale-tick" + (major ? " freq-ruler__scale-tick--major" : "");
      el.style.top = px.toFixed(1) + 'px';
      if (major) {
        const lbl = document.createElement("span");
        lbl.className = "freq-ruler__scale-label";
        lbl.textContent = freqToMhzLabel(tick);
        el.appendChild(lbl);
      }
      elScale.appendChild(el);
      tick += step;
      idx++;
    }

    /* Spots */
    const spots = DEMO_SPOTS.filter(s => s.freqHz >= band.lo && s.freqHz <= band.hi);
    spots.forEach(spot => {
      const px = ((spot.freqHz - band.lo) / span) * RULER_PX;
      const el = document.createElement("div");
      el.className = "freq-ruler__spot";
      el.style.top = px.toFixed(1) + 'px';
      el.title = spot.call + " — " + freqToMhzLabel(spot.freqHz) + " MHz";

      const dot = document.createElement("div");
      dot.className = "freq-ruler__spot-dot" +
        (spot.type === "dx" ? " freq-ruler__spot-dot--dx" :
         spot.type === "rare" ? " freq-ruler__spot-dot--rare" : "");

      const lbl = document.createElement("span");
      lbl.className = "freq-ruler__spot-call";
      lbl.textContent = spot.call;

      el.appendChild(dot);
      el.appendChild(lbl);
      elSpots.appendChild(el);
    });

    /* Centrar a frequência actual após construir o canvas */
    const initPx = ((lastHz - band.lo) / span) * RULER_PX;
    elRuler.scrollTop = Math.max(0, initPx - elRuler.clientHeight / 2);
  }

  function updateCursor(freqHz) {
    if (!rulerBand) return;
    const inBand = freqHz >= rulerBand.lo && freqHz <= rulerBand.hi;
    elCursor.style.display = inBand ? "" : "none";
    if (!inBand) return;
    const pct = (freqHz - rulerBand.lo) / (rulerBand.hi - rulerBand.lo);
    const px = pct * RULER_PX;
    /* O cursor é position:absolute no .freq-ruler (scroll container);
       ajustar top pelo scrollTop para acompanhar o conteúdo visualmente */
    elCursor.style.top = (px - elRuler.scrollTop).toFixed(1) + 'px';
    if (elCursorLbl) elCursorLbl.textContent = freqToMhzLabel(freqHz);
  }

  function getBandForFreq(hz) {
    return BAND_RANGES.find(b => hz >= b.lo && hz <= b.hi) || BAND_RANGES[3]; /* default 20m */
  }

  /* Initial render */
  const initBand = getBandForFreq(currentFrequencyHz);
  buildRuler(initBand);
  updateCursor(currentFrequencyHz);

  /* Actualizar cursor quando o utilizador faz scroll (viewport move, conteúdo fica) */
  elRuler.addEventListener('scroll', () => updateCursor(lastHz));

  /* Re-render quando a frequência muda */
  document.addEventListener("4ham:freqchange", (e) => {
    const hz = e.detail;
    lastHz = hz;
    const band = getBandForFreq(hz);
    if (!rulerBand || band.label !== rulerBand.label) buildRuler(band);
    updateCursor(hz);
  });

  /* Re-render no resize */
  new ResizeObserver(() => {
    if (rulerBand) buildRuler(rulerBand);
    updateCursor(lastHz);
  }).observe(elRuler);
})();
