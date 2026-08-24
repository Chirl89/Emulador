/**
 * NDS Web Emulator - Main Application
 * Orquestador principal, inicializador del núcleo WASM y control de interfaz
 * Versión: v0.2.0
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
    const player = document.getElementById('game-player');
    if (player && !this.domObserver) {
      const observer = new MutationObserver(() => {
        const toRemove = player.querySelectorAll(
          'div[class*="cheat"], div[class*="netplay"], div[class*="control"], ' +
          'div[class*="drag"], div[class*="about"], div[class*="popup"], ' +
          'div[class*="modal"], div[class*="menu"], div[class*="bar"], ' +
          'div[class*="cue"], div[class*="side"], div[class*="text"], ' +
          'button, p, h2, h3, h4, span.ejs_menu_text, .ejs_list_selector, ' +
          '.ejs_context_menu_tab, .ejs_virtualGamepad, [class*="ejs_virtualGamepad"], [class*="ejs_menu"]'
        );
        toRemove.forEach(el => {
          if (el.tagName !== 'CANVAS' && !el.classList.contains('ejs_canvas') && !el.classList.contains('ejs_game') && !el.classList.contains('ejs_parent')) {
            el.remove();
          }
        });
      });
      observer.observe(player, { childList: true, subtree: true });
      this.domObserver = observer;
    }

    const purgeIntrusiveElements = () => {
      // 1. Remover botones de captura, barra inferior ejs_menu_bar, menús gigantes, trucos, red y modales de EmulatorJS
      const intrusive = document.querySelectorAll(
        '.ejs_menu_bar, .ejs_menu_bar_hidden, .ejs_menu_button, .ejs_menu_text, .ejs_menu_text_right, ' +
        '.ejs_list_selector, .ejs_context_menu_tab, .ejs_context_menu, .ejs_menu, .ejs_menu_parent, ' +
        '.ejs_side_menu, .ejs_cues, .ejs_cue, .ejs_screen_capture, .ejs_watermark, .ejs_popup, ' +
        '.ejs_alert, .ejs_confirm, .ejs_modal, .ejs_backdrop, .ejs_settings, .ejs_settings_parent, ' +
        '.ejs_netplay, .ejs_cheats, .ejs_bottom_bar, .ejs_top_bar, .ejs_bar, [class*="ejs_menu"], ' +
        '[class*="ejs_list"], [class*="ejs_bar"], [class*="ejs_side"], [class*="ejs_modal"], ' +
        '[class*="ejs_backdrop"], [class*="ejs_settings"], [class*="ejs_cheats"], [class*="ejs_netplay"], ' +
        '[class*="ejs_context"], [class*="ejs_cue"], [class*="ejs_capture"], [id*="ejs_menu"], ' +
        '.ejs_virtualGamepad, .ejs_virtualGamepad_parent, .ejs_virtualGamepad_open, ' +
        '.ejs_dpad_main, .ejs_virtualGamepad_button, [class*="ejs_virtualGamepad"], [class*="ejs_dpad"]'
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

    setInterval(purgeIntrusiveElements, 50);
  }

  /**
   * Inicializa el servicio de auto-guardado en segundo plano y al cerrar pestaña
   */
  initAutoSaveDaemon() {
    // Polling rápido cada 5 segundos para capturar guardados dentro del juego (ej. Menú Guardar en Pokémon)
    this.autoSaveInterval = setInterval(() => {
      if (this.isEmulating && !this.isPaused) {
        this.triggerSave(true);
      }
    }, 5000);

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
   * Cambia dinámicamente la velocidad de emulación (1x a 10x) mediante botones L2/R2
   */
  changeEmulationSpeed(direction) {
    let nextSpeed = Math.round(this.emulationSpeed + direction);
    if (nextSpeed > 10) nextSpeed = 10;
    if (nextSpeed < 1) nextSpeed = 1;

    this.emulationSpeed = nextSpeed;
    this.applyEmulationSpeed(this.emulationSpeed);

    // Actualizar badge visual en controles táctiles
    const speedBadge = document.getElementById('touch-speed-hud');
    if (speedBadge) {
      speedBadge.textContent = `⚡ ${this.emulationSpeed}x`;
      speedBadge.style.color = this.emulationSpeed > 1 ? '#00f0ff' : '#ffb800';
    }

    if (window.saveManager) {
      window.saveManager.showToast(`⚡ Velocidad: ${this.emulationSpeed}x`, 'info');
    }
  }

  /**
   * Aplica la velocidad en el emulador WebAssembly
   */
  applyEmulationSpeed(speed) {
    if (window.EJS_emulator) {
      if (typeof window.EJS_emulator.setSpeed === 'function') {
        try { window.EJS_emulator.setSpeed(speed); } catch (e) {}
      }
      const gm = window.EJS_emulator.gameManager;
      if (gm && gm.functions) {
        if (typeof gm.functions.setFastForwardRatio === 'function') {
          try { gm.functions.setFastForwardRatio(speed); } catch (e) {}
        }
        if (typeof gm.functions.toggleFastForward === 'function') {
          try { gm.functions.toggleFastForward(speed > 1.0 ? 1 : 0); } catch (e) {}
        }
      }
    }
  }

  initUI() {
    // 1. Selector de ROM y Drag & Drop
    const dropZone = document.getElementById('rom-drop-zone');
    const fileInput = document.getElementById('rom-file-input');
    const browseBtn = document.getElementById('btn-browse-rom');
    const openFolderBtn = document.getElementById('btn-open-folder-game');
    const forceRefreshBtn = document.getElementById('btn-force-git-refresh');

    if (forceRefreshBtn) {
      forceRefreshBtn.addEventListener('click', () => this.forceGitRefresh());
    }

    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', () => fileInput.click());
    }

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', () => this.openGameFromFolder());
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadRomFiles(e.target.files);
        }
      });
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.loadRomFiles(e.dataTransfer.files);
        }
      });
    }

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
            await window.saveManager.saveToIndexedDB(file.name, uint8);
            if (this.isEmulating && window.EJS_emulator && window.EJS_emulator.gameManager) {
              const gm = window.EJS_emulator.gameManager;
              const path = gm.getSaveFilePath?.() || `/data/saves/${file.name}`;
              if (path && gm.FS) {
                gm.FS.writeFile(path, uint8);
                gm.loadSaveFiles?.();
              }
            }
            window.saveManager.showToast(`✅ Partida importada: ${file.name}`, 'success');
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
    if (settingsBtn) settingsBtn.addEventListener('click', () => this.toggleSettings(true));
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => this.toggleSettings(false));
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => this.toggleSettings(false));

    // 7. Controles de Gameplay
    const stopBtn = document.getElementById('btn-stop-game');
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopEmulation());

    const pauseBtn = document.getElementById('btn-pause-game');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());

    const ffBtn = document.getElementById('btn-fast-forward');
    if (ffBtn) ffBtn.addEventListener('click', () => this.changeEmulationSpeed(1));

    const quickSaveBtn = document.getElementById('btn-quick-savestate');
    if (quickSaveBtn) quickSaveBtn.addEventListener('click', () => this.quickSaveState());

    const quickLoadBtn = document.getElementById('btn-quick-loadstate');
    if (quickLoadBtn) quickLoadBtn.addEventListener('click', () => this.quickLoadState());

    // 8. Desbloqueo de Audio Safari en el primer toque
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

    // 9. Enrutador global de teclado físico (Opera GX / Desktop / ROG Ally)
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

    // 10. Escucha de orientación y resolución adaptativa para iOS / ROG Ally / PC
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
   * Abre directamente una carpeta en disco (ej. SoulSilver), detecta la ROM e inicializa auto-guardado
   */
  async openGameFromFolder() {
    if (!('showDirectoryPicker' in window)) {
      document.getElementById('rom-file-input')?.click();
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'nds_soulsilver_saves',
        mode: 'readwrite',
        startIn: 'documents'
      });

      if (window.saveManager) {
        window.saveManager.directoryHandle = dirHandle;
        if (window.saveManager.db) {
          const tx = window.saveManager.db.transaction('handles', 'readwrite');
          tx.objectStore('handles').put({ id: 'soulsilver_dir', handle: dirHandle });
        }
        window.saveManager.updateFolderStatusUI(dirHandle.name, true);
      }

      // Buscar archivo .nds dentro de la carpeta
      let foundRomFile = null;
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.match(/\.(nds|zip|7z)$/i)) {
          foundRomFile = await entry.getFile();
          break;
        }
      }

      if (foundRomFile) {
        window.saveManager?.showToast(`📂 Juego encontrado: ${foundRomFile.name}`, 'success');
        this.loadRomFile(foundRomFile);
      } else {
        window.saveManager?.showToast(`📁 Carpeta "${dirHandle.name}" vinculada. Por favor selecciona el archivo .nds a continuación.`, 'info');
        document.getElementById('rom-file-input')?.click();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error abriendo carpeta:', err);
      }
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

    // Buscar ROM de Nintendo DS (flexible con .nds, .NDS, .zip, .ZIP, .7z)
    let romFile = files.find(f => {
      const n = (f.name || '').toLowerCase();
      return n.endsWith('.nds') || n.endsWith('.zip') || n.endsWith('.7z') || f.name.match(/\.(nds|zip|7z)$/i);
    });

    // Buscar archivo .sav o .dsv
    let savFile = files.find(f => {
      const n = (f.name || '').toLowerCase();
      return n.endsWith('.sav') || n.endsWith('.dsv') || f.name.match(/\.(sav|dsv)$/i);
    });

    // Si no se encontró por extensión exacta pero solo hay 1 archivo binario cargado, tratarlo como ROM
    if (!romFile && files.length === 1 && !savFile) {
      romFile = files[0];
      console.log('Asumiendo archivo único como ROM NDS:', romFile.name);
    }

    // Si el usuario incluyó un archivo .sav de su iPhone/PC, guardarlo en memoria primero
    if (savFile && window.saveManager) {
      try {
        const buffer = await savFile.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        await window.saveManager.saveToIndexedDB(savFile.name, uint8);
        const baseName = window.saveManager.sanitizeName(savFile.name);
        await window.saveManager.saveToIndexedDB(`${baseName}.sav`, uint8);
        await window.saveManager.saveToIndexedDB(`game.sav`, uint8);
        window.saveManager.showToast(`💾 Partida (.sav) detectada y vinculada: ${savFile.name}`, 'info');
      } catch (err) {
        console.error('Error leyendo .sav adjunto:', err);
      }
    }

    if (romFile) {
      this.currentRomName = romFile.name;
      this.currentRomBlob = romFile;
      if (window.saveManager) {
        window.saveManager.currentRomName = romFile.name;
      }
      await this.startEmulator(romFile);
    } else if (!savFile) {
      alert('Por favor, selecciona un archivo de Nintendo DS válido (.nds, .zip o .7z)');
    }
  }

  /**
   * Compatibilidad hacia atrás para un solo archivo
   */
  async loadRomFile(file) {
    await this.loadRomFiles([file]);
  }

  /**
   * Inicializa el núcleo WASM con la ROM proporcionada
   */
  async startEmulator(file) {
    const welcomeScreen = document.getElementById('welcome-screen');
    const emulatorContainer = document.getElementById('emulator-container');
    const gameplayBar = document.getElementById('gameplay-bar');
    const gamePlayer = document.getElementById('game-player');
    const appEl = document.getElementById('app');

    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (emulatorContainer) emulatorContainer.style.display = 'flex';

    // Ocultar cabecera y barra inferior completamente
    const topHeader = document.querySelector('.top-header');
    const bottomBar = document.querySelector('.bottom-bar');
    if (topHeader) topHeader.style.setProperty('display', 'none', 'important');
    if (bottomBar) bottomBar.style.setProperty('display', 'none', 'important');

    // Activar clase is-emulating en html, body y contenedor principal
    document.documentElement.classList.add('is-emulating');
    document.body.classList.add('is-emulating');
    if (appEl) appEl.classList.add('is-emulating');
    this.isEmulating = true;

    // Limpiar contenedor
    gamePlayer.innerHTML = '';

    const romUrl = URL.createObjectURL(file);
    const isVertical = (this.currentLayout === 'layout-vertical');
    const baseName = window.saveManager ? window.saveManager.sanitizeName(this.currentRomName) : 'game';

    // NUNCA cargar savestates automáticos (para no corromper la lectura del juego)
    window.EJS_loadStateURL = null;
    window.EJS_loadState = null;
    window.EJS_externalFiles = null; // Evita que downloadFile de EmulatorJS se bloquee con blobs en Safari

    // Desactivar capturas de pantalla, menús intrusivos, cues, trucos y marcas de agua de EmulatorJS
    window.EJS_disableCue = true;
    window.EJS_screenCapture = false;
    window.EJS_Buttons = false;
    window.EJS_buttons = {
      playPause: false,
      play: false,
      pause: false,
      restart: false,
      mute: false,
      unmute: false,
      settings: false,
      fullscreen: false,
      enterFullscreen: false,
      exitFullscreen: false,
      saveState: false,
      loadState: false,
      screenRecord: false,
      gamepad: false,
      cheat: false,
      volumeSlider: false,
      saveSavFiles: false,
      loadSavFiles: false,
      quickSave: false,
      quickLoad: false,
      screenshot: false,
      cacheManager: false,
      exitEmulation: false,
      netplay: false,
      diskButton: false,
      contextMenu: false
    };
    window.EJS_buttonOpts = window.EJS_buttons;
    window.EJS_hideSettings = true;
    window.EJS_noAutoFocus = false;
    window.EJS_pauseOnUnfocus = false;
    window.EJS_watermark = false;
    window.EJS_disableMenu = true;
    window.EJS_VirtualGamepadSettings = { disabled: true };

    // Optimización de arranque inmediato (Evita el bloqueo de 15s de IndexedDB en Safari iOS)
    window.EJS_cacheLimit = 0;
    window.EJS_disableDatabases = true;
    window.EJS_threads = true;

    // Configuración global para EmulatorJS
    window.EJS_player = '#game-player';
    window.EJS_core = this.selectedCore; // 'desmume' o 'melonds'
    window.EJS_gameUrl = romUrl;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    
    // Opciones de alto rendimiento adaptadas para fluidez a 60 FPS en Opera y Safari
    window.EJS_defaultOptions = {
      "desmume_screens_layout": isVertical ? "top/bottom" : "left/right",
      "desmume_pointer_type": "touch",
      "desmume_pointer_device": "touch",
      "desmume_pointer_device_l": "touch",
      "desmume_pointer_device_r": "touch",
      "desmume_touch_mode": "touch",
      "desmume_pointer_mode": "relative",
      "desmume_pointer_colour": "white",
      "desmume_advanced_timing": "disabled", // Desactiva timing innecesario para duplicar FPS
      "desmume_internal_resolution": "256x192", // Resolución nativa óptima
      "desmume_opengl_mode": "disabled", // Modo softraster optimizado
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

    // Desactivar gamepad virtual duplicado interno de EmulatorJS
    window.EJS_VirtualGamepadSettings = { disabled: true };
    
    // Opciones de buffer de audio y multihilo para eliminar tartamudeo en Opera y PC
    window.EJS_Settings = {
      default_controls: true,
      volume: 1.0,
      audio_latency: 128,
      video_vsync: true,
      video_smooth: false,
      video_threaded: true
    };

    // Callback cuando el juego guarda internamente en su menú (ej. Guardar en Pokémon)
    window.EJS_onSaveSave = (data) => {
      console.log('Evento saveSave detectado: guardando SRAM y generando archivo .sav local...');
      if (data && window.saveManager) {
        window.saveManager.saveGameData(data, `${window.saveManager.sanitizeName(this.currentRomName)}.sav`, false, true);
      }
    };

    window.EJS_onSaveUpdate = () => {
      console.log('Evento onSaveUpdate detectado: sincronizando guardado...');
      this.triggerSave(true);
    };

    window.EJS_onGameStart = async () => {
      // 1. Remover cualquier botón, menú o gamepad residual del motor
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

      // 2. Aplicar opciones de núcleo para Pantalla Dual y Stylus Táctil
      this.applyCoreTouchSettings();

      // 3. Escribir partida previa directamente en la memoria virtual FS si existe
      if (window.saveManager) {
        const priorSave = await window.saveManager.loadExistingSave(this.currentRomName);
        if (priorSave && priorSave.byteLength > 0 && window.EJS_emulator?.gameManager?.FS) {
          try {
            const gm = window.EJS_emulator.gameManager;
            const targetPath = gm.getSaveFilePath?.() || `/data/saves/${baseName}.sav`;
            if (gm.FS.analyzePath('/data/saves').exists) {
              gm.FS.writeFile(targetPath, priorSave);
              gm.FS.writeFile(`/data/saves/game.sav`, priorSave);
              console.log(`[SRAM Direct Injected] ${targetPath} (${priorSave.byteLength} bytes)`);
            }
          } catch (e) {
            console.warn('Error inyectando partida en arranque:', e);
          }
        }
        window.saveManager.showToast(`🎮 ${this.currentRomName} cargado. ¡A jugar!`, 'success');
      }
    };

    // Cargar loader.js de EmulatorJS si no está cargado
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
      
      // Auto-enfoque al contenedor de juego y limpieza de controles duplicados
      setTimeout(() => {
        const playerElem = document.querySelector('#game-player');
        if (playerElem) {
          playerElem.focus?.();
        }
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

    // Ajustar layout actual
    this.setLayout(this.currentLayout);
  }

  /**
   * Detiene la partida actual y regresa a la pantalla principal
   */
  stopEmulation() {
    if (confirm('¿Deseas salir al menú principal? Se guardará tu partida automáticamente.')) {
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
   * Alterna modo de avance rápido (Fast-Forward)
   */
  toggleFastForward() {
    this.isFastForward = !this.isFastForward;
    const btn = document.getElementById('btn-fast-forward');
    if (btn) {
      btn.innerHTML = this.isFastForward ? '⚡ Normal (1x)' : '⏩ Rápido (2x)';
      if (this.isFastForward) btn.classList.add('btn-primary');
      else btn.classList.remove('btn-primary');
    }

    if (window.EJS_emulator && typeof window.EJS_emulator.setSpeed === 'function') {
      window.EJS_emulator.setSpeed(this.isFastForward ? 2.0 : 1.0);
    }
  }

  /**
   * Dispara el guardado de partida a disco (sobreescritura) o descarga/iOS
   */
  async triggerSave(isAutoSave = false, forceDownload = false) {
    if (!window.EJS_emulator || !window.EJS_emulator.gameManager) {
      if (!isAutoSave && window.saveManager) {
        window.saveManager.showToast('ℹ️ El emulador se está iniciando, espera un momento...', 'info');
      }
      return;
    }

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
      await window.saveManager.saveGameData(saveData, `${window.saveManager.sanitizeName(this.currentRomName)}.sav`, isAutoSave, forceDownload);
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
   * Cambia el diseño de pantalla (Horizontal 16:9, Vertical NDS, Enfoque Táctil)
   */
  setLayout(layoutId, isUserClick = false) {
    if (isUserClick) {
      this.userExplicitLayoutChoice = true;
    }

    const container = document.getElementById('emulator-container');
    const label = document.getElementById('current-layout-name');
    if (!container) return;

    // Remover clases de layout previas
    this.layouts.forEach(l => container.classList.remove(l.id));
    container.classList.add(layoutId);
    this.currentLayout = layoutId;

    const found = this.layouts.find(l => l.id === layoutId);
    if (label && found) label.textContent = found.name;

    // Actualizar chips inferiores
    const chips = document.querySelectorAll('.layout-chip');
    chips.forEach(chip => {
      if (chip.dataset.layout === layoutId) chip.classList.add('active');
      else chip.classList.remove('active');
    });

    // Actualizar badge de estado de dispositivo
    this.updateDeviceStatusBadge();

    // Sincronizar disposición de pantallas en el núcleo WebAssembly
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
      // 1. Forzar modo táctil directo en DeSmuME / melonDS
      gm.setVariable('desmume_pointer_type', 'touch');
      gm.setVariable('desmume_pointer_device', 'touch');
      gm.setVariable('desmume_pointer_device_l', 'touch');
      gm.setVariable('desmume_pointer_device_r', 'touch');
      gm.setVariable('desmume_touch_mode', 'touch');
      gm.setVariable('desmume_pointer_mode', 'relative');
      gm.setVariable('melonds_touch_mode', 'touch');

      // 2. Disposición de pantallas duales (Horizontal vs Vertical)
      const isHorizontal = (this.currentLayout === 'layout-horizontal');
      gm.setVariable('desmume_screens_layout', isHorizontal ? 'left/right' : 'top/bottom');
      gm.setVariable('melonds_screen_layout', isHorizontal ? 'Horizontal' : 'Top/Bottom');
      console.log('Opciones de pantalla dual y stylus táctil aplicadas al núcleo:', isHorizontal ? 'Horizontal' : 'Vertical');
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
   * Registro del Service Worker para soporte PWA y ejecución offline
   */
  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        // En entorno local (Live Server), actualizar y limpiar cachés obsoletas automáticamente
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
          navigator.serviceWorker.getRegistrations().then((registrations) => {
            for (let registration of registrations) {
              registration.update();
            }
          });
          if ('caches' in window) {
            caches.keys().then((keys) => {
              keys.forEach((key) => {
                if (key !== 'nds-emulator-v0.2.0') {
                  console.log('Purgando caché obsoleta:', key);
                  caches.delete(key);
                }
              });
            });
          }
        }

        navigator.serviceWorker.register('sw.js?v=0.2.0').then((reg) => {
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

