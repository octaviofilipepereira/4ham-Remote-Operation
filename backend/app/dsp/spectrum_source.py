# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

"""Abstracção SpectrumSource — interface comum para fontes de espectro.

Cada fonte produz SpectrumFrames já processados (dB por bin) que o endpoint
WebSocket /ws/spectrum envia directamente ao browser.

Implementações disponíveis:
  AudioFFTSource  — FFT do áudio AF capturado via sounddevice (comportamento base)
  RTLSDRSource    — Espectro RF wideband via dongle RTL-SDR (ver rtlsdr_source.py)
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import NamedTuple

import numpy as np

from .pipeline import compute_fft_db
from ..remote.audio_capture import AUDIO_SAMPLE_RATE, AudioCaptureService

logger = logging.getLogger(__name__)

_FRAME_INTERVAL_S = 0.10   # ~10 fps
_FFT_SIZE = 2048


class SpectrumFrame(NamedTuple):
    values: np.ndarray     # float32, dB por bin
    min_db: float
    max_db: float
    bin_hz: float          # Hz por bin
    freq_start_hz: float   # frequência do primeiro bin (Hz); 0 para fonte AF


class AudioFFTSource:
    """Fonte de espectro AF: FFT sobre os blocos de áudio do sounddevice.

    Comportamento equivalente à implementação anterior em spectrum.py.
    Span: 0 Hz até (sample_rate/2) Hz — passband AF do rádio.
    """

    def __init__(self, audio_capture: AudioCaptureService) -> None:
        self._audio = audio_capture
        self._queues: list[asyncio.Queue[SpectrumFrame]] = []
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def subscribe(self, maxsize: int = 8) -> asyncio.Queue[SpectrumFrame]:
        q: asyncio.Queue[SpectrumFrame] = asyncio.Queue(maxsize=maxsize)
        self._queues.append(q)
        if self._task is None or self._task.done():
            await self.start()
        return q

    async def unsubscribe(self, queue: asyncio.Queue[SpectrumFrame]) -> None:
        try:
            self._queues.remove(queue)
        except ValueError:
            pass
        if not self._queues:
            await self.stop()

    async def _run(self) -> None:
        audio_queue = await self._audio.subscribe(maxsize=8)
        fft_buffer = np.zeros(_FFT_SIZE, dtype=np.float32)
        buffered = 0
        last_sent = 0.0
        try:
            while True:
                block: np.ndarray = await audio_queue.get()
                samples = block.astype(np.float32) / 32768.0

                # Manter os últimos _FFT_SIZE amostras no buffer deslizante
                if len(samples) >= _FFT_SIZE:
                    fft_buffer[:] = samples[-_FFT_SIZE:]
                    buffered = _FFT_SIZE
                else:
                    shift = len(samples)
                    fft_buffer[:-shift] = fft_buffer[shift:]
                    fft_buffer[-shift:] = samples
                    buffered = min(_FFT_SIZE, buffered + shift)

                now = time.monotonic()
                if buffered < _FFT_SIZE or now - last_sent < _FRAME_INTERVAL_S:
                    continue

                fft_db, bin_hz, min_db, max_db = compute_fft_db(
                    fft_buffer,
                    AUDIO_SAMPLE_RATE,
                    smooth_bins=4,
                )
                frame = SpectrumFrame(
                    values=fft_db,
                    min_db=min_db,
                    max_db=max_db,
                    bin_hz=bin_hz,
                    freq_start_hz=0.0,
                )
                for q in list(self._queues):
                    if not q.full():
                        await q.put(frame)
                last_sent = now

        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Erro no AudioFFTSource._run")
        finally:
            await self._audio.unsubscribe(audio_queue)
