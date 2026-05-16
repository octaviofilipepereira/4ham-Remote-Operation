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


_STATUS_TIMEOUT = 4.0  # segundos — timeout total para get_status()

@router.get("/status", response_model=RigStatusResponse)
async def get_status(request: Request) -> RigStatusResponse:
    """Retorna frequência, modo, S-meter e estado PTT do rádio."""
    driver = _driver(request)
    try:
        status: RigStatus = await asyncio.wait_for(
            driver.get_status(), timeout=_STATUS_TIMEOUT
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=502, detail="Timeout ao obter estado do rádio")
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


# ── Helpers: mapeamento AGC ─────────────────────────────────────────────────
#
# RIG_LEVEL_AGC usa inteiros enum (hamlib.h), NÃO escala 0.0-1.0:
#   RIG_AGC_OFF=0  RIG_AGC_SUPERFAST=1  RIG_AGC_FAST=2
#   RIG_AGC_SLOW=3  RIG_AGC_USER=4  RIG_AGC_MEDIUM=5  RIG_AGC_AUTO=6

_AGC_TO_INT: dict[str, int] = {"FAST": 2, "MID": 5, "SLOW": 3, "AUTO": 6}
_INT_TO_AGC: dict[int, str] = {2: "FAST", 5: "MID", 3: "SLOW", 6: "AUTO"}


def _agc_from_int(val: float) -> str:
    return _INT_TO_AGC.get(int(round(val)), "MID")


# ── GET /api/rig/caps ────────────────────────────────────────────────────────

@router.get("/caps")
async def get_rig_caps(request: Request) -> dict:
    """Retorna as capacidades RF do rádio activo (passos ATT/PREAMP, modos AGC).

    Usado pelo frontend para construir dinamicamente os selects de ATT e PREAMP.
    """
    profile = getattr(request.app.state, "rig_profile", None)
    if profile is None:
        # Valores de retorno seguros se o perfil não estiver disponível
        return {
            "att_steps":     [0],
            "preamp_steps":  [0],
            "preamp_labels": {"0": "OFF"},
            "agc_modes":     ["FAST", "MID", "SLOW", "AUTO"],
        }
    return {
        "att_steps":     getattr(profile, "att_steps",     [0]),
        "preamp_steps":  getattr(profile, "preamp_steps",  [0]),
        "preamp_labels": getattr(profile, "preamp_labels", {"0": "OFF"}),
        "agc_modes":     getattr(profile, "agc_modes",     ["FAST", "MID", "SLOW", "AUTO"]),
    }


# ── GET /api/rig/rf ──────────────────────────────────────────────────────────

@router.get("/rf")
async def get_rf(request: Request) -> dict:
    """Retorna estado dos controlos RF: IPO/AMP, ATT, AGC e potência TX."""
    driver = _driver(request)

    async def _safe_level(name: str, default: float) -> float:
        try:
            return await driver.get_level(name)
        except Exception:
            return default

    preamp_raw = await _safe_level("PREAMP", 0.0)
    att_raw    = await _safe_level("ATT",    0.0)
    agc_raw    = await _safe_level("AGC",    5.0)   # default: MID (enum 5)
    rfpower_raw = await _safe_level("RFPOWER", 1.0)

    rfpower_w = max(5, min(100, round(rfpower_raw * 100)))

    return {
        "preamp":  int(round(preamp_raw)),
        "att":     int(round(att_raw)),
        "agc":     _agc_from_int(agc_raw),
        "rfpower": rfpower_w,
    }


# ── POST /api/rig/rf ─────────────────────────────────────────────────────────

class SetRFRequest(BaseModel):
    preamp:  int | None = Field(None, ge=0, description="Nível de pré-amplificador em dB (0=OFF/IPO)")
    att:     int | None = Field(None, ge=0, le=60, description="Atenuação em dB (0=OFF)")
    agc:     str | None = Field(None, description="FAST / MID / SLOW / AUTO")
    rfpower: int | None = Field(None, ge=5, le=100, description="Potência TX em Watts")


@router.post("/rf")
async def set_rf(body: SetRFRequest, request: Request) -> dict:
    """Define controlos RF do rádio."""
    driver = _driver(request)
    errors: list[str] = []

    if body.preamp is not None:
        try:
            await driver.set_level("PREAMP", float(body.preamp))
        except Exception as exc:
            errors.append(f"PREAMP: {exc}")

    if body.att is not None:
        try:
            await driver.set_level("ATT", float(body.att))
        except Exception as exc:
            errors.append(f"ATT: {exc}")

    if body.agc is not None:
        try:
            await driver.set_level("AGC", float(_AGC_TO_INT.get(body.agc.upper(), 5)))
        except Exception as exc:
            errors.append(f"AGC: {exc}")

    if body.rfpower is not None:
        try:
            await driver.set_level("RFPOWER", body.rfpower / 100.0)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"RFPOWER: {exc}") from exc

    if errors:
        logger.warning("set_rf: comandos parcialmente ignorados — %s", "; ".join(errors))

    return {"ok": True}


# ── GET /api/rig/settings ────────────────────────────────────────────────────

@router.get("/settings")
async def get_rig_settings(request: Request) -> dict:
    """Retorna estado de NB, PROC (COMP), MIC Gain."""
    driver = _driver(request)

    async def _safe_level(name: str, default: float) -> float:
        try:
            return await driver.get_level(name)
        except Exception:
            return default

    async def _safe_func(name: str) -> bool:
        try:
            return await driver.get_func(name)
        except Exception:
            return False

    nb       = await _safe_func("NB")
    nb_level = await _safe_level("NB", 0.5)
    comp     = await _safe_func("COMP")
    comp_level = await _safe_level("COMP", 0.5)
    mic      = await _safe_level("MICGAIN", 0.5)
    moni     = await _safe_level("MONITOR_GAIN", 0.0)

    return {
        "nb":         nb,
        "nb_level":   nb_level,
        "comp":       comp,
        "comp_level": comp_level,
        "mic":        mic,
        "moni":       moni,
    }


# ── POST /api/rig/settings ───────────────────────────────────────────────────

class SetRigSettingsRequest(BaseModel):
    nb:         bool  | None = None
    nb_level:   float | None = Field(None, ge=0.0, le=1.0)
    comp:       bool  | None = None
    comp_level: float | None = Field(None, ge=0.0, le=1.0)
    mic:        float | None = Field(None, ge=0.0, le=1.0)
    moni:       float | None = Field(None, ge=0.0, le=1.0)
    width:   str | None = None


@router.post("/settings")
async def set_rig_settings(body: SetRigSettingsRequest, request: Request) -> dict:
    """Define configurações de rádio: NB, PROC/COMP, MIC Gain."""
    driver = _driver(request)
    errors: list[str] = []

    if body.nb is not None:
        try:
            await driver.set_func("NB", body.nb)
        except Exception as exc:
            errors.append(f"NB func: {exc}")
    if body.nb_level is not None:
        try:
            await driver.set_level("NB", body.nb_level)
        except Exception as exc:
            errors.append(f"NB level: {exc}")
    if body.comp is not None:
        try:
            await driver.set_func("COMP", body.comp)
        except Exception as exc:
            errors.append(f"COMP func: {exc}")
    if body.comp_level is not None:
        try:
            await driver.set_level("COMP", body.comp_level)
        except Exception as exc:
            errors.append(f"COMP level: {exc}")
    if body.mic is not None:
        try:
            await driver.set_level("MICGAIN", body.mic)
        except Exception as exc:
            errors.append(f"MICGAIN: {exc}")
    if body.moni is not None:
        try:
            await driver.set_func("MON", body.moni > 0)
        except Exception as exc:
            errors.append(f"MON: {exc}")

    if errors:
        logger.warning("set_rig_settings: comandos parcialmente ignorados — %s", "; ".join(errors))

    # WIDTH: aplicar via set_mode com a passband adequada
    if body.width is not None:
        _WIDTH_PASSBAND: dict[str, int] = {
            "NARROW": 1800, "MID": 2400, "WIDE": 3000, "AUTO": 0,
        }
        pb_hz = _WIDTH_PASSBAND.get(body.width.upper(), 0)
        try:
            status = await driver.get_status()
            await driver.set_mode(status.mode, pb_hz)
        except Exception:
            pass  # não interromper por erro de width

    # Guardar width em app.state
    if body.width is not None:
        request.app.state.rig_width = body.width

    return {"ok": True}
