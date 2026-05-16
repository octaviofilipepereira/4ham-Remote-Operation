"""WebSocket /ws/tx-monitor — transmite áudio TX pós-DSP ao browser.

PCM16LE mono 48 kHz, frames de 20 ms (960 amostras = 1920 bytes).
Permite ao utilizador ouvir exactamente o que chega ao rádio,
incluindo o pipeline EQ + expander do Pi.
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..remote.audio_tx import AudioTxService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tx-monitor"])


@router.websocket("/ws/tx-monitor")
async def ws_tx_monitor(websocket: WebSocket) -> None:
    audio_tx: AudioTxService | None = getattr(websocket.app.state, "audio_tx", None)
    if audio_tx is None:
        await websocket.close(code=1011, reason="audio_tx not available")
        return

    await websocket.accept()
    queue = audio_tx.subscribe_monitor(maxsize=16)
    logger.info("TX monitor subscrito (%s)", websocket.client)

    try:
        while True:
            data: bytes = await queue.get()
            await websocket.send_bytes(data)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("TX monitor WS erro: %s", exc)
    finally:
        audio_tx.unsubscribe_monitor(queue)
        logger.info("TX monitor desligado (%s)", websocket.client)
