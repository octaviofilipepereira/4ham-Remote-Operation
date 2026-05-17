"""
API de DX Cluster — endpoints FastAPI.

Endpoints:
  GET  /api/dx/clusters?q=&country=  — pesquisar lista de clusters conhecidos
  GET  /api/dx/countries             — países distintos na lista
  GET  /api/dx/cluster               — configuração/estado do cluster activo
  PUT  /api/dx/cluster               — configurar e ligar a um cluster
  DELETE /api/dx/cluster             — desligar
  GET  /api/dx/spots?band=&limit=    — spots recentes (filtro por banda)
  GET  /api/dx/status                — estado da ligação
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/dx", tags=["dx"])
logger = logging.getLogger(__name__)

_ROOT          = Path(__file__).resolve().parent.parent.parent.parent
_CLUSTERS_FILE = _ROOT / "data" / "dx_clusters.json"
_PREFS_FILE    = _ROOT / "config" / "user_prefs.json"


# ── Helpers de persistência ────────────────────────────────────────────────

def _load_prefs() -> dict:
    try:
        return json.loads(_PREFS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_prefs(data: dict) -> None:
    _PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PREFS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _load_clusters() -> list[dict]:
    try:
        return json.loads(_CLUSTERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Não foi possível carregar %s", _CLUSTERS_FILE)
        return []


# ── Modelos ────────────────────────────────────────────────────────────────

class ClusterSetRequest(BaseModel):
    host:             str
    port:             int  = 7300
    callsign:         str  = "CT7BFV"
    node_call:        str  = ""       # indicativo do nó cluster (ex: CS1SEL)
    max_spot_age_min: int  = 60


# ── Endpoints — lista de clusters ─────────────────────────────────────────

@router.get("/clusters")
def get_clusters(
    q:       Optional[str] = Query(None, description="Texto livre (call/host/location)"),
    country: Optional[str] = Query(None, description="Filtro por país"),
    rbn:     Optional[bool] = Query(None, description="Filtrar por RBN (true/false)"),
) -> list[dict]:
    clusters = _load_clusters()
    if q:
        q_lower = q.lower()
        clusters = [
            c for c in clusters
            if q_lower in c.get("call", "").lower()
            or q_lower in c.get("host", "").lower()
            or q_lower in c.get("location", "").lower()
        ]
    if country:
        clusters = [c for c in clusters if c.get("country", "").lower() == country.lower()]
    if rbn is not None:
        clusters = [c for c in clusters if c.get("rbn", False) == rbn]
    return clusters


@router.get("/countries")
def get_countries() -> list[str]:
    clusters = _load_clusters()
    seen: set[str] = set()
    result: list[str] = []
    for c in clusters:
        country = c.get("country", "")
        if country and country not in seen:
            seen.add(country)
            result.append(country)
    return sorted(result)


# ── Endpoints — cluster activo ─────────────────────────────────────────────

@router.get("/cluster")
def get_active_cluster(request: Request) -> dict:
    client = getattr(request.app.state, "dx_cluster_client", None)
    if client is None:
        return {"configured": False}
    return {"configured": True, **client.status()}


@router.put("/cluster")
async def put_active_cluster(body: ClusterSetRequest, request: Request) -> dict:
    # Persistir em user_prefs.json
    prefs = _load_prefs()
    prefs["dx_cluster"] = {
        "host":             body.host,
        "port":             body.port,
        "callsign":         body.callsign,
        "node_call":        body.node_call,
        "max_spot_age_min": body.max_spot_age_min,
    }
    _save_prefs(prefs)

    client = getattr(request.app.state, "dx_cluster_client", None)
    if client is not None:
        await client.reconfigure(
            host=body.host,
            port=body.port,
            callsign=body.callsign,
            node_call=body.node_call,
            max_spot_age_min=body.max_spot_age_min,
        )
    else:
        # Criar cliente em runtime (pode acontecer se o arranque não tinha config)
        from ..remote.dx_cluster import DXClusterClient
        client = DXClusterClient(
            host=body.host,
            port=body.port,
            callsign=body.callsign,
            node_call=body.node_call,
            max_spot_age_min=body.max_spot_age_min,
        )
        await client.start()
        request.app.state.dx_cluster_client = client

    logger.info("DX Cluster configurado: %s:%d (callsign=%s)", body.host, body.port, body.callsign)
    return client.status()


@router.delete("/cluster")
async def delete_active_cluster(request: Request) -> dict:
    client = getattr(request.app.state, "dx_cluster_client", None)
    if client is None:
        raise HTTPException(status_code=404, detail="Nenhum cluster activo")
    await client.stop()
    request.app.state.dx_cluster_client = None

    # Remover da persistência
    prefs = _load_prefs()
    prefs.pop("dx_cluster", None)
    _save_prefs(prefs)

    return {"configured": False}


# ── Endpoints — spots e estado ─────────────────────────────────────────────

@router.get("/spots")
def get_spots(
    request: Request,
    band:  Optional[str] = Query(None, description="Banda (ex: 20m, 40m)"),
    limit: int           = Query(50,   ge=1, le=500, description="Máximo de spots"),
) -> list[dict]:
    client = getattr(request.app.state, "dx_cluster_client", None)
    if client is None:
        return []
    return client.spots(band=band, limit=limit)


@router.get("/status")
def get_status(request: Request) -> dict:
    client = getattr(request.app.state, "dx_cluster_client", None)
    if client is None:
        return {"state": "disconnected", "configured": False}
    return {"configured": True, **client.status()}
