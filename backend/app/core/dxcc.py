# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
"""DXCC prefix lookup a partir do cty.xml do Clublog.

O ficheiro é descarregado de https://cdn.clublog.org/cty.php?api=APIKEY
e guardado em prefixes/cty.xml.  O lookup é feito localmente em memória,
sem chamadas em tempo-real ao Clublog — conforme recomendação oficial:
  https://clublog.freshdesk.com/support/solutions/articles/54902
"""
from __future__ import annotations

import gzip
import logging
import re
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx

logger = logging.getLogger(__name__)

_CTY_URL  = "https://cdn.clublog.org/cty.php"
_CTY_PATH = Path(__file__).resolve().parents[3] / "prefixes" / "cty.xml"

# Sufixos a ignorar antes do lookup: /P /M /MM /AM /QRP /<dígitos>
_SUFFIX_RE = re.compile(r"/(?:P|M{1,2}|AM|QRP|\d+)$", re.IGNORECASE)


def _text(node: ET.Element, tag: str) -> str | None:
    child = node.find(tag)
    return child.text if child is not None else None


def _int_text(node: ET.Element, tag: str) -> int | None:
    val = _text(node, tag)
    try:
        return int(val)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


class DXCCLookup:
    """Carrega cty.xml e faz lookup callsign → entidade DXCC."""

    def __init__(self) -> None:
        self._exceptions: dict[str, dict] = {}          # indicativo exacto → info
        self._prefixes:   list[tuple[str, dict]] = []   # (prefixo, info) desc por comprimento
        self._loaded = False

    def is_loaded(self) -> bool:
        return self._loaded

    async def download(self, api_key: str) -> None:
        """Descarrega cty.xml do Clublog e guarda em prefixes/cty.xml."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(_CTY_URL, params={"api": api_key})
            if r.status_code == 403:
                raise ValueError("API Key inválida para o Clublog (403)")
            r.raise_for_status()

        _CTY_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = gzip.decompress(r.content)
        except Exception:
            data = r.content  # já descomprimido ou formato diferente

        _CTY_PATH.write_bytes(data)
        logger.info("cty.xml guardado: %s (%d bytes)", _CTY_PATH, len(data))
        self._parse(data)

    def load_if_available(self) -> None:
        """Carrega cty.xml do disco se existir (chamado no arranque)."""
        if _CTY_PATH.exists():
            try:
                self._parse(_CTY_PATH.read_bytes())
            except Exception as exc:
                logger.error("Falha ao carregar cty.xml: %s", exc)

    def _parse(self, data: bytes) -> None:
        root = ET.fromstring(data)

        # Mapa adif → info base da entidade
        entities: dict[int, dict] = {}
        for ent in root.findall("entities/entity"):
            adif = _int_text(ent, "adif")
            if adif is None:
                continue
            entities[adif] = {
                "name": _text(ent, "name") or "",
                "cqz":  _int_text(ent, "cqz"),
                "cont": _text(ent, "cont") or "",
            }

        # Excepções: indicativo exacto → info (sem filtro de datas — usamos sempre o mais recente)
        exc: dict[str, dict] = {}
        for node in root.findall("exceptions/exception"):
            call = (_text(node, "call") or "").upper()
            adif = _int_text(node, "adif")
            if not call or adif is None:
                continue
            base = entities.get(adif, {})
            exc[call] = {
                "name": _text(node, "entity") or base.get("name", ""),
                "adif": adif,
                "cqz":  _int_text(node, "cqz") or base.get("cqz"),
                "cont": _text(node, "cont")    or base.get("cont", ""),
            }

        # Prefixos: longest-match
        pfx: list[tuple[str, dict]] = []
        for node in root.findall("prefixes/prefix"):
            call = (_text(node, "call") or "").upper()
            adif = _int_text(node, "adif")
            if not call or adif is None:
                continue
            base = entities.get(adif, {})
            pfx.append((call, {
                "name": _text(node, "entity") or base.get("name", ""),
                "adif": adif,
                "cqz":  _int_text(node, "cqz") or base.get("cqz"),
                "cont": _text(node, "cont")    or base.get("cont", ""),
            }))

        pfx.sort(key=lambda t: len(t[0]), reverse=True)

        self._exceptions = exc
        self._prefixes   = pfx
        self._loaded     = True
        logger.info("cty.xml carregado: %d excepções, %d prefixos", len(exc), len(pfx))

    def lookup(self, callsign: str) -> dict | None:
        """Retorna {'name', 'adif', 'cqz', 'cont'} ou None."""
        if not self._loaded:
            return None
        call = _SUFFIX_RE.sub("", callsign.upper().strip())
        if call in self._exceptions:
            return self._exceptions[call]
        for prefix, info in self._prefixes:
            if call.startswith(prefix):
                return info
        return None


_singleton = DXCCLookup()


def get_dxcc_lookup() -> DXCCLookup:
    return _singleton
