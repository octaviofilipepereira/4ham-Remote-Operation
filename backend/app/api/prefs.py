import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["prefs"])
logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# Ficheiro de preferências — junto à configuração do servidor
_PREFS_FILE = _ROOT / "config" / "user_prefs.json"


class AudioPrefs(BaseModel):
    mic_label: str = ""
    mic_device_id: str = ""
    output_label: str = ""
    output_device_id: str = ""


def _load() -> dict:
    try:
        return json.loads(_PREFS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(data: dict) -> None:
    _PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PREFS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


@router.get("/prefs/audio")
def get_audio_prefs() -> AudioPrefs:
    data = _load()
    return AudioPrefs(
        mic_label=data.get("mic_label", ""),
        mic_device_id=data.get("mic_device_id", ""),
        output_label=data.get("output_label", ""),
        output_device_id=data.get("output_device_id", ""),
    )


@router.put("/prefs/audio")
def put_audio_prefs(prefs: AudioPrefs) -> AudioPrefs:
    data = _load()
    data["mic_label"]       = prefs.mic_label
    data["mic_device_id"]   = prefs.mic_device_id
    data["output_label"]    = prefs.output_label
    data["output_device_id"] = prefs.output_device_id
    _save(data)
    logger.info(
        "Preferências de áudio guardadas: mic=%r (%s) output=%r (%s)",
        prefs.mic_label, prefs.mic_device_id[:8] if prefs.mic_device_id else "-",
        prefs.output_label, prefs.output_device_id[:8] if prefs.output_device_id else "-",
    )
    return prefs


@router.get("/prefs/band-memory")
def get_band_memory() -> dict:
    """Devolver memória de frequência/modo por banda."""
    data = _load()
    return data.get("band_memory", {})


@router.put("/prefs/band-memory")
def put_band_memory(body: dict) -> dict:
    """Guardar memória de frequência/modo por banda."""
    data = _load()
    data["band_memory"] = body
    _save(data)
    return body


@router.get("/setup/ca-cert")
def download_ca_cert():
    """Descarregar o certificado da CA local para instalar no browser/sistema.
    Este endpoint não requer autenticação — é necessário para bootstrapping.
    """
    ca_path = _ROOT / "certs" / "ca.pem"
    if not ca_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Certificado CA não encontrado. Execute scripts/gen-certs.sh primeiro.",
        )
    return FileResponse(
        path=str(ca_path),
        media_type="application/x-pem-file",
        filename="4ham-local-ca.pem",
        headers={"Content-Disposition": "attachment; filename=4ham-local-ca.pem"},
    )
