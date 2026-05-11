import asyncio
import logging
from typing import Optional

import numpy as np
import sounddevice as sd

logger = logging.getLogger(__name__)

AUDIO_PTIME = 0.020
AUDIO_SAMPLE_RATE = 48_000
AUDIO_SAMPLES = int(AUDIO_SAMPLE_RATE * AUDIO_PTIME)


class AudioCaptureService:
    """Shared sounddevice capture source for WebRTC RX and waterfall streaming."""

    def __init__(
        self,
        device: str | int | None = None,
        rx_channel: int = 0,
    ) -> None:
        self._device = device
        self._rx_channel = rx_channel
        self._stream: Optional[sd.InputStream] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._lock = asyncio.Lock()
        self._subscribers: set[asyncio.Queue[np.ndarray]] = set()

    async def subscribe(self, maxsize: int = 50) -> asyncio.Queue[np.ndarray]:
        queue: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=maxsize)

        async with self._lock:
            self._subscribers.add(queue)
            if self._stream is None:
                self._start_stream_locked()

        return queue

    async def unsubscribe(self, queue: asyncio.Queue[np.ndarray]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)
            if not self._subscribers:
                self._stop_stream_locked()

    async def close(self) -> None:
        async with self._lock:
            self._subscribers.clear()
            self._stop_stream_locked()

    def _start_stream_locked(self) -> None:
        self._loop = asyncio.get_running_loop()
        n_channels = self._rx_channel + 1
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
            "AudioCaptureService: captura iniciada (device=%r, canal=%d)",
            self._device,
            self._rx_channel,
        )

    def _stop_stream_locked(self) -> None:
        if self._stream is None:
            return

        self._stream.stop()
        self._stream.close()
        self._stream = None
        self._loop = None
        logger.info("AudioCaptureService: captura parada")

    def _sd_callback(
        self,
        indata: np.ndarray,
        frames: int,
        time,  # noqa: ANN001
        status,
    ) -> None:
        if status:
            logger.warning("sounddevice status: %s", status)

        mono = indata[:, self._rx_channel].copy()
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._fanout, mono)

    def _fanout(self, mono: np.ndarray) -> None:
        for queue in tuple(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass

            try:
                queue.put_nowait(mono.copy())
            except asyncio.QueueFull:
                pass