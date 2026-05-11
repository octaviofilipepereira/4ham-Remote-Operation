import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.rig import router as rig_router
from .remote.cat_driver import CATDriver

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    driver = CATDriver(
        host=os.getenv("RIGCTLD_HOST", "localhost"),
        port=int(os.getenv("RIGCTLD_PORT", "4532")),
    )
    app.state.cat_driver = driver
    try:
        await driver.connect()
    except OSError:
        logger.warning("rigctld não disponível no arranque — será tentado no primeiro comando")
    yield
    await driver.close()


app = FastAPI(
    title="4ham Remote Operation",
    description="Operação remota de estação de rádio amador via browser",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restringir em produção via config
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rig_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
