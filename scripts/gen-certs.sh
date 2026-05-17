#!/usr/bin/env bash
# gen-certs.sh — Gera CA local + certificado de servidor assinado por ela.
#
# Uso:
#   bash scripts/gen-certs.sh [IP_EXTRA ...]
#
# Exemplo:
#   bash scripts/gen-certs.sh 192.168.1.100 10.0.0.50
#
# O certificado incluirá automaticamente:
#   - Todos os IPs actuais do servidor (hostname -I)
#   - localhost / 127.0.0.1
#   - Quaisquer IPs/hostnames passados como argumentos
#
# Resultado:
#   certs/ca.key      — chave privada da CA (guardar em segurança; não partilhar)
#   certs/ca.pem      — certificado da CA (distribuir aos utilizadores para instalar)
#   certs/key.pem     — chave privada do servidor
#   certs/cert.pem    — certificado do servidor (assinado pela CA)
#
# Para que os browsers não mostrem aviso:
#   Instalar certs/ca.pem em cada computador/browser uma única vez.
#   Instruções: https://github.com/octaviofilipepereira/4ham-Remote-Operation
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CERTS_DIR="$ROOT_DIR/certs"
mkdir -p "$CERTS_DIR"

# ── Recolher IPs/hostnames ──────────────────────────────────────────────────
EXTRA_HOSTS=("$@")

# IPs LAN actuais
mapfile -t LAN_IPS < <(hostname -I | tr ' ' '\n' | grep -v '^$')

# Juntar tudo (sem duplicados)
ALL_IPS=()
ALL_DNS=("localhost")

for h in "${LAN_IPS[@]}" "${EXTRA_HOSTS[@]}"; do
    # Determinar se é IP ou hostname
    if [[ "$h" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
       [[ "$h" =~ ^[0-9a-fA-F:]+:[0-9a-fA-F:]+$ ]]; then
        # Verificar se já está na lista
        already=false
        for existing in "${ALL_IPS[@]:-}"; do [[ "$existing" == "$h" ]] && already=true; done
        $already || ALL_IPS+=("$h")
    else
        already=false
        for existing in "${ALL_DNS[@]:-}"; do [[ "$existing" == "$h" ]] && already=true; done
        $already || ALL_DNS+=("$h")
    fi
done

# Garantir 127.0.0.1
already=false
for existing in "${ALL_IPS[@]:-}"; do [[ "$existing" == "127.0.0.1" ]] && already=true; done
$already || ALL_IPS+=("127.0.0.1")

# Construir string SAN
SAN="subjectAltName="
for ip in "${ALL_IPS[@]}"; do SAN+="IP:$ip,"; done
for dns in "${ALL_DNS[@]}"; do SAN+="DNS:$dns,"; done
SAN="${SAN%,}"  # remover vírgula final

echo "=== 4ham — Gerador de Certificados TLS ==="
echo "IPs  : ${ALL_IPS[*]}"
echo "DNS  : ${ALL_DNS[*]}"
echo "SAN  : $SAN"
echo ""

# ── 1. Gerar CA ──────────────────────────────────────────────────────────────
if [[ ! -f "$CERTS_DIR/ca.key" ]]; then
    echo "[1/4] A gerar chave da CA..."
    openssl genrsa -out "$CERTS_DIR/ca.key" 4096 2>/dev/null
else
    echo "[1/4] Chave da CA já existe — a reutilizar."
fi

if [[ ! -f "$CERTS_DIR/ca.pem" ]]; then
    echo "[2/4] A gerar certificado da CA (válido 10 anos)..."
    openssl req -x509 -new -nodes \
        -key "$CERTS_DIR/ca.key" \
        -sha256 -days 3650 \
        -out "$CERTS_DIR/ca.pem" \
        -subj "/CN=4ham Local CA/O=4ham Remote Operation/C=PT"
else
    echo "[2/4] Certificado da CA já existe — a reutilizar."
fi

# ── 2. Gerar certificado do servidor assinado pela CA ────────────────────────
echo "[3/4] A gerar chave e CSR do servidor..."
openssl genrsa -out "$CERTS_DIR/key.pem" 4096 2>/dev/null

openssl req -new -key "$CERTS_DIR/key.pem" \
    -out "$CERTS_DIR/server.csr" \
    -subj "/CN=4ham-server/O=4ham Remote Operation/C=PT"

echo "[4/4] A assinar certificado do servidor com a CA (válido 2 anos)..."
openssl x509 -req -in "$CERTS_DIR/server.csr" \
    -CA "$CERTS_DIR/ca.pem" \
    -CAkey "$CERTS_DIR/ca.key" \
    -CAcreateserial \
    -out "$CERTS_DIR/cert.pem" \
    -days 730 -sha256 \
    -extfile <(printf "%s\n" \
        "basicConstraints=CA:FALSE" \
        "keyUsage=digitalSignature,keyEncipherment" \
        "extendedKeyUsage=serverAuth" \
        "$SAN") 2>/dev/null

rm -f "$CERTS_DIR/server.csr"

echo ""
echo "=== Certificados gerados com sucesso ==="
echo ""
echo "  certs/ca.pem   — instalar nos browsers/sistemas dos utilizadores"
echo "  certs/cert.pem — certificado do servidor"
echo ""

# Copiar CA para directório público (servido em HTTP na porta 8002)
mkdir -p "$CERTS_DIR/public"
cp "$CERTS_DIR/ca.pem" "$CERTS_DIR/public/4ham-local-ca.pem"
echo "  certs/public/4ham-local-ca.pem — acessível via http://<IP>:8002/4ham-local-ca.pem"
echo ""
echo "SANs incluídos:"
openssl x509 -in "$CERTS_DIR/cert.pem" -noout -text | grep -A2 "Subject Alternative"
echo ""
echo "Após instalar a CA, aceder a: https://$(echo "${ALL_IPS[0]}" | head -1):8001"
echo "Download da CA (HTTP, sem aviso): http://$(echo "${ALL_IPS[0]}" | head -1):8002/4ham-local-ca.pem"
