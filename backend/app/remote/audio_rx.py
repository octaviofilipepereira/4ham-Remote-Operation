import asyncio
import fractions
import logging
from typing import Optional

import numpy as np
from aiortc import MediaStreamTrack
from av import AudioFrame

from .audio_capture import AUDIO_SAMPLE_RATE, AUDIO_SAMPLES, AudioCaptureService

logger = logging.getLogger(__name__)

_TIME_BASE = fractions.Fraction(1, AUDIO_SAMPLE_RATE)


_SILENCE = np.zeros(AUDIO_SAMPLES, dtype=np.int16)


class AudioRxTrack(MediaStreamTrack):
    """Consumes shared RX audio blocks and delivers AudioFrames to WebRTC."""

    kind = "audio"

    def __init__(
        self,
        source: AudioCaptureService,
    ) -> None:
        super().__init__()
        self._source = source
        self._queue: Optional[asyncio.Queue[np.ndarray]] = None
        self._timestamp: int = 0
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Quando PTT está activo, enviar silêncio ao browser para quebrar
        # o ciclo de eco acústico (colunas → microfone → TX).
        self._muted: bool = False

    def set_muted(self, muted: bool) -> None:
        """Liga/desliga o mute do RX (usar durante PTT para evitar eco)."""
        self._muted = muted

    def stop(self) -> None:
        if self._queue is not None and self._loop is not None and not self._loop.is_closed():
            try:
                self._loop.create_task(self._source.unsubscribe(self._queue))
            except RuntimeError:
                pass
        self._queue = None
        super().stop()
        logger.info("AudioRxTrack: captura parada")

    async def _ensure_subscription(self) -> None:
        if self._queue is None:
            self._loop = asyncio.get_running_loop()
            self._queue = await self._source.subscribe(maxsize=50)

    # ── aiortc ───────────────────────────────────────────────────────────────

    async def recv(self) -> AudioFrame:
        await self._ensure_subscription()

        assert self._queue is not None
        data = await self._queue.get()

        # Silêncio durante TX — quebra o ciclo de eco acústico.
        if self._muted:
            data = _SILENCE

        frame = AudioFrame(format="s16", layout="mono", samples=AUDIO_SAMPLES)
        frame.planes[0].update(data.tobytes())
        frame.pts = self._timestamp
        frame.time_base = _TIME_BASE
        frame.rate = AUDIO_SAMPLE_RATE
        self._timestamp += AUDIO_SAMPLES
        return frame
