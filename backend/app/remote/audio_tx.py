"""AudioTxService — recebe amostras de áudio do browser via WebRTC
e escreve no canal TX do rádio via sounddevice OutputStream."""

from __future__ import annotations

import collections
import logging
import math
from typing import Optional

import numpy as np
import sounddevice as sd

from .audio_capture import AUDIO_SAMPLE_RATE, AUDIO_SAMPLES

logger = logging.getLogger(__name__)

_DEQUE_MAX = 50   # ~1 s de buffer máximo; amostras mais antigas são descartadas

# ── Noise gate (server-side, antes do USB CODEC) ────────────────────────────
# Headsets electret captam ambiente facilmente → ruído de fundo entre
# palavras vai para o ar. Gate silencia abaixo do threshold.
_GATE_OPEN_DBFS = -32.0   # acima disto, abrir (deixa passar)
_GATE_CLOSE_DBFS = -42.0  # abaixo disto, fechar (silencia)
_GATE_ATTACK_MS = 5.0     # rápido — não cortar início da palavra
_GATE_RELEASE_MS = 120.0  # suave — não cortar finais nem soar a "ck"


def _db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


class AudioTxService:
    """Saída de áudio para o canal TX do rádio (USB Audio CODEC canal R).

    Abre um ``sounddevice.OutputStream`` com callback e escreve amostras
    recebidas do browser (via aiortc) no canal ``tx_channel`` do dispositivo.
    Usa uma ``deque`` como buffer inter-thread (callback C ↔ asyncio task).
    """

    def __init__(
        self,
        device: str | int | None = None,
        tx_channel: int = 1,
    ) -> None:
        self._device = device
        self._tx_channel = tx_channel
        # Precisamos de canais suficientes para cobrir o índice tx_channel.
        self._n_ch = tx_channel + 1
        self._buf: collections.deque[np.ndarray] = collections.deque(maxlen=_DEQUE_MAX)
        self._stream: Optional[sd.OutputStream] = None
        # ── estado do noise gate ─────────────────────────────────────────────
        self._gate_open_lin = _db_to_lin(_GATE_OPEN_DBFS)
        self._gate_close_lin = _db_to_lin(_GATE_CLOSE_DBFS)
        # coeficientes attack/release exponenciais (por bloco de AUDIO_SAMPLES)
        block_ms = 1000.0 * AUDIO_SAMPLES / AUDIO_SAMPLE_RATE
        self._gate_atk_coef = math.exp(-block_ms / max(_GATE_ATTACK_MS, 0.1))
        self._gate_rel_coef = math.exp(-block_ms / max(_GATE_RELEASE_MS, 0.1))
        self._gate_gain = 0.0   # ganho actual (0..1), suavizado

    # ── lifecycle ──────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Abre o OutputStream e começa a reproduzir (silêncio até haver dados)."""
        if self._stream is not None:
            return
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
                "AudioTxService: saída iniciada (device=%r, canal=%d)",
                self._device,
                self._tx_channel,
            )
        except Exception:
            logger.exception("AudioTxService: falha ao abrir OutputStream")
            self._stream = None

    def stop(self) -> None:
        """Para e fecha o OutputStream."""
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

    # ── push (thread-safe via deque) ──────────────────────────────────────────

    def push(self, mono: np.ndarray) -> None:
        """Coloca um bloco mono int16 na fila de saída, com noise gate aplicado.

        Thread-safe: ``collections.deque.append`` é atómica em CPython.
        Se a fila estiver cheia (``maxlen``), o bloco mais antigo é descartado.
        """
        self._buf.append(self._apply_gate(mono))

    # ── noise gate ────────────────────────────────────────────────────────────

    def _apply_gate(self, mono_i16: np.ndarray) -> np.ndarray:
        """Aplica noise gate com hysteresis + smoothing exponencial por bloco.

        Calcula RMS do bloco em escala linear (0..1). Determina o alvo:
          - alvo=1.0 se RMS > open_threshold (abrir)
          - alvo=0.0 se RMS < close_threshold (fechar)
          - mantém estado anterior na zona de hysteresis
        Suaviza com coeficientes attack (subida) e release (descida).
        """
        if mono_i16.size == 0:
            return mono_i16
        # RMS em escala linear normalizada (int16 → -1..1)
        f = mono_i16.astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(f * f))) if f.size else 0.0
        # decidir alvo com hysteresis
        if rms >= self._gate_open_lin:
            target = 1.0
        elif rms <= self._gate_close_lin:
            target = 0.0
        else:
            target = 1.0 if self._gate_gain > 0.5 else 0.0
        # suavização exponencial: gain ← target + (gain-target)*coef
        coef = self._gate_atk_coef if target > self._gate_gain else self._gate_rel_coef
        self._gate_gain = target + (self._gate_gain - target) * coef
        # aplicar ganho e voltar a int16
        out = (f * self._gate_gain * 32768.0).clip(-32768, 32767).astype(np.int16)
        return out

    # ── sounddevice callback (executa em thread C, não no event loop) ─────────

    def _callback(
        self,
        outdata: np.ndarray,   # shape (frames, n_ch), dtype int16
        frames: int,
        time,                  # noqa: ANN001 — CFFI time struct, não usado
        status,
    ) -> None:
        if status:
            logger.debug("AudioTxService: %s", status)
        outdata.fill(0)        # silêncio por omissão em todos os canais
        if self._buf:
            chunk = self._buf.popleft()
            n = min(len(chunk), frames)
            outdata[:n, self._tx_channel] = chunk[:n]
