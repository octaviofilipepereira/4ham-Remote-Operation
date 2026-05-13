"""Gestão do processo rigctld e detecção automática da porta série.

Fluxo de arranque
-----------------
1. Ler ``serial_port`` do config (pode ser um path explícito ou ``"auto"``).
2. Detectar a porta via ``/dev/serial/by-id/`` se necessário.
3. Verificar se o rigctld já está a escutar na porta configurada.
4. Se não estiver, arrancar o rigctld como subprocess gerido pelo backend.
5. Monitorizar o processo e registar se terminar inesperadamente.
"""

import asyncio
import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Padrão glob para identificar a porta CAT do FT-991A (CP2105, interface 0)
# O CP2105 cria dois symlinks: ...-if00-port0 (CAT) e ...-if01-port0 (2.ª UART).
_BY_ID_PATTERN_CAT = "*CP2105*if00*"


def detect_serial_port(explicit_port: str | None = None) -> str | None:
    """Devolve o path da porta série do FT-991A.

    Se *explicit_port* for fornecido e não for ``"auto"``, usa-o directamente
    (desde que o path exista no sistema de ficheiros).  Caso contrário,
    procura em ``/dev/serial/by-id/`` pelos symlinks do CP2105 interface 0.

    Devolve ``None`` se a porta não for encontrada.
    """
    if explicit_port and explicit_port not in ("auto", ""):
        p = Path(explicit_port)
        if p.exists():
            logger.info("Porta série configurada explicitamente: %s", explicit_port)
            return explicit_port
        logger.warning(
            "Porta série configurada '%s' não existe — a tentar auto-detecção",
            explicit_port,
        )

    # Auto-detecção via /dev/serial/by-id/
    by_id = Path("/dev/serial/by-id")
    if by_id.is_dir():
        matches = sorted(by_id.glob(_BY_ID_PATTERN_CAT))
        if matches:
            port = str(matches[0])
            logger.info("FT-991A detectado automaticamente: %s", port)
            return port
        logger.warning(
            "Nenhum CP2105 (if00) encontrado em /dev/serial/by-id/ "
            "(padrão: %s). Verifique a ligação USB do FT-991A.",
            _BY_ID_PATTERN_CAT,
        )
    else:
        logger.warning("/dev/serial/by-id/ não existe — auto-detecção indisponível")

    return None


async def _is_port_listening(host: str, port: int) -> bool:
    """Verifica se já existe algo a escutar num dado TCP host:port."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=1.0
        )
        writer.close()
        await writer.wait_closed()
        return True
    except (OSError, asyncio.TimeoutError):
        return False


class RigctldManager:
    """Inicia e monitoriza o processo ``rigctld``.

    Se o rigctld já estiver a escutar na porta configurada (e.g. arrancado
    manualmente), não arranca um novo processo — funciona em modo passivo.

    Parameters
    ----------
    serial_port:
        Path da porta série (e.g. ``/dev/serial/by-id/…``).
    hamlib_model:
        Número de modelo Hamlib (1035 para FT-991A).
    baud:
        Velocidade da porta série em baud.
    listen_host:
        Endereço TCP onde o rigctld deve escutar.
    listen_port:
        Porto TCP do rigctld.
    """

    def __init__(
        self,
        serial_port: str,
        hamlib_model: int = 1035,
        baud: int = 38400,
        listen_host: str = "127.0.0.1",
        listen_port: int = 4532,
    ) -> None:
        self._serial_port = serial_port
        self._model = hamlib_model
        self._baud = baud
        self._host = listen_host
        self._port = listen_port
        self._process: asyncio.subprocess.Process | None = None
        self._monitor_task: asyncio.Task | None = None
        self._managed = False  # True apenas se este manager arrancou o processo

    async def start(self) -> bool:
        """Arranca o rigctld, se necessário.

        Devolve ``True`` se o rigctld está disponível (já estava a correr
        ou foi arrancado com sucesso), ``False`` caso contrário.
        """
        # 1. Verificar se já está a escutar — não arrancar duplicados
        if await _is_port_listening(self._host, self._port):
            logger.info(
                "rigctld já escuta em %s:%d — modo passivo (não arranco outro processo)",
                self._host,
                self._port,
            )
            return True

        # 2. Verificar se o binário existe
        rigctld_bin = shutil.which("rigctld")
        if not rigctld_bin:
            logger.error(
                "rigctld não encontrado no PATH — instale o Hamlib "
                "(apt install hamlib / dnf install hamlib)"
            )
            return False

        # 3. Verificar se a porta série existe
        if not Path(self._serial_port).exists():
            logger.error(
                "Porta série '%s' não existe — FT-991A ligado? rigctld não arranca.",
                self._serial_port,
            )
            return False

        cmd = [
            rigctld_bin,
            "-m", str(self._model),
            "-r", self._serial_port,
            "-s", str(self._baud),
            "-T", self._host,
            "-t", str(self._port),
        ]
        logger.info("A arrancar rigctld: %s", " ".join(cmd))

        try:
            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            logger.error("Erro ao arrancar rigctld: %s", exc)
            return False

        self._managed = True

        # Aguardar brevemente para o rigctld inicializar
        await asyncio.sleep(0.8)

        if self._process.returncode is not None:
            raw = await self._process.stderr.read()
            logger.error(
                "rigctld terminou imediatamente (code=%d): %s",
                self._process.returncode,
                raw.decode(errors="replace").strip(),
            )
            self._managed = False
            return False

        logger.info("rigctld iniciado com sucesso (pid=%d)", self._process.pid)
        self._monitor_task = asyncio.create_task(
            self._monitor(), name="rigctld-monitor"
        )
        return True

    async def _monitor(self) -> None:
        """Aguarda o fim do processo e regista eventuais erros."""
        assert self._process is not None
        returncode = await self._process.wait()
        raw = b""
        if self._process.stderr:
            raw = await self._process.stderr.read()
        msg = raw.decode(errors="replace").strip()
        if returncode == 0:
            logger.info("rigctld terminou normalmente")
        else:
            logger.error(
                "rigctld terminou inesperadamente (code=%d)%s",
                returncode,
                f": {msg}" if msg else "",
            )

    async def stop(self) -> None:
        """Para o rigctld gerido por este manager."""
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass

        if self._managed and self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()
            logger.info("rigctld parado pelo manager")
