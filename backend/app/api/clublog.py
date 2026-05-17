# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/clublog", tags=["clublog"])
logger = logging.getLogger(__name__)

_CLUBLOG_UPLOAD_URL = "https://clublog.org/upload_adif.php"
_QSO_LOG_PATH = Path("data/qso_log.jsonl")


class ClublogUploadBody(BaseModel):
    email:    str = Field(..., min_length=1, max_length=256)
    api_key:  str = Field(..., min_length=1, max_length=64)
    callsign: str = Field(..., min_length=1, max_length=32)
    adif:     str = Field(..., min_length=1)


@router.post("/upload")
async def upload_to_clublog(body: ClublogUploadBody) -> dict:
    """Proxy de upload ADIF para o Clublog."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                _CLUBLOG_UPLOAD_URL,
                data={
                    "email":    body.email,
                    "api":      body.api_key,
                    "callsign": body.callsign,
                    "adif":     body.adif,
                },
            )
    except httpx.RequestError as exc:
        logger.warning("Erro ao contactar Clublog: %s", exc)
        raise HTTPException(status_code=502, detail="Não foi possível contactar o Clublog") from exc

    text = resp.text.strip()
    ok = resp.status_code == 200 and "error" not in text.lower()
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Clublog devolveu HTTP {resp.status_code}: {text[:200]}")

    return {"ok": ok, "message": text}
