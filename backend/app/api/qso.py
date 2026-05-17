# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

import json
import logging
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/qso", tags=["qso"])
logger = logging.getLogger(__name__)

_QSO_LOG_PATH   = Path("data/qso_log.jsonl")
_QSO_MAX_MEMORY = 100


def _qso_deque(app_state) -> deque:
    if not hasattr(app_state, "qso_log"):
        app_state.qso_log = deque(maxlen=_QSO_MAX_MEMORY)
    return app_state.qso_log


class QSOEntry(BaseModel):
    callsign:  str = Field(..., min_length=1, max_length=32)
    utc:       str = ""
    frequency: str = ""
    mode:      str = ""
    band:      str = ""
    rst_sent:  str = "59"
    rst_rx:    str = "59"
    notes:     str = ""


@router.post("")
async def log_qso(body: QSOEntry, request: Request) -> dict:
    """Guarda um QSO no log em memória e no ficheiro JSONL."""
    from datetime import datetime, timezone
    entry = body.model_dump()
    entry["logged_at"] = datetime.now(timezone.utc).strftime("%H:%MZ")

    q = _qso_deque(request.app.state)
    q.appendleft(entry)

    try:
        _QSO_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _QSO_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        logger.warning("Não foi possível guardar QSO em ficheiro: %s", exc)

    return {"ok": True, "total": len(q)}


@router.get("/recent")
async def get_recent_qsos(request: Request, limit: int = 20) -> list:
    """Retorna os últimos QSOs registados (mais recente primeiro)."""
    q = _qso_deque(request.app.state)
    return list(q)[:min(limit, _QSO_MAX_MEMORY)]
