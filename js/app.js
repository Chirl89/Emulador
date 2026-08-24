/**
 * NDS Web Emulator - Main Application
 * Orquestador principal, inicializador del núcleo WASM y control de interfaz
 * Versión: v0.1.6
 */

// Interceptor a nivel de prototipo para neutralizar la creación de virtualGamepad de EmulatorJS
(function() {
  let _EmulatorJS = window.EmulatorJS;
  const patchPrototype = (cls) => {
    if (cls && cls.prototype) {
      cls.prototype.setVirtualGamepad = function() {
        this.virtualGamepad = document.createElement('div');
        this.virtualGamepad.style.display = 'none';
        this.toggleVirtualGamepad = function() {};
      };
      const originalInit = cls.prototype.init;
      if (originalInit) {
        cls.prototype.init = function(...args) {
          this.hasTouchScreen = false;
          this.touch = false;
          return originalInit.apply(this, args);
        };
      }
    }
  };

  if (_EmulatorJS) patchPrototype(_EmulatorJS);

  try {
    Object.defineProperty(window, 'EmulatorJS', {
      configurable: true,
      enumerable: true,
      get() {
        return _EmulatorJS;
      },
      set(val) {
        _EmulatorJS = val;
        patchPrototype(_EmulatorJS);
      }
    });
  } catch (e) {}
})();

class NDSEmulatorApp {
  constructor() {
    this.currentRomBlob = null;
    this.currentRomName = '';
    this.currentLayout = 'layout-horizontal';
    this.isEmulating = false;
    this.isFastForward = false;
    this.isPaused = false;
    this.selectedCore = 'desmume'; // DeSmuME por defecto para máxima estabilidad y compatibilidad con Pokémon SoulSilver

    this.layouts = [
      { id: 'layout-horizontal', name: 'Horizontal (ROG Ally)' },
      { id: 'layout-vertical', name: 'Vertical (Clásico)' },
      { id: 'layout-touch-focus', name: 'Enfoque Táctil' }
    ];

    this.initEngineGuard();
    this.initUI();
    this.initPWA();
  }

  /**
   * Destructor continuo de controles duplicados generados por el motor EmulatorJS
   */
  initEngineGuard() {
    const killEngineGamepads = () => {
      const selectors = [
        '.ejs_virtualGamepad',
        '.ejs_virtualGamepad_open',
        '.ejs_dpad_main',
        '.ejs_virtualGamepad_button',
        '.ejs_virtualGamepad_left',
        '.ejs_virtualGamepad_right',
        '.ejs_virtualGamepad_dpad',
        '.ejs_menu_button',
        '[class*="ejs_virtualGamepad"]',
        '[class*="ejs_dpad"]'
      ];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });

      // Asegurar que el escudo CSS siempre esté al final del <head>
      const shield = document.getElementById('ejs-override-shield');
      if (shield && document.head && document.head.lastElementChild !== shield) {
        document.head.appendChild(shield);
      }
    };

    // Observador permanente de mutaciones DOM
    const observer = new MutationObserver(killEngineGamepads);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Barrido periódico por seguridad
    setInterval(killEngineGamepads, 200);
  }

  initUI() {
    // 1. Selector de ROM y Drag & Drop
    const dropZone = document.getElementById('rom-drop-zone');
    const fileInput = document.getElementById('rom-file-input');
    const browseBtn = document.getElementById('btn-browse-rom');

    if (browseBtn && fileInput) {
      browseBtn.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadRomFile(e.target.files[0]);
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
          this.loadRomFile(e.dataTransfer.files[0]);
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

    // 3. Cargar archivo .sav externo
    const loadSavBtn = document.getElementById('btn-load-sav-file');
    if (loadSavBtn) {
      loadSavBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.sav,.dsv';
        input.onchange = async (e) => {
          if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const buffer = await file.arrayBuffer();
            if (window.saveManager) {
              await window.saveManager.saveToIndexedDB(file.name, new Uint8Array(buffer));
              window.saveManager.showToast(`✅ Partida importada: ${file.name}`, 'success');
            }
          }
        };
        input.click();
      });
    }

    // 4. Botón de guardado directo
    const directSaveBtn = document.getElementById('btn-direct-save');
    if (directSaveBtn) {
      directSaveBtn.addEventListener('click', () => this.triggerSave());
    }

    // 5. Botones de Layout
    const layoutToggleBtn = document.getElementById('btn-layout-toggle');
    if (layoutToggleBtn) {
      layoutToggleBtn.addEventListener('click', () => this.toggleNextLayout());
    }

    const layoutChips = document.querySelectorAll('.layout-chip');
    layoutChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const layout = chip.dataset.layout;
        if (layout) this.setLayout(layout);
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

    // Ajustes táctiles y hápticos en modal
    const toggleTouchCheckbox = document.getElementById('toggle-touch-controls');
    if (toggleTouchCheckbox) {
      toggleTouchCheckbox.addEventListener('change', (e) => {
        if (window.touchControls) {
          if (e.target.checked) window.touchControls.show();
          else window.touchControls.hide();
        }
      });
    }

    const toggleHapticCheckbox = document.getElementById('toggle-haptic-feedback');
    if (toggleHapticCheckbox) {
      toggleHapticCheckbox.addEventListener('change', (e) => {
        if (window.touchControls) {
          window.touchControls.hapticEnabled = e.target.checked;
        }
      });
    }

    // 7. Controles de Gameplay
    const stopBtn = document.getElementById('btn-stop-game');
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopEmulation());

    const pauseBtn = document.getElementById('btn-pause-game');
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());

    const ffBtn = document.getElementById('btn-fast-forward');
    if (ffBtn) ffBtn.addEventListener('click', () => this.toggleFastForward());

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
      // Ignorar si el usuario está interactuando con inputs de formularios o modales
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
  }

  /**
   * Carga el archivo ROM (.nds) seleccionado
   */
  async loadRomFile(file) {
    if (!file) return;

    if (!file.name.match(/\.(nds|zip|7z)$/i)) {
      alert('Por favor, selecciona un archivo de Nintendo DS válido (.nds, .zip o .7z)');
      return;
    }

    this.currentRomName = file.name;
    this.currentRomBlob = file;

    if (window.saveManager) {
      window.saveManager.currentRomName = file.name;
    }

    // Iniciar emulación
    await this.startEmulator(file);
  }

  /**
   * Inicializa el núcleo WASM con la ROM proporcionada
   */
  async startEmulator(file) {
    const welcomeScreen = document.getElementById('welcome-screen');
    const emulatorContainer = document.getElementById('emulator-container');
    const gameplayBar = document.getElementById('gameplay-bar');
    const gamePlayer = document.getElementById('game-player');

    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (emulatorContainer) emulatorContainer.style.display = 'flex';
    if (gameplayBar) gameplayBar.style.display = 'flex';

    // Limpiar contenedor
    gamePlayer.innerHTML = '';

    const romUrl = URL.createObjectURL(file);

    // Configuración global para EmulatorJS
    window.EJS_player = '#game-player';
    window.EJS_core = this.selectedCore; // 'desmume' o 'melonds'
    window.EJS_gameUrl = romUrl;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    // Opciones del núcleo WebAssembly para Pantalla Dual y Modo Táctil Stylus
    window.EJS_defaultOptions = {
      "desmume_screens_layout": "left/right",
      "desmume_pointer_type": "touch",
      "desmume_pointer_device": "touch",
      "desmume_pointer_device_l": "touch",
      "desmume_pointer_device_r": "touch",
      "desmume_touch_mode": "touch",
      "desmume_pointer_mode": "relative",
      "desmume_pointer_colour": "white",
      "melonds_touch_mode": "touch",
      "melonds_screen_layout": "Horizontal",
      "melonds_screens_layout": "left/right"
    };

    // Desactivar gamepad virtual duplicado interno de EmulatorJS
    window.EJS_VirtualGamepadSettings = { disabled: true };
    
    // Opciones adicionales para Handheld / ROG Ally
    window.EJS_Settings = {
      default_controls: true,
      volume: 1.0
    };

    window.EJS_onGameStart = () => {
      // 1. Remover cualquier botón o gamepad residual del motor
      const duplicates = document.querySelectorAll('.ejs_virtualGamepad, .ejs_virtualGamepad_open, .ejs_dpad_main, [class*="ejs_virtualGamepad"]');
      duplicates.forEach(el => el.remove());
      if (window.EJS_emulator && window.EJS_emulator.virtualGamepad) {
        window.EJS_emulator.virtualGamepad.style.display = 'none';
      }

      // 2. Aplicar opciones de núcleo para Pantalla Dual y Stylus Táctil
      this.applyCoreTouchSettings();
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
    if (confirm('¿Deseas salir al menú principal? Asegúrate de haber guardado tu partida.')) {
      location.reload();
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
   * Dispara el guardado de partida a disco o descarga
   */
  async triggerSave() {
    if (window.EJS_emulator && typeof window.EJS_emulator.saveSaveFiles === 'function') {
      try {
        const saveData = await window.EJS_emulator.saveSaveFiles();
        if (saveData && window.saveManager) {
          await window.saveManager.saveGameData(saveData, `${window.saveManager.sanitizeName(this.currentRomName)}.sav`);
        }
      } catch (err) {
        console.error('Error extrayendo guardado del emulador:', err);
      }
    } else {
      if (window.saveManager) {
        window.saveManager.showToast('ℹ️ Guarda la partida dentro del menú del juego (Guardar en Pokémon) y luego pulsa este botón.', 'info');
      }
    }
  }

  quickSaveState() {
    if (window.saveManager) {
      window.saveManager.showToast('⚡ Guardado rápido generado en memoria.', 'success');
    }
  }

  quickLoadState() {
    if (window.saveManager) {
      window.saveManager.showToast('🔄 Cargando último estado guardado...', 'info');
    }
  }

  /**
   * Cambia el diseño de pantalla (Horizontal 16:9, Vertical NDS, Enfoque Táctil)
   */
  setLayout(layoutId) {
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
                if (key !== 'nds-emulator-v0.1.6') {
                  console.log('Purgando caché obsoleta:', key);
                  caches.delete(key);
                }
              });
            });
          }
        }

        navigator.serviceWorker.register('sw.js?v=0.1.6').then((reg) => {
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
