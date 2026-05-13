/* ── 4ham i18n — PT / EN translations ───────────────────────────────────── */
const LOCALES = {
  pt: {
    /* Cabeçalho */
    brand_subline:         "Painel remoto estilo transceptor",
    rx_link_label:         "Ligação RX",
    /* Ecrã de frequência */
    screen_mode:           "Modo",
    screen_width:          "Largura",
    vfo_main:              "VFO Principal",
    vfo_console:           "Consola Remota",
    freq_display_aria:     "Frequência do VFO",
    vfo_screen_hint:       "Roda o knob, usa o wheel nos dígitos ou os botões rápidos para sintonizar.",
    /* S-Metro */
    smeter_label:          "S-Metro",
    signal_hint:           "S-metro via CAT (HF: S9 = −73 dBm)",
    smeter_standby:        "Em espera",
    /* Waterfall */
    waterfall_label:       "Waterfall",
    waterfall_canvas_aria: "Waterfall do receptor",
    wf_preview:            "Pré-visualização",
    wf_linking:            "A ligar",
    wf_live:               "Activo",
    wf_fault:              "Falha",
    wf_offline:            "Offline",
    /* Painel de operação */
    mode_selector_label:   "Selector de modo",
    radio_operation_label: "Operação Rádio",
    block_copy_audio:      "RX link, TX hold e controlo rápido.",
    btn_connect:           "Ligar RX",
    btn_disconnect:        "Desligar",
    btn_tx_hold:           "EMISSÃO",
    btn_tx_live:           "EM EMISSÃO",
    /* Knob VFO */
    vfo_knob_label:        "VFO Principal",
    vfo_knob_aria:         "Knob de sintonização principal",
    knob_caption:          "Arrasta em arco, clique lateral ou wheel.",
    /* Passo de sintonização */
    tuning_tools_label:    "Ferramentas de Sintonia",
    step_copy:             "Escolhe o passo activo e combina-o com os botões rápidos do VFO.",
    step_caption:          "Dígito {step} seleccionado",
    tune_digit_aria:       "Sintonizar dígito {step}",
    /* Régua DX */
    freq_ruler_aria:       "Régua de frequências com spots DX",
    /* Diário QSO */
    qso_log_label:         "Diário QSO",
    qso_ready:             "Pronto",
    form_callsign:         "Indicativo",
    form_utc:              "UTC",
    form_frequency:        "Frequência",
    form_mode:             "Modo",
    form_band:             "Banda",
    form_rst_sent:         "RST Enviado",
    form_rst_rx:           "RST Recebido",
    form_notes:            "Notas",
    /* Plano de bandas */
    band_plan_label:       "Plano de Bandas",
    band_80m_desc:         "CW, digital e SSB regional",
    band_40m_desc:         "DX, nets e operação geral",
    band_20m_desc:         "DX de longo curso e digital",
    band_15m_desc:         "Boa abertura diurna",
    band_10m_desc:         "Propagação variável e FM alta",
    /* Estados de ligação */
    conn_offline:          "Offline",
    conn_connecting:       "A ligar",
    conn_connected:        "Activo",
    conn_error:            "Falha",
    /* Estados de áudio */
    audio_standby:         "Em espera",
    audio_negotiating:     "A negociar ligação RX",
    audio_stream_received: "Stream RX recebido",
    audio_link_fault:      "Falha na ligação RX",
    audio_finalising:      "A finalizar ligação RX",
    audio_stream_live:     "Stream RX activo",
    audio_session_dropped: "Sessão RX interrompida",
    audio_link_offline:    "Ligação RX offline",
  },

  en: {
    /* Header */
    brand_subline:         "Transceiver-style remote front panel",
    rx_link_label:         "RX Link",
    /* Frequency display */
    screen_mode:           "Mode",
    screen_width:          "Width",
    vfo_main:              "Main VFO",
    vfo_console:           "Remote Console",
    freq_display_aria:     "VFO frequency display",
    vfo_screen_hint:       "Turn the knob, scroll on a digit, or use the quick-step buttons to tune.",
    /* S-Meter */
    smeter_label:          "S-Meter",
    signal_hint:           "S-meter via CAT (HF: S9 = −73 dBm)",
    smeter_standby:        "Standby",
    /* Waterfall */
    waterfall_label:       "Waterfall",
    waterfall_canvas_aria: "Receiver waterfall display",
    wf_preview:            "Preview",
    wf_linking:            "Linking",
    wf_live:               "Live",
    wf_fault:              "Fault",
    wf_offline:            "Offline",
    /* Operation panel */
    mode_selector_label:   "Mode selector",
    radio_operation_label: "Radio Operation",
    block_copy_audio:      "RX link, TX hold and quick controls.",
    btn_connect:           "Connect RX",
    btn_disconnect:        "Disconnect",
    btn_tx_hold:           "TX HOLD",
    btn_tx_live:           "TX LIVE",
    /* VFO knob */
    vfo_knob_label:        "Main VFO",
    vfo_knob_aria:         "Main tuning knob",
    knob_caption:          "Drag in arc, side click, or scroll wheel.",
    /* Tune step */
    tuning_tools_label:    "Tuning Tools",
    step_copy:             "Select the active step and combine with the VFO quick-step buttons.",
    step_caption:          "{step} digit selected",
    tune_digit_aria:       "Tune {step} digit",
    /* DX ruler */
    freq_ruler_aria:       "Frequency ruler with DX spots",
    /* QSO log */
    qso_log_label:         "QSO Log",
    qso_ready:             "Ready",
    form_callsign:         "Callsign",
    form_utc:              "UTC",
    form_frequency:        "Frequency",
    form_mode:             "Mode",
    form_band:             "Band",
    form_rst_sent:         "RST Sent",
    form_rst_rx:           "RST RX",
    form_notes:            "Notes",
    /* Band plan */
    band_plan_label:       "Band Plan",
    band_80m_desc:         "CW, digital and regional SSB",
    band_40m_desc:         "DX, nets and general operation",
    band_20m_desc:         "Long-haul DX and digital",
    band_15m_desc:         "Good daytime opening",
    band_10m_desc:         "Variable propagation and upper FM",
    /* Connection states */
    conn_offline:          "Offline",
    conn_connecting:       "Connecting",
    conn_connected:        "Live",
    conn_error:            "Fault",
    /* Audio states */
    audio_standby:         "Standby",
    audio_negotiating:     "Negotiating RX link",
    audio_stream_received: "RX stream received",
    audio_link_fault:      "RX link fault",
    audio_finalising:      "Finalising RX link",
    audio_stream_live:     "RX stream live",
    audio_session_dropped: "RX session dropped",
    audio_link_offline:    "RX link offline",
  },
};

/* ── Core ────────────────────────────────────────────────────────────────── */
var _lang = (function () {
  try { return localStorage.getItem("4ham_lang") || "pt"; } catch (_) { return "pt"; }
}());

function t(key) {
  return (LOCALES[_lang] || LOCALES.pt)[key] || key;
}

function getLang() { return _lang; }

function applyLocale(lang) {
  if (lang === "pt" || lang === "en") {
    _lang = lang;
    try { localStorage.setItem("4ham_lang", lang); } catch (_) {}
  }
  document.documentElement.lang = _lang;

  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });

  var btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = _lang === "pt" ? "EN" : "PT";
}

window.t          = t;
window.getLang    = getLang;
window.applyLocale = applyLocale;

/* Apply on load (scripts run after DOM is parsed at bottom of <body>) */
applyLocale();
