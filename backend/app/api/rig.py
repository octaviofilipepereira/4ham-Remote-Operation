import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..remote.cat_driver import CATDriver, RigStatus

router = APIRouter(prefix="/api/rig", tags=["rig"])
logger = logging.getLogger(__name__)


def _driver(request: Request) -> CATDriver:
    driver: CATDriver | None = getattr(request.app.state, "cat_driver", None)
    if driver is None:
        raise HTTPException(status_code=503, detail="CAT driver não inicializado")
    return driver


def _cancel_tx_timer(request: Request) -> None:
    """Cancela o timer de TX máximo, se estiver a correr."""
    timer: asyncio.Task | None = getattr(request.app.state, "tx_timer", None)
    if timer is not None and not timer.done():
        timer.cancel()
    request.app.state.tx_timer = None


# ── GET /api/rig/status ──────────────────────────────────────────────────────

class RigStatusResponse(BaseModel):
    frequency_hz: int
    mode: str
    passband_hz: int
    strength_db: float
    ptt: bool
    swr: float = 0.0


@router.get("/status", response_model=RigStatusResponse)
async def get_status(request: Request) -> RigStatusResponse:
    """Retorna frequência, modo, S-meter e estado PTT do rádio."""
    driver = _driver(request)
    try:
        status: RigStatus = await driver.get_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return RigStatusResponse(
        frequency_hz=status.frequency_hz,
        mode=status.mode,
        passband_hz=status.passband_hz,
        strength_db=status.strength_db,
        ptt=status.ptt,
        swr=status.swr,
    )


# ── POST /api/rig/freq ───────────────────────────────────────────────────────

class SetFreqRequest(BaseModel):
    frequency_hz: int = Field(..., gt=0, description="Frequência em Hz")


@router.post("/freq")
async def set_freq(body: SetFreqRequest, request: Request) -> dict:
    """Define a frequência do rádio."""
    driver = _driver(request)
    try:
        await driver.set_freq(body.frequency_hz)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"ok": True}


# ── POST /api/rig/mode ───────────────────────────────────────────────────────

class SetModeRequest(BaseModel):
    mode: str = Field(..., description="Modo (USB, LSB, CW, FM, AM, …)")
    passband_hz: int = Field(0, ge=0, description="Largura de banda em Hz; 0 = default do rádio")


@router.post("/mode")
async def set_mode(body: SetModeRequest, request: Request) -> dict:
    """Define o modo de operação do rádio."""
    driver = _driver(request)
    try:
        await driver.set_mode(body.mode, body.passband_hz)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"ok": True}


# ── POST /api/rig/ptt ────────────────────────────────────────────────────────

class SetPTTRequest(BaseModel):
    enabled: bool = Field(..., description="Estado PTT/TX pretendido")


@router.post("/ptt")
async def set_ptt(body: SetPTTRequest, request: Request) -> dict:
    """Activa ou desactiva o PTT do rádio."""
    driver = _driver(request)

    if body.enabled:
        # ── Verificação de sessão WebRTC ──────────────────────────────────────
        from ..remote.webrtc_peer import WebRTCPeer  # noqa: PLC0415 — import local para evitar ciclo
        peer: WebRTCPeer | None = getattr(request.app.state, "webrtc_peer", None)
        if peer is None or not peer.is_connected:
            raise HTTPException(
                status_code=409,
                detail="PTT negado: sessão WebRTC não activa ou não ligada",
            )

        # ── Verificação de banda ──────────────────────────────────────────────
        allowed_bands: list = getattr(request.app.state, "ptt_allowed_bands", [])
        if allowed_bands:
            try:
                status = await driver.get_status()
                freq = status.frequency_hz
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            if not any(lo <= freq <= hi for lo, hi in allowed_bands):
                raise HTTPException(
                    status_code=403,
                    detail=f"PTT negado: {freq} Hz fora das bandas autorizadas",
                )

        # ── Timer de TX máximo ────────────────────────────────────────────────
        _cancel_tx_timer(request)
        max_secs: int = getattr(request.app.state, "ptt_max_tx_seconds", 180)

        async def _tx_timeout() -> None:
            await asyncio.sleep(max_secs)
            logger.warning("TX: tempo máximo (%ds) excedido — PTT OFF forçado", max_secs)
            try:
                await driver.set_ptt(False)
            except Exception:
                pass
            request.app.state.tx_timer = None

        request.app.state.tx_timer = asyncio.create_task(_tx_timeout())

    else:
        # PTT OFF — cancelar timer sem verificações adicionais
        _cancel_tx_timer(request)

    try:
        await driver.set_ptt(body.enabled)
    except Exception as exc:
        if body.enabled:
            _cancel_tx_timer(request)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"ok": True, "ptt": body.enabled}
