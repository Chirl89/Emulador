/**
 * NDS Web Emulator - Save Manager
 * Gestor de partidas, sobreescritura automática en disco y exportación .sav en iOS
 * Versión: v0.2.0
 */

class SaveManager {
  constructor() {
    this.directoryHandle = null;
    this.currentRomName = 'Pokemon - Edicion Plata SoulSilver';
    this.db = null;
    this.isIOS = (/iPad|iPhone|iPod/.test(navigator.userAgent || '')) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.pendingSaveData = null;
    this.pendingSaveFilename = '';
    this.lastModalTriggerTime = 0;
    this.saveMode = localStorage.getItem('nds_save_mode') || 'auto_download';
    this.initIndexedDB();
    this.initSaveConfirmModal();
  }

  /**
   * Inicializa IndexedDB para almacenamiento local de respaldo y savestates
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('NDSEmulatorDB', 2);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('states')) {
          db.createObjectStore('states', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.loadSavedHandle();
        this.updatePlatformStatusUI();
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('Error inicializando IndexedDB:', e);
        reject(e);
      };
    });
  }

  /**
   * Actualiza la UI de estado según la plataforma (iOS vs Desktop con File System API)
   */
  updatePlatformStatusUI() {
    const label = document.getElementById('save-folder-label');
    const statusItem = document.getElementById('save-folder-status');
    const modalPath = document.getElementById('modal-folder-path');

    if (this.isIOS) {
      if (label) label.textContent = 'Guardado: iOS Archivos & DB';
      if (statusItem) {
        statusItem.classList.add('active');
        statusItem.setAttribute('title', 'Almacenamiento persistente en IndexedDB con exportación a Archivos de iOS');
      }
      if (modalPath) modalPath.textContent = 'Modo iOS: Partidas guardadas en memoria persistente con descarga .sav disponible';
    }
  }

  /**
   * Intenta recuperar el DirectoryHandle guardado de la sesión anterior
   */
  async loadSavedHandle() {
    if (!('showDirectoryPicker' in window)) return;
    try {
      const tx = this.db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const req = store.get('soulsilver_dir');
      req.onsuccess = async () => {
        if (req.result && req.result.handle) {
          const handle = req.result.handle;
          try {
            const opts = { mode: 'readwrite' };
            if ((await handle.queryPermission(opts)) === 'granted') {
              this.directoryHandle = handle;
              this.updateFolderStatusUI(handle.name || 'SoulSilver', true);
            }
          } catch (e) {
            console.log('Permiso pendiente de verificación para handle de carpeta');
          }
        }
      };
    } catch (err) {
      console.log('No se pudo restaurar el DirectoryHandle guardado:', err);
    }
  }

  /**
   * Solicita al usuario seleccionar la carpeta de guardados en disco (ej. C:\Users\cgzla\Documents\SoulSilver)
   */
  async linkSoulSilverFolder() {
    if (!('showDirectoryPicker' in window)) {
      if (this.isIOS) {
        this.showToast('📱 En iOS las partidas se guardan automáticamente en memoria local y puedes pulsar "Exportar .sav" para guardarlo en la app Archivos.', 'info');
      } else {
        this.showToast('ℹ️ Tu navegador no soporta File System Access API directa. Las partidas se guardarán en IndexedDB y se descargarán como .sav.', 'info');
      }
      return false;
    }

    try {
      const handle = await window.showDirectoryPicker({
        id: 'nds_soulsilver_saves',
        mode: 'readwrite',
        startIn: 'documents'
      });

      this.directoryHandle = handle;

      // Guardar handle en IndexedDB
      if (this.db) {
        const tx = this.db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ id: 'soulsilver_dir', handle: handle });
      }

      this.updateFolderStatusUI(handle.name, true);
      this.showToast(`📁 Carpeta "${handle.name}" vinculada con éxito. Partidas .sav se sobreescribirán directamente.`, 'success');
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error al vincular carpeta:', err);
        this.showToast('Error al vincular carpeta en disco.', 'warning');
      }
      return false;
    }
  }

  /**
   * Actualiza el indicador visual de estado de la carpeta de guardado
   */
  updateFolderStatusUI(name, isLinked) {
    const label = document.getElementById('save-folder-label');
    const statusItem = document.getElementById('save-folder-status');
    const modalPath = document.getElementById('modal-folder-path');

    if (label && statusItem) {
      if (isLinked) {
        label.textContent = `SoulSilver: ${name} (OK)`;
        statusItem.classList.add('active');
      } else if (!this.isIOS) {
        label.textContent = 'SoulSilver: Sin vincular';
        statusItem.classList.remove('active');
      }
    }

    if (modalPath && !this.isIOS) {
      modalPath.textContent = isLinked ? `Ruta vinculada: ${name}` : 'Ruta actual: No vinculada';
    }
  }

  /**
   * Inicializa los listeners del modal de confirmación de descarga de guardado .sav
   */
  initSaveConfirmModal() {
    const modal = document.getElementById('save-confirm-modal');
    const btnConfirm = document.getElementById('btn-confirm-save-download');
    const btnCancel = document.getElementById('btn-cancel-save-download');
    const btnClose = document.getElementById('btn-close-save-confirm');
    const chkAuto = document.getElementById('chk-auto-download-sav');

    const closeModal = () => {
      if (modal) modal.style.display = 'none';
    };

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        if (chkAuto && chkAuto.checked) {
          this.saveMode = 'auto_download';
          localStorage.setItem('nds_save_mode', 'auto_download');
          const sel = document.getElementById('save-mode-selector');
          if (sel) sel.value = 'auto_download';
        }
        if (this.pendingSaveData && this.pendingSaveFilename) {
          this.generateSavFileDownload(this.pendingSaveData, this.pendingSaveFilename);
        }
        closeModal();
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (chkAuto && !chkAuto.checked) {
          this.saveMode = 'silent';
          localStorage.setItem('nds_save_mode', 'silent');
          const sel = document.getElementById('save-mode-selector');
          if (sel) sel.value = 'silent';
        }
        closeModal();
      });
    }

    if (btnClose) btnClose.addEventListener('click', closeModal);
  }

  /**
   * Muestra el modal emergente para confirmar la descarga del archivo .sav
   */
  showSaveConfirmationModal(saveData, filename) {
    const now = Date.now();
    // Evitar disparar dos veces en menos de 2.5 segundos
    if (now - this.lastModalTriggerTime < 2500) return;
    this.lastModalTriggerTime = now;

    this.pendingSaveData = saveData;
    this.pendingSaveFilename = filename;

    const modal = document.getElementById('save-confirm-modal');
    const nameEl = document.getElementById('save-modal-filename');
    const detailsEl = document.getElementById('save-modal-file-details');
    const chkAuto = document.getElementById('chk-auto-download-sav');

    if (nameEl) nameEl.textContent = filename;
    if (detailsEl) detailsEl.textContent = filename;
    if (chkAuto) chkAuto.checked = true;

    if (modal) {
      modal.style.display = 'flex';
    }
  }

  /**
   * Guarda los datos de partida (.sav) directamente en disco (sobreescribiendo) o según saveMode
   * @param {Uint8Array|ArrayBuffer|Blob} saveData Datos binarios del archivo .sav
   * @param {string} [customFileName] Nombre del archivo .sav
   * @param {boolean} [isAutoSave] Si es un auto-guardado en segundo plano
   * @param {boolean} [forceDownload] Forzar generación de archivo descargable .sav
   * @param {boolean} [showPrompt] Mostrar menú emergente de confirmación de descarga
   */
  async saveGameData(saveData, customFileName, isAutoSave = false, forceDownload = false, showPrompt = false) {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      console.warn('saveGameData: Datos de guardado vacíos o no listos');
      return false;
    }

    const baseName = this.sanitizeName(this.currentRomName);
    const filename = customFileName || `${baseName}.sav`;
    const uint8Data = saveData instanceof Uint8Array ? saveData : (saveData instanceof ArrayBuffer ? new Uint8Array(saveData) : null);

    // 1. Inyectar y mantener actualizado el archivo en la memoria virtual FS de EmulatorJS
    if (window.EJS_emulator?.gameManager?.FS && uint8Data) {
      try {
        const gm = window.EJS_emulator.gameManager;
        if (gm.FS.analyzePath('/data/saves').exists) {
          gm.FS.writeFile(`/data/saves/${baseName}.sav`, uint8Data);
          gm.FS.writeFile(`/data/saves/game.sav`, uint8Data);
        }
      } catch (e) {}
    }

    // 2. Guardar siempre en almacenamiento persistente con el nombre exacto de la ROM
    await this.saveToIndexedDB(filename, uint8Data || saveData);
    await this.saveToIndexedDB(`${baseName}.sav`, uint8Data || saveData);
    await this.saveToIndexedDB(`game.sav`, uint8Data || saveData);

    // 3. Si hay carpeta en disco vinculada (PC con File System API), sobreescribir silenciosamente
    if (this.directoryHandle) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(saveData);
        await writable.close();
        if (!isAutoSave) {
          this.showToast(`💾 Partida sobreescrita en disco: ${filename}`, 'success');
        }
        return true;
      } catch (err) {
        console.error('Error escribiendo en carpeta vinculada:', err);
      }
    }

    // 4. Gestión según el modo de guardado configurado (iOS / Navegador web)
    if (forceDownload) {
      this.generateSavFileDownload(saveData, filename);
    } else if (!isAutoSave) {
      if (this.saveMode === 'auto_download') {
        // Descarga directa sin intermediarios: solo salta la confirmación nativa de Safari
        this.generateSavFileDownload(saveData, filename);
      } else if (this.saveMode === 'ask_modal' || showPrompt) {
        this.showSaveConfirmationModal(saveData, filename);
      } else if (this.saveMode === 'silent') {
        this.showToast(`💾 Partida guardada en memoria interna: ${filename}`, 'success');
      }
    }

    return true;
  }

  /**
   * Genera la descarga o diálogo de guardado del archivo .sav real (Compatible con iOS Safari y PC)
   */
  generateSavFileDownload(saveData, filename) {
    const blob = saveData instanceof Blob ? saveData : new Blob([saveData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (e) {}
      URL.revokeObjectURL(url);
    }, 15000);

    if (this.isIOS) {
      this.showToast(`💾 Archivo "${filename}" generado en la app Archivos / Descargas de tu iPhone.`, 'success');
    } else {
      this.showToast(`📥 Descargando archivo de guardado: ${filename}`, 'success');
    }
  }

  /**
   * Guarda partida en IndexedDB
   */
  async saveToIndexedDB(name, data) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put({
        name: name,
        data: data,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('Error guardando en IndexedDB:', err);
    }
  }

  /**
   * Guarda un estado rápido (Savestate) en IndexedDB
   */
  async saveQuickState(name, stateData) {
    if (!this.db || !stateData) return;
    try {
      const tx = this.db.transaction('states', 'readwrite');
      tx.objectStore('states').put({
        name: name,
        data: stateData,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('Error guardando state en IndexedDB:', err);
    }
  }

  /**
   * Recupera un estado rápido (Savestate) de IndexedDB
   */
  async loadQuickState(name) {
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('states', 'readonly');
        const req = tx.objectStore('states').get(name);
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result.data);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  /**
   * Carga una partida existente (.sav) desde la carpeta vinculada o desde IndexedDB
   */
  async loadExistingSave(romName) {
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const candidateNames = [
      `${baseName}.sav`,
      `${baseName}.dsv`,
      `${romName}.sav`,
      `game.sav`,
      `game.dsv`
    ];

    // 1. Comprobar en disco si hay carpeta vinculada
    if (this.directoryHandle) {
      for (const fname of candidateNames) {
        try {
          const fileHandle = await this.directoryHandle.getFileHandle(fname);
          const file = await fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          if (arrayBuffer && arrayBuffer.byteLength > 0) {
            console.log(`Partida previa encontrada en disco: ${fname}`);
            return new Uint8Array(arrayBuffer);
          }
        } catch (err) {}
      }
    }

    // 2. Comprobar en IndexedDB (iOS y Respaldo)
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('saves', 'readonly');
          const store = tx.objectStore('saves');

          let foundData = null;
          let pending = candidateNames.length;

          candidateNames.forEach((fname) => {
            const req = store.get(fname);
            req.onsuccess = () => {
              if (req.result && req.result.data && req.result.data.length > 0 && !foundData) {
                foundData = new Uint8Array(req.result.data);
                console.log(`Partida previa recuperada de IndexedDB: ${fname}`);
              }
              pending--;
              if (pending === 0) resolve(foundData);
            };
            req.onerror = () => {
              pending--;
              if (pending === 0) resolve(foundData);
            };
          });
        } catch (e) {
          resolve(null);
        }
      });
    }

    return null;
  }

  /**
   * Inyecta la partida previa (.sav) dentro del sistema de archivos virtual de Emscripten
   */
  async injectSaveIntoEmulator(romName) {
    const saveData = await this.loadExistingSave(romName);
    if (!saveData || saveData.length === 0) {
      console.log('No se encontraron datos de guardado previo para inyectar.');
      return false;
    }

    if (!window.EJS_emulator || !window.EJS_emulator.gameManager) {
      console.warn('injectSaveIntoEmulator: GameManager no está listo todavía.');
      return false;
    }

    const gm = window.EJS_emulator.gameManager;
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const saveFilePath = gm.getSaveFilePath?.() || `/data/saves/${baseName}.sav`;

    const targetPaths = [
      saveFilePath,
      `/data/saves/${baseName}.sav`,
      `/data/saves/${baseName}.dsv`,
      `/data/saves/game.sav`,
      `/data/saves/game.dsv`
    ];

    try {
      // Asegurar que /data y /data/saves existan
      if (gm.FS) {
        if (!gm.FS.analyzePath('/data').exists) gm.FS.mkdir('/data');
        if (!gm.FS.analyzePath('/data/saves').exists) gm.FS.mkdir('/data/saves');

        // Escribir en todas las posibles rutas de guardado
        for (const p of targetPaths) {
          try {
            if (gm.FS.analyzePath(p).exists) gm.FS.unlink(p);
            gm.FS.writeFile(p, saveData);
          } catch (e) {}
        }

        // Notificar al núcleo RetroArch para recargar SRAM
        if (typeof gm.loadSaveFiles === 'function') {
          gm.loadSaveFiles();
        }
        if (typeof gm.FS.syncfs === 'function') {
          gm.FS.syncfs(false, () => {});
        }

        console.log(`✅ Partida previa inyectada exitosamente (${saveData.byteLength} bytes)`);
        this.showToast(`✅ Partida cargada (${baseName}.sav)`, 'success');
        return true;
      }
    } catch (err) {
      console.error('Error inyectando partida previa en el núcleo WASM:', err);
      return false;
    }
  }

  /**
   * Exporta la partida actual a un archivo .sav descargable (iOS y Desktop)
   */
  async exportCurrentSave(romName) {
    let saveData = null;

    // Intentar extraer directamente del núcleo WASM
    if (window.EJS_emulator && window.EJS_emulator.gameManager) {
      try {
        const gm = window.EJS_emulator.gameManager;
        if (typeof gm.saveSaveFiles === 'function') gm.saveSaveFiles();
        if (typeof gm.getSaveFile === 'function') saveData = gm.getSaveFile();
      } catch (e) {
        console.warn('Error extrayendo saveFile de gameManager:', e);
      }
    }

    // Si no está en ejecución o vino vacío, intentar desde IndexedDB
    if (!saveData || saveData.byteLength === 0) {
      saveData = await this.loadExistingSave(romName || this.currentRomName);
    }

    if (saveData && saveData.byteLength > 0) {
      const filename = `${this.sanitizeName(romName || this.currentRomName)}.sav`;
      this.generateSavFileDownload(saveData, filename);
    } else {
      this.showToast('⚠️ No se encontraron datos de guardado aún. Guarda primero dentro del juego.', 'warning');
    }
  }

  sanitizeName(name) {
    if (!name) return 'Pokemon - Edicion Plata SoulSilver';
    return name.replace(/\.(nds|zip|7z|sav|dsv)$/i, '').trim();
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

// Instancia global
window.saveManager = new SaveManager();
