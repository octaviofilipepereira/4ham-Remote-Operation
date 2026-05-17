import asyncio
import logging
from typing import Optional

import numpy as np
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription

from .audio_capture import AudioCaptureService
from .audio_rx import AudioRxTrack
from .audio_tx import AudioTxService

logger = logging.getLogger(__name__)

_ICE_CONFIG = RTCConfiguration(
    iceServers=[RTCIceServer(urls=["stun:stun.l.google.com:19302"])]
)

_ICE_GATHER_TIMEOUT = 10.0   # segundos máximos a esperar pelos candidatos ICE


class WebRTCPeer:
    """Gere uma RTCPeerConnection aiortc com áudio RX e TX."""

    def __init__(
        self,
        audio_source: AudioCaptureService,
        audio_tx: Optional[AudioTxService] = None,
        cat_driver=None,   # CATDriver | None — para PTT safety
    ) -> None:
        self._audio_source = audio_source
        self._audio_tx = audio_tx
        self._cat_driver = cat_driver
        self._pc: Optional[RTCPeerConnection] = None
        self._audio_track: Optional[AudioRxTrack] = None
        self._tx_task: Optional[asyncio.Task] = None

    # ── propriedades públicas ─────────────────────────────────────────────────

    @property
    def is_connected(self) -> bool:
        """Verdadeiro se a RTCPeerConnection estiver no estado 'connected'."""
        return self._pc is not None and self._pc.connectionState == "connected"

    def set_rx_muted(self, muted: bool) -> None:
        """Silencia (ou restaura) o áudio RX enviado ao browser.

        Usar quando PTT está activo para quebrar o ciclo de eco acústico:
        colunas → microfone → rádio TX.
        """
        if self._audio_track is not None:
            self._audio_track.set_muted(muted)

    # ── offer/answer ─────────────────────────────────────────────────────────

    async def handle_offer(self, sdp: str, type_: str) -> dict:
        """Processa um SDP offer do browser e devolve o SDP answer."""
        await self.close()   # fechar ligação anterior se existir

        self._pc = RTCPeerConnection(configuration=_ICE_CONFIG)
        self._audio_track = AudioRxTrack(source=self._audio_source)
        self._pc.addTrack(self._audio_track)

        # ── Receber track TX do browser (microfone) ───────────────────────────
        @self._pc.on("track")
        def _on_track(track) -> None:
            if track.kind == "audio":
                logger.info("WebRTC: track TX recebida do browser")
                loop = asyncio.get_event_loop()
                self._tx_task = loop.create_task(self._consume_tx_track(track))

        @self._pc.on("connectionstatechange")
        async def on_state_change() -> None:
            state = self._pc.connectionState
            logger.info("WebRTC connectionState: %s", state)
            if state in ("disconnected", "failed"):
                # Segurança: PTT OFF imediato para evitar transmissão sem sessão
                if self._cat_driver is not None:
                    try:
                        await self._cat_driver.set_ptt(False)
                        logger.warning(
                            "WebRTC: PTT forçado OFF por perda de ligação (%s)", state
                        )
                    except Exception:
                        logger.debug("WebRTC: erro ao forçar PTT OFF", exc_info=True)
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

    # ── TX track consumer ─────────────────────────────────────────────────────

    async def _consume_tx_track(self, track) -> None:
        """Lê frames de áudio do browser e encaminha para AudioTxService."""
        if self._audio_tx is not None:
            self._audio_tx.start()
        _first_frame = True
        try:
            while True:
                try:
                    frame = await track.recv()
                except Exception:
                    break
                if self._audio_tx is None:
                    continue

                arr = frame.to_ndarray()
                n_samples_per_ch = frame.samples  # e.g. 960 para 20 ms a 48 kHz

                # Log do primeiro frame para diagnóstico
                if _first_frame:
                    logger.info(
                        "TX audio frame: shape=%s dtype=%s sample_rate=%d samples=%d",
                        arr.shape, arr.dtype,
                        getattr(frame, "sample_rate", 0),
                        n_samples_per_ch,
                    )
                    _first_frame = False

                if arr.dtype != np.int16:
                    # Formato planar (fltp): shape (n_ch, n_samples)
                    if arr.ndim == 2 and arr.shape[0] > 1:
                        arr = arr[0:1, :]  # extrair canal 0
                    mono = (arr.astype(np.float32) * 32767.0).clip(-32768, 32767).astype(np.int16).flatten()
                else:
                    # Formato packed (s16): shape (1, n_ch * n_samples)
                    flat = arr.flatten()
                    n_ch = flat.size // n_samples_per_ch if n_samples_per_ch > 0 else 1
                    mono = flat[::max(1, n_ch)]

                self._audio_tx.push(mono)
        finally:
            logger.info("WebRTC: track TX encerrada")
            if self._audio_tx is not None:
                self._audio_tx.stop()

    # ── cleanup ───────────────────────────────────────────────────────────────

    async def close(self) -> None:
        # Segurança: garantir PTT OFF ao fechar a ligação
        if self._cat_driver is not None:
            try:
                await self._cat_driver.set_ptt(False)
            except Exception:
                pass

        # Cancelar task de consumo TX
        if self._tx_task is not None and not self._tx_task.done():
            self._tx_task.cancel()
            try:
                await self._tx_task
            except asyncio.CancelledError:
                pass
            self._tx_task = None

        if self._audio_track is not None:
            self._audio_track.stop()
            self._audio_track = None
        if self._pc is not None:
            await self._pc.close()
            self._pc = None
            logger.info("WebRTC peer fechado")
