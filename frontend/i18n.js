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
    signal_hint:           "S-metro via CAT (0 dB = S9, −6 dB por unidade S)",
    smeter_standby:        "Em espera",
    /* ROE (SWR) */
    swr_label:             "ROE",
    swr_hint:              "ROE via CAT (apenas em TX)",
    swr_standby:           "—",
    swr_ok:                "Boa",
    swr_warn:              "Alta",
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
    btn_rig_connect_off:   "Ligar ao Rádio",
    btn_rig_connect_on:    "Rádio Ligado",
    btn_rig_connecting:    "A ligar…",
    connecting_title:      "A ligar ao rádio…",
    btn_rig_connect_off_title: "Clique para ligar ao rádio",
    btn_rig_connect_on_title:  "Rádio ligado — clique para reconectar",
    rig_offline_title:   "Rádio desligado",
    rig_offline_body:    "Não foi possível ligar ao transceptor.\nLigue o rádio e clique no botão.",
    rig_offline_dismiss: "Fechar",
    audio_settings_title:   "Configuração de Áudio",
    audio_settings_mic:     "Microfone (TX)",
    audio_settings_output:  "Saída de áudio (RX)",
    audio_settings_apply:   "Aplicar",
    audio_settings_close:   "Fechar",
    audio_settings_default: "Predefinido do sistema",
    /* Definições RF */
    rig_settings_title:       "Definições de Rádio",
    rsd_nb_level:             "Nível NB",
    rsd_proc_level:           "Nível PROC",
    rsd_mic_gain:             "Ganho MIC",
    rsd_mic_eq:               "EQ MIC",
    rsd_width:                "Largura de Banda",
    rsd_cancel:               "Cancelar",
    btn_audio_settings_aria:  "Configuração de áudio",
    btn_audio_settings_title: "Configuração de áudio",
    btn_rig_settings_aria:    "Definições de rádio",
    btn_rig_settings_title:   "Definições de rádio (NB, PROC, MIC…)",
    btn_tx_hold:           "EMISSÃO",
    btn_tx_live:           "EM EMISSÃO",
    btn_vox:               "VOX",
    vox_sens_label:        "Sens",
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
    form_notes_placeholder: "Locator, nome, potência, observações…",
    btn_log_qso:           "Registar QSO",
    recent_qso_label:      "Últimos QSOs",
    recent_qso_empty:      "Nenhum QSO registado",
    /* Export ADIF + Clublog */
    btn_adif_export:       "ADIF",
    btn_adif_export_title: "Exportar QSOs em formato ADIF",
    btn_clublog:           "Clublog",
    btn_clublog_title:     "Configurar integração com o Clublog",
    clublog_title:         "Clublog",
    clublog_email:         "E-mail",
    clublog_password:      "Palavra-passe de Aplicação",
    clublog_password_placeholder: "Application Password do Clublog",
    clublog_apikey:        "API Key",
    clublog_apikey_placeholder: "Chave da API do Clublog",
    clublog_hint:          "API Key em <a href=\"https://clublog.org/apikeys.php\" target=\"_blank\" rel=\"noopener\">clublog.org/apikeys.php</a>. Application Password em <strong>Conta &rarr; Segurança</strong>.",
    clublog_save:          "Guardar",
    clublog_saved:         "Configurações guardadas.",
    clublog_cty_ok:        "Prefixos DXCC actualizados.",
    clublog_upload:        "Enviar para Clublog",
    clublog_uploading:     "A enviar…",
    clublog_upload_ok:     "Upload concluído com sucesso!",
    clublog_upload_error:  "Erro ao enviar para o Clublog.",
    clublog_upload_403:    "Credenciais inválidas (403). Corrija e-mail, palavra-passe ou API Key. Não repita o envio sem corrigir — o IP pode ser bloqueado.",
    clublog_missing_fields: "Preencha o Indicativo, E-mail, Palavra-passe de Aplicação e API Key.",
    btn_close:             "Fechar",
    /* Cluster DX */
    dx_cluster_search_placeholder: "país, call, host…",
    btn_dx_cluster:                "Clusters",
    btn_dx_cluster_title:          "Ligar a um cluster DX",
    /* Plano de bandas */
    band_plan_label:       "Plano de Bandas",
    band_160m_desc:        "Banda de inverno, propagação nocturna",
    band_80m_desc:         "CW, digital e SSB regional",
    band_40m_desc:         "DX, nets e operação geral",
    band_20m_desc:         "DX de longo curso e digital",
    band_17m_desc:         "WARC, sem contestos, DX consistente",
    band_15m_desc:         "Boa abertura diurna",
    band_12m_desc:         "WARC, abertura solar, pouco tráfego",
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
    signal_hint:           "S-meter via CAT (0 dB = S9, −6 dB per S-unit)",
    smeter_standby:        "Standby",
    /* SWR */
    swr_label:             "SWR",
    swr_hint:              "SWR via CAT (TX only)",
    swr_standby:           "—",
    swr_ok:                "Good",
    swr_warn:              "High",
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
    btn_vox:               "VOX",
    btn_rig_connect_off:   "Connect to Radio",
    btn_rig_connect_on:    "Radio Connected",
    btn_rig_connecting:    "Connecting…",
    connecting_title:      "Connecting to radio…",
    btn_rig_connect_off_title: "Click to connect to the radio",
    btn_rig_connect_on_title:  "Radio connected — click to reconnect",
    rig_offline_title:   "Radio offline",
    rig_offline_body:    "Could not connect to the transceiver.\nTurn on the radio and click the button.",
    rig_offline_dismiss: "Dismiss",
    audio_settings_title:   "Audio Settings",
    audio_settings_mic:     "Microphone (TX)",
    audio_settings_output:  "Audio output (RX)",
    audio_settings_apply:   "Apply",
    audio_settings_close:   "Close",
    audio_settings_default: "System default",
    /* RF Settings */
    rig_settings_title:       "Radio Settings",
    rsd_nb_level:             "NB Level",
    rsd_proc_level:           "PROC Level",
    rsd_mic_gain:             "MIC Gain",
    rsd_mic_eq:               "MIC EQ",
    rsd_width:                "Passband Width",
    rsd_cancel:               "Cancel",
    btn_audio_settings_aria:  "Audio settings",
    btn_audio_settings_title: "Audio settings",
    btn_rig_settings_aria:    "Radio settings",
    btn_rig_settings_title:   "Radio Settings (NB, PROC, MIC…)",
    vox_sens_label:        "Sens",
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
    form_notes_placeholder: "Locator, name, power, notes…",
    btn_log_qso:           "Log QSO",
    recent_qso_label:      "Recent QSOs",
    recent_qso_empty:      "No QSOs logged",
    /* Export ADIF + Clublog */
    btn_adif_export:       "ADIF",
    btn_adif_export_title: "Export QSOs in ADIF format",
    btn_clublog:           "Clublog",
    btn_clublog_title:     "Configure Clublog integration",
    clublog_title:         "Clublog",
    clublog_email:         "E-mail",
    clublog_password:      "Application Password",
    clublog_password_placeholder: "Clublog Application Password",
    clublog_apikey:        "API Key",
    clublog_apikey_placeholder: "Clublog API Key",
    clublog_hint:          "API Key at <a href=\"https://clublog.org/apikeys.php\" target=\"_blank\" rel=\"noopener\">clublog.org/apikeys.php</a>. Application Password under <strong>Account &rarr; Security</strong>.",
    clublog_save:          "Save",
    clublog_saved:         "Settings saved.",
    clublog_cty_ok:        "DXCC prefixes updated.",
    clublog_upload:        "Upload to Clublog",
    clublog_uploading:     "Uploading\u2026",
    clublog_upload_ok:     "Upload completed successfully!",
    clublog_upload_error:  "Error uploading to Clublog.",
    clublog_upload_403:    "Invalid credentials (403). Fix your e-mail, password or API Key. Do not retry without correcting them — your IP may be blocked.",
    clublog_missing_fields: "Please fill in Callsign, E-mail, Application Password and API Key.",
    btn_close:             "Close",
    /* DX Cluster */
    dx_cluster_search_placeholder: "country, call, host…",
    btn_dx_cluster:                "Clusters",
    btn_dx_cluster_title:          "Connect to a DX cluster",
    /* Band plan */
    band_plan_label:       "Band Plan",
    band_160m_desc:        "Winter band, night propagation",
    band_80m_desc:         "CW, digital and regional SSB",
    band_40m_desc:         "DX, nets and general operation",
    band_20m_desc:         "Long-haul DX and digital",
    band_17m_desc:         "WARC, no contests, consistent DX",
    band_15m_desc:         "Good daytime opening",
    band_12m_desc:         "WARC, solar opening, low traffic",
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
  document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
    el.setAttribute("title", t(el.dataset.i18nTitle));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
    el.innerHTML = t(el.dataset.i18nHtml);
  });

  var btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = _lang === "pt" ? "EN" : "PT";
}

window.t          = t;
window.getLang    = getLang;
window.applyLocale = applyLocale;

/* Apply on load (scripts run after DOM is parsed at bottom of <body>) */
applyLocale();
