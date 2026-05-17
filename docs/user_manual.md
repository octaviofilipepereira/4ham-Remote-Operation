<!--
© 2026 Octávio Filipe Gonçalves
Indicativo: CT7BFV
Licença: GNU AGPL-3.0 (https://www.gnu.org/licenses/agpl-3.0.html)
Última actualização: 2026-05-17 UTC
-->

# 4HAM Remote Operation — Manual do Utilizador

> 🇬🇧 [English version](user_manual_en.md)

---

## Índice

1. [Introdução](#1-introdução)
2. [Requisitos do Utilizador](#2-requisitos-do-utilizador)
3. [Aceder à Interface](#3-aceder-à-interface)
4. [Interface Principal](#4-interface-principal)
   - [VFO e Frequência](#vfo-e-frequência)
   - [Knob de Sintonia](#knob-de-sintonia)
   - [Selector de Modo](#selector-de-modo)
   - [S-meter](#s-meter)
   - [PTT e Transmissão](#ptt-e-transmissão)
5. [Áudio RX — Ouvir o Rádio](#5-áudio-rx--ouvir-o-rádio)
6. [Áudio TX — Transmitir Voz SSB](#6-áudio-tx--transmitir-voz-ssb)
   - [DSP no Pi](#dsp-no-pi)
   - [Definições de Áudio](#definições-de-áudio)
   - [Monitor TX pós-DSP](#monitor-tx-pós-dsp)
7. [Waterfall e Espectro](#7-waterfall-e-espectro)
   - [Painel de Espectro](#painel-de-espectro)
   - [Waterfall AF](#waterfall-af)
   - [Interpretação das Cores](#interpretação-das-cores)
8. [DX Cluster e Ruler](#8-dx-cluster-e-ruler)
9. [QSO Log](#9-qso-log)
10. [Indicadores de Estado](#10-indicadores-de-estado)
11. [Resolução de Problemas](#11-resolução-de-problemas)

---

## 1. Introdução

O **4HAM Remote Operation** é uma aplicação web que permite operar uma estação de rádio amador remotamente através de qualquer browser moderno.

O utilizador controla o transceptor físico (frequência, modo, PTT) e ouve/transmite áudio em tempo real, como se estivesse sentado na frente do rádio.

### O que é possível fazer

- Sintonizar frequência e mudar modo (SSB, CW, FM, AM, FT8)
- Ouvir o áudio de recepção via WebRTC com latência inferior a 80 ms em LAN
- Transmitir voz SSB com o microfone do browser
- Ver o espectro AF e a waterfall em tempo real
- Registar QSOs no log integrado
- Consultar spots DX no ruler de frequência

### Limitações actuais

- O espectro/waterfall mostra apenas a largura de banda de áudio AF do rádio (não espectro RF wideband)
- Transmissão TX requer que o rádio suporte PTT via CAT (rigctld)

---

## 2. Requisitos do Utilizador

### Browser

| Browser | Versão mínima | Notas |
|---|---|---|
| Google Chrome | 90+ | Recomendado |
| Mozilla Firefox | 88+ | Suportado |
| Microsoft Edge | 90+ | Suportado |
| Safari | 15+ | WebRTC suportado |

> **Importante:** O browser deve suportar WebRTC. Navegação em modo privado pode bloquear o acesso ao microfone necessário para TX.

### Ligação de rede

- LAN: latência de áudio < 80 ms
- WAN/Internet: latência de áudio 100–200 ms (depende da ligação)
- Largura de banda mínima recomendada: 256 kbps (só RX); 512 kbps (RX+TX)

### Permissões no browser

- **Microfone**: necessário para TX (transmissão de voz SSB)
- O browser pedirá permissão na primeira vez que clicar em **TX HOLD**

---

## 3. Aceder à Interface

O endereço é fornecido pelo administrador da estação. Formato típico:

```
https://<endereço>:8001/
```

Na primeira visita o browser pode alertar para um certificado auto-assinado. Clicar em **Avançar** (ou equivalente no browser) para aceitar.

### Autenticação

A interface pede **utilizador e password** via HTTP Basic Auth. Inserir as credenciais fornecidas pelo administrador.

> As credenciais são armazenadas pelo browser durante a sessão. Fechar o browser ou a tab elimina a sessão.

---

## 4. Interface Principal

### VFO e Frequência

O display central mostra a frequência actual do rádio em MHz com 3 casas decimais (ex: `7.120`).

**Formas de alterar a frequência:**

| Método | Como usar |
|---|---|
| **Knob** | Rodar com o rato (arrastar ou scroll) |
| **Scroll no dígito** | Passar o rato sobre um dígito e usar a roda |
| **Botões de passo** | Clicar nos botões de passo (10 Hz a 1 MHz) |
| **Botões de banda** | Clicar directamente no nome de banda (ex: `40m`) |
| **Softkeys ×1/×10/×100** | Multiplicar o passo de sintonia |

### Knob de Sintonia

O knob VFO responde a:
- **Arrastar** com o rato (circular)
- **Roda do rato** sobre o knob

Cada clique da roda ou movimento do knob avança um passo no passo de sintonia seleccionado.

### Selector de Modo

O dropdown **Mode selector** permite escolher:

| Modo | Uso |
|---|---|
| **USB** | SSB em bandas acima de 10 MHz (20m, 17m, 15m, 12m, 10m) |
| **LSB** | SSB em bandas abaixo de 10 MHz (80m, 40m) |
| **CW** | Telegrafia |
| **FM** | VHF/UHF e 10m |
| **AM** | Amplitude modulada |

### S-meter

A barra de sinal mostra:
- **Nível em dBm** — valor numérico à direita
- **Qualidade do sinal** — etiqueta textual (Noise floor / Weak / Usable / Clean / Strong / Broadcast)

### PTT e Transmissão

> ⚠️ **Atenção:** Ao activar TX, o rádio transmite em RF. Confirmar que a antena está ligada e que o operador tem licença para transmitir na frequência seleccionada.

**TX HOLD** — mantém PTT activo até clicar novamente para libertar.

O badge **TX/RX** no topo da interface indica o estado actual.

---

## 5. Áudio RX — Ouvir o Rádio

1. Clicar em **Connect** para iniciar a ligação WebRTC.
2. Aguardar o badge de estado passar para **Live**.
3. O áudio do rádio começa a ser reproduzido automaticamente.

> Se não houver áudio, verificar que o volume do browser não está silenciado e que o badge de áudio mostra **Live** e não **Fault**.

### Latência esperada

| Rede | Latência típica |
|---|---|
| LAN (mesma rede) | 40–80 ms |
| WAN (Internet) | 100–200 ms |

---

## 6. Áudio TX — Transmitir Voz SSB

> **Pré-requisito:** O modo deve estar em USB ou LSB. O browser pedirá acesso ao microfone.

1. Seleccionar modo **USB** ou **LSB**.
2. Clicar em **TX HOLD** — o browser pede permissão de microfone (primeira vez).
3. O badge muda para **TX** e o rádio começa a transmitir.
4. Falar normalmente para o microfone do computador.
5. Clicar novamente em **TX HOLD** para libertar o PTT.

> **Safety timeout:** Se a ligação WebRTC cair durante TX, o PTT é libertado automaticamente em menos de 500 ms.

> **Silenciamento RX durante TX:** Enquanto o PTT está activo, o áudio de recepção é automaticamente silenciado no servidor. Isto elimina o eco acústico (auscultadores/altifalantes → microfone → rádio TX) sem necessidade de qualquer configuração adicional. O áudio RX retoma imediatamente ao soltar o PTT.

### DSP no Pi

O áudio de voz captado pelo microfone é transmitido ao Pi via WebRTC e processado antes de chegar ao rádio. A cadeia de processamento aplicada (por esta ordem) é:

| Etapa | Tipo | Parâmetros |
|---|---|---|
| HPF | Passa-alto | 200 Hz — elimina ruído de baixa frequência |
| Bell EQ | Corte | −6 dB @ 350 Hz — reduz ressalto de voz masculina |
| Bell EQ | Realce | +3 dB @ 2200 Hz — melhora inteligibilidade SSB |
| LPF | Passa-baixo | 3200 Hz — banda SSB padrão |
| Expander | Downward expander | Reduz nível quando a voz está abaixo do limiar (supressão de fundo) |

Este processamento é aplicado sempre que o PTT está activo, independentemente do modo de monitorização seleccionado.

### Definições de Áudio

O botão **⚙ Áudio** (ou similar) abre uma popup com opções de configuração de áudio TX:

| Opção | Descrição |
|---|---|
| **Dispositivo de microfone** | Seleccionar o microfone a usar para TX |
| **Monitor TX pós-DSP** | Ver secção abaixo |

### Monitor TX pós-DSP

A checkbox **Monitor TX pós-DSP** na popup de Áudio permite ouvir o sinal exacto que chegou ao rádio após todo o processamento DSP.

**Como funciona:**
- Durante o PTT, o Pi envia os frames de áudio processados para o browser via WebSocket (`/ws/tx-monitor`)
- O browser *não* os reproduz durante a transmissão (evitaria eco)
- Ao **soltar o PTT**, o browser reproduz imediatamente todos os frames acumulados em sequência

**Para que serve:**
- Verificar a qualidade do sinal transmitido (EQ, nível do expander)
- Diagnosticar problemas de áudio sem necessitar de outro operador
- Confirmar que a voz soa correctamente antes de um QSO

> O Monitor TX pós-DSP **não causa eco** porque o áudio é reproduzido apenas depois de o PTT ser libertado e o microfone desactivado.

---

## 7. Waterfall e Espectro

A secção de waterfall tem dois painéis sobrepostos:

### Painel de Espectro

Painel superior (80 px de altura) — mostra a energia por frequência em tempo real, com suavização exponencial. Picos altos e coloridos indicam sinais activos.

- **Eixo horizontal**: frequência em Hz (dentro do passband AF do rádio)
- **Área preenchida**: energia do sinal com gradiente de cor
- **Linha de contorno**: crista do espectro instânea suavizada

### Waterfall AF

Painel inferior (altura variável) — exibe a evolução temporal do espectro, com o instante mais recente no topo e o tempo a avançar para baixo.

- **Eixo horizontal**: frequência (mesma escala do painel de espectro)
- **Eixo vertical**: tempo (topo = agora, baixo = passado)
- **Cor**: intensidade do sinal

### Interpretação das Cores

| Cor | Intensidade | Significado |
|---|---|---|
| Azul escuro / preto | Muito baixa | Ruído de fundo / sem sinal |
| Azul médio | Baixa | Sinal fraco |
| Ciano / verde-água | Média | Sinal moderado |
| Amarelo / laranja | Alta | Sinal forte |
| Vermelho / coral | Muito alta | Sinal muito forte |

> **Nota sobre o FT-991A:** A waterfall mostra o espectro AF (0–3 kHz para SSB). É o comportamento normal para este rádio — o FT-991A não fornece espectro RF wideband via USB.

---

## 8. DX Cluster e Ruler

O **DX Ruler** é a régua de frequência abaixo do VFO que mostra spots DX activos na banda actual.

- Cada marca colorida representa um spot DX com indicativo e frequência
- Passar o rato sobre uma marca mostra os detalhes do spot
- Clicar numa marca sintoniza o rádio para essa frequência

> *Funcionalidade em desenvolvimento — spots DX em tempo real via cluster externo.*

---

## 9. QSO Log

O formulário **QSO Log** permite registar contactos realizados.

| Campo | Descrição |
|---|---|
| **Call** | Indicativo da estação contactada |
| **Freq** | Frequência (preenchida automaticamente pelo VFO) |
| **Mode** | Modo (preenchido automaticamente) |
| **Band** | Banda (calculada automaticamente) |
| **RST Sent / Rcvd** | Relatório de sinal enviado e recebido |
| **Name** | Nome do operador |
| **QTH** | Localidade |
| **Notes** | Notas livres |
| **Time** | Hora UTC (preenchida automaticamente) |

Clicar em **Log QSO** para guardar o registo.

---

## 10. Indicadores de Estado

| Indicador | Verde / Live | Vermelho / Fault | Cinzento / Offline |
|---|---|---|---|
| **Badge de conexão** (topo) | Ligado e operacional | Erro de ligação | Desligado |
| **Waterfall** (label) | Recebendo espectro | Erro no WebSocket | Sem ligação |
| **TX/RX badge** | TX activo (vermelho) / RX (verde) | — | — |

---

## 11. Resolução de Problemas

### Sem áudio após Connect

- Verificar que o badge de estado passou para **Live** (não **Fault**)
- Verificar que o volume do browser não está silenciado
- Tentar **Disconnect** e **Connect** novamente
- Em alguns browsers, clicar uma vez na página antes de Connect desbloqueia o autoplay de áudio

### Waterfall em branco / "Standby"

- O espectro requer que o backend esteja a correr e a receber áudio do rádio
- Verificar que o rádio está ligado e o USB Audio está conectado ao servidor
- Aguardar alguns segundos — o WebSocket reconecta automaticamente

### Delay na mudança de frequência

- Normal: < 200 ms
- Se superior, pode indicar sobrecarga no servidor — contactar o administrador

### TX não funciona / sem sinal RF

- Confirmar que o modo é USB ou LSB (modos AM/FM/CW têm restrições de TX via microfone)
- Verificar que o browser tem permissão de microfone
- Confirmar que a antena está ligada no rádio

### Eco reportado pelo outro operador

O sistema silencia automaticamente o áudio RX durante TX para eliminar o eco. Se o eco persistir:

1. Confirmar que o **Monitor TX pós-DSP** está desligado durante o QSO real (apenas para diagnóstico)
2. Verificar que não há outro dispositivo de áudio a reproduzir som próximo do microfone
3. Desligar e religar a ligação WebRTC

### Monitor TX pós-DSP não produz áudio

- Confirmar que a checkbox está activa antes de premir PTT
- Verificar no log do browser (F12 → Console) se aparece "[TX Monitor] primeiro frame"
- O áudio só é reproduzido **após soltar o PTT** — é comportamento esperado

### O browser mostra "Aviso de segurança" no certificado

- Normal em instalações com certificado auto-assinado
- Clicar em **Avançar** / **Proceed** para aceitar e continuar

---

*Para questões técnicas e configuração do servidor, consultar [install.md](install.md) e [hardware_requirements.md](hardware_requirements.md).*

<!--
© 2026 Octávio Filipe Gonçalves — CT7BFV
GNU AGPL-3.0
-->
