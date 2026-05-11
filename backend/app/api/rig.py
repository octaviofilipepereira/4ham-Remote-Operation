from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..remote.cat_driver import CATDriver, RigStatus

router = APIRouter(prefix="/api/rig", tags=["rig"])


def _driver(request: Request) -> CATDriver:
    driver: CATDriver | None = getattr(request.app.state, "cat_driver", None)
    if driver is None:
        raise HTTPException(status_code=503, detail="CAT driver não inicializado")
    return driver


# ── GET /api/rig/status ──────────────────────────────────────────────────────

class RigStatusResponse(BaseModel):
    frequency_hz: int
    mode: str
    passband_hz: int
    strength_db: float
    ptt: bool


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
