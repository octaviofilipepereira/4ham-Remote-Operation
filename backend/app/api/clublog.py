# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/clublog", tags=["clublog"])
logger = logging.getLogger(__name__)

_CLUBLOG_UPLOAD_URL   = "https://clublog.org/putlogs.php"
_CLUBLOG_REALTIME_URL = "https://clublog.org/realtime.php"
_QSO_LOG_PATH = Path("data/qso_log.jsonl")


class ClublogUploadBody(BaseModel):
    email:    str = Field(..., min_length=1, max_length=256)
    password: str = Field(..., min_length=1, max_length=256)
    api_key:  str = Field(..., min_length=1, max_length=64)
    callsign: str = Field(..., min_length=1, max_length=32)
    adif:     str = Field(..., min_length=1)


@router.post("/upload")
async def upload_to_clublog(body: ClublogUploadBody) -> dict:
    """Proxy de upload ADIF (batch) para o Clublog via putlogs.php."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                _CLUBLOG_UPLOAD_URL,
                files={"file": ("qsos.adi", body.adif.encode(), "text/plain")},
                data={
                    "email":    body.email,
                    "password": body.password,
                    "callsign": body.callsign,
                    "api":      body.api_key,
                },
            )
    except httpx.RequestError as exc:
        logger.warning("Erro ao contactar Clublog: %s", exc)
        raise HTTPException(status_code=502, detail="Não foi possível contactar o Clublog") from exc

    text = resp.text.strip()
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Clublog: {text[:300]}")

    return {"ok": True, "message": text or "Upload enviado para a fila do Clublog."}


class ClublogRealtimeBody(BaseModel):
    email:    str = Field(..., min_length=1, max_length=256)
    password: str = Field(..., min_length=1, max_length=256)
    api_key:  str = Field(..., min_length=1, max_length=64)
    callsign: str = Field(..., min_length=1, max_length=32)
    adif:     str = Field(..., min_length=1)


@router.post("/realtime")
async def realtime_qso(body: ClublogRealtimeBody) -> dict:
    """Envia um QSO individual para o Clublog em tempo-real via realtime.php."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                _CLUBLOG_REALTIME_URL,
                data={
                    "email":    body.email,
                    "password": body.password,
                    "callsign": body.callsign,
                    "api":      body.api_key,
                    "adif":     body.adif,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except httpx.RequestError as exc:
        logger.warning("Erro ao contactar Clublog realtime: %s", exc)
        raise HTTPException(status_code=502, detail="Não foi possível contactar o Clublog") from exc

    text = resp.text.strip()
    if resp.status_code == 403:
        # Credenciais inválidas — o cliente DEVE parar de enviar para não bloquear o IP
        raise HTTPException(status_code=403, detail=text or "Credenciais inválidas")
    if resp.status_code == 400:
        raise HTTPException(status_code=400, detail=text or "QSO rejeitado pelo Clublog")
    if resp.status_code == 500:
        raise HTTPException(status_code=500, detail=text or "Erro interno do Clublog")
    # 200 = sucesso (OK, Duplicate, Modified — todos são aceitáveis)
    return {"ok": True, "message": text}


@router.post("/cty-refresh")async def refresh_cty(api_key: str = Body(..., embed=True)) -> dict:
    """Descarrega/actualiza o ficheiro cty.xml do Clublog para lookup local de DXCC."""
    from ..core.dxcc import get_dxcc_lookup
    lookup = get_dxcc_lookup()
    try:
        await lookup.download(api_key)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        logger.warning("Erro ao descarregar cty.xml: %s", exc)
        raise HTTPException(status_code=502, detail="Falha ao contactar Clublog") from exc
    return {"ok": True}
