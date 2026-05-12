import asyncio
import base64
import binascii
import logging
from typing import Callable

import bcrypt
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# Rotas que não precisam de autenticação
_PUBLIC_PATHS = {"/health"}


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Middleware de autenticação HTTP Basic com passwords bcrypt.

    Os utilizadores são passados como lista de dicts com 'username',
    'password_hash' e 'role'. Exemplo:

        users = [
            {"username": "ct7bfv", "password_hash": "$2b$12$...", "role": "operator"},
        ]
    """

    def __init__(self, app, users: list[dict]) -> None:
        super().__init__(app)
        # índice username → hash + role
        self._users: dict[str, dict] = {
            u["username"]: u for u in users if "username" in u and "password_hash" in u
        }

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Basic "):
            return self._challenge()

        try:
            decoded = base64.b64decode(auth[6:]).decode("utf-8")
            username, _, password = decoded.partition(":")
        except (binascii.Error, UnicodeDecodeError):
            return self._challenge()

        user = self._users.get(username)
        if user is None:
            return self._challenge()

        # bcrypt.checkpw é síncrono e bloqueante — correr em thread pool
        # para não bloquear o event loop do asyncio (crítico em ARM/Pi)
        loop = asyncio.get_running_loop()
        ok = await loop.run_in_executor(
            None,
            bcrypt.checkpw,
            password.encode(),
            user["password_hash"].encode(),
        )
        if not ok:
            logger.warning("Autenticação falhada para utilizador '%s' em %s", username, request.url.path)
            return self._challenge()

        request.state.user = username
        request.state.role = user.get("role", "rx_only")
        return await call_next(request)

    @staticmethod
    def _challenge() -> Response:
        return JSONResponse(
            status_code=401,
            content={"detail": "Autenticação necessária"},
            headers={"WWW-Authenticate": 'Basic realm="4ham Remote"'},
        )
