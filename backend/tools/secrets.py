#!/usr/bin/env python3
# © 2026 Octávio Filipe Gonçalves
# Callsign: CT7BFV
# License: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
#
# Utilitário de linha de comando para gerir segredos da aplicação 4ham.
#
# Uso:
#   python -m backend.tools.secrets set clublog_api_key <valor>
#   python -m backend.tools.secrets get clublog_api_key
#   python -m backend.tools.secrets list

import sys


def _usage():
    print("Uso:")
    print("  python -m backend.tools.secrets set <nome> <valor>")
    print("  python -m backend.tools.secrets get <nome>")
    print("  python -m backend.tools.secrets list")
    sys.exit(1)


def main():
    # Adicionar raiz do projecto ao path para importar o backend
    import os
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
    os.chdir(Path(__file__).resolve().parents[3])

    from backend.app.core.secrets import get_secret, has_secret, set_secret, _get_conn

    if len(sys.argv) < 2:
        _usage()

    cmd = sys.argv[1]

    if cmd == "set":
        if len(sys.argv) != 4:
            _usage()
        name, value = sys.argv[2], sys.argv[3]
        set_secret(name, value)
        print(f"✓ Segredo '{name}' guardado com sucesso.")

    elif cmd == "get":
        if len(sys.argv) != 3:
            _usage()
        name = sys.argv[2]
        val = get_secret(name)
        if val is None:
            print(f"Segredo '{name}' não encontrado.")
            sys.exit(1)
        print(val)

    elif cmd == "list":
        try:
            with _get_conn() as conn:
                rows = conn.execute("SELECT name FROM secrets ORDER BY name").fetchall()
            if not rows:
                print("Nenhum segredo guardado.")
            else:
                for (name,) in rows:
                    print(f"  {name}")
        except Exception as exc:
            print(f"Erro: {exc}")
            sys.exit(1)

    else:
        _usage()


if __name__ == "__main__":
    main()
