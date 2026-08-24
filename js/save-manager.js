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
    this.initIndexedDB();
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
   * Guarda los datos de partida (.sav) directamente en disco (sobreescribiendo) o genera descarga/iOS
   * @param {Uint8Array|ArrayBuffer|Blob} saveData Datos binarios del archivo .sav
   * @param {string} [customFileName] Nombre del archivo .sav
   * @param {boolean} [isAutoSave] Si es un auto-guardado en segundo plano
   * @param {boolean} [forceDownload] Forzar generación de archivo descargable .sav
   */
  async saveGameData(saveData, customFileName, isAutoSave = false, forceDownload = false) {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      console.warn('saveGameData: Datos de guardado vacíos o no listos');
      return false;
    }

    const filename = customFileName || `${this.sanitizeName(this.currentRomName)}.sav`;
    const uint8Data = saveData instanceof Uint8Array ? saveData : (saveData instanceof ArrayBuffer ? new Uint8Array(saveData) : null);

    // 1. Guardar siempre copia de respaldo en IndexedDB persistente
    await this.saveToIndexedDB(filename, uint8Data || saveData);

    // 2. Si se fuerza descarga o es iOS (y no es auto-save silencioso), generar el archivo .sav
    if (forceDownload || (this.isIOS && !isAutoSave)) {
      this.generateSavFileDownload(saveData, filename);
      return true;
    }

    // 3. Escribir directamente en el disco si hay carpeta vinculada (Opera GX, Chrome, ROG Ally)
    if (this.directoryHandle && !forceDownload) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(saveData);
        await writable.close();
        if (!isAutoSave) {
          this.showToast(`💾 Partida sobreescrita en disco: ${this.directoryHandle.name}/${filename}`, 'success');
        } else {
          console.log(`[AutoSave] Sincronizado ${filename} en disco.`);
        }
        return true;
      } catch (err) {
        console.error('Error sobreescribiendo en disco:', err);
        if (!isAutoSave) {
          this.generateSavFileDownload(saveData, filename);
        }
      }
    } else {
      // Sin carpeta vinculada en PC: si es guardado manual, generar archivo .sav
      if (!isAutoSave) {
        this.generateSavFileDownload(saveData, filename);
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
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    if (this.isIOS) {
      this.showToast(`💾 Archivo "${filename}" generado. Puedes guardarlo en la app Archivos de tu iPhone/iPad.`, 'success');
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
    const filename = `${baseName}.sav`;

    // 1. Comprobar en disco si hay carpeta vinculada
    if (this.directoryHandle) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        console.log(`Partida previa encontrada en disco: ${filename}`);
        return new Uint8Array(arrayBuffer);
      } catch (err) {
        console.log(`No se encontró .sav en disco para ${filename}`);
      }
    }

    // 2. Comprobar en IndexedDB (iOS y Respaldo)
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('saves', 'readonly');
          const req = tx.objectStore('saves').get(filename);
          req.onsuccess = () => {
            if (req.result && req.result.data) {
              console.log(`Partida previa recuperada de IndexedDB: ${filename}`);
              resolve(new Uint8Array(req.result.data));
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
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
    if (!saveData || saveData.length === 0) return false;

    if (!window.EJS_emulator || !window.EJS_emulator.gameManager) {
      console.warn('injectSaveIntoEmulator: GameManager no está listo todavía.');
      return false;
    }

    const gm = window.EJS_emulator.gameManager;
    const saveFilePath = gm.getSaveFilePath();

    if (!saveFilePath) {
      console.warn('injectSaveIntoEmulator: No se pudo obtener getSaveFilePath()');
      return false;
    }

    try {
      // Asegurar que la ruta exista
      const paths = saveFilePath.split('/');
      let currentPath = '';
      for (let i = 0; i < paths.length - 1; i++) {
        if (!paths[i].trim()) continue;
        currentPath += '/' + paths[i];
        if (!gm.FS.analyzePath(currentPath).exists) {
          gm.FS.mkdir(currentPath);
        }
      }

      // Escribir el archivo .sav
      if (gm.FS.analyzePath(saveFilePath).exists) {
        gm.FS.unlink(saveFilePath);
      }
      gm.FS.writeFile(saveFilePath, saveData);

      // Notificar al núcleo para recargar la memoria SRAM
      gm.loadSaveFiles();
      this.showToast(`✅ Partida previa cargada con éxito (${this.sanitizeName(romName)}.sav)`, 'success');
      return true;
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
        saveData = window.EJS_emulator.gameManager.getSaveFile();
      } catch (e) {
        console.warn('Error extrayendo saveFile de gameManager:', e);
      }
    }

    // Si no está en ejecución, intentar desde IndexedDB
    if (!saveData) {
      saveData = await this.loadExistingSave(romName || this.currentRomName);
    }

    if (saveData && saveData.length > 0) {
      const filename = `${this.sanitizeName(romName || this.currentRomName)}.sav`;
      this.generateSavFileDownload(saveData, filename);
    } else {
      this.showToast('⚠️ No hay datos de partida guardados aún. Guarda primero dentro del juego.', 'warning');
    }
  }

  sanitizeName(name) {
    if (!name) return 'game';
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
    }, 4000);
  }
}

// Instancia global
window.saveManager = new SaveManager();
