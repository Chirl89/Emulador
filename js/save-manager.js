/**
 * NDS Web Emulator - Save Manager
 * Gestor de persistencia directa: 1 único save local (.sav) y 1 respaldo en la nube
 * Elimina versiones antiguas, historiales y conflictos de sobreescritura
 * Versión: v0.9.0
 */

class SaveManager {
  constructor() {
    this.db = null;
    this.directoryHandle = null;
    this.currentRomName = 'Pokemon - Edicion Plata SoulSilver.nds';
    this.lastSavedHash = null;
    this.isIOS = (/iPad|iPhone|iPod/.test(navigator.userAgent)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.saveMode = localStorage.getItem('nds_save_mode') || (this.isIOS ? 'vault_cloud' : 'disk_vault');
    this.storageQuotaInfo = { usage: 0, quota: 0, persisted: false };

    this.initStorage();
  }

  /**
   * Inicializa la persistencia y la base de datos IndexedDB
   */
  async initStorage() {
    await this.initIndexedDB();
    await this.checkStoragePersistence();
    await this.purgeOldLegacySaves();
  }

  /**
   * Solicita persistencia de almacenamiento permanente (Evita purgas del navegador)
   */
  async checkStoragePersistence() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Storage] Persistencia de datos activada: ${isPersisted}`);
        if (navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          this.storageQuotaInfo = {
            usage: estimate.usage || 0,
            quota: estimate.quota || 0,
            persisted: isPersisted
          };
          this.updateStorageQuotaUI();
        }
      } catch (err) {
        console.warn('[Storage] Error comprobando persistencia:', err);
      }
    }
  }

  /**
   * Inicializa IndexedDB con almacenes limpios
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('NDSEmulatorDB', 4);

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
        if (!db.objectStoreNames.contains('roms')) {
          db.createObjectStore('roms', { keyPath: 'name' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.loadSavedHandle();
        this.updatePlatformStatusUI();
        if (window.app && typeof window.app.renderRecentRoms === 'function') {
          window.app.renderRecentRoms();
        }
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('Error inicializando IndexedDB:', e);
        reject(e);
      };
    });
  }

  /**
   * Purga definitiva de partidas antiguas, versiones históricas y claves duplicadas
   * Deja EXACTAMENTE un único guardado principal por juego (.sav)
   */
  async purgeOldLegacySaves() {
    if (!this.db) return;

    try {
      // 1. Limpiar almacén 'backups' si todavía existe en la base de datos
      if (this.db.objectStoreNames.contains('backups')) {
        try {
          const bTx = this.db.transaction('backups', 'readwrite');
          bTx.objectStore('backups').clear();
        } catch (e) {}
      }

      // 2. Limpiar claves duplicadas/antiguas en 'saves'
      const tx = this.db.transaction('saves', 'readwrite');
      const store = tx.objectStore('saves');

      const allRecords = await new Promise((res) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });

      const legacyKeysToDelete = [
        'game.sav',
        'game.srm',
        'game.dsv',
        'default.sav',
        'default.srm'
      ];

      for (const rec of allRecords) {
        if (!rec || !rec.name) continue;
        const name = rec.name;

        // Eliminar claves genéricas o snapshots antiguos
        if (legacyKeysToDelete.includes(name) ||
            name.startsWith('last_known_good_') ||
            name.startsWith('backup_') ||
            name.endsWith('.srm') ||
            name.endsWith('.dsv')) {
          store.delete(name);
          console.log(`🧹 [Limpieza] Clave antigua eliminada: ${name}`);
        }
      }

      console.log('🧹 [Limpieza] Base de datos saneada: Solo se conservan saves .sav únicos.');
    } catch (err) {
      console.warn('Error en purgeOldLegacySaves:', err);
    }
  }

  /**
   * Calcula un hash rápido FNV-1a de 32-bit de los datos binarios
   */
  computeHash(data) {
    if (!data) return 0;
    const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
    if (!uint8 || uint8.length === 0) return 0;
    let hash = 2166136261;
    const len = uint8.length;
    const step = len > 65536 ? 4 : 1;
    for (let i = 0; i < len; i += step) {
      hash ^= uint8[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) ^ len;
  }

  /**
   * Valida si un buffer contiene datos reales de guardado NDS
   */
  isValidSaveBuffer(data) {
    if (!data) return false;
    const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
    if (!uint8 || uint8.byteLength < 512) return false;

    let hasNonZero = false;
    let hasNonFF = false;
    const sampleLimit = Math.min(uint8.byteLength, 131072);

    for (let i = 0; i < sampleLimit; i++) {
      const b = uint8[i];
      if (b !== 0x00) hasNonZero = true;
      if (b !== 0xFF) hasNonFF = true;
      if (hasNonZero && hasNonFF) return true;
    }

    return (hasNonZero && hasNonFF);
  }

  /**
   * Alias de compatibilidad
   */
  isSramValidAndProgressed(data) {
    return this.isValidSaveBuffer(data);
  }

  /**
   * Guarda directamente en IndexedDB (Único guardado local por juego)
   */
  async saveToIndexedDB(name, data, timestamp = null) {
    if (!this.db || !data) return false;
    const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
    if (!uint8 || uint8.byteLength === 0) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put({
          name: name,
          data: uint8,
          size: uint8.byteLength,
          hash: this.computeHash(uint8),
          timestamp: Number(timestamp) || Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => {
          console.warn(`Error en saveToIndexedDB para ${name}:`, e);
          resolve(false);
        };
      } catch (err) {
        console.warn('Error iniciando transacción en IndexedDB:', err);
        resolve(false);
      }
    });
  }

  /**
   * Obtiene un archivo de guardado de IndexedDB
   */
  async getFromIndexedDB(name) {
    if (!this.db || !name) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').get(name);
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            const uint8 = req.result.data instanceof Uint8Array ? req.result.data : new Uint8Array(req.result.data);
            resolve(uint8);
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

  /**
   * Obtiene el registro completo de la partida local
   */
  async getLocalSaveRecord(romName) {
    if (!this.db) return null;
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const filename = `${baseName}.sav`;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').get(filename);
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result);
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

  /**
   * Elimina la partida guardada localmente
   */
  async deleteSave(romName) {
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const filename = `${baseName}.sav`;

    if (this.db) {
      try {
        const tx = this.db.transaction('saves', 'readwrite');
        tx.objectStore('saves').delete(filename);
      } catch (e) {}
    }

    window._activeRomSaveData = null;
    this.lastSavedHash = null;
    if (window.app) window.app.lastSavedHash = null;

    this.showToast(`🗑️ Partida local "${filename}" eliminada.`, 'info');
    return true;
  }

  /**
   * Carga la partida existente (.sav)
   * REGLA ESTRICTA: El guardado LOCAL es el rey.
   * La Nube es ÚNICAMENTE un respaldo de emergencia por si el local no existe.
   */
  async loadExistingSave(romName) {
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const filename = `${baseName}.sav`;

    // 1. Cargar el guardado LOCAL único desde IndexedDB
    let localData = await this.getFromIndexedDB(filename);

    // 2. Si no está en IndexedDB, buscar en la carpeta en disco vinculada
    if (!localData && this.directoryHandle) {
      localData = await this.readFromDisk(filename);
      if (localData && this.isValidSaveBuffer(localData)) {
        await this.saveToIndexedDB(filename, localData);
      }
    }

    // 3. SI EXISTE GUARDADO LOCAL VÁLIDO: USARLO SIEMPRE
    if (localData && localData.byteLength >= 512 && this.isValidSaveBuffer(localData)) {
      console.log(`✅ [Save Load] Guardado LOCAL cargado (${localData.byteLength} bytes).`);
      this.lastSavedHash = this.computeHash(localData);
      window._activeRomSaveData = localData;

      // Respaldar en la nube en segundo plano
      if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
        window.cloudSaveManager.uploadCloudSave(localData, baseName).catch(() => {});
      }

      this.showToast(`💾 Partida local cargada con éxito`, 'success');
      return localData;
    }

    // 4. SOLO SI NO HAY GUARDADO LOCAL: Buscar respaldo de emergencia en la Nube
    console.log('ℹ️ [Save Load] No hay partida local. Buscando respaldo en la Nube...');
    let cloudResult = null;
    if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
      try {
        cloudResult = await window.cloudSaveManager.fetchLatestCloudSave(romName);
      } catch (e) {
        console.warn('Error consultando nube:', e);
      }
    }

    if (cloudResult && cloudResult.data && cloudResult.data.byteLength >= 512 && this.isValidSaveBuffer(cloudResult.data)) {
      console.log(`☁️ [Save Load] Respaldo de la Nube recuperado (${cloudResult.data.byteLength} bytes). Restaurando a local...`);
      await this.saveToIndexedDB(filename, cloudResult.data, cloudResult.timestamp);
      if (this.directoryHandle) {
        this.writeToDisk(filename, cloudResult.data).catch(() => {});
      }
      this.lastSavedHash = this.computeHash(cloudResult.data);
      window._activeRomSaveData = cloudResult.data;
      this.showToast(`☁️ Partida recuperada desde la Nube (Respaldo)`, 'success');
      return cloudResult.data;
    }

    console.log('ℹ️ [Save Load] No hay partida previa. Iniciando juego nuevo.');
    window._activeRomSaveData = null;
    return null;
  }

  /**
   * Guarda los datos de la partida (.sav)
   * Escribe en el único save local, en disco y en la nube en segundo plano
   */
  async saveGameData(saveData, customFileName = null, isAutoSave = false, forceDownload = false, showPrompt = false, source = 'manual') {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) return false;

    const uint8Data = saveData instanceof Uint8Array ? saveData : (saveData instanceof ArrayBuffer ? new Uint8Array(saveData) : null);
    if (!uint8Data || uint8Data.byteLength < 512) return false;

    if (!this.isValidSaveBuffer(uint8Data)) {
      console.warn('🛡️ Se evitó guardar un buffer de SRAM no inicializado.');
      return false;
    }

    const baseName = this.sanitizeName(this.currentRomName);
    const filename = `${baseName}.sav`;
    const newHash = this.computeHash(uint8Data);

    // Evitar escrituras idénticas repetidas en auto-guardado
    if (isAutoSave && this.lastSavedHash === newHash) {
      window._activeRomSaveData = uint8Data;
      return true;
    }

    this.lastSavedHash = newHash;
    window._activeRomSaveData = uint8Data;
    if (window.app) {
      window.app.lastSavedHash = window.app.computeSaveHash(uint8Data);
    }

    const saveTimestamp = Date.now();

    // 1. Guardar en el ÚNICO registro de IndexedDB
    await this.saveToIndexedDB(filename, uint8Data, saveTimestamp);

    // 2. Inyectar en la memoria virtual FS de RetroArch
    if (window.app && typeof window.app.injectSaveFilesToFS === 'function' && window.EJS_emulator?.gameManager?.FS) {
      window.app.injectSaveFilesToFS(window.EJS_emulator.gameManager.FS, uint8Data, this.currentRomName);
    }

    // 3. Escribir en carpeta en disco si está vinculada
    if (this.directoryHandle) {
      this.writeToDisk(filename, uint8Data).catch(() => {});
    }

    // 4. Subir a la Nube (PubNub) como copia de respaldo
    if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
      window.cloudSaveManager.uploadCloudSave(uint8Data, this.currentRomName, saveTimestamp).catch(() => {});
    }

    if (forceDownload) {
      this.generateSavFileDownload(uint8Data, filename);
    } else if (!isAutoSave) {
      if (this.saveMode === 'auto_download') {
        this.generateSavFileDownload(uint8Data, filename);
      } else {
        this.showToast(`💾 Partida guardada con éxito (${filename})`, 'success');
      }
    }

    return true;
  }

  /**
   * Escribe directamente en el archivo del directorio vinculado en disco
   */
  async writeToDisk(filename, uint8Data) {
    if (!this.directoryHandle || !uint8Data) return false;
    try {
      const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(uint8Data);
      await writable.close();
      return true;
    } catch (err) {
      console.warn('Error escribiendo en carpeta de disco vinculada:', err);
      return false;
    }
  }

  /**
   * Lee un archivo directamente del disco vinculado
   */
  async readFromDisk(filename) {
    if (!this.directoryHandle) return null;
    try {
      const fileHandle = await this.directoryHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      if (buffer && buffer.byteLength >= 512) {
        return new Uint8Array(buffer);
      }
    } catch (e) {}
    return null;
  }

  /**
   * Inyecta la partida previa (.sav) dentro del sistema de archivos virtual de Emscripten
   */
  async injectSaveIntoEmulator(romName) {
    const saveData = await this.loadExistingSave(romName);
    if (!saveData || saveData.byteLength === 0) return false;

    if (!window.EJS_emulator || !window.EJS_emulator.gameManager) return false;

    const gm = window.EJS_emulator.gameManager;

    try {
      if (gm.FS) {
        if (window.app && typeof window.app.injectSaveFilesToFS === 'function') {
          window.app.injectSaveFilesToFS(gm.FS, saveData, romName);
        }

        const dynamicPath = gm.getSaveFilePath?.();
        if (dynamicPath) {
          try {
            if (gm.FS.analyzePath(dynamicPath).exists) gm.FS.unlink(dynamicPath);
            gm.FS.writeFile(dynamicPath, saveData);
          } catch (e) {}
        }

        if (typeof gm.loadSaveFiles === 'function') {
          gm.loadSaveFiles();
        }

        console.log(`✅ Partida inyectada exitosamente (${saveData.byteLength} bytes)`);
        return true;
      }
    } catch (err) {
      console.error('Error inyectando partida en el emulador:', err);
      return false;
    }
  }

  /**
   * Genera la descarga segura de un archivo .sav
   */
  generateSavFileDownload(saveData, filename) {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      this.showToast('⚠️ No hay datos de partida listos para descargar.', 'warning');
      return;
    }

    const now = Date.now();
    if (this.lastDownloadTime && (now - this.lastDownloadTime < 2500)) return;
    this.lastDownloadTime = now;

    const blob = saveData instanceof Blob ? saveData : new Blob([saveData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (e) {}
      URL.revokeObjectURL(url);
    }, 10000);

    this.showToast(`📥 Descargando archivo de partida: ${filename}`, 'success');
  }

  /**
   * Exporta la partida actual a un archivo .sav descargable
   */
  async exportCurrentSave(romName) {
    let saveData = null;

    if (window.EJS_emulator && window.EJS_emulator.gameManager) {
      try {
        const gm = window.EJS_emulator.gameManager;
        if (typeof gm.saveSaveFiles === 'function') gm.saveSaveFiles();
        if (typeof gm.getSaveFile === 'function') saveData = gm.getSaveFile();
      } catch (e) {}
    }

    if (!saveData || saveData.byteLength === 0) {
      saveData = await this.loadExistingSave(romName || this.currentRomName);
    }

    if (saveData && saveData.byteLength > 0) {
      const filename = `${this.sanitizeName(romName || this.currentRomName)}.sav`;
      this.generateSavFileDownload(saveData, filename);
    } else {
      this.showToast('⚠️ No hay datos de partida guardada todavía.', 'warning');
    }
  }

  /**
   * Descarga directamente el archivo .sav actual sin prompts (para PKHeX)
   */
  async exportSavFileDirect(romName) {
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const filename = `${baseName}.sav`;
    const saveInfo = await this.getSaveFileInfo(baseName);
    
    let uint8 = saveInfo.data;
    if (!uint8 || uint8.byteLength === 0) {
      uint8 = new Uint8Array(512 * 1024);
      uint8.fill(0xFF);
    }

    this.generateSavFileDownload(uint8, filename);
    return uint8;
  }

  /**
   * Importa y asegura un archivo .sav editado con PKHeX
   */
  async importPkhexEditedSave(romName, data) {
    if (!data) return false;
    const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
    if (!uint8 || uint8.byteLength === 0) return false;

    const baseName = this.sanitizeName(romName || this.currentRomName);
    const filename = `${baseName}.sav`;
    const now = Date.now();

    try {
      // 1. Guardar en el único registro de IndexedDB
      await this.saveToIndexedDB(filename, uint8, now);
      window._activeRomSaveData = uint8;

      // 2. Escribir en carpeta en disco si está vinculada
      if (this.directoryHandle) {
        this.writeToDisk(filename, uint8).catch(() => {});
      }

      // 3. Inyectar en emulador si está corriendo y recargar SRAM en el núcleo
      if (window.EJS_emulator?.gameManager?.FS) {
        try {
          const gm = window.EJS_emulator.gameManager;
          if (window.app && typeof window.app.injectSaveFilesToFS === 'function') {
            window.app.injectSaveFilesToFS(gm.FS, uint8, romName);
          }
          const targetPath = gm.getSaveFilePath?.();
          if (targetPath) {
            try {
              if (gm.FS.analyzePath(targetPath).exists) gm.FS.unlink(dynamicPath);
              gm.FS.writeFile(targetPath, uint8);
            } catch (e) {}
          }
          if (typeof gm.loadSaveFiles === 'function') {
            gm.loadSaveFiles();
          }
        } catch (e) {}
      }

      // 4. Sincronizar en la Nube
      if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
        window.cloudSaveManager.uploadCloudSave(uint8, baseName, now);
      }

      this.lastSavedHash = this.computeHash(uint8);
      if (window.app) window.app.lastSavedHash = window.app.computeSaveHash(uint8);
      this.showToast(`💉 Partida editada con PKHeX guardada con éxito (${(uint8.byteLength/1024).toFixed(0)} KB)`, 'success');
      return true;
    } catch (err) {
      console.error('Error importando guardado de PKHeX:', err);
      this.showToast('⚠️ Error al aplicar el archivo guardado de PKHeX.', 'warning');
      return false;
    }
  }

  /**
   * Obtiene metadatos e información de la partida única de un juego
   */
  async getSaveFileInfo(romName) {
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const filename = `${baseName}.sav`;

    const localRec = await this.getLocalSaveRecord(baseName);
    let exists = false;
    let size = 0;
    let timestamp = 0;
    let location = 'Sin guardar';
    let data = null;

    if (localRec && localRec.data) {
      exists = true;
      size = localRec.size || localRec.data.byteLength || 0;
      timestamp = localRec.timestamp || 0;
      location = 'Almacenamiento Local (IndexedDB)';
      data = localRec.data instanceof Uint8Array ? localRec.data : new Uint8Array(localRec.data);
    }

    const sizeFormatted = size > 0 ? `${(size / 1024).toFixed(0)} KB` : '0 KB';
    const timeFormatted = timestamp > 0 ? new Date(timestamp).toLocaleString() : 'Sin fecha';

    return {
      exists,
      filename,
      baseName,
      size,
      sizeFormatted,
      timestamp,
      timeFormatted,
      location,
      data
    };
  }

  /**
   * Gestión de ROMs recientes en IndexedDB
   */
  async saveRom(file) {
    if (!this.db || !file) return;
    try {
      const tx = this.db.transaction('roms', 'readwrite');
      const store = tx.objectStore('roms');
      const cleanTitle = this.sanitizeName(file.name);
      store.put({
        name: file.name,
        cleanTitle: cleanTitle,
        size: file.size,
        data: file,
        lastPlayed: Date.now()
      });
    } catch (err) {
      console.warn('Error guardando ROM en biblioteca:', err);
    }
  }

  async getAllRecentRoms() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('roms', 'readonly');
        const req = tx.objectStore('roms').getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async updateRomLastPlayed(romName) {
    if (!this.db || !romName) return;
    try {
      const tx = this.db.transaction('roms', 'readwrite');
      const store = tx.objectStore('roms');
      const req = store.get(romName);
      req.onsuccess = () => {
        if (req.result) {
          req.result.lastPlayed = Date.now();
          store.put(req.result);
        }
      };
    } catch (e) {}
  }

  async deleteRom(romName) {
    if (!this.db || !romName) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('roms', 'readwrite');
        tx.objectStore('roms').delete(romName);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Vincula una carpeta en disco local
   */
  async selectDirectory() {
    if (!('showDirectoryPicker' in window)) {
      this.showToast('⚠️ Tu navegador no soporta vinculación directa con carpetas en disco.', 'warning');
      return false;
    }

    try {
      this.directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents'
      });

      await this.saveDirectoryHandle(this.directoryHandle);
      this.updatePlatformStatusUI();
      this.showToast(`📁 Carpeta vinculada: ${this.directoryHandle.name}`, 'success');
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error seleccionando directorio:', err);
      }
      return false;
    }
  }

  async linkSoulSilverFolder() {
    return this.selectDirectory();
  }

  async saveDirectoryHandle(handle) {
    if (!this.db || !handle) return;
    try {
      const tx = this.db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put({ id: 'save_dir', handle: handle });
    } catch (err) {
      console.warn('Error guardando directory handle:', err);
    }
  }

  async loadSavedHandle() {
    if (!this.db || !('showDirectoryPicker' in window)) return;
    try {
      const tx = this.db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('save_dir');
      req.onsuccess = async () => {
        if (req.result && req.result.handle) {
          const handle = req.result.handle;
          const permission = await handle.queryPermission({ mode: 'readwrite' });
          if (permission === 'granted') {
            this.directoryHandle = handle;
            this.updatePlatformStatusUI();
          }
        }
      };
    } catch (err) {}
  }

  async removeDirectoryHandle() {
    this.directoryHandle = null;
    if (this.db) {
      try {
        const tx = this.db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete('save_dir');
      } catch (e) {}
    }
    this.updatePlatformStatusUI();
    this.showToast('📁 Carpeta en disco desvinculada.', 'info');
  }

  setSaveMode(mode) {
    this.saveMode = mode;
    localStorage.setItem('nds_save_mode', mode);
    this.updatePlatformStatusUI();
  }

  updatePlatformStatusUI() {
    const diskBadge = document.getElementById('disk-folder-status');
    const folderNameEl = document.getElementById('disk-folder-name');
    if (diskBadge) {
      if (this.directoryHandle) {
        diskBadge.textContent = '🟢 Conectada';
        diskBadge.className = 'status-badge active';
        if (folderNameEl) folderNameEl.textContent = this.directoryHandle.name;
      } else {
        diskBadge.textContent = '⚪ No vinculada';
        diskBadge.className = 'status-badge inactive';
        if (folderNameEl) folderNameEl.textContent = 'Ninguna';
      }
    }
  }

  updateStorageQuotaUI() {
    const quotaEl = document.getElementById('storage-quota-text');
    if (quotaEl && this.storageQuotaInfo.quota > 0) {
      const usedMb = (this.storageQuotaInfo.usage / (1024 * 1024)).toFixed(1);
      const totalMb = (this.storageQuotaInfo.quota / (1024 * 1024)).toFixed(0);
      quotaEl.textContent = `${usedMb} MB de ${totalMb} MB (${this.storageQuotaInfo.persisted ? 'Permanente' : 'Normal'})`;
    }
  }

  sanitizeName(name) {
    if (!name) return 'Pokemon - Edicion Plata SoulSilver';
    return name.replace(/\.(nds|zip|7z|sav|dsv|srm)$/i, '').trim();
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
