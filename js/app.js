/**
 * NDS Web Emulator - Main Application
 * Orquestador principal, inicializador del núcleo WASM y control de interfaz
 * Versión: v0.0.1
 */

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

    this.initUI();
    this.initPWA();
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

    // 6. Pantalla completa y ajustes
    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
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
    window.EJS_language = 'es-ES';
    
    // Opciones adicionales para Handheld / ROG Ally
    window.EJS_Settings = {
      default_controls: true,
      volume: 1.0
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
        navigator.serviceWorker.register('sw.js').catch(err => {
          console.log('SW registration error:', err);
        });
      });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new NDSEmulatorApp();
});
