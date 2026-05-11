import logging
from typing import Optional

from aiortc import RTCPeerConnection, RTCSessionDescription

from .audio_rx import AudioRxTrack

logger = logging.getLogger(__name__)


class WebRTCPeer:
    """Gere uma RTCPeerConnection aiortc com uma track de áudio RX.

    *audio_device* — dispositivo sounddevice (nome, índice ou None)
    *rx_channel*   — canal de captura (0 = L)
    """

    def __init__(
        self,
        audio_device: str | int | None = None,
        rx_channel: int = 0,
    ) -> None:
        self._audio_device = audio_device
        self._rx_channel = rx_channel
        self._pc: Optional[RTCPeerConnection] = None
        self._audio_track: Optional[AudioRxTrack] = None

    # ── offer/answer ─────────────────────────────────────────────────────────

    async def handle_offer(self, sdp: str, type_: str) -> dict:
        """Processa um SDP offer do browser e devolve o SDP answer."""
        await self.close()   # fechar ligação anterior se existir

        self._pc = RTCPeerConnection()
        self._audio_track = AudioRxTrack(
            device=self._audio_device,
            rx_channel=self._rx_channel,
        )
        self._pc.addTrack(self._audio_track)

        @self._pc.on("connectionstatechange")
        async def on_state_change() -> None:
            state = self._pc.connectionState
            logger.info("WebRTC connectionState: %s", state)
            if state in ("failed", "closed"):
                await self.close()

        offer = RTCSessionDescription(sdp=sdp, type=type_)
        await self._pc.setRemoteDescription(offer)
        answer = await self._pc.createAnswer()
        await self._pc.setLocalDescription(answer)

        logger.info("WebRTC answer criado")
        return {
            "sdp": self._pc.localDescription.sdp,
            "type": self._pc.localDescription.type,
        }

    # ── cleanup ───────────────────────────────────────────────────────────────

    async def close(self) -> None:
        if self._audio_track is not None:
            self._audio_track.stop()
            self._audio_track = None
        if self._pc is not None:
            await self._pc.close()
            self._pc = None
            logger.info("WebRTC peer fechado")
