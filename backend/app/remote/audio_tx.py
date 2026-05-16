"""AudioTxService — recebe amostras de áudio do browser via WebRTC
e escreve no canal TX do rádio via sounddevice OutputStream.

Pipeline de processamento (server-side, antes do USB CODEC):
    push(int16) → [EQ 4 biquads] → [Downward expander] → deque → callback

Objectivo: reduzir reverb da sala captado por mics electret sensíveis
(headsets tipo Elite H40) sem introduzir latência apreciável e sem
risco de feedback (não toca em WebAudio do browser).

Para desactivar todo o DSP rapidamente (A/B test ou rollback instantâneo):
    _DSP_ENABLED = False
"""

from __future__ import annotations

import collections
import logging
import math
from typing import Optional

import numpy as np
import sounddevice as sd
from scipy import signal as sps

from .audio_capture import AUDIO_SAMPLE_RATE, AUDIO_SAMPLES

logger = logging.getLogger(__name__)

_DEQUE_MAX = 50   # ~1 s de buffer máximo; amostras mais antigas são descartadas

# ── Bypass global (mudar para False para desactivar todo o DSP) ─────────────
_DSP_ENABLED = True

# ── EQ banda-voz ─────────────────────────────────────────────────────────────
_EQ_HPF_HZ   = 200.0    # high-pass 2ª ordem — remove rumble + reverb low-freq
_EQ_LPF_HZ   = 3200.0   # low-pass 2ª ordem — banda SSB clássica
_EQ_BELL1_HZ = 350.0    # peaking: cortar "boxiness" da sala
_EQ_BELL1_DB = -6.0
_EQ_BELL1_Q  = 1.5
_EQ_BELL2_HZ = 2200.0   # peaking: presence / inteligibilidade SSB
_EQ_BELL2_DB = +3.0
_EQ_BELL2_Q  = 1.0

# ── Downward expander ────────────────────────────────────────────────────────
_EXP_THRESHOLD_DBFS = -38.0   # início da atenuação
_EXP_RATIO          = 3.0     # 3:1 abaixo do threshold
_EXP_FLOOR_DB       = -18.0   # atenuação máxima (nunca silêncio absoluto)
_EXP_ATTACK_MS      = 5.0     # rápido — não corta início de palavras
_EXP_RELEASE_MS     = 150.0   # suave — não corta finais


def _db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


def _peaking_sos(freq_hz: float, gain_db: float, q: float, fs: int) -> np.ndarray:
    """Biquad peaking EQ (RBJ Audio EQ Cookbook). Devolve SOS 1×6."""
    A  = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq_hz / fs
    cw = math.cos(w0)
    alpha = math.sin(w0) / (2.0 * q)
    b0 = 1.0 + alpha * A;  b1 = -2.0 * cw;  b2 = 1.0 - alpha * A
    a0 = 1.0 + alpha / A;  a1 = -2.0 * cw;  a2 = 1.0 - alpha / A
    return np.array([[b0/a0, b1/a0, b2/a0, 1.0, a1/a0, a2/a0]], dtype=np.float64)


def _build_eq_sos(fs: int) -> np.ndarray:
    """Cadeia EQ como SOS (pronto para scipy.signal.sosfilt)."""
    hpf   = sps.butter(2, _EQ_HPF_HZ,  btype="highpass", fs=fs, output="sos")
    bell1 = _peaking_sos(_EQ_BELL1_HZ, _EQ_BELL1_DB, _EQ_BELL1_Q, fs)
    bell2 = _peaking_sos(_EQ_BELL2_HZ, _EQ_BELL2_DB, _EQ_BELL2_Q, fs)
    lpf   = sps.butter(2, _EQ_LPF_HZ,  btype="lowpass",  fs=fs, output="sos")
    return np.vstack([hpf, bell1, bell2, lpf]).astype(np.float64)


class AudioTxService:
    """Saída de áudio para o canal TX do rádio (USB Audio CODEC canal R)."""

    def __init__(
        self,
        device: str | int | None = None,
        tx_channel: int = 1,
    ) -> None:
        self._device = device
        self._tx_channel = tx_channel
        self._n_ch = tx_channel + 1
        self._buf: collections.deque[np.ndarray] = collections.deque(maxlen=_DEQUE_MAX)
        self._stream: Optional[sd.OutputStream] = None

        # EQ: SOS + estado persistente entre blocos
        self._eq_sos = _build_eq_sos(AUDIO_SAMPLE_RATE)
        self._eq_zi  = sps.sosfilt_zi(self._eq_sos)   # shape (n_sections, 2)

        # Expander: estado de ganho suavizado
        self._exp_thr_lin   = _db_to_lin(_EXP_THRESHOLD_DBFS)
        self._exp_floor_lin = _db_to_lin(_EXP_FLOOR_DB)
        block_ms = 1000.0 * AUDIO_SAMPLES / AUDIO_SAMPLE_RATE
        self._exp_atk_coef  = math.exp(-block_ms / max(_EXP_ATTACK_MS,  0.1))
        self._exp_rel_coef  = math.exp(-block_ms / max(_EXP_RELEASE_MS, 0.1))
        self._exp_gain      = 1.0

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._stream is not None:
            return
        # resetar estado dos filtros a cada sessão
        self._eq_zi    = sps.sosfilt_zi(self._eq_sos)
        self._exp_gain = 1.0
        try:
            self._stream = sd.OutputStream(
                device=self._device,
                samplerate=AUDIO_SAMPLE_RATE,
                channels=self._n_ch,
                dtype="int16",
                blocksize=AUDIO_SAMPLES,
                callback=self._callback,
            )
            self._stream.start()
            logger.info(
                "AudioTxService: saída iniciada (device=%r, canal=%d, dsp=%s)",
                self._device, self._tx_channel, _DSP_ENABLED,
            )
        except Exception:
            logger.exception("AudioTxService: falha ao abrir OutputStream")
            self._stream = None

    def stop(self) -> None:
        if self._stream is None:
            return
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            logger.debug("AudioTxService: erro ao fechar stream", exc_info=True)
        finally:
            self._stream = None
            self._buf.clear()
        logger.info("AudioTxService: saída parada")

    # ── push ─────────────────────────────────────────────────────────────────

    def push(self, mono: np.ndarray) -> None:
        """Processa e coloca bloco mono int16 na fila de saída (thread-safe)."""
        if _DSP_ENABLED:
            mono = self._apply_eq(mono)
            mono = self._apply_expander(mono)
        self._buf.append(mono)

    # ── EQ ────────────────────────────────────────────────────────────────────

    def _apply_eq(self, mono_i16: np.ndarray) -> np.ndarray:
        if mono_i16.size == 0:
            return mono_i16
        f = mono_i16.astype(np.float64) / 32768.0
        f_out, self._eq_zi = sps.sosfilt(self._eq_sos, f, zi=self._eq_zi)
        return (f_out * 32768.0).clip(-32768, 32767).astype(np.int16)

    # ── Downward expander ─────────────────────────────────────────────────────

    def _apply_expander(self, mono_i16: np.ndarray) -> np.ndarray:
        if mono_i16.size == 0:
            return mono_i16
        f   = mono_i16.astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(f * f)))

        if rms >= self._exp_thr_lin:
            target = 1.0
        else:
            level_db = 20.0 * math.log10(max(rms, 1e-10))
            gain_db  = (_EXP_RATIO - 1.0) * (level_db - _EXP_THRESHOLD_DBFS)
            target   = _db_to_lin(max(gain_db, _EXP_FLOOR_DB))

        coef = self._exp_atk_coef if target >= self._exp_gain else self._exp_rel_coef
        self._exp_gain = target + (self._exp_gain - target) * coef

        return (f * self._exp_gain * 32768.0).clip(-32768, 32767).astype(np.int16)

    # ── sounddevice callback ──────────────────────────────────────────────────

    def _callback(
        self,
        outdata: np.ndarray,
        frames: int,
        time,       # noqa: ANN001
        status,
    ) -> None:
        if status:
            logger.debug("AudioTxService: %s", status)
        outdata.fill(0)
        if self._buf:
            chunk = self._buf.popleft()
            n = min(len(chunk), frames)
            outdata[:n, self._tx_channel] = chunk[:n]
