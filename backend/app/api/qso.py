# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)

import json
import logging
from collections import deque
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import Response
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


@router.get("/export/adif")
async def export_adif() -> Response:
    """Exporta todos os QSOs do ficheiro JSONL em formato ADIF (.adi)."""
    today = date.today().strftime("%Y%m%d")

    def _f(name: str, value: str) -> str:
        return f"<{name}:{len(value)}>{value}"

    entries: list[dict] = []
    if _QSO_LOG_PATH.exists():
        try:
            for raw in _QSO_LOG_PATH.read_text(encoding="utf-8").strip().splitlines():
                if raw.strip():
                    entries.append(json.loads(raw))
        except Exception as exc:
            logger.warning("Erro ao ler JSONL para ADIF: %s", exc)

    lines = [f"{_f('ADIF_VER', '3.1.4')} {_f('PROGRAMID', '4ham')} <EOH>"]
    for e in entries:
        fs = []
        if e.get("callsign"):
            fs.append(_f("CALL", e["callsign"].upper()))
        if e.get("frequency"):
            fs.append(_f("FREQ", str(e["frequency"])))
        if e.get("band"):
            fs.append(_f("BAND", e["band"].upper()))
        if e.get("mode"):
            fs.append(_f("MODE", e["mode"].upper()))
        fs.append(_f("QSO_DATE", today))
        raw_t = str(e.get("utc") or e.get("logged_at") or "")
        t_on = "".join(c for c in raw_t if c.isdigit())[:4]
        if t_on:
            fs.append(_f("TIME_ON", t_on))
        if e.get("rst_sent"):
            fs.append(_f("RST_SENT", str(e["rst_sent"])))
        if e.get("rst_rx"):
            fs.append(_f("RST_RCVD", str(e["rst_rx"])))
        if e.get("notes"):
            fs.append(_f("NOTES", str(e["notes"])))
        lines.append(" ".join(fs) + " <EOR>")

    content = "\n".join(lines) + "\n"
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=qsos_{today}.adi"},
    )
