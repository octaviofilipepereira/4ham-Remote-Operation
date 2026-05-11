import logging
import os
from contextlib import asynccontextmanager

import yaml
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api.rig import router as rig_router
from .api.webrtc import router as webrtc_router
from .core.auth_middleware import BasicAuthMiddleware
from .remote.cat_driver import CATDriver
from .remote.webrtc_peer import WebRTCPeer

logger = logging.getLogger(__name__)

_CONFIG_PATH = os.getenv("REMOTE_CONFIG", "config/remote_config.yaml")


def _load_config() -> dict:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        logger.warning("Ficheiro de config não encontrado (%s) — a usar defaults", _CONFIG_PATH)
        return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = _load_config()

    driver = CATDriver(
        host=os.getenv("RIGCTLD_HOST", cfg.get("rig", {}).get("rigctld", {}).get("host", "localhost")),
        port=int(os.getenv("RIGCTLD_PORT", cfg.get("rig", {}).get("rigctld", {}).get("port", 4532))),
    )
    app.state.cat_driver = driver
    try:
        await driver.connect()
    except OSError:
        logger.warning("rigctld não disponível no arranque — será tentado no primeiro comando")

    audio_cfg = cfg.get("audio", {})
    peer = WebRTCPeer(
        audio_device=os.getenv("AUDIO_DEVICE") or audio_cfg.get("device") or None,
        rx_channel=int(os.getenv("AUDIO_RX_CHANNEL", audio_cfg.get("rx_channel", 0))),
    )
    app.state.webrtc_peer = peer

    yield

    await peer.close()
    await driver.close()


def create_app() -> FastAPI:
    cfg = _load_config()
    users = cfg.get("auth", {}).get("users", [])

    app = FastAPI(
        title="4ham Remote Operation",
        description="Operação remota de estação de rádio amador via browser",
        version="0.1.0",
        lifespan=lifespan,
    )

    if users:
        app.add_middleware(BasicAuthMiddleware, users=users)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # restringir em produção via config
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(rig_router)
    app.include_router(webrtc_router)

    # servir o frontend estático se a pasta existir
    frontend_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "frontend")
    if os.path.isdir(frontend_path):
        app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

    return app


app = create_app()


@app.get("/health")
async def health():
    return {"status": "ok"}
