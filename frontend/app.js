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
let localMonitorEl = null;  // <audio> para monitorização local do mic durante TX
let localMonitorEnabled = false;  // toggle Monitor local (OFF por defeito)
let moniRadioEnabled = false;     // toggle MONI Rádio (OFF por defeito)
let txAudioCtx = null;            // AudioContext para ganho de TX
let txGainNode = null;            // GainNode no caminho TX
let rawMicStream = null;          // stream original do getUserMedia (para cleanup)

// ── TX POST-DSP MONITOR ───────────────────────────────────────────────────────
let txMonWs         = null;       // WebSocket para /ws/tx-monitor
let txMonCtx        = null;       // AudioContext para playback do monitor
let txMonNextTime   = 0;          // próximo instante de playback agendado
let txMonPttActive  = false;      // true enquanto PTT está activo
let txMonPlayBuf    = [];         // frames Float32 bufferizados durante PTT
const TX_MON_MAX_BUF = 1500;     // máx ~30 s de buffer (1500 × 20 ms)

// ── VOX ──────────────────────────────────────────────────────────────────────
let voxEnabled = false;
let voxRafId   = null;
let voxHangTimer = null;
let voxAnalyser = null;
let voxDataBuf  = null;
let voxSuppressUntil = 0;   // epoch ms — VOX suprimido até este instante (Monitor DSP a reproduzir)
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
const btnMonLocal    = document.getElementById("btn-mon-local");
const btnMonRadio    = document.getElementById("btn-mon-radio");
const elMicPcGain    = document.getElementById("mic-pc-gain");
const elMicPcGainVal = document.getElementById("mic-pc-gain-val");
const chkTxMonitor   = document.getElementById("chk-tx-monitor");
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

// ── RF Controls ───────────────────────────────────────────────────────────────
const elRigPreamp   = document.getElementById("rig-preamp");
const elRigAtt      = document.getElementById("rig-att");
const elRigAgc      = document.getElementById("rig-agc");
const elRfPower     = document.getElementById("rf-power");
const elRfPowerVal  = document.getElementById("rf-power-val");

// ── Radio Settings Dialog ─────────────────────────────────────────────────────
const btnRigSettings    = document.getElementById("btn-rig-settings");
const dlgRigSettings    = document.getElementById("dlg-rig-settings");
const elRigNb           = document.getElementById("rig-nb");
const elRigNbLevel      = document.getElementById("rig-nb-level");
const elRigNbLevelVal   = document.getElementById("rig-nb-level-val");
const elRigProc         = document.getElementById("rig-proc");
const elRigProcLevel    = document.getElementById("rig-proc-level");
const elRigProcLevelVal = document.getElementById("rig-proc-level-val");
const elRigMicGain      = document.getElementById("rig-mic-gain");
const elRigMicGainVal   = document.getElementById("rig-mic-gain-val");
const elRigWidth        = document.getElementById("rig-width");
const btnRsdApply       = document.getElementById("rsd-apply");
const btnRsdCancel      = document.getElementById("rsd-cancel");

// ── QSO Log ───────────────────────────────────────────────────────────────────
const elQsoCallsign    = document.getElementById("qso-callsign");
const elQsoRstSent     = document.getElementById("qso-rst-sent");
const elQsoRstRx       = document.getElementById("qso-rst-rx");
const elQsoNotes       = document.getElementById("qso-notes");
const btnLogQso        = document.getElementById("btn-log-qso");
const elRecentQsoBody  = document.getElementById("recent-qso-body");
const elRecentQsoCount = document.getElementById("recent-qso-count");

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
  if (frequencyHz >= 1810000 && frequencyHz < 2000000) return "160m";
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

  // Preferências guardadas no servidor (label + deviceId — portável entre browsers)
  let serverMicLabel = "", serverMicId = "", serverOutputLabel = "", serverOutputId = "";
  try {
    const r = await fetch(`${API}/api/prefs/audio`);
    if (r.ok) {
      const p = await r.json();
      serverMicLabel    = p.mic_label        || "";
      serverMicId       = p.mic_device_id    || "";
      serverOutputLabel = p.output_label     || "";
      serverOutputId    = p.output_device_id || "";
    }
  } catch (_) { /* sem servidor — ignorar */ }

  // Se não há permissão de mic (labels vazios), pedir brevemente para obter os nomes
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch (_) {}
  const hasLabels = devices.some(d => d.kind === "audioinput" && d.label);
  if (!hasLabels) {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      devices = await navigator.mediaDevices.enumerateDevices(); // enumerar enquanto stream activo (Firefox)
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) { /* utilizador recusou — continuar sem labels */ }
  }

  // Determinar que deviceId pré-seleccionar:
  //   1. localStorage (preferência explícita neste browser)
  //   2. deviceId do servidor (mesmo browser, sessão anterior)
  //   3. label do servidor → match por nome (outro browser, mesma máquina)
  //   4. track activa (browser escolheu por omissão)
  const _findByLabel = (label, kind) =>
    devices.find(d => d.kind === kind && d.label === label)?.deviceId || "";
  const _deviceExists = (id, kind) =>
    devices.some(d => d.kind === kind && d.deviceId === id);

  const selectedMic =
    (savedMic    && _deviceExists(savedMic,    "audioinput")  ? savedMic    : "") ||
    (serverMicId && _deviceExists(serverMicId, "audioinput")  ? serverMicId : "") ||
    (serverMicLabel ? _findByLabel(serverMicLabel, "audioinput")  : "") ||
    (micTrack       ? (micTrack.getSettings().deviceId || "")     : "");

  const selectedOutput =
    (savedOutput     && _deviceExists(savedOutput,     "audiooutput") ? savedOutput     : "") ||
    (serverOutputId  && _deviceExists(serverOutputId,  "audiooutput") ? serverOutputId  : "") ||
    (serverOutputLabel ? _findByLabel(serverOutputLabel, "audiooutput") : "");

  // Opção "predefinido do sistema"
  if (selMic)    _addDeviceOption(selMic,    "", t("audio_settings_default"), selectedMic);
  if (selOutput) _addDeviceOption(selOutput, "", t("audio_settings_default"), selectedOutput);

  devices.forEach(d => {
    const label = d.label || `${d.kind} (${d.deviceId.slice(0, 8)}…)`;
    if (d.kind === "audioinput"  && selMic)
      _addDeviceOption(selMic,    d.deviceId, label, selectedMic);
    if (d.kind === "audiooutput" && selOutput)
      _addDeviceOption(selOutput, d.deviceId, label, selectedOutput);
  });

  // Esconder saída de áudio se setSinkId não suportado
  if (selOutput && typeof HTMLMediaElement.prototype.setSinkId !== "function") {
    const outLabel = selOutput.previousElementSibling;
    if (outLabel) outLabel.style.display = "none";
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

  // Guardar label + deviceId no servidor (portável entre browsers; deviceId acelera match)
  const micLabel    = selMic?.options[selMic.selectedIndex]?.textContent       || "";
  const outputLabel = selOutput?.options[selOutput.selectedIndex]?.textContent || "";
  const defaultText = t("audio_settings_default");
  fetch(`${API}/api/prefs/audio`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mic_label:        micLabel    === defaultText ? "" : micLabel,
      mic_device_id:    micLabel    === defaultText ? "" : micId,
      output_label:     outputLabel === defaultText ? "" : outputLabel,
      output_device_id: outputLabel === defaultText ? "" : outputId,
    }),
  }).catch(err => console.warn("Falha ao guardar prefs de áudio:", err));

  // Aplicar saída de áudio imediatamente se o stream RX já estiver activo
  if (outputId) {
    if (audioCtx && typeof audioCtx.setSinkId === "function") {
      audioCtx.setSinkId(outputId).catch(err => console.warn("audioCtx.setSinkId:", err));
    }
    if (elAudio && typeof elAudio.setSinkId === "function") {
      elAudio.setSinkId(outputId).catch(err => console.warn("elAudio.setSinkId:", err));
    }
  }

  dlgAudioSettings.close();
}

if (btnAudioSettings) btnAudioSettings.addEventListener("click", openAudioSettings);
if (dlgAudioApply)    dlgAudioApply.addEventListener("click", applyAudioSettings);
if (dlgAudioClose)    dlgAudioClose.addEventListener("click", () => dlgAudioSettings?.close());

// ── RF Controls ───────────────────────────────────────────────────────────────

// Popula os selects ATT, PREAMP e AGC com base nas capacidades do rádio activo.
async function loadRigCaps() {
  try {
    const r = await fetch(`${API}/api/rig/caps`);
    if (!r.ok) return;
    const caps = await r.json();

    // Label do painel PREAMP = rótulo do primeiro passo (ex: "IPO" ou "OFF")
    const lblPreamp = document.getElementById("lbl-preamp");
    if (lblPreamp && caps.preamp_labels) {
      const firstKey = String(Math.min(...(caps.preamp_steps ?? [0])));
      lblPreamp.textContent = caps.preamp_labels[firstKey] ?? "PREAMP";
    }

    if (elRigPreamp && caps.preamp_steps) {
      elRigPreamp.innerHTML = "";
      for (const step of caps.preamp_steps) {
        const opt = document.createElement("option");
        opt.value = String(step);
        opt.textContent = caps.preamp_labels?.[String(step)] ?? (step === 0 ? "OFF" : `${step} dB`);
        elRigPreamp.appendChild(opt);
      }
    }

    if (elRigAtt && caps.att_steps) {
      // Se só há um passo não-zero, mostrar ON/OFF em vez de "12 dB"
      const attOnOff = caps.att_steps.filter(s => s !== 0).length === 1;
      elRigAtt.innerHTML = "";
      for (const step of caps.att_steps) {
        const opt = document.createElement("option");
        opt.value = String(step);
        opt.textContent = step === 0 ? "OFF" : (attOnOff ? "ON" : `${step} dB`);
        elRigAtt.appendChild(opt);
      }
    }

    if (elRigAgc && caps.agc_modes) {
      const prevAgc = elRigAgc.value;
      elRigAgc.innerHTML = "";
      for (const mode of caps.agc_modes) {
        const opt = document.createElement("option");
        opt.value = mode;
        opt.textContent = mode;
        elRigAgc.appendChild(opt);
      }
      if ([...elRigAgc.options].some(o => o.value === prevAgc)) elRigAgc.value = prevAgc;
    }
  } catch (_) {}
}

async function loadRfControls() {
  try {
    const r = await fetch(`${API}/api/rig/rf`);
    if (!r.ok) return;
    const d = await r.json();
    if (elRigPreamp && d.preamp !== undefined) elRigPreamp.value = String(d.preamp);
    if (elRigAtt && d.att !== undefined)       elRigAtt.value    = String(d.att);
    if (elRigAgc && d.agc)                     elRigAgc.value    = d.agc;
    if (elRfPower && d.rfpower !== undefined) {
      elRfPower.value = d.rfpower;
      if (elRfPowerVal) elRfPowerVal.textContent = `${d.rfpower} W`;
    }
  } catch (_) {}
}

async function sendRfControls() {
  try {
    await fetch(`${API}/api/rig/rf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preamp:  parseInt(elRigPreamp?.value || "0",   10),
        att:     parseInt(elRigAtt?.value    || "0",   10),
        agc:     elRigAgc?.value             || "MID",
        rfpower: parseInt(elRfPower?.value   || "100", 10),
      }),
    });
  } catch (_) {}
}

if (elRfPower) {
  elRfPower.addEventListener("input", () => {
    if (elRfPowerVal) elRfPowerVal.textContent = `${elRfPower.value} W`;
  });
  elRfPower.addEventListener("change", sendRfControls);
}
if (elRigPreamp) elRigPreamp.addEventListener("change", sendRfControls);
if (elRigAtt)    elRigAtt.addEventListener("change",    sendRfControls);
if (elRigAgc)    elRigAgc.addEventListener("change",    sendRfControls);

// ── Radio Settings Dialog ─────────────────────────────────────────────────────

async function openRigSettings() {
  try {
    const r = await fetch(`${API}/api/rig/settings`);
    if (r.ok) {
      const d = await r.json();
      if (elRigNb) elRigNb.value = d.nb ? "1" : "0";
      if (elRigNbLevel) {
        elRigNbLevel.value = Math.round(d.nb_level * 100);
        if (elRigNbLevelVal) elRigNbLevelVal.textContent = `${elRigNbLevel.value}%`;
      }
      if (elRigProc) elRigProc.value = d.comp ? "1" : "0";
      if (elRigProcLevel) {
        elRigProcLevel.value = Math.round(d.comp_level * 100);
        if (elRigProcLevelVal) elRigProcLevelVal.textContent = `${elRigProcLevel.value}%`;
      }
      if (elRigMicGain) {
        elRigMicGain.value = Math.round(d.mic * 100);
        if (elRigMicGainVal) elRigMicGainVal.textContent = `${elRigMicGain.value}%`;
      }
    }
  } catch (_) {}
  if (dlgRigSettings) dlgRigSettings.showModal();
}

async function applyRigSettings() {
  try {
    await fetch(`${API}/api/rig/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nb:         elRigNb?.value === "1",
        nb_level:   parseInt(elRigNbLevel?.value    || "50", 10) / 100,
        comp:       elRigProc?.value === "1",
        comp_level: parseInt(elRigProcLevel?.value  || "50", 10) / 100,
        mic:        parseInt(elRigMicGain?.value    || "50", 10) / 100,
        width:      elRigWidth?.value  || "AUTO",
      }),
    });
  } catch (_) {}
  if (dlgRigSettings) dlgRigSettings.close();
}

if (elRigNbLevel)    elRigNbLevel.addEventListener("input",    () => { if (elRigNbLevelVal)    elRigNbLevelVal.textContent    = `${elRigNbLevel.value}%`; });
if (elRigProcLevel)  elRigProcLevel.addEventListener("input",  () => { if (elRigProcLevelVal)  elRigProcLevelVal.textContent  = `${elRigProcLevel.value}%`; });
if (elRigMicGain)    elRigMicGain.addEventListener("input",    () => { if (elRigMicGainVal)    elRigMicGainVal.textContent    = `${elRigMicGain.value}%`; });
if (btnRigSettings)  btnRigSettings.addEventListener("click", openRigSettings);
if (btnRsdCancel)    btnRsdCancel.addEventListener("click", () => dlgRigSettings?.close());
if (btnRsdApply)     btnRsdApply.addEventListener("click", applyRigSettings);

// ── QSO Log ───────────────────────────────────────────────────────────────────

async function loadRecentQsos() {
  try {
    const r = await fetch(`${API}/api/qso/recent?limit=10`);
    if (!r.ok || !elRecentQsoBody) return;
    const qsos = await r.json();
    if (qsos.length === 0) {
      elRecentQsoBody.innerHTML = `<tr><td colspan="5" class="recent-qso-empty">${t("recent_qso_empty")}</td></tr>`;
      if (elRecentQsoCount) elRecentQsoCount.textContent = "0";
      return;
    }
    elRecentQsoBody.innerHTML = qsos.map(q => `
      <tr>
        <td>${escapeHtml(q.callsign)}</td>
        <td>${escapeHtml(q.band || "—")}</td>
        <td>${escapeHtml(q.mode || "—")}</td>
        <td>${escapeHtml(q.utc || q.logged_at || "—")}</td>
        <td>${escapeHtml(q.rst_sent || "59")}</td>
      </tr>`).join("");
    if (elRecentQsoCount) elRecentQsoCount.textContent = String(qsos.length);
  } catch (_) {}
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function logQso() {
  const callsign = elQsoCallsign?.value?.trim().toUpperCase();
  if (!callsign) {
    if (elQsoCallsign) elQsoCallsign.focus();
    return;
  }
  try {
    const r = await fetch(`${API}/api/qso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callsign,
        utc:       elQsoTime?.value       || "",
        frequency: elQsoFrequency?.value  || "",
        mode:      elQsoMode?.value       || "",
        band:      elQsoBand?.value       || "",
        rst_sent:  elQsoRstSent?.value    || "59",
        rst_rx:    elQsoRstRx?.value      || "59",
        notes:     elQsoNotes?.value      || "",
      }),
    });
    if (r.ok) {
      if (elQsoCallsign) elQsoCallsign.value = "";
      if (elQsoRstSent)  elQsoRstSent.value  = "";
      if (elQsoRstRx)    elQsoRstRx.value    = "";
      if (elQsoNotes)    elQsoNotes.value    = "";
      await loadRecentQsos();
    }
  } catch (_) {}
}

if (btnLogQso) btnLogQso.addEventListener("click", logQso);

function setRigConnected(connected) {
  if (rigConnected === connected) return;
  rigConnected = connected;
  if (connected) {
    closeRigOfflineDialog();
    _rigOfflineShown = false;  // nova ligação — permitir mostrar modal de novo se cair
    loadRigCaps().then(loadRfControls); // carregar caps + estado RF assim que o rádio fica acessível
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
  // RX sempre silenciado no browser durante TX — o hardware MONI do rádio funciona
  // independentemente disto. Manter gainNode=0 elimina o reverb causado pela
  // sobreposição do sinal MONI imediato (rádio) com a cópia atrasada via WebRTC.
  if (gainNode) gainNode.gain.value = 0;
  // Monitorização local: clone da track (independente do WebRTC) → Audio element
  if (localMonitorEnabled && micTrack && !localMonitorEl) {
    try {
      const monTrack = micTrack.clone();
      const monStream = new MediaStream([monTrack]);
      localMonitorEl = new Audio();
      localMonitorEl.srcObject = monStream;
      localMonitorEl.volume = 0.8;
      localMonitorEl.play().catch(e => console.warn('[4ham] monitor local:', e));
    } catch (e) {
      console.warn('[4ham] monitor local erro:', e);
      localMonitorEl = null;
    }
  }
  sendPtt(true);
  // TX monitor: começar a bufferizar — sem reproduzir durante TX para evitar eco
  if (txMonCtx) { txMonPttActive = true; txMonPlayBuf = []; }
}

function endTxHold() {
  if (!txHoldActive) return;
  txHoldActive = false;
  setTxButtonState(false);
  if (micTrack) micTrack.enabled = false;
  // Parar monitorização local do mic e libertar o clone
  if (localMonitorEl) {
    localMonitorEl.srcObject?.getTracks().forEach(t => t.stop());
    localMonitorEl.pause();
    localMonitorEl.srcObject = null;
    localMonitorEl = null;
  }
  // Restaurar volume RX após TX
  if (gainNode) gainNode.gain.value = parseInt(elVolume.value, 10) / 100;
  sendPtt(false);
  // TX monitor: reproduzir o buffer acumulado durante o PTT
  txMonPttActive = false;
  if (txMonCtx && txMonPlayBuf.length > 0) {
    if (txMonCtx.state === "suspended") txMonCtx.resume().catch(() => {});
    txMonNextTime = txMonCtx.currentTime + 0.05;
    for (const f32 of txMonPlayBuf) {
      const buf = txMonCtx.createBuffer(1, f32.length, 48000);
      buf.copyToChannel(f32, 0);
      const src = txMonCtx.createBufferSource();
      src.buffer = buf;
      src.connect(txMonCtx.destination);
      src.start(txMonNextTime);
      txMonNextTime += buf.duration;
    }
    txMonPlayBuf = [];
    // Suprimir VOX durante a duração da reprodução + margem de segurança
    if (voxEnabled) {
      const suppressMs = Math.ceil((txMonNextTime - txMonCtx.currentTime) * 1000) + 300;
      voxSuppressUntil = Date.now() + suppressMs;
    }
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

// Plano de Bandas — clicar numa banda sintoniza no início da zona SSB (IARU Região 1)
// e selecciona o modo correcto: LSB se banda ≤ 7 MHz, USB acima de 7 MHz.
// Se o utilizador já esteve nessa banda, restaura a última frequência/modo usados.
const BAND_SSB = {
  "160m": { hz: 1_840_000,  mode: "LSB" },  // 1.840 MHz
  "80m":  { hz: 3_600_000,  mode: "LSB" },  // 3.600 MHz
  "40m":  { hz: 7_060_000,  mode: "LSB" },  // 7.060 MHz — banda inicia em 7.000 (= 7000 kHz ≤ 7000 → LSB)
  "20m":  { hz: 14_125_000, mode: "USB" },  // 14.125 MHz
  "17m":  { hz: 18_110_000, mode: "USB" },  // 18.110 MHz
  "15m":  { hz: 21_151_000, mode: "USB" },  // 21.151 MHz
  "12m":  { hz: 24_930_000, mode: "USB" },  // 24.930 MHz
  "10m":  { hz: 28_300_000, mode: "USB" },  // 28.300 MHz
};

// Memória por banda: { [band]: { hz, mode } } — persiste no servidor (config/user_prefs.json)
// localStorage serve apenas como cache imediata enquanto o fetch inicial ainda não respondeu.
const _BAND_MEM_KEY = "4ham_band_memory";
let bandMemory = (() => {
  try { return JSON.parse(localStorage.getItem(_BAND_MEM_KEY) || "{}"); }
  catch { return {}; }
})();

// Bloquear PUTs ao servidor até o GET inicial ter completado — evita sobrescrever
// dados do servidor com bandMemory vazio (race condition em browsers sem localStorage).
let _bandMemReady = false;
let _bandMemSaveTimer = null;

fetch(`${API}/api/prefs/band-memory`)
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data && typeof data === "object") {
      bandMemory = data;
      try { localStorage.setItem(_BAND_MEM_KEY, JSON.stringify(bandMemory)); } catch { /* quota */ }
    }
  })
  .catch(() => { /* servidor indisponível — usar cache local */ })
  .finally(() => {
    _bandMemReady = true;
    // Cancelar qualquer save agendado antes dos dados do servidor chegarem;
    // foi baseado em estado incompleto e já não é necessário.
    clearTimeout(_bandMemSaveTimer);
    _bandMemSaveTimer = null;
  });

function saveBandMemory() {
  // cache local sempre imediata
  try { localStorage.setItem(_BAND_MEM_KEY, JSON.stringify(bandMemory)); } catch { /* quota */ }
  // PUT ao servidor só depois do GET inicial ter completado
  if (!_bandMemReady) return;
  clearTimeout(_bandMemSaveTimer);
  _bandMemSaveTimer = setTimeout(() => {
    fetch(`${API}/api/prefs/band-memory`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bandMemory),
    }).catch(() => { /* silenciar erros de rede */ });
  }, 1500);
}

// Guardar frequência+modo actuais na memória da banda sempre que a frequência muda
document.addEventListener("4ham:freqchange", (e) => {
  const band = getBandLabel(e.detail);
  if (band && band !== "General" && band !== "") {
    bandMemory[band] = { hz: e.detail, mode: elMode.value };
    saveBandMemory();
  }
});

// Guardar modo na memória da banda quando o modo muda (sem mudança de frequência)
elMode.addEventListener("change", () => {
  const band = getBandLabel(currentFrequencyHz);
  if (band && band !== "General" && band !== "") {
    if (bandMemory[band]) bandMemory[band].mode = elMode.value;
    saveBandMemory();
  }
}, /* capture */ true);  // capture=true: executa antes do handler que envia ao rádio

bandPlanRows.forEach((row) => {
  row.style.cursor = "pointer";
  row.addEventListener("click", async () => {
    const band = row.dataset.band;
    const def  = BAND_SSB[band];
    if (!def) return;

    // Usar memória se existir, caso contrário usar o default SSB da banda
    const mem   = bandMemory[band];
    const entry = mem ?? def;

    // 1. Frequência
    applyLocalFrequency(entry.hz, 1000);

    // 2. Modo — actualizar UI e enviar ao rádio
    if (elMode.value !== entry.mode) {
      elMode.value = entry.mode;
      syncModeUI(entry.mode);
      try {
        await fetch(`${API}/api/rig/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: entry.mode, passband_hz: 0 }),
        });
      } catch (err) {
        console.error("[4ham] band plan set_mode:", err);
      }
    }
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
  // Usar rawMicStream (sinal original, nunca desactivado) e txAudioCtx.
  // micTrack tem enabled=false quando PTT está inactivo — não serve para VOX.
  // audioCtx (RX) pode não existir ainda quando o utilizador activa VOX.
  if (voxAnalyser || !rawMicStream || !txAudioCtx) return;
  try {
    const src = txAudioCtx.createMediaStreamSource(rawMicStream);
    voxAnalyser = txAudioCtx.createAnalyser();
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

  const threshold = parseInt(elVoxThreshold?.value ?? "25", 10) / 100; // 0.01..0.50

  // Suprimir VOX enquanto o Monitor DSP está a reproduzir para evitar eco em loop:
  // a reprodução é captada pelo mic (ou pelo analyser) e re-dispara o VOX.
  if (Date.now() < voxSuppressUntil) {
    voxRafId = requestAnimationFrame(voxLoop);
    return;
  }

  if (rms > threshold) {
    // sinal detectado — cancelar hang, activar PTT via beginTxHold
    // (garante gainNode=0, TX monitor, etc. — mesma lógica do PTT manual)
    if (voxHangTimer !== null) { clearTimeout(voxHangTimer); voxHangTimer = null; }
    if (!txHoldActive) beginTxHold();
  } else if (txHoldActive && voxHangTimer === null) {
    // silêncio — iniciar hang time
    voxHangTimer = setTimeout(() => {
      voxHangTimer = null;
      endTxHold();
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

btnMonLocal?.addEventListener("click", () => {
  localMonitorEnabled = !localMonitorEnabled;
  btnMonLocal.classList.toggle("is-active", localMonitorEnabled);
  // Mutuamente exclusivo com Radio Monitor
  if (localMonitorEnabled && moniRadioEnabled) {
    moniRadioEnabled = false;
    btnMonRadio?.classList.remove("is-active");
    fetch(`${API}/api/rig/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moni: 0.0 }),
    }).catch(() => {});
  }
});

btnMonRadio?.addEventListener("click", () => {
  moniRadioEnabled = !moniRadioEnabled;
  btnMonRadio.classList.toggle("is-active", moniRadioEnabled);
  // Mutuamente exclusivo com Local Monitor
  if (moniRadioEnabled && localMonitorEnabled) {
    localMonitorEnabled = false;
    btnMonLocal?.classList.remove("is-active");
  }
  // Activar/desactivar MONI hardware no rádio via CAT
  fetch(`${API}/api/rig/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moni: moniRadioEnabled ? 0.5 : 0.0 }),
  }).catch(() => {});
});

elMicPcGain?.addEventListener("input", () => {
  const pct = parseInt(elMicPcGain.value, 10);
  if (elMicPcGainVal) elMicPcGainVal.textContent = `${pct}%`;
  if (txGainNode) txGainNode.gain.value = pct / 100;
});

// ── TX MONITOR pós-DSP ────────────────────────────────────────────────────────
chkTxMonitor?.addEventListener("change", () => {
  if (chkTxMonitor.checked) {
    startTxMonitor();
  } else {
    stopTxMonitor();
  }
});

function startTxMonitor() {
  if (txMonWs) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  txMonWs = new WebSocket(`${proto}//${location.host}/ws/tx-monitor`);
  txMonWs.binaryType = "arraybuffer";
  txMonCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  txMonCtx.resume().catch(() => {});
  txMonNextTime = 0;
  let _rxFrames = 0;
  txMonWs.onmessage = (evt) => {
    const int16 = new Int16Array(evt.data);
    if (_rxFrames === 0) {
      console.log("[TX Monitor] primeiro frame: amostras=", int16.length,
                  "ctx.sampleRate=", txMonCtx.sampleRate, "ctx.state=", txMonCtx.state);
    }
    _rxFrames++;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
    if (txMonPttActive) {
      // Bufferizar durante PTT — não reproduzir para evitar eco na transmissão
      if (txMonPlayBuf.length < TX_MON_MAX_BUF) txMonPlayBuf.push(float32);
    }
    // Fora de PTT os frames são silêncio — descartar
  };
  txMonWs.onclose = () => {
    stopTxMonitor();
    if (chkTxMonitor) chkTxMonitor.checked = false;
  };
  txMonWs.onerror = () => txMonWs?.close();
}

function stopTxMonitor() {
  if (txMonWs) { txMonWs.onclose = null; txMonWs.close(); txMonWs = null; }
  if (txMonCtx) { txMonCtx.close().catch(() => {}); txMonCtx = null; }
  txMonNextTime  = 0;
  txMonPttActive = false;
  txMonPlayBuf   = [];
}
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
    // Workaround Chrome (bug histórico): uma MediaStream remota WebRTC só é
    // "puxada" pelo motor de áudio se também estiver anexada a um HTMLMediaElement.
    // Sem isto, createMediaStreamSource não produz som no Chrome.
    try {
      const sink = new Audio();
      sink.srcObject = stream;
      sink.muted = true;
      sink.play().catch(() => {});
    } catch (_) {}
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
      // Chrome suspende AudioContext por política de autoplay — forçar resume
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
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
      ? { deviceId: { exact: savedMicId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    rawMicStream = micStream;
    // Inserir GainNode no caminho TX para controlo de ganho do mic local
    txAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    if (txAudioCtx.state === "suspended") txAudioCtx.resume().catch(() => {});
    const txSrc = txAudioCtx.createMediaStreamSource(micStream);
    txGainNode = txAudioCtx.createGain();
    txGainNode.gain.value = (elMicPcGain ? parseInt(elMicPcGain.value, 10) : 100) / 100;
    const txDst = txAudioCtx.createMediaStreamDestination();
    txSrc.connect(txGainNode);
    txGainNode.connect(txDst);
    micTrack = txDst.stream.getAudioTracks()[0];
    micTrack.enabled = false;  // silencioso até PTT activo
    pc.addTrack(micTrack, txDst.stream);
    // Logar label do mic activo — visível na consola e no título do botão TX
    const micLabel = micTrack.label || "desconhecido";
    console.info("[4ham] Microfone activo:", micLabel, "| deviceId:", micTrack.getSettings().deviceId);
    btnTx.title = "Mic: " + micLabel;
  } catch (micErr) {
    console.warn("Microfone não disponível — TX desactivado (modo RX apenas)", micErr);
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
        if (rawMicStream) { rawMicStream.getTracks().forEach(t => t.stop()); rawMicStream = null; }
        if (txAudioCtx) { txAudioCtx.close().catch(() => {}); txAudioCtx = null; txGainNode = null; }
        pc = null;
      }
    }
  };
}

async function disconnectRx() {
  endTxHold();   // PTT OFF imediato antes de fechar
  voxStopAnalyser();

  if (micTrack) { micTrack.stop(); micTrack = null; }
  if (rawMicStream) { rawMicStream.getTracks().forEach(t => t.stop()); rawMicStream = null; }
  if (txAudioCtx) { await txAudioCtx.close().catch(() => {}); txAudioCtx = null; txGainNode = null; }

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
loadRecentQsos();

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

  const SPOTS_REFRESH_MS = 60_000; /* polling a cada 60 s */

  const elRuler     = document.getElementById("freq-ruler");
  const elScale     = document.getElementById("freq-ruler-scale");
  const elSpots     = document.getElementById("freq-ruler-spots");
  const elCursor    = document.getElementById("freq-ruler-cursor");
  const elCursorLbl = document.getElementById("freq-ruler-cursor-label");
  const elBandLbl   = document.getElementById("dx-band-label");

  if (!elRuler) return;

  /* Canvas de altura fixa em px — garante overflow → scroll no contentor */
  const RULER_PX = 1400;

  let rulerBand  = null;
  let lastHz      = currentFrequencyHz;
  let spotsTimer  = null;

  function freqToMhzLabel(hz) {
    return (hz / 1e6).toFixed(3);
  }

  async function loadSpots(band) {
    try {
      const bParam = band.label.replace(" ", "");
      const r = await fetch(`${API}/api/dx/spots?band=${encodeURIComponent(bParam)}&limit=100`);
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }

  function renderSpots(band, spots) {
    /* Ignorar se a banda mudou entretanto */
    if (!rulerBand || rulerBand.label !== band.label) return;
    elSpots.innerHTML = "";
    const span = band.hi - band.lo;
    spots.forEach(spot => {
      const freqHz = spot.freq_hz;
      if (freqHz < band.lo || freqHz > band.hi) return;
      const px = ((freqHz - band.lo) / span) * RULER_PX;
      const el = document.createElement("div");
      el.className = "freq-ruler__spot";
      el.style.top = px.toFixed(1) + 'px';
      el.title = spot.dx_call + " — " + freqToMhzLabel(freqHz) + " MHz"
                 + (spot.comment ? " — " + spot.comment : "");
      el.style.cursor = "pointer";

      const dot = document.createElement("div");
      dot.className = "freq-ruler__spot-dot freq-ruler__spot-dot--dx";

      const lbl = document.createElement("span");
      lbl.className = "freq-ruler__spot-call";
      lbl.textContent = spot.dx_call;

      el.appendChild(dot);
      el.appendChild(lbl);

      el.addEventListener("click", () => {
        applyLocalFrequency(freqHz, 1000);
      });

      elSpots.appendChild(el);
    });
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

    /* Spots — carregar do backend de forma assíncrona */
    loadSpots(band).then(spots => renderSpots(band, spots));

    /* Centrar a frequência actual após construir o canvas */
    const initPx = ((lastHz - band.lo) / span) * RULER_PX;
    elRuler.scrollTop = Math.max(0, initPx - elRuler.clientHeight / 2);
  }

  function updateCursor(freqHz, autoScroll = false) {
    if (!rulerBand) return;
    const inBand = freqHz >= rulerBand.lo && freqHz <= rulerBand.hi;
    elCursor.style.display = inBand ? "" : "none";
    if (!inBand) return;
    const pct = (freqHz - rulerBand.lo) / (rulerBand.hi - rulerBand.lo);
    const px = pct * RULER_PX;
    /* Auto-scroll: centrar a frequência se saiu da janela visível */
    if (autoScroll) {
      const visTop = elRuler.scrollTop;
      const visBot = visTop + elRuler.clientHeight;
      if (px < visTop || px > visBot) {
        elRuler.scrollTop = Math.max(0, px - elRuler.clientHeight / 2);
      }
    }
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
    updateCursor(hz, true); /* auto-scroll activo quando o VFO muda */
  });

  /* Polling periódico para actualizar spots */
  spotsTimer = window.setInterval(() => {
    if (rulerBand) loadSpots(rulerBand).then(spots => renderSpots(rulerBand, spots));
  }, SPOTS_REFRESH_MS);

  /* Re-render no resize */
  new ResizeObserver(() => {
    if (rulerBand) buildRuler(rulerBand);
    updateCursor(lastHz);
  }).observe(elRuler);
})();

/* ── DX Cluster: gestão do diálogo ─────────────────────────────────────── */
(function () {
  const dlg          = document.getElementById("dlg-dx-cluster");
  const btnOpen      = document.getElementById("btn-dx-cluster");
  const btnClose     = document.getElementById("dx-cluster-close");
  const btnDisconnect= document.getElementById("dx-cluster-disconnect");
  const inpCallsign  = document.getElementById("dx-cluster-callsign");
  const inpSearch    = document.getElementById("dx-cluster-search");
  const listEl       = document.getElementById("dx-cluster-list");
  const statusBar    = document.getElementById("dx-cluster-status-bar");
  const statusText   = document.getElementById("dx-cluster-status-text");
  const headerDot    = document.getElementById("dx-cluster-dot");

  if (!dlg) return;

  let allClusters  = [];
  let activeCall   = null; /* call do cluster actualmente ligado */

  /* ── Actualizar indicadores ── */
  function applyDotState(dot, state) {
    dot.className = "dx-cluster-dot";
    if      (state === "connected")   dot.classList.add("dx-cluster-dot--connected");
    else if (state === "connecting")  dot.classList.add("dx-cluster-dot--connecting");
    else if (state === "error")       dot.classList.add("dx-cluster-dot--error");
    else                              dot.classList.add("dx-cluster-dot--off");
  }

  function updateStatusBar(status) {
    const dot = statusBar.querySelector(".dx-cluster-dot");
    applyDotState(dot, status.state);
    applyDotState(headerDot, status.state);
    if (status.state === "connected") {
      activeCall = status.call || status.host || "";
      statusText.textContent = "Ligado a " + (status.call || status.host);
      headerDot.title = "Ligado: " + (status.call || status.host);
    } else if (status.state === "connecting") {
      statusText.textContent = "A ligar a " + (status.host || "…");
      headerDot.title = "A ligar…";
    } else if (status.state === "error") {
      statusText.textContent = "Erro: " + (status.error || "desconhecido");
      activeCall = null;
      headerDot.title = "Erro de ligação";
    } else {
      statusText.textContent = "Desligado";
      activeCall = null;
      headerDot.title = "Sem cluster activo";
    }
    /* Destacar linha activa na lista */
    listEl.querySelectorAll(".dx-cluster-row").forEach(row => {
      row.classList.toggle("dx-cluster-row--active",
        status.state === "connected" && row.dataset.host === status.host);
    });
  }

  async function refreshStatus() {
    try {
      const r = await fetch(`${API}/api/dx/status`);
      if (r.ok) updateStatusBar(await r.json());
    } catch { /* ignorar */ }
  }

  /* ── Renderizar lista de clusters ── */
  function renderList(clusters) {
    listEl.innerHTML = "";
    if (!clusters.length) {
      listEl.innerHTML = '<div style="padding:0.6em 0.65em;font-size:0.75rem;color:rgba(200,212,220,0.4)">Sem resultados</div>';
      return;
    }
    clusters.forEach(c => {
      const row = document.createElement("div");
      row.className = "dx-cluster-row";
      row.dataset.host = c.host;
      row.dataset.port = c.port;
      row.dataset.call = c.call;
      row.role = "option";
      row.innerHTML =
        `<span class="dx-cluster-row__call">${c.call}</span>` +
        `<span class="dx-cluster-row__loc">${c.country} — ${c.location}</span>` +
        (c.rbn ? '<span class="dx-cluster-row__rbn">RBN</span>' : "");

      row.addEventListener("click", () => connectCluster(c));
      listEl.appendChild(row);
    });
  }

  function filterList(q) {
    if (!q) { renderList(allClusters); return; }
    const ql = q.toLowerCase();
    renderList(allClusters.filter(c =>
      c.call.toLowerCase().includes(ql) ||
      c.host.toLowerCase().includes(ql) ||
      c.country.toLowerCase().includes(ql) ||
      c.location.toLowerCase().includes(ql)
    ));
  }

  /* ── Ligar a um cluster ── */
  async function connectCluster(c) {
    const callsign = (inpCallsign.value || "CT7BFV").trim().toUpperCase();
    /* Feedback imediato na linha */
    listEl.querySelectorAll(".dx-cluster-row").forEach(row => {
      row.classList.remove("dx-cluster-row--connecting", "dx-cluster-row--active");
      if (row.dataset.host === c.host) row.classList.add("dx-cluster-row--connecting");
    });
    applyDotState(headerDot, "connecting");
    statusText.textContent = "A ligar a " + c.call + "…";

    try {
      const r = await fetch(`${API}/api/dx/cluster`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: c.host, port: c.port, callsign }),
      });
      const data = await r.json();
      updateStatusBar(data);
    } catch (err) {
      console.error("[DXCluster] connectCluster:", err);
      applyDotState(headerDot, "error");
      statusText.textContent = "Erro ao ligar";
    }
  }

  /* ── Desligar ── */
  async function disconnectCluster() {
    try {
      await fetch(`${API}/api/dx/cluster`, { method: "DELETE" });
    } catch { /* ignorar */ }
    updateStatusBar({ state: "disconnected" });
  }

  /* ── Abrir diálogo ── */
  async function openDialog() {
    /* Carregar clusters se ainda não foram carregados */
    if (!allClusters.length) {
      try {
        const r = await fetch(`${API}/api/dx/clusters`);
        if (r.ok) allClusters = await r.json();
      } catch { /* ignorar */ }
    }
    renderList(allClusters);
    await refreshStatus();
    dlg.showModal();
  }

  btnOpen.addEventListener("click", openDialog);
  btnClose.addEventListener("click", () => dlg.close());
  btnDisconnect.addEventListener("click", disconnectCluster);
  inpSearch.addEventListener("input", () => filterList(inpSearch.value));

  /* Fechar ao clicar no backdrop */
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });

  /* Polling do estado no header (a cada 10 s) */
  refreshStatus();
  window.setInterval(refreshStatus, 10_000);
})();
