/**
 * NDS Web Emulator - Main Application
 * Orquestador principal, inicializador del núcleo WASM, Bóveda de Partidas y control de interfaz
 * Versión: v0.9.0
 */

class NDSEmulatorApp {
  constructor() {
    this.currentRomBlob = null;
    this.currentRomName = '';
    this.pendingLaunchRom = null;
    this.activePkhexRom = null;
    this.pkhexEngine = localStorage.getItem('nds_pkhex_engine') || 'https://pkhex-web.github.io';
    this.isPkhexFullscreen = false;
    this.isEmulating = false;
    this.isFastForward = false;
    this.isPaused = false;
    this.selectedCore = localStorage.getItem('nds_core') || 'desmume'; // DeSmuME por defecto para máxima estabilidad y compatibilidad
    this.userExplicitLayoutChoice = false;
    this.autoSaveInterval = null;
    this.emulationSpeed = 1.0; // Velocidad dinámica entre 1x y 3x
    this.lastSavedHash = null;
    this.hasPlayerSavedInSession = false;
    this.initialBootSramHash = 0;
    this.isExiting = false;

    // Configuración de audio y sonido real
    this.audioMuted = localStorage.getItem('nds_audio_muted') === 'true';
    this.audioVolume = localStorage.getItem('nds_audio_volume') !== null ? parseFloat(localStorage.getItem('nds_audio_volume')) : 1.0;

    // Filtros de pantalla y renderizado
    this.videoFilter = localStorage.getItem('nds_video_filter') || 'pixelated';

    // Configuración de rendimiento y salto de cuadros (Frameskip) para iOS y dispositivos móviles
    this.frameskip = localStorage.getItem('nds_frameskip') || 'auto';

    // Configuración de controles táctiles
    this.touchOpacity = localStorage.getItem('nds_touch_opacity') !== null ? parseFloat(localStorage.getItem('nds_touch_opacity')) : 0.95;
    this.touchVisibilityMode = localStorage.getItem('nds_touch_mode') || 'auto';

    // Desactivación permanente de OSD / Mensajes y Widgets de Fast-Forward de RetroArch en memoria y almacenamiento local
    try {
      localStorage.setItem('ejs_menu_enable_widgets', 'false');
      localStorage.setItem('ejs_menu_widget_scale_auto', 'false');
      localStorage.setItem('ejs_notification_show_fast_forward', 'false');
      localStorage.setItem('ejs_video_font_enable', 'false');
      localStorage.setItem('ejs_fps_show', 'false');
      localStorage.setItem('ejs_video_font_size', '0');
      localStorage.setItem('ejs_video_msg_bgcolor_opacity', '0.0');
      localStorage.setItem('ejs_nds_menu_enable_widgets', 'false');
      localStorage.setItem('ejs_nds_menu_widget_scale_auto', 'false');
      localStorage.setItem('ejs_nds_notification_show_fast_forward', 'false');
      localStorage.setItem('ejs_nds_video_font_enable', 'false');
      localStorage.setItem('ejs_nds_fps_show', 'false');
      localStorage.setItem('ejs_nds_video_font_size', '0');
      localStorage.setItem('ejs_nds_video_msg_bgcolor_opacity', '0.0');
    } catch (e) {}

    this.layouts = [
      { id: 'layout-horizontal', name: 'Horizontal (ROG Ally / 16:9)' },
      { id: 'layout-vertical', name: 'Vertical (iOS / NDS Clásico)' },
      { id: 'layout-touch-focus', name: 'Enfoque Táctil' }
    ];

    // Auto-identificar dispositivo y resolución óptima
    this.deviceInfo = this.detectDevice();
    
    // Si es iPhone o dispositivo móvil en vertical, usar Vertical por defecto
    if (this.deviceInfo.isIPhone || (this.deviceInfo.isMobile && this.deviceInfo.isPortrait)) {
      this.currentLayout = 'layout-vertical';
    } else {
      this.currentLayout = 'layout-horizontal';
    }

    this.initEngineGuard();
    this.initUI();
    this.initAutoSaveDaemon();
    this.initPWA();
  }

  /**
   * Auto-detecta el dispositivo, navegador, orientación y ratio de píxeles
   */
  detectDevice() {
    const ua = navigator.userAgent || '';
    const isIOS = (/iPad|iPhone|iPod/.test(ua)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isIPhone = /iPhone|iPod/.test(ua);
    const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isMobile = isIPhone || isAndroid || (isIPad && window.innerWidth < 1024);
    const isPortrait = window.innerHeight > window.innerWidth;
    const dpr = window.devicePixelRatio || 1;
    const isHandheld = /SteamOS|AMD Custom APU/i.test(ua) || (window.innerWidth === 1920 && window.innerHeight === 1080 && 'ontouchstart' in window);

    const info = {
      isIOS,
      isIPhone,
      isIPad,
      isAndroid,
      isMobile,
      isPortrait,
      isHandheld,
      dpr,
      name: isIPhone ? 'iPhone' : (isIPad ? 'iPad' : (isAndroid ? 'Android' : (isHandheld ? 'ROG Ally' : 'PC Desktop')))
    };

    // Inyectar clases al elemento raíz y body para adaptación CSS
    const root = document.documentElement;
    root.classList.toggle('device-ios', isIOS);
    root.classList.toggle('device-iphone', isIPhone);
    root.classList.toggle('device-ipad', isIPad);
    root.classList.toggle('device-mobile', isMobile);
    root.classList.toggle('device-portrait', isPortrait);
    root.classList.toggle('device-landscape', !isPortrait);
    root.classList.toggle('device-handheld', isHandheld);

    return info;
  }

  /**
   * Oculta de forma permanente y segura cualquier menú modal, truco, menú contextual o captura del motor
   * Utiliza MutationObserver pasivo para eliminar el consumo de CPU y evitar micro-congelamientos en iOS
   */
  initEngineGuard() {
    const purgeIntrusiveElements = () => {
      const intrusive = document.querySelectorAll(
        '.ejs_cheat_parent, .ejs_netplay_parent, .ejs_menu_bar, .ejs_menu_bar_hidden, ' +
        '.ejs_menu_button, .ejs_menu_text, .ejs_volume_parent, .ejs_side_menu, .ejs_modal, ' +
        '.ejs_backdrop, .ejs_settings, .ejs_settings_parent, .ejs_cues, .ejs_cue, .ejs_notification, ' +
        '.ejs_notifications, .ejs_notification_parent, .ejs_notification_text, .ejs_fastforward, ' +
        '.ejs_fast_forward, .ejs_ff, .ejs_speed, .ejs_speed_indicator, .ejs_fps, .ejs_fps_parent, ' +
        '.ejs_fps_counter, .ejs_screen_capture, .ejs_watermark, .ejs_virtualGamepad, ' +
        '.ejs_virtualGamepad_parent, .ejs_virtualGamepad_open, .ejs_dpad_main, ' +
        '[class*="ejs_cue"], [class*="ejs_notification"], [class*="ejs_fast"], [class*="ejs_speed"]'
      );
      intrusive.forEach(el => el.remove());

      // Eliminar cualquier elemento textual intrusivo que contenga 'Fast-Forward' o 'Fast Forward'
      document.querySelectorAll('#game-player div, #game-player span, #game-player p, .ejs_parent div, .ejs_parent span').forEach(el => {
        if (el.tagName !== 'CANVAS' && !el.classList.contains('ejs_parent') && !el.classList.contains('ejs_canvas_parent')) {
          const txt = (el.textContent || '').trim();
          if (txt.includes('Fast-Forward') || txt.includes('Fast Forward') || txt.includes('Fast-forward') || txt.includes('Fast forward')) {
            el.remove();
          }
        }
      });

      if (window.EJS_emulator) {
        try {
          if (typeof window.EJS_emulator.displayNotification === 'function') {
            window.EJS_emulator.displayNotification = () => {};
          }
          if (typeof window.EJS_emulator.showNotification === 'function') {
            window.EJS_emulator.showNotification = () => {};
          }
          if (typeof window.EJS_emulator.showCue === 'function') {
            window.EJS_emulator.showCue = () => {};
          }
          if (typeof window.EJS_emulator.toggleVirtualGamepad === 'function') {
            window.EJS_emulator.toggleVirtualGamepad(false);
          }
          if (window.EJS_emulator.virtualGamepad) {
            window.EJS_emulator.virtualGamepad.style.display = 'none';
            window.EJS_emulator.virtualGamepad.remove?.();
          }
          if (window.EJS_emulator.menu) {
            window.EJS_emulator.menu.open = () => {};
            window.EJS_emulator.menu.toggle = () => {};
            window.EJS_emulator.menu.close = () => {};
          }
          if (window.EJS_emulator.elements) {
            const els = window.EJS_emulator.elements;
            if (els.menu) els.menu.remove();
            if (els.menuToggle) els.menuToggle.remove();
            if (els.contextMenu && els.contextMenu.remove) els.contextMenu.remove();
            if (els.sideMenu) els.sideMenu.remove();
            if (els.modal) els.modal.remove();
            if (els.backdrop) els.backdrop.remove();
            if (els.bottomBar && els.bottomBar.parent) els.bottomBar.parent.remove();
          }
        } catch (e) {}
      }
    };

    purgeIntrusiveElements();

    // Observador pasivo sin polling agresivo (0ms CPU en iOS)
    if (window.MutationObserver) {
      const observer = new MutationObserver(() => {
        purgeIntrusiveElements();
      });
      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, { childList: true, subtree: true });
      }
    }

    // Comprobación de seguridad a muy baja frecuencia (cada 3.5 segundos)
    setInterval(purgeIntrusiveElements, 3500);
  }

  /**
   * Calcula un hash rápido de 32-bit de los datos binarios de guardado
   */
  computeSaveHash(data) {
    if (!data) return 0;
    const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
    if (!uint8 || uint8.length === 0) return 0;
    let hash = 2166136261;
    for (let i = 0; i < uint8.length; i += 4) {
      hash ^= uint8[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) ^ uint8.length;
  }

  /**
   * Inicializa el servicio de auto-guardado seguro en segundo plano (Protección Anti-Pérdida)
   */
  /**
   * Extrae los datos de guardado activos directamente de GameManager o del FS de Emscripten
   */
  extractSaveDataFromGameManager(gm) {
    if (!gm) return null;
    let data = null;
    try {
      if (typeof gm.saveSaveFiles === 'function') gm.saveSaveFiles();
      if (typeof gm.getSaveFile === 'function') data = gm.getSaveFile(false);
    } catch (e) {}

    if ((!data || data.byteLength < 512) && gm.FS) {
      const baseName = window.saveManager ? window.saveManager.sanitizeName(this.currentRomName) : 'game';
      const cleanRom = (this.currentRomName || '').replace(/\.(nds|zip|7z)$/i, '');
      const possiblePaths = [
        gm.getSaveFilePath?.(),
        `/data/saves/${baseName}.sav`,
        `/data/saves/${baseName}.srm`,
        `/data/saves/${cleanRom}.sav`,
        `/data/saves/${cleanRom}.srm`,
        `/data/saves/game.sav`,
        `/data/saves/game.srm`,
        `/${baseName}.sav`,
        `/${baseName}.srm`
      ].filter(Boolean);

      for (const p of possiblePaths) {
        try {
          if (gm.FS.analyzePath(p).exists) {
            const b = gm.FS.readFile(p);
            if (b && b.byteLength >= 512) {
              data = b;
              break;
            }
          }
        } catch (e) {}
      }
    }
    return data;
  }

  /**
   * Inicializa el servicio de auto-guardado seguro en segundo plano (Protección Anti-Pérdida)
   */
  initAutoSaveDaemon() {
    this.autoSaveInterval = setInterval(() => {
      if (!this.isEmulating || this.isPaused || this.isExiting || !window.EJS_emulator?.gameManager) {
        return;
      }

      try {
        const gm = window.EJS_emulator.gameManager;
        const saveData = this.extractSaveDataFromGameManager(gm);

        if (saveData && saveData.byteLength >= 512) {
          const currentHash = this.computeSaveHash(saveData);
          const isValidSram = window.saveManager ? window.saveManager.isValidSaveBuffer(saveData) : false;

          // Si la SRAM es válida y ha cambiado respecto al último guardado
          if (isValidSram && (!this.lastSavedHash || currentHash !== this.lastSavedHash)) {
            this.lastSavedHash = currentHash;
            this.hasPlayerSavedInSession = true;
            window._activeRomSaveData = saveData;
            window.saveManager?.saveGameData(
              saveData,
              null,
              true,  // isAutoSave = true
              false, // forceDownload = false
              false, // showPrompt = false
              'autosave_daemon'
            );
          }
        }
      } catch (err) {
        console.warn('Error en daemon de auto-guardado:', err);
      }
    }, 3000);

    // Guardar automáticamente antes de salir o recargar la página
    window.addEventListener('beforeunload', () => {
      if (this.isEmulating && !this.isExiting && window.EJS_emulator?.gameManager) {
        try {
          const gm = window.EJS_emulator.gameManager;
          const saveData = this.extractSaveDataFromGameManager(gm);
          if (saveData && window.saveManager?.isValidSaveBuffer(saveData)) {
            window._activeRomSaveData = saveData;
            window.saveManager.saveGameData(saveData, null, true, false, false, 'unload');
          }
        } catch (e) {}
        this.isExiting = true;
      }
    });

    // Guardar si la app entra en segundo plano (ej. cambiar de app en iOS / minimizar ventana)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.isEmulating && !this.isExiting && window.EJS_emulator?.gameManager) {
        try {
          const gm = window.EJS_emulator.gameManager;
          const saveData = this.extractSaveDataFromGameManager(gm);
          if (saveData && window.saveManager?.isValidSaveBuffer(saveData)) {
            window._activeRomSaveData = saveData;
            window.saveManager.saveGameData(saveData, null, true, false, false, 'visibility_hidden');
          }
        } catch (e) {}
      }
    });
  }

  /**
   * Cambia dinámicamente la velocidad de emulación (1x, 1.5x, 2x, 3x Turbo)
   */
  changeEmulationSpeed(direction) {
    const availableSpeeds = [1.0, 1.5, 2.0, 3.0];
    let currentIndex = availableSpeeds.findIndex(s => Math.abs(s - this.emulationSpeed) < 0.1);
    if (currentIndex === -1) currentIndex = 0;

    let nextIndex = currentIndex + direction;
    if (nextIndex >= availableSpeeds.length) nextIndex = availableSpeeds.length - 1;
    if (nextIndex < 0) nextIndex = 0;

    this.emulationSpeed = availableSpeeds[nextIndex];
    this.applyEmulationSpeed(this.emulationSpeed);
    this.updateSpeedUI();
  }

  /**
   * Cicla la velocidad de emulación (1x -> 1.5x -> 2x -> 3x -> 1x)
   */
  cycleEmulationSpeed() {
    const availableSpeeds = [1.0, 1.5, 2.0, 3.0];
    let currentIndex = availableSpeeds.findIndex(s => Math.abs(s - this.emulationSpeed) < 0.1);
    if (currentIndex === -1) currentIndex = 0;

    let nextIndex = (currentIndex + 1) % availableSpeeds.length;
    this.emulationSpeed = availableSpeeds[nextIndex];
    this.applyEmulationSpeed(this.emulationSpeed);
    this.updateSpeedUI();
  }

  /**
   * Sincroniza todos los elementos UI de velocidad
   */
  updateSpeedUI() {
    const speedFormatted = this.emulationSpeed === 1.0 ? '1x' : `${this.emulationSpeed}x`;

    const speedBadge = document.getElementById('in-game-speed-badge');
    if (speedBadge) {
      speedBadge.textContent = speedFormatted;
      if (this.emulationSpeed > 1.0) {
        speedBadge.classList.add('is-fast');
      } else {
        speedBadge.classList.remove('is-fast');
      }
    }

    const ffBtn = document.getElementById('btn-fast-forward');
    if (ffBtn) {
      ffBtn.innerHTML = `⚡ ${speedFormatted}`;
      if (this.emulationSpeed > 1.0) {
        ffBtn.classList.add('btn-primary');
        ffBtn.classList.remove('btn-ghost');
      } else {
        ffBtn.classList.remove('btn-primary');
        ffBtn.classList.add('btn-ghost');
      }
    }
  }

  /**
   * Aplica la velocidad en el emulador WebAssembly de forma robusta
   */
  applyEmulationSpeed(speed) {
    const isFast = (speed > 1.0);
    const ratio = Number(speed);

    if (window.EJS_emulator && typeof window.EJS_emulator.setSpeed === 'function') {
      try { window.EJS_emulator.setSpeed(ratio); } catch (e) {}
    }

    const gm = window.EJS_emulator?.gameManager;
    if (gm) {
      try {
        if (typeof gm.functions?.setVariable === 'function') {
          gm.functions.setVariable("menu_enable_widgets", "false");
          gm.functions.setVariable("notification_show_fast_forward", "false");
          gm.functions.setVariable("fastforward_notification", "false");
          gm.functions.setVariable("video_font_enable", "false");
          gm.functions.setVariable("fps_show", "false");
          gm.functions.setVariable("video_message_pos_x", "5.0");
          gm.functions.setVariable("video_message_pos_y", "5.0");
          gm.functions.setVariable("video_font_size", "0");
          gm.functions.setVariable("video_msg_bgcolor_opacity", "0.0");
        }

        if (typeof gm.setFastForwardRatio === 'function') {
          gm.setFastForwardRatio(ratio);
        } else if (typeof gm.functions?.setFastForwardRatio === 'function') {
          gm.functions.setFastForwardRatio(ratio);
        }

        if (typeof gm.toggleFastForward === 'function') {
          gm.toggleFastForward(isFast ? 1 : 0);
        } else if (typeof gm.functions?.toggleFastForward === 'function') {
          gm.functions.toggleFastForward(isFast ? 1 : 0);
        }
      } catch (e) {
        console.warn('Error aplicando aceleración en GameManager:', e);
      }
    }

    // Purgar inmediatamente cualquier overlay generado por EmulatorJS
    setTimeout(() => {
      document.querySelectorAll('.ejs_cue, .ejs_cues, .ejs_notification, .ejs_notifications, .ejs_fastforward, .ejs_fast_forward, [class*="ejs_cue"], [class*="ejs_notification"]').forEach(el => el.remove());
      document.querySelectorAll('#game-player div, #game-player span, #game-player p').forEach(el => {
        if (el.tagName !== 'CANVAS' && !el.classList.contains('ejs_parent') && !el.classList.contains('ejs_canvas_parent')) {
          const txt = (el.textContent || '').trim();
          if (txt.includes('Fast-Forward') || txt.includes('Fast Forward') || txt.includes('Fast-forward') || txt.includes('Fast forward')) {
            el.remove();
          }
        }
      });
    }, 10);
  }

  initUI() {
    // 1. Selector de ROM, Actualización GitHub y Drag & Drop
    const fileInput = document.getElementById('rom-file-input');
    const browseBtn = document.getElementById('btn-browse-rom');
    const forceRefreshBtn = document.getElementById('btn-force-git-refresh');
    const welcomeCard = document.getElementById('welcome-card') || document.getElementById('welcome-screen');

    if (forceRefreshBtn) {
      forceRefreshBtn.addEventListener('click', () => this.forceGitRefresh());
    }

    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadRomFiles(e.target.files);
        }
      });
    }

    if (welcomeCard) {
      welcomeCard.addEventListener('dragover', (e) => {
        e.preventDefault();
        welcomeCard.classList.add('drag-over');
      });

      welcomeCard.addEventListener('dragleave', () => {
        welcomeCard.classList.remove('drag-over');
      });

      welcomeCard.addEventListener('drop', (e) => {
        e.preventDefault();
        welcomeCard.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.loadRomFiles(e.dataTransfer.files);
        }
      });
    }

    // Renderizar la lista inicial de ROMs jugadas recientemente
    this.renderRecentRoms();

    // 2. Vinculación de carpeta SoulSilver
    const linkFolderBtn = document.getElementById('btn-link-soulsilver-folder');
    const modalLinkFolderBtn = document.getElementById('btn-modal-choose-folder');
    const handleLink = async () => {
      if (window.saveManager) {
        await window.saveManager.linkSoulSilverFolder();
      }
    };
    if (linkFolderBtn) linkFolderBtn.addEventListener('click', handleLink);
    if (modalLinkFolderBtn) modalLinkFolderBtn.addEventListener('click', handleLink);

    // 3. Cargar / Importar archivo .sav externo
    const loadSavBtn = document.getElementById('btn-load-sav-file');
    const importSavModalBtn = document.getElementById('btn-import-sav-modal');
    const handleImportSav = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.sav,.dsv';
      input.onchange = async (e) => {
        if (e.target.files.length > 0) {
          const file = e.target.files[0];
          const buffer = await file.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          if (window.saveManager) {
            await window.saveManager.saveGameData(uint8, null, false, false, false, 'import');
            window.saveManager.showToast(`✅ Partida importada con éxito: ${file.name}`, 'success');
          }
        }
      };
      input.click();
    };
    if (loadSavBtn) loadSavBtn.addEventListener('click', handleImportSav);
    if (importSavModalBtn) importSavModalBtn.addEventListener('click', handleImportSav);

    // 4. Botones de Guardado y Exportación
    const directSaveBtn = document.getElementById('btn-direct-save');
    if (directSaveBtn) {
      directSaveBtn.addEventListener('click', () => this.triggerSave(false, true));
    }

    const exportSavBtn = document.getElementById('btn-export-sav');
    const exportSavModalBtn = document.getElementById('btn-export-sav-modal');
    const handleExport = () => {
      if (window.saveManager) {
        window.saveManager.exportCurrentSave(this.currentRomName);
      }
    };
    if (exportSavBtn) exportSavBtn.addEventListener('click', handleExport);
    if (exportSavModalBtn) exportSavModalBtn.addEventListener('click', handleExport);

    // 5. Botones de Layout
    const layoutToggleBtn = document.getElementById('btn-layout-toggle');
    if (layoutToggleBtn) {
      layoutToggleBtn.addEventListener('click', () => this.toggleNextLayout());
    }

    const layoutChips = document.querySelectorAll('.layout-chip');
    layoutChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const layout = chip.dataset.layout;
        if (layout) this.setLayout(layout, true);
      });
    });

    // 6. Pantalla completa y controles táctiles
    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    const toggleTouchBtn = document.getElementById('btn-toggle-touch');
    if (toggleTouchBtn) {
      toggleTouchBtn.addEventListener('click', () => {
        if (window.touchControls) {
          const isVis = window.touchControls.toggle();
          if (window.saveManager) {
            window.saveManager.showToast(isVis ? '📱 Controles táctiles activados' : '📱 Controles táctiles ocultados', 'info');
          }
        }
      });
    }

    // --- Modal de Ajustes Generales / En Partida (#settings-modal) ---
    const settingsBtn = document.getElementById('btn-settings');
    const closeSettingsBtn = document.getElementById('btn-close-settings');
    const saveSettingsBtn = document.getElementById('btn-save-settings');

    // 1. Audio y Sonido
    const toggleAudioEnable = document.getElementById('toggle-audio-enable');
    const audioVolumeSlider = document.getElementById('audio-volume-slider');
    const btnUnlockAudioManual = document.getElementById('btn-unlock-audio-manual');

    if (toggleAudioEnable) {
      toggleAudioEnable.checked = !this.audioMuted;
      toggleAudioEnable.addEventListener('change', (e) => {
        this.toggleAudio(e.target.checked, true);
      });
    }

    if (audioVolumeSlider) {
      audioVolumeSlider.value = Math.round(this.audioVolume * 100);
      const updateSliderVal = (e) => {
        const val = parseFloat(e.target.value) / 100;
        this.setAudioVolume(val, e.type === 'change');
      };
      audioVolumeSlider.addEventListener('input', updateSliderVal);
      audioVolumeSlider.addEventListener('change', updateSliderVal);
    }

    if (btnUnlockAudioManual) {
      btnUnlockAudioManual.addEventListener('click', () => this.unlockAudioEngine(true));
    }

    // 2. Velocidad y Núcleo
    const settingsSpeedSelector = document.getElementById('settings-speed-selector');
    const coreSelector = document.getElementById('core-selector');

    if (settingsSpeedSelector) {
      settingsSpeedSelector.value = this.emulationSpeed.toString();
      settingsSpeedSelector.addEventListener('change', (e) => {
        this.emulationSpeed = parseFloat(e.target.value);
        this.applyEmulationSpeed(this.emulationSpeed);
        this.updateSpeedUI();
      });
    }

    if (coreSelector) {
      coreSelector.value = this.selectedCore;
      coreSelector.addEventListener('change', (e) => {
        this.selectedCore = e.target.value;
        localStorage.setItem('nds_core', e.target.value);
        window.saveManager?.showToast(`⚡ Núcleo seleccionado: ${e.target.options[e.target.selectedIndex].text}`, 'info');
      });
    }

    const settingsFrameskipSelector = document.getElementById('settings-frameskip-selector');
    const welcomeFrameskipSelector = document.getElementById('welcome-frameskip-selector');

    const handleFrameskipChange = (e) => {
      this.frameskip = e.target.value;
      localStorage.setItem('nds_frameskip', e.target.value);
      this.applyFrameskip(this.frameskip);
      if (settingsFrameskipSelector) settingsFrameskipSelector.value = this.frameskip;
      if (welcomeFrameskipSelector) welcomeFrameskipSelector.value = this.frameskip;
      window.saveManager?.showToast(`⚡ Salto de cuadros: ${e.target.options[e.target.selectedIndex].text}`, 'info');
    };

    if (settingsFrameskipSelector) {
      settingsFrameskipSelector.value = this.frameskip;
      settingsFrameskipSelector.addEventListener('change', handleFrameskipChange);
    }
    if (welcomeFrameskipSelector) {
      welcomeFrameskipSelector.value = this.frameskip;
      welcomeFrameskipSelector.addEventListener('change', handleFrameskipChange);
    }

    // 3. Pantalla y Filtros
    const settingsLayoutSelector = document.getElementById('settings-layout-selector');
    const settingsFilterSelector = document.getElementById('settings-filter-selector');

    if (settingsLayoutSelector) {
      settingsLayoutSelector.value = this.currentLayout;
      settingsLayoutSelector.addEventListener('change', (e) => {
        this.setLayout(e.target.value, true);
      });
    }

    if (settingsFilterSelector) {
      settingsFilterSelector.value = this.videoFilter;
      settingsFilterSelector.addEventListener('change', (e) => {
        this.applyVideoFilter(e.target.value);
      });
    }

    // 4. Controles Táctiles y Háptica
    const settingsTouchVisibility = document.getElementById('settings-touch-visibility');
    const toggleHapticFeedback = document.getElementById('toggle-haptic-feedback');
    const touchOpacitySlider = document.getElementById('touch-opacity-slider');

    if (settingsTouchVisibility) {
      settingsTouchVisibility.value = this.touchVisibilityMode;
      settingsTouchVisibility.addEventListener('change', (e) => {
        this.touchVisibilityMode = e.target.value;
        localStorage.setItem('nds_touch_mode', e.target.value);
        if (window.touchControls) {
          window.touchControls.userPreference = e.target.value;
          if (e.target.value === 'show') window.touchControls.show();
          else if (e.target.value === 'hide') window.touchControls.hide();
          else if (this.isEmulating) window.touchControls.onGameStart();
        }
      });
    }

    if (toggleHapticFeedback) {
      toggleHapticFeedback.checked = (localStorage.getItem('nds_haptic_enabled') !== 'false');
      toggleHapticFeedback.addEventListener('change', (e) => {
        if (window.touchControls) {
          window.touchControls.hapticEnabled = e.target.checked;
          localStorage.setItem('nds_haptic_enabled', e.target.checked ? 'true' : 'false');
        }
      });
    }

    if (touchOpacitySlider) {
      touchOpacitySlider.value = Math.round(this.touchOpacity * 100);
      const updateOpacity = (e) => {
        const val = parseFloat(e.target.value) / 100;
        this.applyTouchOpacity(val);
      };
      touchOpacitySlider.addEventListener('input', updateOpacity);
      touchOpacitySlider.addEventListener('change', updateOpacity);
    }

    // --- Modal de Configuración en Pantalla de Bienvenida (#welcome-config-modal) ---
    const btnOpenWelcomeConfig = document.getElementById('btn-open-welcome-config');
    const btnCloseWelcomeConfig = document.getElementById('btn-close-welcome-config');
    const btnSaveWelcomeConfig = document.getElementById('btn-save-welcome-config');
    const welcomeSaveModeSelector = document.getElementById('welcome-save-mode-selector');

    if (btnOpenWelcomeConfig) {
      btnOpenWelcomeConfig.addEventListener('click', () => {
        if (welcomeSaveModeSelector && window.saveManager) {
          welcomeSaveModeSelector.value = window.saveManager.saveMode;
        }
        syncPubNubInputs();
        this.toggleWelcomeConfig(true);
      });
    }

    if (btnCloseWelcomeConfig) btnCloseWelcomeConfig.addEventListener('click', () => this.toggleWelcomeConfig(false));
    if (btnSaveWelcomeConfig) btnSaveWelcomeConfig.addEventListener('click', () => this.toggleWelcomeConfig(false));

    if (welcomeSaveModeSelector && window.saveManager) {
      welcomeSaveModeSelector.value = window.saveManager.saveMode;
      welcomeSaveModeSelector.addEventListener('change', (e) => {
        window.saveManager.saveMode = e.target.value;
        localStorage.setItem('nds_save_mode', e.target.value);
        window.saveManager.showToast(`💾 Modo de guardado: ${e.target.options[e.target.selectedIndex].text}`, 'info');
      });
    }

    // Configuración de PubNub Cloud Saves
    const pubKeyInput = document.getElementById('pubnub-pub-input');
    const subKeyInput = document.getElementById('pubnub-sub-input');
    const channelDisplay = document.getElementById('pubnub-channel-display');
    const savePubNubBtn = document.getElementById('btn-save-pubnub-config');
    const testPubNubBtn = document.getElementById('btn-test-pubnub');
    const pubNubResult = document.getElementById('pubnub-test-result');

    const syncPubNubInputs = () => {
      if (window.cloudSaveManager) {
        if (pubKeyInput) pubKeyInput.value = window.cloudSaveManager.publishKey || 'demo';
        if (subKeyInput) subKeyInput.value = window.cloudSaveManager.subscribeKey || 'demo';
        if (channelDisplay) channelDisplay.value = window.cloudSaveManager.getChannelForRom(this.currentRomName);
      }
    };
    syncPubNubInputs();

    if (savePubNubBtn) {
      savePubNubBtn.addEventListener('click', () => {
        if (window.cloudSaveManager) {
          const ok = window.cloudSaveManager.saveCredentials(
            pubKeyInput?.value,
            subKeyInput?.value
          );
          if (pubNubResult) {
            pubNubResult.textContent = ok ? '✅ Claves guardadas' : '⚠️ Error en claves';
            pubNubResult.style.color = ok ? 'var(--color-success)' : 'var(--color-warning)';
          }
          window.saveManager?.showToast('☁️ Configuración de PubNub guardada', 'success');
        }
      });
    }

    if (testPubNubBtn) {
      testPubNubBtn.addEventListener('click', async () => {
        if (pubNubResult) {
          pubNubResult.textContent = '🔄 Probando conexión...';
          pubNubResult.style.color = 'var(--color-primary)';
        }
        if (window.cloudSaveManager) {
          const res = await window.cloudSaveManager.testConnection(
            pubKeyInput?.value,
            subKeyInput?.value
          );
          if (pubNubResult) {
            pubNubResult.textContent = res.success ? '✅ Conexión exitosa' : '❌ Error';
            pubNubResult.style.color = res.success ? 'var(--color-success)' : 'var(--color-error)';
          }
          window.saveManager?.showToast(res.message, res.success ? 'success' : 'error');
        }
      });
    }

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      this.syncSettingsUI();
      this.toggleSettings(true);
    });

    const inGameMenuBtn = document.getElementById('btn-in-game-menu');
    if (inGameMenuBtn) {
      inGameMenuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.syncSettingsUI();
        this.toggleSettings(true);
      });
    }

    const inGameSpeedBadge = document.getElementById('in-game-speed-badge');
    if (inGameSpeedBadge) {
      inGameSpeedBadge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.cycleEmulationSpeed();
      });
    }

    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => this.toggleSettings(false));
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => this.toggleSettings(false));

    // Aplicar estado inicial de vídeo, opacidad y audio
    this.applyVideoFilter(this.videoFilter);
    this.applyTouchOpacity(this.touchOpacity);

    // 7. Controles de Gameplay (Reiniciar ROM y Salir)
    const exitGameBtns = [
      document.getElementById('btn-stop-game'),
      document.getElementById('btn-settings-exit-game'),
      document.getElementById('btn-header-exit-game')
    ];
    exitGameBtns.forEach(btn => {
      if (btn) btn.addEventListener('click', () => this.exitGameToWelcome());
    });

    const restartRomBtns = [
      document.getElementById('btn-restart-rom-bar'),
      document.getElementById('btn-settings-restart-rom'),
      document.getElementById('btn-header-restart-rom')
    ];
    restartRomBtns.forEach(btn => {
      if (btn) btn.addEventListener('click', () => this.restartRom());
    });

    const pauseBtn = document.getElementById('btn-pause-game');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());

    const ffBtn = document.getElementById('btn-fast-forward');
    if (ffBtn) ffBtn.addEventListener('click', () => this.cycleEmulationSpeed());

    const quickSaveBtn = document.getElementById('btn-quick-savestate');
    if (quickSaveBtn) quickSaveBtn.addEventListener('click', () => this.quickSaveState());

    const quickLoadBtn = document.getElementById('btn-quick-loadstate');
    if (quickLoadBtn) quickLoadBtn.addEventListener('click', () => this.quickLoadState());

    // 8. Integración del Lanzador de Juegos y PKHeX Web Studio
    this.initLauncherAndPkhexUI();

    // 9. Integración de la Bóveda de Partidas (Backup Vault)
    this.initVaultUI();

    // 10. Desbloqueo de Audio Safari en el primer toque
    const unlockAudio = () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    // 10. Enrutador global de teclado físico
    const keyboardKeyMap = {
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right',
      'z': 'a', 'Z': 'a',
      'x': 'b', 'X': 'b',
      'a': 'x', 'A': 'x',
      's': 'y', 'S': 'y',
      'q': 'l', 'Q': 'l',
      'e': 'r', 'E': 'r',
      'Enter': 'start',
      'v': 'select', 'V': 'select',
      'Shift': 'select'
    };

    const handleKey = (e, isDown) => {
      if (!e.isTrusted) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      if (!this.isEmulating) return;

      const inputName = keyboardKeyMap[e.key];
      if (inputName && window.gamepadController) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
          e.preventDefault();
        }
        window.gamepadController.dispatchKey(inputName, isDown);
      }
    };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      handleKey(e, true);
    });

    window.addEventListener('keyup', (e) => {
      handleKey(e, false);
    });

    // 11. Escucha de orientación y resolución adaptativa
    const handleResizeOrRotate = () => {
      this.deviceInfo = this.detectDevice();
      const isPortraitNow = window.innerHeight > window.innerWidth;
      
      if ((this.deviceInfo.isMobile || this.deviceInfo.isIOS) && !this.userExplicitLayoutChoice) {
        const targetLayout = isPortraitNow ? 'layout-vertical' : 'layout-horizontal';
        if (this.currentLayout !== targetLayout) {
          this.setLayout(targetLayout);
        }
      }
      this.updateDeviceStatusBadge();
    };

    window.addEventListener('resize', handleResizeOrRotate);
    window.addEventListener('orientationchange', () => setTimeout(handleResizeOrRotate, 150));
    this.updateDeviceStatusBadge();
  }

  /**
   * Inicializa la interfaz y eventos del Lanzador de Juego y de PKHeX Web Studio
   */
  initLauncherAndPkhexUI() {
    // 1. Botón PKHeX en cabecera principal
    const headerPkhexBtn = document.getElementById('btn-header-pkhex');
    if (headerPkhexBtn) {
      headerPkhexBtn.addEventListener('click', () => {
        const activeName = this.pendingLaunchRom?.name || this.currentRomName || 'Pokemon - Edicion Plata SoulSilver.nds';
        this.openPkhexStudio(activeName, this.pendingLaunchRom?.blob || this.currentRomBlob);
      });
    }

    // 2. Eventos del Modal de Lanzamiento (#game-launcher-modal)
    const btnCloseLauncher = document.getElementById('btn-close-launcher');
    const btnCancelLauncher = document.getElementById('btn-launcher-cancel');
    const btnLauncherStartGame = document.getElementById('btn-launcher-start-game');
    const btnLauncherOpenPkhex = document.getElementById('btn-launcher-open-pkhex');
    const btnLauncherOpenVault = document.getElementById('btn-launcher-open-vault');
    const btnLauncherExportSav = document.getElementById('btn-launcher-export-sav');
    const btnLauncherImportSav = document.getElementById('btn-launcher-import-sav');
    const launcherSavInput = document.getElementById('launcher-sav-input');

    if (btnCloseLauncher) btnCloseLauncher.addEventListener('click', () => this.closeGameLauncher());
    if (btnCancelLauncher) btnCancelLauncher.addEventListener('click', () => this.closeGameLauncher());

    if (btnLauncherStartGame) {
      btnLauncherStartGame.addEventListener('click', async () => {
        this.closeGameLauncher();
        const rom = this.pendingLaunchRom;
        if (rom && (rom.blob || rom.file)) {
          await this.startEmulator(rom.blob || rom.file, rom.name);
        } else if (this.currentRomBlob) {
          await this.startEmulator(this.currentRomBlob, this.currentRomName);
        }
      });
    }

    if (btnLauncherOpenPkhex) {
      btnLauncherOpenPkhex.addEventListener('click', () => {
        const rom = this.pendingLaunchRom;
        this.openPkhexStudio(rom?.name, rom?.blob);
      });
    }

    if (btnLauncherOpenVault) {
      btnLauncherOpenVault.addEventListener('click', () => {
        this.closeGameLauncher();
        this.toggleVaultModal(true);
      });
    }

    if (btnLauncherExportSav) {
      btnLauncherExportSav.addEventListener('click', async () => {
        const romName = this.pendingLaunchRom?.name || this.currentRomName;
        if (window.saveManager) {
          await window.saveManager.exportSavFileDirect(romName);
        }
      });
    }

    if (btnLauncherImportSav && launcherSavInput) {
      btnLauncherImportSav.addEventListener('click', () => launcherSavInput.click());
      launcherSavInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
          const file = e.target.files[0];
          const romName = this.pendingLaunchRom?.name || this.currentRomName;
          await this.handlePkhexSaveImport(file);
          // Refrescar el estado del modal
          await this.openGameLauncher(this.pendingLaunchRom?.file, romName, this.pendingLaunchRom?.blob);
        }
      });
    }

    // 3. Eventos del Modal PKHeX Studio (#pkhex-modal)
    const btnClosePkhex = document.getElementById('btn-close-pkhex');
    const btnPkhexFullscreen = document.getElementById('btn-pkhex-toggle-fullscreen');
    const btnPkhexDownloadSav = document.getElementById('btn-pkhex-download-sav');
    const pkhexEngineSelect = document.getElementById('pkhex-engine-select');
    const pkhexDropzone = document.getElementById('pkhex-sav-dropzone');
    const pkhexSavFileInput = document.getElementById('pkhex-sav-file-input');
    const btnPkhexPlayGame = document.getElementById('btn-pkhex-play-game');

    if (btnClosePkhex) btnClosePkhex.addEventListener('click', () => this.closePkhexStudio());
    if (btnPkhexFullscreen) btnPkhexFullscreen.addEventListener('click', () => this.togglePkhexFullscreen());

    if (btnPkhexDownloadSav) {
      btnPkhexDownloadSav.addEventListener('click', async () => {
        const romName = this.activePkhexRom || this.pendingLaunchRom?.name || this.currentRomName;
        if (window.saveManager) {
          await window.saveManager.exportSavFileDirect(romName);
          window.saveManager.showToast(`📥 Partida descargada. Ábrela en PKHeX abajo ("Open...").`, 'info');
        }
      });
    }

    if (pkhexEngineSelect) {
      pkhexEngineSelect.addEventListener('change', (e) => {
        this.pkhexEngine = e.target.value;
        localStorage.setItem('nds_pkhex_engine', e.target.value);
        const iframe = document.getElementById('pkhex-iframe');
        const loader = document.getElementById('pkhex-frame-loading');
        if (iframe) {
          if (loader) loader.classList.remove('hidden');
          iframe.src = this.pkhexEngine;
        }
      });
    }

    if (pkhexDropzone && pkhexSavFileInput) {
      pkhexDropzone.addEventListener('click', () => pkhexSavFileInput.click());
      pkhexSavFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handlePkhexSaveImport(e.target.files[0]);
        }
      });

      pkhexDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        pkhexDropzone.classList.add('drag-over');
      });

      pkhexDropzone.addEventListener('dragleave', () => {
        pkhexDropzone.classList.remove('drag-over');
      });

      pkhexDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        pkhexDropzone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.handlePkhexSaveImport(e.dataTransfer.files[0]);
        }
      });
    }

    if (btnPkhexPlayGame) {
      btnPkhexPlayGame.addEventListener('click', async () => {
        this.closePkhexStudio();
        const rom = this.pendingLaunchRom;
        const romName = this.activePkhexRom || rom?.name || this.currentRomName;
        const romBlob = rom?.blob || this.currentRomBlob;
        if (romBlob) {
          await this.startEmulator(romBlob, romName);
        }
      });
    }
  }

  /**
   * Abre el Modal de Lanzamiento y Preparación de Juego antes de arrancar
   */
  async openGameLauncher(romFile, romName, romBlob) {
    const finalName = romName || (romFile ? romFile.name : (this.currentRomName || 'Pokemon - Edicion Plata SoulSilver.nds'));
    
    let finalBlob = romBlob || romFile;
    if (!finalBlob && romFile) finalBlob = romFile;
    if (!finalBlob && this.currentRomBlob) finalBlob = this.currentRomBlob;

    this.pendingLaunchRom = {
      file: romFile,
      name: finalName,
      blob: finalBlob
    };
    this.currentRomName = finalName;
    if (finalBlob) this.currentRomBlob = finalBlob;

    if (window.saveManager) {
      window.saveManager.currentRomName = finalName;
    }

    const modal = document.getElementById('game-launcher-modal');
    const titleEl = document.getElementById('launcher-game-title');
    const filenameEl = document.getElementById('launcher-rom-filename');
    const sizeEl = document.getElementById('launcher-rom-size');
    const statusTextEl = document.getElementById('launcher-save-status-text');
    const pillEl = document.getElementById('launcher-save-pill');
    const locEl = document.getElementById('launcher-save-location');
    const timeEl = document.getElementById('launcher-save-time');
    const saveSizeEl = document.getElementById('launcher-save-size');
    const cloudEl = document.getElementById('launcher-save-cloud');

    const cleanTitle = finalName.replace(/\.(nds|zip|7z)$/i, '');
    if (titleEl) titleEl.textContent = cleanTitle;
    if (filenameEl) filenameEl.textContent = finalName;

    if (finalBlob && finalBlob.size) {
      if (sizeEl) sizeEl.textContent = this.formatFileSize(finalBlob.size);
    } else if (sizeEl) {
      sizeEl.textContent = 'NDS ROM';
    }

    // Consultar estado de la partida vinculada
    if (window.saveManager) {
      const info = await window.saveManager.getSaveFileInfo(finalName);
      
      if (info.exists) {
        if (statusTextEl) statusTextEl.textContent = `Partida lista: ${info.filename}`;
        if (pillEl) {
          pillEl.textContent = 'Guardada';
          pillEl.className = 'save-status-pill';
        }
        if (timeEl) timeEl.textContent = info.timeFormatted;
        if (saveSizeEl) saveSizeEl.textContent = info.sizeFormatted;
        if (locEl) locEl.textContent = info.location;
        if (cloudEl) cloudEl.textContent = '🟢 Respaldo listo';
      } else {
        if (statusTextEl) statusTextEl.textContent = 'Partida nueva (Aún sin guardado registrado)';
        if (pillEl) {
          pillEl.textContent = 'Nueva';
          pillEl.className = 'save-status-pill pill-new';
        }
        if (timeEl) timeEl.textContent = 'Al guardar en juego';
        if (saveSizeEl) saveSizeEl.textContent = '512 KB';
        if (locEl) locEl.textContent = 'Sin guardar';
        if (cloudEl) cloudEl.textContent = '⚪ Pendiente';
      }
    }

    if (modal) {
      modal.style.display = 'flex';
    }
  }

  /**
   * Cierra el modal de lanzamiento de juego
   */
  closeGameLauncher() {
    const modal = document.getElementById('game-launcher-modal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Abre la suite integrada de PKHeX Web Studio
   */
  async openPkhexStudio(romName, romBlob) {
    const finalName = romName || this.pendingLaunchRom?.name || this.currentRomName || 'Pokemon - Edicion Plata SoulSilver.nds';
    this.activePkhexRom = finalName;
    this.currentRomName = finalName;
    if (romBlob) this.currentRomBlob = romBlob;

    if (window.saveManager) {
      window.saveManager.currentRomName = finalName;
    }

    const modal = document.getElementById('pkhex-modal');
    const badgeEl = document.getElementById('pkhex-active-rom-badge');
    const iframe = document.getElementById('pkhex-iframe');
    const loader = document.getElementById('pkhex-frame-loading');
    const engineSelect = document.getElementById('pkhex-engine-select');

    const baseName = window.saveManager ? window.saveManager.sanitizeName(finalName) : 'game';
    if (badgeEl) badgeEl.textContent = `${baseName}.sav`;

    const targetUrl = this.pkhexEngine || 'https://pkhex-web.github.io';
    if (engineSelect) engineSelect.value = targetUrl;

    if (iframe) {
      if (loader) loader.classList.remove('hidden');
      if (iframe.src !== targetUrl) {
        iframe.src = targetUrl;
        iframe.onload = () => {
          if (loader) loader.classList.add('hidden');
        };
      } else {
        if (loader) setTimeout(() => loader.classList.add('hidden'), 400);
      }
    }

    // Cerrar launcher si estaba abierto
    this.closeGameLauncher();

    if (modal) {
      modal.style.display = 'flex';
    }

    if (window.saveManager) {
      window.saveManager.showToast(`💉 PKHeX Studio abierto para: ${baseName}.sav`, 'info');
    }
  }

  /**
   * Cierra el modal de PKHeX Studio
   */
  closePkhexStudio() {
    const modal = document.getElementById('pkhex-modal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Alterna la pantalla completa para el modal de PKHeX Studio
   */
  togglePkhexFullscreen() {
    const content = document.querySelector('.pkhex-modal-content');
    if (content) {
      content.classList.toggle('is-fullscreen');
      this.isPkhexFullscreen = content.classList.contains('is-fullscreen');
    }
  }

  /**
   * Procesa la importación de un guardado editado en PKHeX (soltado o seleccionado)
   */
  async handlePkhexSaveImport(fileOrBuffer) {
    if (!fileOrBuffer) return;
    const romName = this.activePkhexRom || this.pendingLaunchRom?.name || this.currentRomName;
    const dropzone = document.getElementById('pkhex-sav-dropzone');
    const label = document.getElementById('pkhex-dropzone-label');
    const baseName = window.saveManager ? window.saveManager.sanitizeName(romName) : 'game';

    try {
      let uint8;
      let fname = `${baseName}.sav`;

      if (fileOrBuffer instanceof File || fileOrBuffer instanceof Blob) {
        fname = fileOrBuffer.name || fname;
        const ab = await fileOrBuffer.arrayBuffer();
        uint8 = new Uint8Array(ab);
      } else if (fileOrBuffer instanceof Uint8Array) {
        uint8 = fileOrBuffer;
      } else if (fileOrBuffer instanceof ArrayBuffer) {
        uint8 = new Uint8Array(fileOrBuffer);
      }

      if (window.saveManager && uint8) {
        const ok = await window.saveManager.importPkhexEditedSave(romName, uint8);
        if (ok) {
          if (dropzone) {
            dropzone.classList.add('success-flash');
            setTimeout(() => dropzone.classList.remove('success-flash'), 2000);
          }
          if (label) {
            label.innerHTML = `<strong>✅ ¡${fname} inyectado!</strong> (${(uint8.byteLength/1024).toFixed(0)} KB) Listo para jugar`;
          }
          const pillEl = document.getElementById('launcher-save-pill');
          if (pillEl) {
            pillEl.textContent = 'Editado PKHeX';
            pillEl.className = 'save-status-pill pill-pkhex';
          }
        }
      }
    } catch (err) {
      console.error('Error procesando save de PKHeX:', err);
      alert('Error al leer el archivo de guardado editado.');
    }
  }

  /**
   * Inicializa la interfaz y eventos del modal de Gestión de Partida y Respaldo
   */
  initVaultUI() {
    const openVaultBtns = document.querySelectorAll('.btn-open-vault, #btn-open-vault, #btn-open-vault-welcome, #btn-open-vault-settings');
    const closeVaultBtn = document.getElementById('btn-close-vault');
    const exportSavBtn = document.getElementById('btn-vault-export-sav');
    const importSavBtn = document.getElementById('btn-vault-import-sav');
    const forceUploadBtn = document.getElementById('btn-vault-force-upload');
    const forceDownloadBtn = document.getElementById('btn-vault-force-download');
    const deleteSaveBtn = document.getElementById('btn-vault-delete-save');

    openVaultBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleVaultModal(true);
      });
    });

    if (closeVaultBtn) closeVaultBtn.addEventListener('click', () => this.toggleVaultModal(false));

    if (exportSavBtn) {
      exportSavBtn.addEventListener('click', () => {
        window.saveManager?.exportCurrentSave(this.currentRomName);
      });
    }

    if (importSavBtn) {
      importSavBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.sav,.dsv,.srm';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (file && window.saveManager) {
            const buf = await file.arrayBuffer();
            await window.saveManager.saveGameData(new Uint8Array(buf), null, false, false, false, 'import');
            await this.renderVaultUI();
            window.saveManager.showToast(`📥 Partida "${file.name}" importada con éxito.`, 'success');
          }
        };
        input.click();
      });
    }

    if (forceUploadBtn) {
      forceUploadBtn.addEventListener('click', async () => {
        if (window.cloudSaveManager) {
          const ok = await window.cloudSaveManager.forceCloudUpload(this.currentRomName);
          if (ok) await this.renderVaultUI();
        }
      });
    }

    if (forceDownloadBtn) {
      forceDownloadBtn.addEventListener('click', async () => {
        if (confirm('¿Restaurar la partida desde el respaldo de la Nube?\n\nEsto reemplazará la partida local de tu dispositivo.')) {
          if (window.cloudSaveManager) {
            const ok = await window.cloudSaveManager.forceCloudDownload(this.currentRomName);
            if (ok) await this.renderVaultUI();
          }
        }
      });
    }

    if (deleteSaveBtn) {
      deleteSaveBtn.addEventListener('click', async () => {
        if (confirm(`¿Estás seguro de que deseas eliminar la partida guardada de "${this.currentRomName}"?\n\nEsta acción reiniciará tu partida a 0.`)) {
          await window.saveManager?.deleteSave(this.currentRomName);
          await this.renderVaultUI();
        }
      });
    }
  }

  /**
   * Abre o cierra el modal de Gestión de Partida
   */
  async toggleVaultModal(open) {
    const modal = document.getElementById('vault-modal');
    if (!modal) return;

    if (open) {
      await this.renderVaultUI();
      modal.style.display = 'flex';
    } else {
      modal.style.display = 'none';
    }
  }

  /**
   * Renderiza el contenido del modal de Gestión de Partida
   */
  async renderVaultUI() {
    if (!window.saveManager) return;
    const baseName = window.saveManager.sanitizeName(this.currentRomName);

    // 1. Cabecera y Título
    const titleEl = document.getElementById('vault-game-title');
    if (titleEl) titleEl.textContent = this.currentRomName || 'Pokemon - Edicion Plata SoulSilver';

    // 2. Estado Local
    const localRecord = await window.saveManager.getLocalSaveRecord(baseName);
    const localStatusEl = document.getElementById('vault-local-status');
    if (localStatusEl) {
      if (localRecord && localRecord.data) {
        const timeStr = this.formatTimeAgo(localRecord.timestamp);
        const sizeStr = `${(localRecord.data.byteLength / 1024).toFixed(0)} KB`;
        localStatusEl.innerHTML = `<span style="color: var(--color-success);">🟢 Guardada</span> (${sizeStr} • ${timeStr})`;
      } else {
        localStatusEl.innerHTML = `<span style="color: var(--text-muted);">⚪ Sin partida guardada aún</span>`;
      }
    }

    // 3. Estado Nube
    const cloudStatusEl = document.getElementById('vault-cloud-status');
    if (cloudStatusEl && window.cloudSaveManager) {
      const channel = window.cloudSaveManager.getChannelForRom(this.currentRomName);
      cloudStatusEl.innerHTML = `<span style="color: var(--color-primary);">☁️ Activo</span> (Canal: <code>${channel}</code>)`;
    }
  }

  /**
   * Actualiza la etiqueta informativa de dispositivo y modo en la barra superior
   */
  updateDeviceStatusBadge() {
    const badge = document.getElementById('device-status-badge');
    if (badge) {
      const modeText = this.currentLayout === 'layout-vertical' ? 'Vertical' : 'Horizontal';
      badge.textContent = `${this.deviceInfo.isIOS ? '🍎' : (this.deviceInfo.isHandheld ? '🎮' : '💻')} ${this.deviceInfo.name} (${modeText})`;
    }
  }

  /**
   * Fuerza la actualización inmediata desde GitHub limpiando Service Workers y cachés
   */
  async forceGitRefresh() {
    if (window.saveManager) {
      window.saveManager.showToast('🔄 Purgando caché y descargando última versión de GitHub...', 'info');
    }
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let reg of registrations) {
          await reg.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (err) {
      console.warn('Error purgando caché:', err);
    }
    setTimeout(() => {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.location.href = cleanUrl + '?refresh=' + Date.now();
    }, 350);
  }

  /**
   * Carga uno o varios archivos seleccionados (ROM .nds y/o partida .sav previa)
   */
  async loadRomFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    let romFile = files.find(f => {
      const n = (f.name || '').toLowerCase();
      return n.endsWith('.nds') || n.endsWith('.zip') || n.endsWith('.7z') || f.name.match(/\.(nds|zip|7z)$/i);
    });

    let savFile = files.find(f => {
      const n = (f.name || '').toLowerCase();
      return n.endsWith('.sav') || n.endsWith('.dsv') || f.name.match(/\.(sav|dsv)$/i);
    });

    if (!romFile && files.length === 1 && !savFile) {
      romFile = files[0];
      console.log('Asumiendo archivo único como ROM NDS:', romFile.name);
    }

    if (savFile && window.saveManager) {
      try {
        const buffer = await savFile.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        await window.saveManager.saveGameData(uint8, null, false, false, false, 'import');
        window.saveManager.showToast(`💾 Partida (.sav) vinculada: ${savFile.name}`, 'info');
      } catch (err) {
        console.error('Error leyendo .sav adjunto:', err);
      }
    }

    if (romFile) {
      this.currentRomName = romFile.name;
      this.currentRomBlob = romFile;
      if (window.saveManager) {
        window.saveManager.currentRomName = romFile.name;
        await window.saveManager.saveRom(romFile);
        this.renderRecentRoms();
      }
      await this.openGameLauncher(romFile, romFile.name, romFile);
    } else if (!savFile) {
      alert('Por favor, selecciona un archivo de Nintendo DS válido (.nds, .zip o .7z)');
    }
  }

  async loadRomFile(file) {
    await this.loadRomFiles([file]);
  }

  /**
   * Escribe el buffer de guardado en todas las rutas posibles del FS virtual de RetroArch / EmulatorJS (.sav y .srm)
   */
  injectSaveFilesToFS(fs, saveData, romName) {
    if (!fs || !saveData || saveData.byteLength === 0) return false;
    const uint8 = saveData instanceof Uint8Array ? saveData : new Uint8Array(saveData);
    const baseName = window.saveManager ? window.saveManager.sanitizeName(romName || this.currentRomName) : 'game';
    const cleanRom = (romName || this.currentRomName || '').replace(/\.(nds|zip|7z)$/i, '');
    const romFullName = (romName || this.currentRomName || '');

    const dirs = [
      '/data',
      '/data/saves',
      '/home',
      '/home/web_user',
      '/home/web_user/.config',
      '/home/web_user/.config/retroarch',
      '/home/web_user/.config/retroarch/saves',
      '/home/web_user/retroarch',
      '/home/web_user/retroarch/userdata',
      '/home/web_user/retroarch/userdata/saves',
      '/saves'
    ];

    dirs.forEach(d => {
      try {
        if (!fs.analyzePath(d).exists) {
          if (typeof fs.mkdirTree === 'function') fs.mkdirTree(d);
          else if (typeof fs.mkdir === 'function') fs.mkdir(d);
        }
      } catch (e) {}
    });

    const targetPaths = [
      // 1. Ubicaciones canónicas (/data/saves)
      `/data/saves/${baseName}.srm`,
      `/data/saves/${baseName}.sav`,
      `/data/saves/${baseName}.dsv`,
      `/data/saves/${cleanRom}.srm`,
      `/data/saves/${cleanRom}.sav`,
      `/data/saves/${cleanRom}.nds.srm`,
      `/data/saves/${cleanRom}.nds.sav`,
      `/data/saves/${romFullName}.srm`,
      `/data/saves/${romFullName}.sav`,
      `/data/saves/game.srm`,
      `/data/saves/game.sav`,
      `/data/saves/game.dsv`,

      // 2. Raíz (por si RetroArch busca relativo a la ROM en /)
      `/${baseName}.srm`,
      `/${baseName}.sav`,
      `/${baseName}.dsv`,
      `/${cleanRom}.srm`,
      `/${cleanRom}.sav`,
      `/${cleanRom}.nds.srm`,
      `/${cleanRom}.nds.sav`,
      `/${romFullName}.srm`,
      `/${romFullName}.sav`,
      `/game.srm`,
      `/game.sav`,
      `/game.dsv`,

      // 3. Rutas de usuario de RetroArch
      `/home/web_user/.config/retroarch/saves/${baseName}.srm`,
      `/home/web_user/.config/retroarch/saves/${baseName}.sav`,
      `/home/web_user/retroarch/userdata/saves/${baseName}.srm`,
      `/home/web_user/retroarch/userdata/saves/${baseName}.sav`,
      `/home/web_user/retroarch/userdata/saves/${cleanRom}.srm`,
      `/home/web_user/retroarch/userdata/saves/game.srm`,
      `/home/web_user/retroarch/userdata/saves/game.sav`,
      `/saves/${baseName}.srm`,
      `/saves/${baseName}.sav`,
      `/saves/game.srm`,
      `/saves/game.sav`
    ];

    for (const p of targetPaths) {
      try {
        if (fs.analyzePath(p).exists) fs.unlink(p);
        fs.writeFile(p, uint8);
      } catch (e) {}
    }

    console.log(`[Save Injection] Inyectados ${uint8.byteLength} bytes en rutas de RetroArch (${targetPaths.length} ubicaciones).`);
    return true;
  }

  /**
   * Inicializa el núcleo WASM con la ROM proporcionada
   */
  async startEmulator(file, customRomName) {
    this.closeGameLauncher();
    this.closePkhexStudio();

    if (customRomName) {
      this.currentRomName = customRomName;
    } else if (file && file.name) {
      this.currentRomName = file.name;
    } else if (!this.currentRomName) {
      this.currentRomName = 'Pokemon - Edicion Plata SoulSilver.nds';
    }

    if (!this.currentRomName.match(/\.(nds|zip|7z)$/i)) {
      this.currentRomName += '.nds';
    }

    if (window.saveManager) {
      window.saveManager.currentRomName = this.currentRomName;
    }

    // Pre-cargar la partida existente en memoria antes de instanciar EmulatorJS
    let preloadedSave = null;
    if (window.saveManager) {
      preloadedSave = await window.saveManager.loadExistingSave(this.currentRomName);
      window._activeRomSaveData = preloadedSave;
      console.log(`[Pre-Boot] Partida precargada para ${this.currentRomName}:`, preloadedSave ? `${preloadedSave.byteLength} bytes` : 'Ninguna');
    }

    const welcomeScreen = document.getElementById('welcome-screen');
    const emulatorContainer = document.getElementById('emulator-container');
    const gamePlayer = document.getElementById('game-player');
    const appEl = document.getElementById('app');

    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (emulatorContainer) emulatorContainer.style.display = 'flex';

    const topHeader = document.querySelector('.top-header');
    const bottomBar = document.querySelector('.bottom-bar');
    if (topHeader) topHeader.style.setProperty('display', 'none', 'important');
    if (bottomBar) bottomBar.style.setProperty('display', 'none', 'important');

    document.documentElement.classList.add('is-emulating');
    document.body.classList.add('is-emulating');
    if (appEl) appEl.classList.add('is-emulating');
    this.isEmulating = true;
    this.isExiting = false;
    this.hasPlayerSavedInSession = false;
    this.lastSavedHash = preloadedSave ? this.computeSaveHash(preloadedSave) : null;

    if (window.touchControls && typeof window.touchControls.onGameStart === 'function') {
      window.touchControls.onGameStart();
    }

    gamePlayer.innerHTML = '';

    let romBlob = file;
    if (!(romBlob instanceof Blob) && !(romBlob instanceof File)) {
      romBlob = new Blob([file], { type: 'application/octet-stream' });
    }
    const romUrl = URL.createObjectURL(romBlob);
    const isVertical = (this.currentLayout === 'layout-vertical');
    const baseName = window.saveManager ? window.saveManager.sanitizeName(this.currentRomName) : 'game';

    window.EJS_loadStateURL = null;
    window.EJS_loadState = null;
    window.EJS_externalFiles = null;

    window.EJS_disableCue = true;
    window.EJS_cues = false;
    window.EJS_screenCapture = false;
    window.EJS_Buttons = false;
    window.EJS_buttons = {
      playPause: false, play: false, pause: false, restart: false, mute: false,
      unmute: false, settings: false, fullscreen: false, enterFullscreen: false,
      exitFullscreen: false, saveState: false, loadState: false, screenRecord: false,
      gamepad: false, cheat: false, volumeSlider: false, saveSavFiles: false,
      loadSavFiles: false, quickSave: false, quickLoad: false, screenshot: false,
      cacheManager: false, exitEmulation: false, netplay: false, diskButton: false,
      contextMenu: false
    };
    window.EJS_buttonOpts = window.EJS_buttons;
    window.EJS_hideSettings = true;
    window.EJS_noAutoFocus = false;
    window.EJS_pauseOnUnfocus = false;
    window.EJS_watermark = false;
    window.EJS_disableMenu = true;
    window.EJS_VirtualGamepadSettings = { disabled: true };

    const loadingOverlay = document.getElementById('emulator-loading-overlay');
    const loadingStatus = document.getElementById('emulator-loading-status');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (loadingStatus) loadingStatus.textContent = `Cargando ${this.currentRomName}...`;

    clearTimeout(this.loadingSafetyTimeout);
    this.loadingSafetyTimeout = setTimeout(() => {
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }, 4500);

    const checkCanvasInterval = setInterval(() => {
      const cvs = document.querySelector('#game-player canvas');
      if (cvs) {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
        clearInterval(checkCanvasInterval);
      }
    }, 300);
    setTimeout(() => clearInterval(checkCanvasInterval), 10000);

    window.EJS_player = '#game-player';
    window.EJS_core = this.selectedCore;
    window.EJS_gameName = this.currentRomName;
    window.EJS_gameUrl = romUrl;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoad = true;
    window.EJS_startOnLoaded = true;
    window.EJS_startButtonName = "Iniciar";
    window.EJS_startBtnName = "Iniciar";
    window.EJS_disableAutoLang = false;
    window.EJS_language = "en-US";
    window.EJS_backgroundColor = '#000000';
    
    window.EJS_retroarchOpts = [
      { name: "menu_enable_widgets", default: "false", isString: false },
      { name: "menu_widget_scale_auto", default: "false", isString: false },
      { name: "menu_widget_scale_factor", default: "0.0", isString: false },
      { name: "video_font_enable", default: "false", isString: false },
      { name: "notification_show_fast_forward", default: "false", isString: false },
      { name: "fastforward_notification", default: "false", isString: false },
      { name: "fps_show", default: "false", isString: false },
      { name: "video_msg_bgcolor_opacity", default: "0.0", isString: false },
      { name: "video_msg_color", default: "0", isString: false },
      { name: "video_font_size", default: "0.0", isString: false },
      { name: "video_message_pos_x", default: "5.0", isString: false },
      { name: "video_message_pos_y", default: "5.0", isString: false }
    ];

    window.EJS_defaultOptions = {
      "menu_enable_widgets": "false",
      "menu_widget_scale_auto": "false",
      "notification_show_fast_forward": "false",
      "video_font_enable": "false",
      "fps_show": "false",
      "video_font_size": "0",
      "video_message_pos_x": "5.0",
      "video_message_pos_y": "5.0",
      "video_msg_bgcolor_opacity": "0.0",
      "desmume_screens_layout": isVertical ? "top/bottom" : "left/right",
      "desmume_pointer_type": "touch",
      "desmume_pointer_device": "touch",
      "desmume_pointer_device_l": "touch",
      "desmume_pointer_device_r": "touch",
      "desmume_touch_mode": "touch",
      "desmume_pointer_mode": "relative",
      "desmume_pointer_colour": "white",
      "desmume_advanced_timing": "disabled",
      "desmume_internal_resolution": "256x192",
      "desmume_opengl_mode": "disabled",
      "desmume_spu_interpolation": "linear",
      "desmume_cpu_mode": "jit",
      "desmume_frameskip": "0",
      "melonds_touch_mode": "touch",
      "melonds_screen_layout": isVertical ? "Top/Bottom" : "Horizontal",
      "melonds_screens_layout": isVertical ? "top/bottom" : "left/right",
      "melonds_threaded_renderer": "enabled",
      "melonds_jit_enable": "enabled",
      "melonds_audio_interpolation": "none"
    };

    window.EJS_VirtualGamepadSettings = { disabled: true };
    
    window.EJS_Settings = {
      default_controls: true,
      volume: this.audioMuted ? 0.0 : this.audioVolume,
      audio_latency: 128,
      video_vsync: true,
      video_smooth: (this.videoFilter === 'smooth'),
      video_threaded: true,
      video_font_enable: false,
      notification_show_fast_forward: false,
      menu_enable_widgets: false
    };

    const buildOsdSuppressedCfg = () => {
      return [
        'savefile_directory = "/data/saves"',
        'savestate_directory = "/data/saves"',
        'block_sram_overwrite = false',
        'autosave_interval = 10',
        'screenshot_directory = "/"',
        'video_gpu_screenshot = false',
        'audio_latency = 64',
        'video_top_portrait_viewport = true',
        'video_vsync = true',
        'video_smooth = false',
        'fastforward_ratio = 3.0',
        'slowmotion_ratio = 3.0',
        'notification_show_fast_forward = false',
        'menu_enable_widgets = false',
        'widgets_enable = false',
        'video_font_enable = false',
        'fps_show = false',
        'menu_widget_scale_auto = false',
        'menu_widget_scale_factor = 0.0',
        'video_msg_bgcolor_opacity = 0.0',
        'video_msg_color = 0',
        'video_font_size = 0.0',
        'video_message_pos_x = 5.0',
        'video_message_pos_y = 5.0',
        'video_font_path = ""',
        'fastforward_notification = false',
        'notification_show_autoconfig = false',
        'notification_show_cheats = false',
        'notification_show_config_override_load = false',
        'notification_show_remap_load = false',
        'notification_show_patch_applied = false',
        'notification_show_refresh_rate = false',
        'notification_show_save_state = false',
        'notification_show_screenshot = false',
        'notification_show_set_initial_disk = false',
        'notification_show_when_menu_is_alive = false'
      ].join('\n') + '\n';
    };

    const injectConfigsToFS = (fs) => {
      if (!fs) return;
      const cfgContent = buildOsdSuppressedCfg();
      const paths = [
        '/retroarch.cfg',
        '/etc/retroarch.cfg',
        '/home/web_user/.config/retroarch/retroarch.cfg',
        '/home/web_user/.retroarch.cfg',
        '/home/web_user/retroarch/userdata/config/retroarch.cfg',
        '/home/web_user/retroarch.cfg',
        '/data/retroarch.cfg'
      ];
      for (const p of paths) {
        try {
          const lastSlash = p.lastIndexOf('/');
          const dir = p.substring(0, lastSlash);
          if (dir && !fs.analyzePath(dir).exists) {
            if (typeof fs.mkdirTree === 'function') fs.mkdirTree(dir);
            else if (typeof fs.mkdir === 'function') fs.mkdir(dir);
          }
          fs.writeFile(p, cfgContent);
        } catch (e) {}
      }
    };

    // Hook de inicialización para inyectar configuración e inyección pre-boot de guardado
    window.EJS_ready = () => {
      if (window.EJS_emulator) {
        // 1. Escuchar cuando IDBFS termine de montarse en /data/saves
        window.EJS_emulator.on("saveDatabaseLoaded", (fs) => {
          console.log('⚡ [Event: saveDatabaseLoaded] IDBFS montado. Inyectando partida previa...');
          const activeFS = fs || window.EJS_emulator?.gameManager?.FS;
          if (window._activeRomSaveData && activeFS) {
            this.injectSaveFilesToFS(activeFS, window._activeRomSaveData, this.currentRomName);
          }
        });

        // 2. Escuchar evento directo de guardado emitido por GameManager
        window.EJS_emulator.on("saveSaveFiles", (data) => {
          if (this.isExiting) {
            console.log('🛡️ [Event: saveSaveFiles] Omitido durante la secuencia de salida/reset.');
            return;
          }
          if (data && data.byteLength >= 512 && window.saveManager) {
            if (window.saveManager.isValidSaveBuffer(data)) {
              console.log('⚡ [Event: saveSaveFiles] Guardando SRAM emitida por el emulador:', data.byteLength);
              this.hasPlayerSavedInSession = true;
              window._activeRomSaveData = data;
              this.lastSavedHash = this.computeSaveHash(data);
              window.saveManager.saveGameData(data, null, true, false, false, 'emulator_event');
            }
          }
        });

        window.EJS_emulator.retroarchOpts = window.EJS_emulator.retroarchOpts || [];
        window.EJS_emulator.retroarchOpts.push(
          { name: "menu_enable_widgets", default: "false", isString: false },
          { name: "menu_widget_scale_auto", default: "false", isString: false },
          { name: "menu_widget_scale_factor", default: "0.0", isString: false },
          { name: "video_font_enable", default: "false", isString: false },
          { name: "notification_show_fast_forward", default: "false", isString: false },
          { name: "fastforward_notification", default: "false", isString: false },
          { name: "fps_show", default: "false", isString: false },
          { name: "video_font_size", default: "0.0", isString: false },
          { name: "video_message_pos_x", default: "5.0", isString: false },
          { name: "video_message_pos_y", default: "5.0", isString: false },
          { name: "video_msg_bgcolor_opacity", default: "0.0", isString: false }
        );

        let emuModule = window.EJS_emulator.Module;
        const hookModule = (mod) => {
          if (!mod || mod._callMainHooked) return mod;
          mod._callMainHooked = true;
          const origCallMain = mod.callMain;
          if (typeof origCallMain === 'function') {
            mod.callMain = (args) => {
              injectConfigsToFS(mod.FS);

              // Inyección PRE-MAIN en FS antes de que RetroArch arranque
              if (window._activeRomSaveData && mod.FS) {
                this.injectSaveFilesToFS(mod.FS, window._activeRomSaveData, this.currentRomName);
                if (args && args.length > 0) {
                  const romArg = args[args.length - 1];
                  if (typeof romArg === 'string' && romArg.startsWith('/')) {
                    const argName = romArg.substring(1).replace(/\.(nds|zip|7z)$/i, '');
                    try {
                      mod.FS.writeFile(`/data/saves/${argName}.srm`, window._activeRomSaveData);
                      mod.FS.writeFile(`/data/saves/${argName}.sav`, window._activeRomSaveData);
                      mod.FS.writeFile(`/${argName}.srm`, window._activeRomSaveData);
                      mod.FS.writeFile(`/${argName}.sav`, window._activeRomSaveData);
                    } catch (e) {}
                  }
                }
              }

              return origCallMain.call(mod, args);
            };
          }
          return mod;
        };

        if (emuModule) {
          hookModule(emuModule);
        }

        try {
          Object.defineProperty(window.EJS_emulator, 'Module', {
            get() { return emuModule; },
            set(val) {
              emuModule = hookModule(val);
            },
            configurable: true,
            enumerable: true
          });
        } catch (e) {}
      }
    };

    // Callback de Guardado dentro del juego (ej. Guardar en Pokémon)
    window.EJS_onSaveSave = (data) => {
      console.log('Evento saveSave detectado: guardando SRAM...');
      this.hasPlayerSavedInSession = true;
      if (data && window.saveManager) {
        window._activeRomSaveData = data;
        this.lastSavedHash = this.computeSaveHash(data);
        window.saveManager.saveGameData(data, null, true, false, false, 'in_game');
      }
    };

    window.EJS_onSaveUpdate = () => {
      console.log('Evento onSaveUpdate detectado: sincronizando guardado...');
      this.triggerSave(true);
    };

    window.EJS_onGameStart = async () => {
      const overlay = document.getElementById('emulator-loading-overlay');
      if (overlay) {
        setTimeout(() => overlay.classList.add('hidden'), 200);
      }

      const duplicates = document.querySelectorAll('.ejs_virtualGamepad, .ejs_virtualGamepad_open, .ejs_dpad_main, .ejs_menu_bar, .ejs_menu_button, .ejs_menu, [class*="ejs_virtualGamepad"], [class*="ejs_menu"]');
      duplicates.forEach(el => el.remove());
      if (window.EJS_emulator) {
        try {
          if (window.EJS_emulator.virtualGamepad) {
            window.EJS_emulator.virtualGamepad.style.display = 'none';
            window.EJS_emulator.virtualGamepad.remove?.();
          }
          if (window.EJS_emulator.menu) {
            window.EJS_emulator.menu.open = () => {};
            window.EJS_emulator.menu.toggle = () => {};
            window.EJS_emulator.menu.close = () => {};
          }
          if (window.EJS_emulator.elements) {
            const els = window.EJS_emulator.elements;
            if (els.menu) els.menu.remove();
            if (els.menuToggle) els.menuToggle.remove();
            if (els.contextMenu && els.contextMenu.remove) els.contextMenu.remove();
            if (els.sideMenu) els.sideMenu.remove();
            if (els.modal) els.modal.remove();
            if (els.backdrop) els.backdrop.remove();
            if (els.bottomBar && els.bottomBar.parent) els.bottomBar.parent.remove();
          }
        } catch (e) {}
      }

      // Asegurar supresión absoluta de OSD / Fast-Forward en el sistema de archivos de RetroArch
      if (window.EJS_emulator?.gameManager?.FS) {
        injectConfigsToFS(window.EJS_emulator.gameManager.FS);
      }

      this.applyCoreTouchSettings();
      this.applyEmulationSpeed(this.emulationSpeed);
      this.applyAudioSettings();
      this.applyVideoFilter(this.videoFilter);
      this.applyTouchOpacity(this.touchOpacity);

      if (window.touchControls && typeof window.touchControls.onGameStart === 'function') {
        window.touchControls.onGameStart();
      }

      // Inyección y recarga activa en el núcleo WASM
      const saveData = window._activeRomSaveData || (window.saveManager ? await window.saveManager.loadExistingSave(this.currentRomName) : null);
      if (saveData && saveData.byteLength >= 512 && window.EJS_emulator?.gameManager) {
        const gm = window.EJS_emulator.gameManager;
        if (gm.FS) {
          this.injectSaveFilesToFS(gm.FS, saveData, this.currentRomName);
          const savePath = gm.getSaveFilePath?.();
          if (savePath) {
            try {
              if (gm.FS.analyzePath(savePath).exists) gm.FS.unlink(savePath);
              gm.FS.writeFile(savePath, saveData);
              console.log(`[Post-Boot] Partida inyectada en ruta exacta del núcleo: ${savePath}`);
            } catch (e) {}
          }
          if (typeof gm.loadSaveFiles === 'function') {
            console.log('[Post-Boot] Ejecutando gm.loadSaveFiles() para sincronizar SRAM en RAM...');
            gm.loadSaveFiles();
          }
        }
        this.lastSavedHash = this.computeSaveHash(saveData);
        window._activeRomSaveData = saveData;
        window.saveManager?.showToast(`🎮 Partida cargada con éxito (${(saveData.byteLength/1024).toFixed(0)} KB)`, 'success');
      }

      this.gameStartedTime = Date.now();
      setTimeout(() => {
        if (window.EJS_emulator?.gameManager) {
          const gm = window.EJS_emulator.gameManager;
          let sData = null;
          if (typeof gm.getSaveFile === 'function') {
            sData = gm.getSaveFile(false);
          }
          if (sData && sData.byteLength >= 512) {
            this.initialBootSramHash = this.computeSaveHash(sData);
            if (!this.lastSavedHash) this.lastSavedHash = this.initialBootSramHash;
            console.log('Hash inicial de arranque capturado:', this.initialBootSramHash);
          }
        }
      }, 2500);
    };

    const existingScript = document.getElementById('ejs-loader');
    if (existingScript) {
      existingScript.remove();
    }

    const script = document.createElement('script');
    script.id = 'ejs-loader';
    script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
    script.onload = () => {
      console.log('EmulatorJS cargado correctamente.');
      this.isEmulating = true;
      
      setTimeout(() => {
        const playerElem = document.querySelector('#game-player');
        if (playerElem) playerElem.focus?.();
        const duplicates = document.querySelectorAll('.ejs_virtualGamepad, .ejs_virtualGamepad_open, .ejs_dpad_main, [class*="ejs_virtualGamepad"]');
        duplicates.forEach(el => el.remove());
        this.applyCoreTouchSettings();
      }, 500);

      if (window.saveManager) {
        window.saveManager.showToast(`🎮 Iniciando ${this.currentRomName}...`, 'success');
      }
    };
    script.onerror = () => {
      alert('Error al descargar el núcleo de emulación WebAssembly. Verifica tu conexión a internet.');
    };
    document.body.appendChild(script);

    this.setLayout(this.currentLayout);
  }

  /**
   * Sale del juego actual, respalda la partida en la Bóveda y regresa a la pantalla de bienvenida
   */
  async exitGameToWelcome() {
    if (confirm('¿Deseas salir del juego y volver a la pantalla de bienvenida? Tu partida se guardará automáticamente.')) {
      this.isExiting = true;
      try {
        await this.triggerSave(true);
      } catch (e) {
        console.warn('Error al guardar partida antes de salir:', e);
      }

      // Detener audio y pausar núcleo
      if (window.EJS_emulator) {
        try {
          if (typeof window.EJS_emulator.pause === 'function') window.EJS_emulator.pause();
        } catch (e) {}
      }

      // Ocultar modal de ajustes si está abierto
      this.toggleSettings(false);

      // Limpiar contenedor del emulador y deshabilitar emulación
      const container = document.getElementById('game-player');
      if (container) container.innerHTML = '';

      const emuContainer = document.getElementById('emulator-container');
      if (emuContainer) emuContainer.style.display = 'none';

      document.documentElement.classList.remove('is-emulating');
      document.body.classList.remove('is-emulating');
      const appElem = document.getElementById('app');
      if (appElem) appElem.classList.remove('is-emulating');

      const topHeader = document.querySelector('.top-header');
      const bottomBar = document.querySelector('.bottom-bar');
      if (topHeader) topHeader.style.removeProperty('display');
      if (bottomBar) bottomBar.style.removeProperty('display');

      if (window.touchControls) {
        window.touchControls.hide();
      }

      const gameplayBar = document.getElementById('gameplay-bar');
      if (gameplayBar) gameplayBar.style.display = 'none';

      // Mostrar pantalla de bienvenida
      const welcomeScreen = document.getElementById('welcome-screen');
      if (welcomeScreen) welcomeScreen.style.display = 'flex';

      window.EJS_emulator = null;
      this.isEmulating = false;
      this.isPaused = false;

      // Actualizar biblioteca de juegos recientes
      this.renderRecentRoms();

      if (window.saveManager) {
        window.saveManager.showToast('🏠 Has vuelto a la pantalla de bienvenida.', 'info');
      }
    }
  }

  /**
   * Alias de compatibilidad para detener emulación
   */
  stopEmulation() {
    return this.exitGameToWelcome();
  }

  /**
   * Reinicia la ROM actual desde el principio guardando el progreso previo
   */
  async restartRom() {
    if (confirm('¿Deseas reiniciar la ROM actual? El juego se recargará desde el principio.')) {
      try {
        await this.triggerSave(true);
      } catch (e) {
        console.warn('Error al respaldar partida antes de reiniciar:', e);
      }

      this.toggleSettings(false);

      if (window.saveManager) {
        window.saveManager.showToast('🔄 Reiniciando juego...', 'info');
      }

      // 1. Intentar método de reinicio directo de EmulatorJS
      if (window.EJS_emulator) {
        const gm = window.EJS_emulator.gameManager;
        if (gm && typeof gm.restart === 'function') {
          try {
            gm.restart();
            if (window.saveManager) window.saveManager.showToast('🎮 Juego reiniciado con éxito.', 'success');
            return;
          } catch (e) {
            console.warn('Error en gm.restart():', e);
          }
        }
        if (typeof window.EJS_emulator.restart === 'function') {
          try {
            window.EJS_emulator.restart();
            if (window.saveManager) window.saveManager.showToast('🎮 Juego reiniciado con éxito.', 'success');
            return;
          } catch (e) {
            console.warn('Error en EJS_emulator.restart():', e);
          }
        }
      }

      // 2. Si no hay método nativo o falló, recargar con el blob de la ROM en memoria
      if (this.currentRomBlob && this.currentRomName) {
        const blob = this.currentRomBlob;
        const name = this.currentRomName;
        const container = document.getElementById('game-player');
        if (container) container.innerHTML = '';
        window.EJS_emulator = null;
        await this.startEmulator(blob, name);
      } else {
        location.reload();
      }
    }
  }

  /**
   * Pausa o reanuda la emulación
   */
  togglePause() {
    this.isPaused = !this.isPaused;
    const btn = document.getElementById('btn-pause-game');
    if (btn) btn.innerHTML = this.isPaused ? '▶️ Reanudar' : '⏸️ Pausar';
    
    if (window.EJS_emulator && typeof window.EJS_emulator.pause === 'function') {
      window.EJS_emulator.pause();
    }
  }

  /**
   * Alterna / Cicla modo de avance de velocidad
   */
  toggleFastForward() {
    this.cycleEmulationSpeed();
  }

  /**
   * Dispara el guardado de partida con protección acorazada
   */
  async triggerSave(isAutoSave = false, forceDownload = false) {
    if (!window.EJS_emulator || !window.EJS_emulator.gameManager) {
      if (!isAutoSave && window.saveManager) {
        window.saveManager.showToast('ℹ️ El emulador se está iniciando, espera un momento...', 'info');
      }
      return;
    }

    this.hasPlayerSavedInSession = true;
    const gm = window.EJS_emulator.gameManager;
    const saveData = this.extractSaveDataFromGameManager(gm);

    if (saveData && window.saveManager && window.saveManager.isValidSaveBuffer(saveData)) {
      window._activeRomSaveData = saveData;
      this.lastSavedHash = this.computeSaveHash(saveData);
      await window.saveManager.saveGameData(saveData, null, isAutoSave, forceDownload, !isAutoSave, 'manual');
    } else if (!isAutoSave && window.saveManager) {
      window.saveManager.showToast('ℹ️ Guarda la partida dentro del juego (Menú -> Guardar en Pokémon) y luego pulsa este botón.', 'info');
    }
  }

  /**
   * Guarda un estado rápido en memoria e IndexedDB
   */
  async quickSaveState() {
    if (window.EJS_emulator && window.EJS_emulator.gameManager) {
      try {
        const state = window.EJS_emulator.gameManager.getState();
        if (state && window.saveManager) {
          await window.saveManager.saveQuickState(this.currentRomName, state);
          window.saveManager.showToast('⚡ Guardado rápido generado con éxito.', 'success');
        }
      } catch (err) {
        console.error('Error generando savestate:', err);
        window.saveManager?.showToast('⚠️ No se pudo generar el guardado rápido.', 'warning');
      }
    }
  }

  /**
   * Carga el último estado rápido de memoria e IndexedDB
   */
  async quickLoadState() {
    if (window.EJS_emulator && window.EJS_emulator.gameManager && window.saveManager) {
      try {
        const state = await window.saveManager.loadQuickState(this.currentRomName);
        if (state) {
          window.EJS_emulator.gameManager.loadState(state);
          window.saveManager.showToast('🔄 Estado rápido restaurado con éxito.', 'info');
        } else {
          window.saveManager.showToast('ℹ️ No hay estado rápido previo guardado.', 'info');
        }
      } catch (err) {
        console.error('Error restaurando savestate:', err);
        window.saveManager?.showToast('⚠️ Error al restaurar estado rápido.', 'warning');
      }
    }
  }

  /**
   * Cambia el diseño de pantalla
   */
  setLayout(layoutId, isUserClick = false) {
    if (isUserClick) {
      this.userExplicitLayoutChoice = true;
    }

    const container = document.getElementById('emulator-container');
    const label = document.getElementById('current-layout-name');
    if (!container) return;

    this.layouts.forEach(l => container.classList.remove(l.id));
    container.classList.add(layoutId);
    this.currentLayout = layoutId;

    const found = this.layouts.find(l => l.id === layoutId);
    if (label && found) label.textContent = found.name;

    const chips = document.querySelectorAll('.layout-chip');
    chips.forEach(chip => {
      if (chip.dataset.layout === layoutId) chip.classList.add('active');
      else chip.classList.remove('active');
    });

    this.updateDeviceStatusBadge();
    this.applyCoreTouchSettings();

    if (this.isEmulating && window.touchControls && typeof window.touchControls.onGameStart === 'function') {
      window.touchControls.onGameStart();
    }
  }

  /**
   * Configura las opciones del núcleo WebAssembly para Pantallas Duales y Stylus Táctil
   */
  applyCoreTouchSettings() {
    if (!window.EJS_emulator || !window.EJS_emulator.gameManager) return;
    const gm = window.EJS_emulator.gameManager;
    if (typeof gm.setVariable !== 'function') return;

    try {
      gm.setVariable('desmume_pointer_type', 'touch');
      gm.setVariable('desmume_pointer_device', 'touch');
      gm.setVariable('desmume_pointer_device_l', 'touch');
      gm.setVariable('desmume_pointer_device_r', 'touch');
      gm.setVariable('desmume_touch_mode', 'touch');
      gm.setVariable('desmume_pointer_mode', 'relative');
      gm.setVariable('melonds_touch_mode', 'touch');

      const isHorizontal = (this.currentLayout === 'layout-horizontal');
      gm.setVariable('desmume_screens_layout', isHorizontal ? 'left/right' : 'top/bottom');
      gm.setVariable('melonds_screen_layout', isHorizontal ? 'Horizontal' : 'Top/Bottom');
    } catch (e) {
      console.warn('Error configurando variables de núcleo:', e);
    }
  }

  /**
   * Aplica dinámicamente el salto de cuadros (Frameskip) en caliente
   */
  applyFrameskip(frameskip) {
    this.frameskip = frameskip;
    localStorage.setItem('nds_frameskip', frameskip.toString());

    if (window.EJS_emulator && window.EJS_emulator.gameManager) {
      const gm = window.EJS_emulator.gameManager;
      if (typeof gm.setVariable === 'function') {
        try {
          gm.setVariable('desmume_frameskip', frameskip.toString());
          gm.setVariable('melonds_frameskip', frameskip.toString());
        } catch (e) {
          console.warn('Error aplicando frameskip en vivo:', e);
        }
      }
    }
  }

  toggleNextLayout() {
    const currentIndex = this.layouts.findIndex(l => l.id === this.currentLayout);
    const nextIndex = (currentIndex + 1) % this.layouts.length;
    this.setLayout(this.layouts[nextIndex].id);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.log(err));
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  toggleSettings(open) {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      if (open) this.syncSettingsUI();
      modal.style.display = open ? 'flex' : 'none';
    }
  }

  /**
   * Abre o cierra el modal de configuración de la pantalla de bienvenida
   */
  toggleWelcomeConfig(open) {
    const modal = document.getElementById('welcome-config-modal');
    if (!modal) return;
    if (open) {
      if (window.cloudSaveManager) {
        const pubKeyInput = document.getElementById('pubnub-pub-input');
        const subKeyInput = document.getElementById('pubnub-sub-input');
        const channelDisplay = document.getElementById('pubnub-channel-display');
        if (pubKeyInput) pubKeyInput.value = window.cloudSaveManager.publishKey || 'demo';
        if (subKeyInput) subKeyInput.value = window.cloudSaveManager.subscribeKey || 'demo';
        if (channelDisplay) channelDisplay.value = window.cloudSaveManager.getChannelForRom(this.currentRomName);
      }
      const welcomeSaveMode = document.getElementById('welcome-save-mode-selector');
      if (welcomeSaveMode && window.saveManager) {
        welcomeSaveMode.value = window.saveManager.saveMode;
      }
      const welcomeFrameskip = document.getElementById('welcome-frameskip-selector');
      if (welcomeFrameskip) {
        welcomeFrameskip.value = this.frameskip;
      }
      modal.style.display = 'flex';
    } else {
      modal.style.display = 'none';
    }
  }

  /**
   * Sincroniza los controles interactivos del modal de ajustes con el estado actual
   */
  syncSettingsUI() {
    const toggleAudio = document.getElementById('toggle-audio-enable');
    const volumeSlider = document.getElementById('audio-volume-slider');
    const volumeVal = document.getElementById('audio-volume-value');
    if (toggleAudio) toggleAudio.checked = !this.audioMuted;
    if (volumeSlider) volumeSlider.value = Math.round(this.audioVolume * 100);
    if (volumeVal) volumeVal.textContent = `${Math.round(this.audioVolume * 100)}%`;

    const speedSelector = document.getElementById('settings-speed-selector');
    if (speedSelector) speedSelector.value = this.emulationSpeed.toString();

    const coreSelector = document.getElementById('core-selector');
    if (coreSelector) coreSelector.value = this.selectedCore;

    const frameskipSelector = document.getElementById('settings-frameskip-selector');
    if (frameskipSelector) frameskipSelector.value = this.frameskip;

    const welcomeFrameskip = document.getElementById('welcome-frameskip-selector');
    if (welcomeFrameskip) welcomeFrameskip.value = this.frameskip;

    const layoutSelector = document.getElementById('settings-layout-selector');
    if (layoutSelector) layoutSelector.value = this.currentLayout;

    const filterSelector = document.getElementById('settings-filter-selector');
    if (filterSelector) filterSelector.value = this.videoFilter;

    const touchVis = document.getElementById('settings-touch-visibility');
    if (touchVis) touchVis.value = this.touchVisibilityMode;

    const touchHaptic = document.getElementById('toggle-haptic-feedback');
    if (touchHaptic) touchHaptic.checked = (localStorage.getItem('nds_haptic_enabled') !== 'false');

    const touchOpacity = document.getElementById('touch-opacity-slider');
    const touchOpacityVal = document.getElementById('touch-opacity-value');
    if (touchOpacity) touchOpacity.value = Math.round(this.touchOpacity * 100);
    if (touchOpacityVal) touchOpacityVal.textContent = `${Math.round(this.touchOpacity * 100)}%`;
  }

  /**
   * Configura el nivel de volumen de emulación (0.0 a 1.0)
   */
  setAudioVolume(vol, isUserInteraction = true) {
    const clamped = Math.max(0.0, Math.min(1.0, vol));
    this.audioVolume = clamped;
    localStorage.setItem('nds_audio_volume', clamped.toString());

    const volumeSlider = document.getElementById('audio-volume-slider');
    const volumeVal = document.getElementById('audio-volume-value');
    if (volumeSlider) volumeSlider.value = Math.round(clamped * 100);
    if (volumeVal) volumeVal.textContent = `${Math.round(clamped * 100)}%`;

    this.applyAudioSettings();

    if (isUserInteraction && !this.audioMuted && window.saveManager) {
      window.saveManager.showToast(`🔊 Volumen: ${Math.round(clamped * 100)}%`, 'info');
    }
  }

  /**
   * Activa o desactiva el sonido (Mute / Unmute)
   */
  toggleAudio(enabled, isUserInteraction = true) {
    this.audioMuted = !enabled;
    localStorage.setItem('nds_audio_muted', this.audioMuted ? 'true' : 'false');

    const toggleAudio = document.getElementById('toggle-audio-enable');
    if (toggleAudio) toggleAudio.checked = enabled;

    this.applyAudioSettings();

    if (isUserInteraction && window.saveManager) {
      window.saveManager.showToast(enabled ? '🔊 Sonido activado' : '🔇 Sonido silenciado', 'info');
    }
  }

  /**
   * Aplica los parámetros de audio al motor de emulación WebAssembly y contexto WebAudio
   */
  applyAudioSettings() {
    const effectiveVolume = this.audioMuted ? 0.0 : this.audioVolume;

    if (window.EJS_emulator) {
      try {
        if (typeof window.EJS_emulator.setVolume === 'function') {
          window.EJS_emulator.setVolume(effectiveVolume);
        }
        if (this.audioMuted && typeof window.EJS_emulator.mute === 'function') {
          window.EJS_emulator.mute();
        } else if (!this.audioMuted && typeof window.EJS_emulator.unmute === 'function') {
          window.EJS_emulator.unmute();
        }
        if (window.EJS_emulator.elements?.audio) {
          window.EJS_emulator.elements.audio.volume = effectiveVolume;
          window.EJS_emulator.elements.audio.muted = this.audioMuted;
        }
      } catch (e) {
        console.warn('Error aplicando volumen en EmulatorJS:', e);
      }
    }

    const audioStatusEl = document.getElementById('audio-status');
    if (audioStatusEl) {
      const icon = audioStatusEl.querySelector('.icon');
      const label = audioStatusEl.querySelector('.label');
      if (this.audioMuted) {
        if (icon) icon.textContent = '🔇';
        if (label) label.textContent = 'Silenciado';
        audioStatusEl.classList.remove('active');
      } else {
        if (icon) icon.textContent = '🔊';
        if (label) label.textContent = `Audio ${Math.round(this.audioVolume * 100)}%`;
        audioStatusEl.classList.add('active');
      }
    }
  }

  /**
   * Reactiva y desbloquea el contexto de audio WebAudio para Safari / iOS
   */
  async unlockAudioEngine(showToast = true) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
      }
      if (window.EJS_emulator && typeof window.EJS_emulator.unmute === 'function') {
        window.EJS_emulator.unmute();
      }
      this.applyAudioSettings();
      if (showToast && window.saveManager) {
        window.saveManager.showToast('🔊 Motor de audio reactivado y sincronizado', 'success');
      }
    } catch (e) {
      console.warn('Error desbloqueando audio WebAudio:', e);
    }
  }

  /**
   * Aplica un filtro visual (Pixel Art Nítido, Suavizado Bilineal, Filtro Retro CRT)
   */
  applyVideoFilter(filterName) {
    const validFilters = ['pixelated', 'smooth', 'crt'];
    const chosen = validFilters.includes(filterName) ? filterName : 'pixelated';
    this.videoFilter = chosen;
    localStorage.setItem('nds_video_filter', chosen);

    const player = document.getElementById('game-player');
    const container = document.getElementById('emulator-container');
    const selector = document.getElementById('settings-filter-selector');

    validFilters.forEach(f => {
      player?.classList.remove(`filter-${f}`);
      container?.classList.remove(`filter-${f}`);
    });

    player?.classList.add(`filter-${chosen}`);
    container?.classList.add(`filter-${chosen}`);
    if (selector) selector.value = chosen;
  }

  /**
   * Aplica la opacidad a los controles táctiles virtuales
   */
  applyTouchOpacity(opacityVal) {
    const clamped = Math.max(0.3, Math.min(1.0, opacityVal));
    this.touchOpacity = clamped;
    localStorage.setItem('nds_touch_opacity', clamped.toString());

    document.documentElement.style.setProperty('--touch-btn-opacity', clamped.toString());

    const slider = document.getElementById('touch-opacity-slider');
    const label = document.getElementById('touch-opacity-value');
    if (slider) slider.value = Math.round(clamped * 100);
    if (label) label.textContent = `${Math.round(clamped * 100)}%`;
  }

  /**
   * Renderiza la lista de juegos jugados en orden de última partida con acceso directo
   */
  async renderRecentRoms() {
    const container = document.getElementById('recent-roms-list');
    const countBadge = document.getElementById('recent-roms-count');
    if (!container) return;

    let roms = [];
    if (window.saveManager && typeof window.saveManager.getAllRecentRoms === 'function') {
      try {
        roms = await window.saveManager.getAllRecentRoms();
      } catch (e) {
        console.warn('Error obteniendo ROMs recientes:', e);
      }
    }

    if (countBadge) {
      if (roms && roms.length > 0) {
        countBadge.textContent = `${roms.length} ${roms.length === 1 ? 'juego' : 'juegos'}`;
        countBadge.style.display = 'inline-block';
      } else {
        countBadge.style.display = 'none';
      }
    }

    if (!roms || roms.length === 0) {
      container.innerHTML = `
        <div class="recent-roms-empty" id="recent-roms-empty">
          <p>No hay juegos recientes guardados en memoria.</p>
          <p class="empty-subtext">Selecciona una ROM (.nds) a continuación para comenzar.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    roms.forEach((rom) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'recent-rom-item';
      itemEl.setAttribute('title', `Pulsar para jugar directamente a ${rom.cleanTitle || rom.name}`);

      const sizeStr = this.formatFileSize(rom.size);
      const timeStr = this.formatTimeAgo(rom.lastPlayed);

      itemEl.innerHTML = `
        <div class="recent-rom-left">
          <div class="recent-rom-icon">🎮</div>
          <div class="recent-rom-info">
            <div class="recent-rom-title">${rom.cleanTitle || rom.name}</div>
            <div class="recent-rom-meta">${sizeStr} • ${timeStr}</div>
          </div>
        </div>
        <div class="recent-rom-actions">
          <button class="btn btn-pkhex-recent btn-sm btn-pkhex-recent-act" title="Abrir en PKHeX Studio">💉 PKHeX</button>
          <button class="btn btn-primary btn-sm btn-play-recent" title="Preparar / Jugar">▶️ Jugar</button>
          <button class="btn btn-ghost btn-sm btn-delete-recent" title="Eliminar de recientes">🗑️</button>
        </div>
      `;

      const getRomBlob = () => {
        if (!rom || !rom.data) return null;
        const romName = rom.name || 'Pokemon - Edicion Plata SoulSilver.nds';
        if (rom.data instanceof File) return rom.data;
        if (rom.data instanceof Blob) return new File([rom.data], romName, { type: 'application/octet-stream' });
        return new File([rom.data], romName, { type: 'application/octet-stream' });
      };

      const prepareRom = async (e) => {
        if (e) e.stopPropagation();
        try {
          if (rom && rom.data) {
            const romName = rom.name || 'Pokemon - Edicion Plata SoulSilver.nds';
            const romBlob = getRomBlob();

            this.currentRomName = romName;
            this.currentRomBlob = romBlob;

            if (window.saveManager) {
              window.saveManager.currentRomName = romName;
              window.saveManager.updateRomLastPlayed(romName);
            }

            console.log(`[Recent ROM Launcher] Preparando juego: ${romName}`);
            await this.openGameLauncher(null, romName, romBlob);
          } else {
            alert('Los datos de este juego no se encuentran en memoria. Por favor, vuelve a cargarlo con "Seleccionar ROM".');
          }
        } catch (err) {
          console.error('Error preparando ROM reciente:', err);
          alert('Error al abrir el juego. Por favor, selecciona el archivo .nds nuevamente con el botón "Seleccionar ROM".');
        }
      };

      const openPkhexDirect = async (e) => {
        if (e) e.stopPropagation();
        const romName = rom.name || 'Pokemon - Edicion Plata SoulSilver.nds';
        const romBlob = getRomBlob();
        await this.openPkhexStudio(romName, romBlob);
      };

      itemEl.addEventListener('click', prepareRom);

      const playBtn = itemEl.querySelector('.btn-play-recent');
      if (playBtn) playBtn.addEventListener('click', prepareRom);

      const pkhexBtn = itemEl.querySelector('.btn-pkhex-recent-act');
      if (pkhexBtn) pkhexBtn.addEventListener('click', openPkhexDirect);

      const deleteBtn = itemEl.querySelector('.btn-delete-recent');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const gameTitle = rom.cleanTitle || rom.name;
          if (confirm(`¿Eliminar "${gameTitle}" de la lista de juegos recientes?`)) {
            if (window.saveManager) {
              await window.saveManager.deleteRom(rom.name);
              await this.renderRecentRoms();
              window.saveManager.showToast(`🗑️ "${gameTitle}" eliminado de recientes`, 'info');
            }
          }
        });
      }

      container.appendChild(itemEl);
    });
  }

  formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return 'NDS ROM';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  formatTimeAgo(timestamp) {
    if (!timestamp) return 'Recientemente';
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'hace un momento';
    if (diffMin < 60) return `hace ${diffMin} min`;
    if (diffHour < 24) return `hace ${diffHour} h`;
    if (diffDay === 1) return 'ayer';
    if (diffDay < 7) return `hace ${diffDay} días`;
    const d = new Date(timestamp);
    return d.toLocaleDateString();
  }

  /**
   * Registro del Service Worker para soporte PWA y ejecución offline
   */
  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (let registration of registrations) {
            registration.update();
          }
        });
        if ('caches' in window) {
          caches.keys().then((keys) => {
             keys.forEach((key) => {
              if (key !== 'nds-emulator-v0.9.0') {
                console.log('Purgando caché obsoleta:', key);
                caches.delete(key);
              }
            });
          });
        }

        navigator.serviceWorker.register('sw.js?v=0.9.0').then((reg) => {
          reg.update();
        }).catch(err => {
          console.log('SW registration error:', err);
        });
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new NDSEmulatorApp();
});
