"""AudioTxService — recebe amostras de áudio do browser via WebRTC
e escreve no canal TX do rádio via sounddevice OutputStream."""

from __future__ import annotations

import collections
import logging
from typing import Optional

import numpy as np
import sounddevice as sd

from .audio_capture import AUDIO_SAMPLE_RATE, AUDIO_SAMPLES

logger = logging.getLogger(__name__)

_DEQUE_MAX = 50   # ~1 s de buffer máximo; amostras mais antigas são descartadas


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
        """Coloca um bloco mono int16 na fila de saída.

        Thread-safe: ``collections.deque.append`` é atómica em CPython.
        Se a fila estiver cheia (``maxlen``), o bloco mais antigo é descartado.
        """
        self._buf.append(mono)

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
