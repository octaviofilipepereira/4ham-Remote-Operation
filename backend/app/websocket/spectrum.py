import logging
import time

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..dsp.pipeline import compute_fft_db
from ..remote.audio_capture import AUDIO_SAMPLE_RATE, AudioCaptureService
from ..streaming import encode_delta_int8

logger = logging.getLogger(__name__)

router = APIRouter(tags=["spectrum"])

_FFT_SIZE = 2048
_FRAME_INTERVAL_S = 0.10


def _audio_source(websocket: WebSocket) -> AudioCaptureService:
    source: AudioCaptureService | None = getattr(websocket.app.state, "audio_capture", None)
    if source is None:
        raise RuntimeError("fonte de áudio não inicializada")
    return source


@router.websocket("/ws/spectrum")
async def ws_spectrum(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        source = _audio_source(websocket)
        queue = await source.subscribe(maxsize=8)
    except Exception as exc:
        logger.exception("Falha ao iniciar waterfall: %s", exc)
        await websocket.close(code=1011, reason="waterfall unavailable")
        return

    fft_buffer = np.zeros(_FFT_SIZE, dtype=np.float32)
    buffered = 0
    last_sent = 0.0

    try:
        while True:
            block = await queue.get()
            samples = block.astype(np.float32) / 32768.0

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
            payload = encode_delta_int8(fft_db, step_db=0.5)
            payload.update(
                {
                    "type": "spectrum",
                    "fft_size": _FFT_SIZE,
                    "bin_hz": bin_hz,
                    "min_db": min_db,
                    "max_db": max_db,
                }
            )
            await websocket.send_json(payload)
            last_sent = now
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("Erro no websocket de spectrum: %s", exc)
    finally:
        await source.unsubscribe(queue)