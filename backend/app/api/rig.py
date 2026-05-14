import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..remote.cat_driver import CATDriver, RigStatus
from ..remote.rigctld_manager import RigctldManager, detect_serial_port

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


# ── POST /api/rig/connect ────────────────────────────────────────────────────

@router.post("/connect")
async def connect_rig(request: Request) -> dict:
    """Liga ao rádio: (re)inicia o rigctld se necessário e conecta o CATDriver.

    Pode ser chamado pelo utilizador quando liga o rádio sem reiniciar a aplicação.
    """
    driver = _driver(request)

    # 1. Se não há rigctld_manager ativo, tenta arrancar um
    manager: RigctldManager | None = getattr(request.app.state, "rigctld_manager", None)
    if manager is None or not manager.is_running():
        profile_name = getattr(request.app.state, "rig_profile_name", "ft991a")
        serial_port = getattr(request.app.state, "rig_serial_port", None)
        rigctld_host = getattr(request.app.state, "rigctld_host", "127.0.0.1")
        rigctld_port = getattr(request.app.state, "rigctld_port", 4532)
        hamlib_model = getattr(request.app.state, "rig_profile_hamlib_model", 1035)
        baud = getattr(request.app.state, "rig_profile_baud", 38400)

        # Re-tentar detecção automática da porta série
        if serial_port is None:
            from ..remote.profiles import load_profile
            profile = load_profile(profile_name)
            pattern = getattr(profile, "serial_by_id_pattern", None)
            serial_port = detect_serial_port(
                explicit_port="auto",
                by_id_pattern=pattern,
                radio_name=getattr(profile, "name", profile_name),
            )
            if serial_port:
                request.app.state.rig_serial_port = serial_port

        if serial_port:
            new_manager = RigctldManager(
                serial_port=serial_port,
                hamlib_model=hamlib_model,
                baud=baud,
                listen_host=rigctld_host,
                listen_port=rigctld_port,
            )
            try:
                await new_manager.start()
                request.app.state.rigctld_manager = new_manager
                manager = new_manager
                # aguardar um momento para o rigctld ficar pronto
                await asyncio.sleep(1.5)
            except Exception as exc:
                logger.warning("Não foi possível arrancar rigctld: %s", exc)

    # 2. Conecta o CATDriver (fecha ligações antigas primeiro)
    await driver.close()
    try:
        await driver.connect()
        await driver._connect_poll()
    except OSError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Não foi possível ligar ao rádio: {exc}",
        )

    return {"ok": True, "message": "Ligado ao rádio"}


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
