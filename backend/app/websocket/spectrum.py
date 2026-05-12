import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..dsp.spectrum_source import AudioFFTSource, SpectrumFrame
from ..streaming import encode_delta_int8

logger = logging.getLogger(__name__)

router = APIRouter(tags=["spectrum"])


def _spectrum_source(websocket: WebSocket) -> AudioFFTSource:
    """Retorna a fonte de espectro activa (AudioFFTSource ou RTLSDRSource)."""
    source = getattr(websocket.app.state, "spectrum_source", None)
    if source is None:
        raise RuntimeError("fonte de espectro não inicializada")
    return source


@router.websocket("/ws/spectrum")
async def ws_spectrum(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        source = _spectrum_source(websocket)
        queue = await source.subscribe(maxsize=8)
    except Exception as exc:
        logger.exception("Falha ao iniciar waterfall: %s", exc)
        await websocket.close(code=1011, reason="waterfall unavailable")
        return

    try:
        while True:
            frame: SpectrumFrame = await queue.get()
            payload = encode_delta_int8(frame.values, step_db=0.5)
            payload.update(
                {
                    "type": "spectrum",
                    "fft_size": len(frame.values),
                    "bin_hz": frame.bin_hz,
                    "min_db": frame.min_db,
                    "max_db": frame.max_db,
                    "freq_start_hz": frame.freq_start_hz,
                }
            )
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("Erro no websocket de spectrum: %s", exc)
    finally:
        await source.unsubscribe(queue)