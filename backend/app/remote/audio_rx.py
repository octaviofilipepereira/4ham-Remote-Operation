import asyncio
import fractions
import logging
from typing import Optional

import numpy as np
import sounddevice as sd
from aiortc import MediaStreamTrack
from av import AudioFrame

logger = logging.getLogger(__name__)

AUDIO_PTIME = 0.020                                # 20 ms por frame
AUDIO_SAMPLE_RATE = 48_000
AUDIO_SAMPLES = int(AUDIO_SAMPLE_RATE * AUDIO_PTIME)  # 960 amostras
_TIME_BASE = fractions.Fraction(1, AUDIO_SAMPLE_RATE)


class AudioRxTrack(MediaStreamTrack):
    """Captura o canal RX do rádio via sounddevice e entrega AudioFrames ao WebRTC.

    *device*     — nome ou índice do dispositivo sounddevice (None = default)
    *rx_channel* — índice do canal de captura (0 = L para FT-991A)
    """

    kind = "audio"

    def __init__(
        self,
        device: str | int | None = None,
        rx_channel: int = 0,
    ) -> None:
        super().__init__()
        self._device = device
        self._rx_channel = rx_channel
        self._queue: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=50)
        self._timestamp: int = 0
        self._stream: Optional[sd.InputStream] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ── sounddevice ──────────────────────────────────────────────────────────

    def start(self) -> None:
        self._loop = asyncio.get_event_loop()
        n_channels = self._rx_channel + 1          # capturar até ao canal pedido
        self._stream = sd.InputStream(
            device=self._device,
            samplerate=AUDIO_SAMPLE_RATE,
            channels=n_channels,
            dtype="int16",
            blocksize=AUDIO_SAMPLES,
            callback=self._sd_callback,
        )
        self._stream.start()
        logger.info(
            "AudioRxTrack: captura iniciada (device=%r, canal=%d)",
            self._device,
            self._rx_channel,
        )

    def stop(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
            logger.info("AudioRxTrack: captura parada")

    def _sd_callback(
        self,
        indata: np.ndarray,
        frames: int,
        time,   # noqa: ANN001
        status,
    ) -> None:
        if status:
            logger.warning("sounddevice status: %s", status)
        mono = indata[:, self._rx_channel].copy()
        if self._loop is not None and not self._loop.is_closed():
            try:
                self._loop.call_soon_threadsafe(self._queue.put_nowait, mono)
            except asyncio.QueueFull:
                pass   # descartar frame antigo se o consumer estiver atrasado

    # ── aiortc ───────────────────────────────────────────────────────────────

    async def recv(self) -> AudioFrame:
        if self._stream is None:
            self.start()

        data = await self._queue.get()

        frame = AudioFrame(format="s16", layout="mono", samples=AUDIO_SAMPLES)
        frame.planes[0].update(data.tobytes())
        frame.pts = self._timestamp
        frame.time_base = _TIME_BASE
        frame.rate = AUDIO_SAMPLE_RATE
        self._timestamp += AUDIO_SAMPLES
        return frame
