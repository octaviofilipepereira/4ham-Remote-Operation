# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
#
# Gestão de segredos da aplicação via SQLite + Fernet.
#
# A Fernet key está embutida no código-fonte (inútil sem os valores encriptados).
# Os valores encriptados estão na base de dados (data/secrets.db, gitignored).
# Nem um nem o outro sozinho revela os segredos.

import logging
import sqlite3
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# Gerada uma única vez; NÃO alterar depois de existirem segredos na base de dados.
_FERNET_KEY = b"i7EKcv9znNH2OUDXyiYWVPZgTTN00JxK4yOhQ7y5aEo="

_DB_PATH = Path("data/secrets.db")


def _fernet() -> Fernet:
    return Fernet(_FERNET_KEY)


def _get_conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS secrets (
            name  TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def get_secret(name: str) -> str | None:
    """Lê e desencripta um segredo da base de dados. Devolve None se não existir."""
    try:
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT value FROM secrets WHERE name = ?", (name,)
            ).fetchone()
        if row is None:
            return None
        return _fernet().decrypt(row[0].encode()).decode()
    except InvalidToken:
        logger.error("Falha ao desencriptar segredo '%s' — Fernet key incorrecta?", name)
        return None
    except Exception as exc:
        logger.warning("Erro ao ler segredo '%s': %s", name, exc)
        return None


def set_secret(name: str, value: str) -> None:
    """Encripta e guarda um segredo na base de dados."""
    encrypted = _fernet().encrypt(value.encode()).decode()
    with _get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO secrets (name, value) VALUES (?, ?)",
            (name, encrypted),
        )
        conn.commit()


def has_secret(name: str) -> bool:
    """Verifica se um segredo existe na base de dados (sem o desencriptar)."""
    try:
        with _get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM secrets WHERE name = ?", (name,)
            ).fetchone()
        return row is not None
    except Exception:
        return False
