import json
import logging
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/prefs", tags=["prefs"])
logger = logging.getLogger(__name__)

# Ficheiro de preferências — junto à configuração do servidor
_PREFS_FILE = (
    Path(__file__).resolve().parent.parent.parent.parent / "config" / "user_prefs.json"
)


class AudioPrefs(BaseModel):
    mic_label: str = ""
    output_label: str = ""


def _load() -> dict:
    try:
        return json.loads(_PREFS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(data: dict) -> None:
    _PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PREFS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


@router.get("/audio")
def get_audio_prefs() -> AudioPrefs:
    data = _load()
    return AudioPrefs(
        mic_label=data.get("mic_label", ""),
        output_label=data.get("output_label", ""),
    )


@router.put("/audio")
def put_audio_prefs(prefs: AudioPrefs) -> AudioPrefs:
    data = _load()
    data["mic_label"] = prefs.mic_label
    data["output_label"] = prefs.output_label
    _save(data)
    logger.info("Preferências de áudio guardadas: mic=%r output=%r", prefs.mic_label, prefs.output_label)
    return prefs
