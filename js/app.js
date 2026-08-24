/**
 * NDS Web Emulator - Main Application
 * Orquestador principal, inicializador del núcleo WASM, Bóveda de Partidas y control de interfaz
 * Versión: v0.5.0
 */

class NDSEmulatorApp {
  constructor() {
    this.currentRomBlob = null;
    this.currentRomName = '';
    this.isEmulating = false;
    this.isFastForward = false;
    this.isPaused = false;
    this.selectedCore = 'desmume'; // DeSmuME por defecto para máxima estabilidad y compatibilidad con Pokémon SoulSilver
    this.userExplicitLayoutChoice = false;
    this.autoSaveInterval = null;
    this.emulationSpeed = 1.0; // Velocidad dinámica entre 1x y 10x
    this.lastSavedHash = null;
    this.hasPlayerSavedInSession = false;
    this.initialBootSramHash = 0;

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
   */
  initEngineGuard() {
    const purgeIntrusiveElements = () => {
      const intrusive = document.querySelectorAll(
        '.ejs_cheat_parent, .ejs_netplay_parent, .ejs_menu_bar, .ejs_menu_bar_hidden, ' +
        '.ejs_menu_button, .ejs_menu_text, .ejs_volume_parent, .ejs_side_menu, .ejs_modal, ' +
        '.ejs_backdrop, .ejs_settings_parent, .ejs_cues, .ejs_cue, .ejs_screen_capture, ' +
        '.ejs_watermark, .ejs_virtualGamepad, .ejs_virtualGamepad_parent, .ejs_virtualGamepad_open, .ejs_dpad_main'
      );
      intrusive.forEach(el => el.remove());

      if (window.EJS_emulator) {
        try {
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

    setInterval(purgeIntrusiveElements, 100);
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
  initAutoSaveDaemon() {
    this.autoSaveInterval = setInterval(() => {
      if (!this.isEmulating || this.isPaused || !window.EJS_emulator?.gameManager) {
        return;
      }

      try {
        const gm = window.EJS_emulator.gameManager;
        let saveData = null;

        if (typeof gm.getSaveFile === 'function') {
          saveData = gm.getSaveFile();
        } else if (typeof gm.saveSaveFiles === 'function') {
          gm.saveSaveFiles();
          saveData = gm.getSaveFile?.(false);
        }

        if (saveData && (saveData.byteLength || saveData.length) > 0) {
          const currentHash = this.computeSaveHash(saveData);
          const isProgressed = window.saveManager ? window.saveManager.isSramValidAndProgressed(saveData) : false;

          // PROTECCIÓN TOTAL ANTI-VACÍO:
          // Solo auto-guardar si el usuario guardó en el juego O si la SRAM es válida y difiere del arranque
          if (this.hasPlayerSavedInSession || (isProgressed && currentHash !== this.initialBootSramHash)) {
            window.saveManager?.saveGameData(
              saveData,
              `${window.saveManager.sanitizeName(this.currentRomName)}.sav`,
              true,  // isAutoSave = true
              false, // forceDownload = false
              false  // showPrompt = false
            );
          }
        }
      } catch (err) {
        console.warn('Error en daemon de auto-guardado:', err);
      }
    }, 4000);

    // Guardar automáticamente antes de salir o recargar la página
    window.addEventListener('beforeunload', () => {
      if (this.isEmulating) {
        this.triggerSave(true);
      }
    });

    // Guardar si la app entra en segundo plano (ej. cambiar de app en iOS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.isEmulating) {
        this.triggerSave(true);
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
            await window.saveManager.createBackupSnapshot(file.name, uint8, 'import', 'Importación manual de .sav');
            await window.saveManager.saveToIndexedDB(file.name, uint8);
            const baseName = window.saveManager.sanitizeName(file.name);
            await window.saveManager.saveToIndexedDB(`${baseName}.sav`, uint8);
            await window.saveManager.saveToIndexedDB(`game.sav`, uint8);
            await window.saveManager.saveToIndexedDB(`last_known_good_${baseName}.sav`, uint8);

            if (this.isEmulating && window.EJS_emulator && window.EJS_emulator.gameManager) {
              const gm = window.EJS_emulator.gameManager;
              const path = gm.getSaveFilePath?.() || `/data/saves/${file.name}`;
              if (path && gm.FS) {
                gm.FS.writeFile(path, uint8);
                gm.FS.writeFile(`/data/saves/game.sav`, uint8);
                gm.loadSaveFiles?.();
              }
            }
            window.saveManager.showToast(`✅ Partida importada y respaldada: ${file.name}`, 'success');
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

    const settingsBtn = document.getElementById('btn-settings');
    const closeSettingsBtn = document.getElementById('btn-close-settings');
    const saveSettingsBtn = document.getElementById('btn-save-settings');
    const saveModeSelector = document.getElementById('save-mode-selector');

    if (saveModeSelector && window.saveManager) {
      saveModeSelector.value = window.saveManager.saveMode;
      saveModeSelector.addEventListener('change', (e) => {
        window.saveManager.saveMode = e.target.value;
        localStorage.setItem('nds_save_mode', e.target.value);
        window.saveManager.showToast(`💾 Modo de guardado: ${e.target.options[e.target.selectedIndex].text}`, 'info');
      });
    }

    // Configuración de PubNub Cloud Saves en el Modal de Ajustes
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
      if (saveModeSelector && window.saveManager) {
        saveModeSelector.value = window.saveManager.saveMode;
      }
      syncPubNubInputs();
      this.toggleSettings(true);
    });

    const inGameMenuBtn = document.getElementById('btn-in-game-menu');
    if (inGameMenuBtn) {
      inGameMenuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (saveModeSelector && window.saveManager) {
          saveModeSelector.value = window.saveManager.saveMode;
        }
        syncPubNubInputs();
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

    // 7. Controles de Gameplay
    const stopBtn = document.getElementById('btn-stop-game');
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopEmulation());

    const pauseBtn = document.getElementById('btn-pause-game');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());

    const ffBtn = document.getElementById('btn-fast-forward');
    if (ffBtn) ffBtn.addEventListener('click', () => this.cycleEmulationSpeed());

    const quickSaveBtn = document.getElementById('btn-quick-savestate');
    if (quickSaveBtn) quickSaveBtn.addEventListener('click', () => this.quickSaveState());

    const quickLoadBtn = document.getElementById('btn-quick-loadstate');
    if (quickLoadBtn) quickLoadBtn.addEventListener('click', () => this.quickLoadState());

    // 8. Integración de la Bóveda de Partidas (Backup Vault)
    this.initVaultUI();

    // 9. Desbloqueo de Audio Safari en el primer toque
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
      'w': 'r', 'W': 'r',
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
   * Inicializa la interfaz y eventos de la Bóveda de Partidas (Backup Vault)
   */
  initVaultUI() {
    const openVaultBtns = document.querySelectorAll('.btn-open-vault, #btn-open-vault, #btn-open-vault-welcome, #btn-open-vault-settings');
    const closeVaultBtn = document.getElementById('btn-close-vault');
    const manualBackupBtn = document.getElementById('btn-vault-manual-backup');
    const forceUploadBtn = document.getElementById('btn-vault-force-upload');
    const forceDownloadBtn = document.getElementById('btn-vault-force-download');
    const refreshVaultBtn = document.getElementById('btn-vault-refresh');

    openVaultBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleVaultModal(true);
      });
    });

    if (closeVaultBtn) closeVaultBtn.addEventListener('click', () => this.toggleVaultModal(false));

    if (manualBackupBtn) {
      manualBackupBtn.addEventListener('click', async () => {
        if (!window.saveManager) return;
        const baseName = window.saveManager.sanitizeName(this.currentRomName);
        let dataToBackup = null;

        if (this.isEmulating && window.EJS_emulator?.gameManager) {
          const gm = window.EJS_emulator.gameManager;
          if (typeof gm.saveSaveFiles === 'function') gm.saveSaveFiles();
          if (typeof gm.getSaveFile === 'function') dataToBackup = gm.getSaveFile();
        }

        if (!dataToBackup) {
          const rec = await window.saveManager.getLocalSaveRecord(baseName);
          dataToBackup = rec?.data;
        }

        if (dataToBackup) {
          const snap = await window.saveManager.createBackupSnapshot(
            this.currentRomName,
            dataToBackup,
            'manual',
            'Copia manual creada desde la Bóveda'
          );
          if (snap) {
            window.saveManager.showToast('🛡️ Copia de seguridad manual creada con éxito', 'success');
            await this.renderVaultUI();
          }
        } else {
          window.saveManager.showToast('⚠️ No se encontraron datos para respaldar. Guarda primero en el juego.', 'warning');
        }
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
        if (window.cloudSaveManager) {
          const ok = await window.cloudSaveManager.forceCloudDownload(this.currentRomName);
          if (ok) await this.renderVaultUI();
        }
      });
    }

    if (refreshVaultBtn) {
      refreshVaultBtn.addEventListener('click', () => this.renderVaultUI());
    }
  }

  /**
   * Abre o cierra el modal de la Bóveda de Partidas
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
   * Renderiza el contenido de la Bóveda de Partidas (Estado general y lista de copias)
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
        localStatusEl.innerHTML = `<span style="color: var(--color-success);">🟢 Protegida</span> (${sizeStr} • ${timeStr})`;
      } else {
        localStatusEl.innerHTML = `<span style="color: var(--text-muted);">⚪ Sin partida guardada aún</span>`;
      }
    }

    // 3. Estado Nube
    const cloudStatusEl = document.getElementById('vault-cloud-status');
    if (cloudStatusEl && window.cloudSaveManager) {
      const channel = window.cloudSaveManager.getChannelForRom(this.currentRomName);
      cloudStatusEl.innerHTML = `<span style="color: var(--color-primary);">☁️ Activa</span> (Canal: <code>${channel}</code>)`;
    }

    // 4. Lista de Backups Históricos (Time-Machine)
    await this.renderVaultBackupsList();
  }

  /**
   * Renderiza la lista histórica de snapshots en la Bóveda
   */
  async renderVaultBackupsList() {
    const container = document.getElementById('vault-backups-list');
    const countBadge = document.getElementById('vault-backups-count');
    if (!container || !window.saveManager) return;

    const baseName = window.saveManager.sanitizeName(this.currentRomName);
    const backups = await window.saveManager.getBackupsForRom(baseName);

    if (countBadge) {
      countBadge.textContent = `${backups.length} ${backups.length === 1 ? 'copia' : 'copias'}`;
    }

    if (!backups || backups.length === 0) {
      container.innerHTML = `
        <div class="vault-empty">
          <p>🛡️ No hay copias de seguridad previas para este juego todavía.</p>
          <p class="empty-subtext">Las copias se crearán automáticamente cada vez que guardes en Pokémon o pulses "➕ Crear Copia Manual".</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    backups.forEach((b) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'vault-backup-item';

      const d = new Date(b.timestamp);
      const exactTimeStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
      const timeAgoStr = this.formatTimeAgo(b.timestamp);
      const sizeKb = (b.size / 1024).toFixed(0);

      let badgeClass = 'badge-auto';
      let badgeLabel = '🤖 Auto';
      if (b.source === 'manual') {
        badgeClass = 'badge-manual';
        badgeLabel = '⭐ Manual';
      } else if (b.source === 'cloud') {
        badgeClass = 'badge-cloud';
        badgeLabel = '☁️ Nube';
      } else if (b.source === 'local_pre_sync') {
        badgeClass = 'badge-presync';
        badgeLabel = '🛡️ Pre-Sync';
      } else if (b.source === 'import') {
        badgeClass = 'badge-import';
        badgeLabel = '📥 Importado';
      }

      itemEl.innerHTML = `
        <div class="vault-item-left">
          <div class="vault-item-badge ${badgeClass}">${badgeLabel}</div>
          <div class="vault-item-info">
            <div class="vault-item-title">${exactTimeStr} <span class="vault-item-timeago">(${timeAgoStr})</span></div>
            <div class="vault-item-meta">${sizeKb} KB ${b.note ? `• ${b.note}` : ''}</div>
          </div>
        </div>
        <div class="vault-item-actions">
          <button class="btn btn-primary btn-sm btn-restore-backup" title="Restaurar esta versión de partida">🔄 Restaurar</button>
          <button class="btn btn-secondary btn-sm btn-download-backup" title="Descargar este archivo .sav">📥</button>
          <button class="btn btn-ghost btn-sm btn-delete-backup" title="Eliminar copia de seguridad">🗑️</button>
        </div>
      `;

      // Botón Restaurar
      const restoreBtn = itemEl.querySelector('.btn-restore-backup');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
          if (confirm(`¿Restaurar la partida del ${exactTimeStr} (${timeAgoStr})?\n\nTu partida actual se archivará automáticamente como copia de seguridad previa.`)) {
            await window.saveManager.restoreBackup(b.id);
            await this.renderVaultUI();
          }
        });
      }

      // Botón Descargar
      const downloadBtn = itemEl.querySelector('.btn-download-backup');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
          window.saveManager.exportBackupAsFile(b.id);
        });
      }

      // Botón Eliminar
      const deleteBtn = itemEl.querySelector('.btn-delete-backup');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (confirm(`¿Eliminar esta copia de seguridad del ${exactTimeStr}?`)) {
            await window.saveManager.deleteBackup(b.id);
            await this.renderVaultUI();
            window.saveManager.showToast('🗑️ Copia de seguridad eliminada', 'info');
          }
        });
      }

      container.appendChild(itemEl);
    });
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
        await window.saveManager.createBackupSnapshot(savFile.name, uint8, 'import', 'Importación con ROM');
        await window.saveManager.saveToIndexedDB(savFile.name, uint8);
        const baseName = window.saveManager.sanitizeName(savFile.name);
        await window.saveManager.saveToIndexedDB(`${baseName}.sav`, uint8);
        await window.saveManager.saveToIndexedDB(`game.sav`, uint8);
        await window.saveManager.saveToIndexedDB(`last_known_good_${baseName}.sav`, uint8);
        window.saveManager.showToast(`💾 Partida (.sav) vinculada y asegurada en Bóveda: ${savFile.name}`, 'info');
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
      await this.startEmulator(romFile);
    } else if (!savFile) {
      alert('Por favor, selecciona un archivo de Nintendo DS válido (.nds, .zip o .7z)');
    }
  }

  async loadRomFile(file) {
    await this.loadRomFiles([file]);
  }

  /**
   * Inicializa el núcleo WASM con la ROM proporcionada
   */
  async startEmulator(file, customRomName) {
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
    this.hasPlayerSavedInSession = false;

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
    
    window.EJS_defaultOptions = {
      "notification_show_fast_forward": "false",
      "video_font_enable": "false",
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
      volume: 1.0,
      audio_latency: 128,
      video_vsync: true,
      video_smooth: false,
      video_threaded: true
    };

    // Callback de Guardado dentro del juego (ej. Guardar en Pokémon)
    window.EJS_onSaveSave = (data) => {
      console.log('Evento saveSave detectado: guardando SRAM con protección acorazada...');
      this.hasPlayerSavedInSession = true;
      if (data && window.saveManager) {
        window.saveManager.saveGameData(data, `${window.saveManager.sanitizeName(this.currentRomName)}.sav`, false, false, true, 'in_game');
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

      this.applyCoreTouchSettings();
      this.applyEmulationSpeed(this.emulationSpeed);

      // Inyección protegida de partida previa
      if (window.saveManager) {
        const priorSave = await window.saveManager.loadExistingSave(this.currentRomName);
        if (priorSave && priorSave.byteLength > 0 && window.EJS_emulator?.gameManager?.FS) {
          try {
            const gm = window.EJS_emulator.gameManager;
            const targetPath = gm.getSaveFilePath?.() || `/data/saves/${baseName}.sav`;
            if (gm.FS.analyzePath('/data/saves').exists) {
              gm.FS.writeFile(targetPath, priorSave);
              gm.FS.writeFile(`/data/saves/game.sav`, priorSave);
              console.log(`[SRAM Injected] ${targetPath} (${priorSave.byteLength} bytes)`);
            }
          } catch (e) {
            console.warn('Error inyectando partida en arranque:', e);
          }
        }
        window.saveManager.showToast(`🎮 ${this.currentRomName} cargado con Bóveda activa`, 'success');
      }

      this.gameStartedTime = Date.now();
      setTimeout(() => {
        if (window.EJS_emulator?.gameManager) {
          const gm = window.EJS_emulator.gameManager;
          let sData = null;
          if (typeof gm.getSaveFile === 'function') sData = gm.getSaveFile();
          else if (typeof gm.saveSaveFiles === 'function') { gm.saveSaveFiles(); sData = gm.getSaveFile?.(false); }
          if (sData) {
            this.initialBootSramHash = this.computeSaveHash(sData);
            this.lastSavedHash = this.initialBootSramHash;
            console.log('Hash inicial de arranque capturado (Blindaje anti-vacío):', this.initialBootSramHash);
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
   * Detiene la partida actual y regresa a la pantalla principal
   */
  stopEmulation() {
    if (confirm('¿Deseas salir al menú principal? Tu partida se respaldará automáticamente en la Bóveda.')) {
      this.triggerSave(true).then(() => {
        location.reload();
      });
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
    let saveData = null;

    try {
      if (typeof gm.getSaveFile === 'function') {
        saveData = gm.getSaveFile();
      } else if (typeof gm.saveSaveFiles === 'function') {
        gm.saveSaveFiles();
        saveData = gm.getSaveFile(false);
      }
    } catch (err) {
      console.error('Error extrayendo guardado del emulador:', err);
    }

    if (saveData && window.saveManager) {
      await window.saveManager.saveGameData(saveData, `${window.saveManager.sanitizeName(this.currentRomName)}.sav`, isAutoSave, forceDownload, !isAutoSave, 'manual');
    } else if (!isAutoSave && window.saveManager) {
      window.saveManager.showToast('ℹ️ Guarda la partida dentro del juego (Guardar en Pokémon) y luego pulsa este botón.', 'info');
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
      modal.style.display = open ? 'flex' : 'none';
    }
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
          <button class="btn btn-primary btn-sm btn-play-recent" title="Jugar ahora">▶️ Jugar</button>
          <button class="btn btn-ghost btn-sm btn-delete-recent" title="Eliminar de recientes">🗑️</button>
        </div>
      `;

      const launchGame = async (e) => {
        if (e) e.stopPropagation();
        try {
          if (rom && rom.data) {
            const romName = rom.name || 'Pokemon - Edicion Plata SoulSilver.nds';
            let romBlob;
            
            if (rom.data instanceof File) {
              romBlob = rom.data;
            } else if (rom.data instanceof Blob) {
              romBlob = new File([rom.data], romName, { type: 'application/octet-stream' });
            } else if (rom.data instanceof Uint8Array || rom.data instanceof ArrayBuffer) {
              romBlob = new File([rom.data], romName, { type: 'application/octet-stream' });
            } else {
              romBlob = new File([rom.data], romName, { type: 'application/octet-stream' });
            }

            this.currentRomName = romName;
            this.currentRomBlob = romBlob;

            if (window.saveManager) {
              window.saveManager.currentRomName = romName;
              window.saveManager.updateRomLastPlayed(romName);
            }

            console.log(`[Recent ROM Launcher] Lanzando juego directo: ${romName} (${romBlob.size} bytes)`);
            await this.startEmulator(romBlob, romName);
          } else {
            alert('Los datos de este juego no se encuentran en memoria. Por favor, vuelve a cargarlo con "Seleccionar ROM".');
          }
        } catch (err) {
          console.error('Error lanzando ROM reciente:', err);
          alert('Error al abrir el juego. Por favor, selecciona el archivo .nds nuevamente con el botón "Seleccionar ROM".');
        }
      };

      itemEl.addEventListener('click', launchGame);

      const playBtn = itemEl.querySelector('.btn-play-recent');
      if (playBtn) playBtn.addEventListener('click', launchGame);

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
              if (key !== 'nds-emulator-v0.5.0') {
                console.log('Purgando caché obsoleta:', key);
                caches.delete(key);
              }
            });
          });
        }

        navigator.serviceWorker.register('sw.js?v=0.5.0').then((reg) => {
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
