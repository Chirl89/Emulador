/**
 * NDS Web Emulator - Save Manager
 * Gestor de partidas y sincronización con disco local (C:\Users\cgzla\Documents\SoulSilver)
 * Versión: v0.0.1
 */

class SaveManager {
  constructor() {
    this.directoryHandle = null;
    this.currentRomName = 'Pokemon - Edicion Plata SoulSilver';
    this.db = null;
    this.initIndexedDB();
  }

  /**
   * Inicializa IndexedDB para almacenamiento local de respaldo
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('NDSEmulatorDB', 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.loadSavedHandle();
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('Error inicializando IndexedDB:', e);
        reject(e);
      };
    });
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
          // Verificar si aún tenemos permisos de lectura/escritura
          const opts = { mode: 'readwrite' };
          if ((await handle.queryPermission(opts)) === 'granted') {
            this.directoryHandle = handle;
            this.updateFolderStatusUI(handle.name || 'SoulSilver', true);
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
      alert('Tu navegador no soporta File System Access API directa. Las partidas se guardarán en IndexedDB y podrás descargarlas manualmente como .sav.');
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
      this.showToast(`📁 Carpeta "${handle.name}" vinculada con éxito para guardados directos.`, 'success');
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
      } else {
        label.textContent = 'SoulSilver: Sin vincular';
        statusItem.classList.remove('active');
      }
    }

    if (modalPath) {
      modalPath.textContent = isLinked ? `Ruta vinculada: ${name}` : 'Ruta actual: No vinculada';
    }
  }

  /**
   * Guarda los datos de partida (.sav) directamente en la carpeta de disco o en IndexedDB
   * @param {Uint8Array|ArrayBuffer|Blob} saveData Datos del archivo .sav
   * @param {string} [customFileName] Nombre del archivo .sav
   */
  async saveGameData(saveData, customFileName) {
    const filename = customFileName || `${this.sanitizeName(this.currentRomName)}.sav`;

    // 1. Intentar escribir directamente en el disco si hay carpeta vinculada
    if (this.directoryHandle) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(saveData);
        await writable.close();
        this.showToast(`💾 Partida guardada directamente en ${this.directoryHandle.name}/${filename}`, 'success');
      } catch (err) {
        console.error('Error escribiendo en disco:', err);
        this.fallbackSave(saveData, filename);
      }
    } else {
      this.fallbackSave(saveData, filename);
    }

    // 2. Guardar siempre copia de respaldo en IndexedDB
    this.saveToIndexedDB(filename, saveData);
  }

  /**
   * Guarda respaldo en IndexedDB
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
   * Fallback de descarga directa de archivo .sav
   */
  fallbackSave(saveData, filename) {
    const blob = saveData instanceof Blob ? saveData : new Blob([saveData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast(`📥 Descargando archivo de guardado: ${filename}`, 'success');
  }

  /**
   * Carga una partida existente (.sav) desde la carpeta vinculada si existe
   */
  async loadExistingSaveFromDisk(romName) {
    const filename = `${this.sanitizeName(romName || this.currentRomName)}.sav`;
    if (this.directoryHandle) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        this.showToast(`✅ Partida previa encontrada en disco: ${filename}`, 'success');
        return new Uint8Array(arrayBuffer);
      } catch (err) {
        console.log(`No se encontró partida previa en disco para ${filename}`);
      }
    }

    // Comprobar en IndexedDB
    if (this.db) {
      return new Promise((resolve) => {
        const tx = this.db.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').get(filename);
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result.data);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    }

    return null;
  }

  sanitizeName(name) {
    return name.replace(/\.(nds|zip|7z)$/i, '').trim();
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
