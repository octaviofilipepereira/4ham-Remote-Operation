import asyncio
import logging
from typing import Optional

from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription

from .audio_capture import AudioCaptureService
from .audio_rx import AudioRxTrack

logger = logging.getLogger(__name__)

_ICE_CONFIG = RTCConfiguration(
    iceServers=[RTCIceServer(urls=["stun:stun.l.google.com:19302"])]
)

_ICE_GATHER_TIMEOUT = 10.0   # segundos máximos a esperar pelos candidatos ICE


class WebRTCPeer:
    """Gere uma RTCPeerConnection aiortc com uma track de áudio RX."""

    def __init__(
        self,
        audio_source: AudioCaptureService,
    ) -> None:
        self._audio_source = audio_source
        self._pc: Optional[RTCPeerConnection] = None
        self._audio_track: Optional[AudioRxTrack] = None

    # ── offer/answer ─────────────────────────────────────────────────────────

    async def handle_offer(self, sdp: str, type_: str) -> dict:
        """Processa um SDP offer do browser e devolve o SDP answer."""
        await self.close()   # fechar ligação anterior se existir

        self._pc = RTCPeerConnection(configuration=_ICE_CONFIG)
        self._audio_track = AudioRxTrack(source=self._audio_source)
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

        # Aguardar ICE gathering antes de devolver o SDP; sem isto os candidatos
        # ICE podem estar em falta e a ligação falha silenciosamente no browser.
        try:
            await asyncio.wait_for(
                self._wait_ice_complete(),
                timeout=_ICE_GATHER_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "ICE gathering não completou em %.0fs — a devolver SDP parcial",
                _ICE_GATHER_TIMEOUT,
            )

        logger.info("WebRTC answer criado (iceGatheringState=%s)", self._pc.iceGatheringState)
        return {
            "sdp": self._pc.localDescription.sdp,
            "type": self._pc.localDescription.type,
        }

    async def _wait_ice_complete(self) -> None:
        if self._pc is None:
            return
        if self._pc.iceGatheringState == "complete":
            return
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()

        @self._pc.on("icegatheringstatechange")
        def _on_ice_state() -> None:
            if self._pc and self._pc.iceGatheringState == "complete":
                if not future.done():
                    loop.call_soon_threadsafe(future.set_result, None)

        # verificar novamente após registar o handler (evita race condition)
        if self._pc.iceGatheringState == "complete":
            future.set_result(None)

        await future

    # ── cleanup ───────────────────────────────────────────────────────────────

    async def close(self) -> None:
        if self._audio_track is not None:
            self._audio_track.stop()
            self._audio_track = None
        if self._pc is not None:
            await self._pc.close()
            self._pc = None
            logger.info("WebRTC peer fechado")
