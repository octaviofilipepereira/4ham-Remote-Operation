# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/clublog", tags=["clublog"])
logger = logging.getLogger(__name__)

_CLUBLOG_UPLOAD_URL = "https://clublog.org/putlogs.php"
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
