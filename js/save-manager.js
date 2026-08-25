/**
 * NDS Web Emulator - Save Manager
 * Gestor acorazado de partidas, Bóveda Time-Machine, prevención de pérdidas y sincronización
 * Versión: v0.7.3
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
    this.lastDownloadTime = 0;
    this.saveMode = localStorage.getItem('nds_save_mode') || 'auto_download';
    this.lastSavedHash = 0;

    this.initIndexedDB();
    this.initSaveConfirmModal();
    this.requestStoragePersistence();
  }

  /**
   * Solicita persistencia permanente de almacenamiento en el navegador
   * Evita que iOS Safari o Chrome eliminen IndexedDB por presión de almacenamiento
   */
  async requestStoragePersistence() {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          const granted = await navigator.storage.persist();
          console.log(`[Storage] Persistencia duradera de almacenamiento: ${granted ? 'Concedida ✅' : 'No concedida'}`);
        } else {
          console.log('[Storage] Persistencia duradera ya activa ✅');
        }
      } catch (err) {
        console.warn('[Storage] Error comprobando persistencia:', err);
      }
    }
  }

  /**
   * Inicializa IndexedDB v4 con soporte para Bóveda Histórica de Backups (Time-Machine)
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
        // Almacén de Bóveda Histórica de Backups (v4)
        if (!db.objectStoreNames.contains('backups')) {
          const backupStore = db.createObjectStore('backups', { keyPath: 'id' });
          backupStore.createIndex('romName', 'romName', { unique: false });
          backupStore.createIndex('timestamp', 'timestamp', { unique: false });
          backupStore.createIndex('source', 'source', { unique: false });
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
   * Valida si un buffer de guardado contiene datos de SRAM reales y con progreso
   * Evita que buffers vacíos (todos 0x00 o 0xFF) pisen partidas reales
   */
  isSramValidAndProgressed(data) {
    if (!data) return false;
    const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
    if (!uint8 || uint8.byteLength < 512) return false;

    let zeroes = 0;
    let ones = 0;
    const sampleSize = Math.min(uint8.byteLength, 4096);
    for (let i = 0; i < sampleSize; i++) {
      if (uint8[i] === 0x00) zeroes++;
      else if (uint8[i] === 0xFF) ones++;
    }

    if (zeroes / sampleSize > 0.99 || ones / sampleSize > 0.99) {
      return false;
    }

    return true;
  }

  /**
   * Crea una copia de seguridad histórica (Snapshot) en la Bóveda de IndexedDB
   */
  async createBackupSnapshot(romName, data, source = 'auto', note = '') {
    if (!this.db || !data) return null;
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (uint8.byteLength === 0) return null;

    const baseName = this.sanitizeName(romName || this.currentRomName);
    const hash = this.computeHash(uint8);
    const now = Date.now();

    try {
      const recentBackups = await this.getBackupsForRom(baseName);
      if (recentBackups.length > 0 && recentBackups[0].hash === hash && (now - recentBackups[0].timestamp < 15000)) {
        return recentBackups[0];
      }

      const backupRecord = {
        id: `backup_${baseName}_${now}_${Math.random().toString(36).substring(2, 6)}`,
        romName: baseName,
        gameTitle: romName || this.currentRomName,
        timestamp: now,
        size: uint8.byteLength,
        hash: hash,
        source: source,
        note: note || '',
        data: uint8
      };

      const tx = this.db.transaction('backups', 'readwrite');
      tx.objectStore('backups').put(backupRecord);

      await new Promise((res) => {
        tx.oncomplete = res;
        tx.onerror = res;
      });

      console.log(`🛡️ [Bóveda Time-Machine] Snapshot creado: ${backupRecord.id} (${source}, ${uint8.byteLength} bytes)`);
      this.cleanupOldAutoBackups(baseName, 30);

      return backupRecord;
    } catch (err) {
      console.warn('Error guardando snapshot en Bóveda:', err);
      return null;
    }
  }

  /**
   * Limpia snapshots automáticos antiguos manteniendo un límite máximo
   */
  async cleanupOldAutoBackups(romName, maxCount = 30) {
    if (!this.db) return;
    try {
      const backups = await this.getBackupsForRom(romName);
      const autoBackups = backups.filter(b => b.source === 'auto');

      if (autoBackups.length > maxCount) {
        const toDelete = autoBackups.slice(maxCount);
        const tx = this.db.transaction('backups', 'readwrite');
        const store = tx.objectStore('backups');
        toDelete.forEach(b => store.delete(b.id));
      }
    } catch (err) {
      console.warn('Error en limpieza de snapshots antiguos:', err);
    }
  }

  /**
   * Obtiene la lista completa de copias de seguridad de una ROM ordenadas por fecha descendente
   */
  async getBackupsForRom(romName) {
    if (!this.db) return [];
    const baseName = this.sanitizeName(romName || this.currentRomName);

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('backups', 'readonly');
        const store = tx.objectStore('backups');
        const index = store.index('romName');
        const req = index.getAll(baseName);

        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  /**
   * Obtiene todas las copias de seguridad existentes de todos los juegos
   */
  async getAllBackups() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('backups', 'readonly');
        const store = tx.objectStore('backups');
        const req = store.getAll();

        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  /**
   * Restaura una copia de seguridad específica desde la Bóveda hacia el juego activo
   */
  async restoreBackup(backupId) {
    if (!this.db || !backupId) return false;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('backups', 'readonly');
        const store = tx.objectStore('backups');
        const req = store.get(backupId);

        req.onsuccess = async () => {
          const record = req.result;
          if (!record || !record.data) {
            this.showToast('⚠️ No se encontró la copia de seguridad seleccionada.', 'warning');
            resolve(false);
            return;
          }

          const baseName = record.romName || this.sanitizeName(this.currentRomName);
          const uint8 = record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data);

          // 1. Crear snapshot de seguridad del estado actual antes de restaurar
          const currentSave = await this.getLocalSaveRecord(baseName);
          if (currentSave && currentSave.data) {
            await this.createBackupSnapshot(baseName, currentSave.data, 'manual', 'Pre-restauración de snapshot');
          }

          // 2. Sobreescribir en almacenamiento primario de IndexedDB
          await this.saveToIndexedDB(`${baseName}.sav`, uint8);
          await this.saveToIndexedDB(`game.sav`, uint8);
          await this.saveToIndexedDB(`last_known_good_${baseName}.sav`, uint8);

          // 3. Si el emulador está corriendo, inyectar inmediatamente en el core WASM
          if (window.EJS_emulator?.gameManager?.FS) {
            try {
              const gm = window.EJS_emulator.gameManager;
              const targetPath = gm.getSaveFilePath?.() || `/data/saves/${baseName}.sav`;
              if (gm.FS.analyzePath('/data/saves').exists) {
                gm.FS.writeFile(targetPath, uint8);
                gm.FS.writeFile(`/data/saves/game.sav`, uint8);
                if (typeof gm.loadSaveFiles === 'function') gm.loadSaveFiles();
              }
            } catch (e) {
              console.warn('Error inyectando copia restaurada en emulador:', e);
            }
          }

          // 4. Si hay carpeta vinculada en disco, escribir
          if (this.directoryHandle) {
            try {
              const fileHandle = await this.directoryHandle.getFileHandle(`${baseName}.sav`, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(uint8);
              await writable.close();
            } catch (e) {}
          }

          // 5. Subir a la nube como versión más reciente
          if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
            window.cloudSaveManager.uploadCloudSave(uint8, baseName);
          }

          const timeStr = new Date(record.timestamp).toLocaleTimeString();
          this.showToast(`🔄 Partida restaurada con éxito (${timeStr})`, 'success');
          resolve(true);
        };

        req.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  /**
   * Descarga un archivo .sav de una copia de seguridad histórica específica
   */
  async exportBackupAsFile(backupId) {
    if (!this.db || !backupId) return;
    try {
      const tx = this.db.transaction('backups', 'readonly');
      const store = tx.objectStore('backups');
      const req = store.get(backupId);

      req.onsuccess = () => {
        const record = req.result;
        if (record && record.data) {
          const dateStr = new Date(record.timestamp).toISOString().replace(/[:.]/g, '-').substring(0, 19);
          const filename = `${record.romName || 'save'}_backup_${dateStr}.sav`;
          this.generateSavFileDownload(record.data, filename);
        }
      };
    } catch (e) {
      console.warn('Error exportando backup:', e);
    }
  }

  /**
   * Elimina una copia de seguridad individual de la Bóveda
   */
  async deleteBackup(backupId) {
    if (!this.db || !backupId) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('backups', 'readwrite');
        const req = tx.objectStore('backups').delete(backupId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Obtiene el registro completo de guardado local de IndexedDB con metadatos
   */
  async getLocalSaveRecord(romName) {
    if (!this.db) return null;
    const baseName = this.sanitizeName(romName || this.currentRomName);
    const candidateKeys = [
      `${baseName}.sav`,
      `${baseName}.dsv`,
      `${romName}.sav`,
      `game.sav`,
      `last_known_good_${baseName}.sav`
    ];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('saves', 'readonly');
        const store = tx.objectStore('saves');

        let foundRecord = null;
        let pending = candidateKeys.length;

        candidateKeys.forEach((key) => {
          const req = store.get(key);
          req.onsuccess = () => {
            if (req.result && req.result.data && req.result.data.length > 0 && !foundRecord) {
              foundRecord = req.result;
            }
            pending--;
            if (pending === 0) resolve(foundRecord);
          };
          req.onerror = () => {
            pending--;
            if (pending === 0) resolve(foundRecord);
          };
        });
      } catch (e) {
        resolve(null);
      }
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
      if (label) label.textContent = 'Guardado: iOS Bóveda & DB';
      if (statusItem) {
        statusItem.classList.add('active');
        statusItem.setAttribute('title', 'Bóveda de guardados persistente con Time-Machine y exportación a Archivos de iOS');
      }
      if (modalPath) modalPath.textContent = 'Modo iOS: Partidas guardadas en memoria persistente protegida';
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
        this.showToast('📱 En iOS las partidas se protegen automáticamente en la Bóveda local y en la Nube.', 'info');
      } else {
        this.showToast('ℹ️ Tu navegador no soporta File System Access API directa. Las partidas se guardan con seguridad en la Bóveda.', 'info');
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

      if (this.db) {
        const tx = this.db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ id: 'soulsilver_dir', handle: handle });
      }

      this.updateFolderStatusUI(handle.name, true);
      this.showToast(`📁 Carpeta "${handle.name}" vinculada con éxito. Partidas sincronizadas directamente.`, 'success');
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
   * Guarda los datos de partida con protección acorazada:
   * 1. Validación de SRAM real vs vacía
   * 2. Snapshot de seguridad previo antes de sobreescribir
   * 3. Escritura en múltiples ranuras de IndexedDB
   * 4. Escritura en disco si está vinculado
   * 5. Sincronización en la nube PubNub con metadatos
   */
  async saveGameData(saveData, customFileName, isAutoSave = false, forceDownload = false, showPrompt = false, source = 'local') {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      return false;
    }

    const uint8Data = saveData instanceof Uint8Array ? saveData : (saveData instanceof ArrayBuffer ? new Uint8Array(saveData) : null);
    if (!uint8Data) return false;

    // VALIDACIÓN ANTI-VACÍO: Si es auto-guardado y los datos son SRAM en blanco o no válida, ignorar
    if (isAutoSave && !this.isSramValidAndProgressed(uint8Data)) {
      return false;
    }

    const baseName = this.sanitizeName(this.currentRomName);
    const filename = customFileName || `${baseName}.sav`;
    const newHash = this.computeHash(uint8Data);

    // Evitar escrituras repetidas redundantes con idéntico hash
    if (isAutoSave && this.lastSavedHash === newHash) {
      return true;
    }
    this.lastSavedHash = newHash;

    // 1. CAPA TIME-MACHINE: Comprobar guardado anterior y crear Snapshot de respaldo antes de sobreescribir
    try {
      const priorSave = await this.getLocalSaveRecord(baseName);
      if (priorSave && priorSave.data && this.computeHash(priorSave.data) !== newHash) {
        await this.createBackupSnapshot(
          this.currentRomName,
          priorSave.data,
          isAutoSave ? 'auto' : 'manual',
          isAutoSave ? 'Respaldo automático previo' : 'Respaldo manual'
        );
      }
    } catch (e) {}

    // 2. Inyectar y mantener actualizado en la memoria virtual FS de EmulatorJS
    if (window.EJS_emulator?.gameManager?.FS) {
      try {
        const gm = window.EJS_emulator.gameManager;
        if (gm.FS.analyzePath('/data/saves').exists) {
          gm.FS.writeFile(`/data/saves/${baseName}.sav`, uint8Data);
          gm.FS.writeFile(`/data/saves/game.sav`, uint8Data);
        }
      } catch (e) {}
    }

    // 3. Guardar en almacenamiento primario persistente y ranuras de emergencia
    await this.saveToIndexedDB(filename, uint8Data);
    await this.saveToIndexedDB(`${baseName}.sav`, uint8Data);
    await this.saveToIndexedDB(`game.sav`, uint8Data);
    await this.saveToIndexedDB(`last_known_good_${baseName}.sav`, uint8Data);

    // 4. Si hay carpeta en disco vinculada (PC / ROG Ally), escribir directamente
    if (this.directoryHandle) {
      try {
        const fileHandle = await this.directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(uint8Data);
        await writable.close();
        if (!isAutoSave) {
          this.showToast(`💾 Partida guardada en disco: ${filename}`, 'success');
        }
      } catch (err) {
        console.error('Error escribiendo en carpeta vinculada:', err);
      }
    }

    // 5. Sincronizar en la Nube de PubNub (Cross-device Cloud Save)
    if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
      window.cloudSaveManager.uploadCloudSave(uint8Data, this.currentRomName);
    }

    // 6. Modo de guardado configurado (Descarga / Modal / Silencioso)
    if (forceDownload) {
      this.generateSavFileDownload(uint8Data, filename);
    } else if (!isAutoSave) {
      if (this.saveMode === 'auto_download') {
        this.generateSavFileDownload(uint8Data, filename);
      } else if (this.saveMode === 'ask_modal' || showPrompt) {
        this.showSaveConfirmationModal(uint8Data, filename);
      } else if (this.saveMode === 'silent') {
        this.showToast(`💾 Partida protegida en Bóveda interna: ${filename}`, 'success');
      }
    }

    return true;
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
    if (this.lastDownloadTime && (now - this.lastDownloadTime < 2500)) {
      return;
    }
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

    if (this.isIOS) {
      this.showToast(`💾 Archivo "${filename}" generado en tu iPhone.`, 'success');
    } else {
      this.showToast(`📥 Descargando archivo de guardado: ${filename}`, 'success');
    }
  }

  /**
   * Guarda partida en almacén 'saves' de IndexedDB con timestamp y hash
   */
  async saveToIndexedDB(name, data) {
    if (!this.db || !data) return;
    try {
      const uint8 = data instanceof Uint8Array ? data : (data instanceof ArrayBuffer ? new Uint8Array(data) : null);
      const tx = this.db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put({
        name: name,
        data: uint8 || data,
        size: (uint8 || data).byteLength || 0,
        hash: this.computeHash(uint8 || data),
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
   * Carga una partida existente (.sav) mediante Sincronización Inteligente Bidireccional:
   * - Consulta local (IndexedDB / Disco) y Nube (PubNub) simultáneamente.
   * - Compara timestamps y validez de contenido.
   * - El más reciente siempre gana, pero creando antes un snapshot de respaldo del otro.
   * - Si la nube está vacía o fallida, JAMÁS pisa el local.
   */
  async loadExistingSave(romName) {
    const baseName = this.sanitizeName(romName || this.currentRomName);

    // 1. Obtener partida local (IndexedDB)
    const localRecord = await this.getLocalSaveRecord(baseName);
    let localData = localRecord?.data ? (localRecord.data instanceof Uint8Array ? localRecord.data : new Uint8Array(localRecord.data)) : null;
    let localTimestamp = localRecord?.timestamp || 0;

    // 2. Comprobar en disco si hay carpeta vinculada (si es más nueva que IndexedDB)
    if (this.directoryHandle) {
      const candidateNames = [`${baseName}.sav`, `${baseName}.dsv`, `${romName}.sav`, `game.sav`];
      for (const fname of candidateNames) {
        try {
          const fileHandle = await this.directoryHandle.getFileHandle(fname);
          const file = await fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          if (arrayBuffer && arrayBuffer.byteLength > 0) {
            const diskData = new Uint8Array(arrayBuffer);
            if (file.lastModified > localTimestamp || !localData) {
              localData = diskData;
              localTimestamp = file.lastModified;
              console.log(`Partida de disco más reciente encontrada: ${fname}`);
            }
            break;
          }
        } catch (err) {}
      }
    }

    // 3. Consultar la Nube de PubNub (Cross-device Sync)
    let cloudResult = null;
    if (window.cloudSaveManager && window.cloudSaveManager.isConfigured()) {
      try {
        cloudResult = await window.cloudSaveManager.fetchLatestCloudSave(romName);
      } catch (e) {
        console.warn('Error consultando partida en PubNub Cloud:', e);
      }
    }

    // 4. Resolución Inteligente de Conflictos (Nube vs Local)
    if (cloudResult && cloudResult.data && cloudResult.data.byteLength > 0 && this.isSramValidAndProgressed(cloudResult.data)) {
      const cloudData = cloudResult.data;
      const cloudTimestamp = cloudResult.timestamp || 0;

      // CASO A: La nube es más reciente que el guardado local
      if (cloudTimestamp > localTimestamp || !localData || !this.isSramValidAndProgressed(localData)) {
        console.log(`☁️ [Cloud Sync] La nube tiene una partida más reciente (${new Date(cloudTimestamp).toLocaleString()})`);

        // Crear snapshot de seguridad del local antes de aplicar la nube
        if (localData && this.isSramValidAndProgressed(localData)) {
          await this.createBackupSnapshot(baseName, localData, 'local_pre_sync', 'Respaldo previo a sincronización de nube');
        }

        // Guardar la versión de la nube en almacenamiento local
        await this.saveToIndexedDB(`${baseName}.sav`, cloudData);
        await this.saveToIndexedDB('game.sav', cloudData);
        await this.saveToIndexedDB(`last_known_good_${baseName}.sav`, cloudData);
        await this.createBackupSnapshot(baseName, cloudData, 'cloud', 'Sincronizado desde la Nube');

        this.showToast(`☁️ Partida descargada de la Nube (${new Date(cloudTimestamp).toLocaleTimeString()})`, 'success');
        this.lastSavedHash = this.computeHash(cloudData);
        return cloudData;
      }
      // CASO B: El guardado local es más reciente que la nube
      else if (localData && localTimestamp > cloudTimestamp) {
        console.log(`💻 [Cloud Sync] La partida local es más reciente (${new Date(localTimestamp).toLocaleString()}). Actualizando la Nube...`);
        // Actualizar la nube en segundo plano con el progreso local más reciente
        window.cloudSaveManager.uploadCloudSave(localData, romName);
        this.showToast(`💻 Partida local cargada y sincronizada a la Nube`, 'success');
        this.lastSavedHash = this.computeHash(localData);
        return localData;
      }
    }

    // 5. Si no hay nube o la nube era más antigua/falló, usar el guardado local protegido
    if (localData && localData.byteLength > 0 && this.isSramValidAndProgressed(localData)) {
      console.log(`✅ [Save Load] Partida local cargada con éxito (${localData.byteLength} bytes)`);
      this.lastSavedHash = this.computeHash(localData);
      return localData;
    }

    // 6. Si no hay partida válida previa, buscar si hay una última versión conocida en la Bóveda
    const backups = await this.getBackupsForRom(baseName);
    if (backups.length > 0 && backups[0].data && this.isSramValidAndProgressed(backups[0].data)) {
      console.log(`🛡️ [Bóveda Time-Machine] Recuperada última partida de la Bóveda (${backups[0].id})`);
      const recoveredData = backups[0].data instanceof Uint8Array ? backups[0].data : new Uint8Array(backups[0].data);
      await this.saveToIndexedDB(`${baseName}.sav`, recoveredData);
      await this.saveToIndexedDB('game.sav', recoveredData);
      this.showToast(`🛡️ Partida restaurada desde la Bóveda de Seguridad`, 'info');
      this.lastSavedHash = this.computeHash(recoveredData);
      return recoveredData;
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
      if (gm.FS) {
        if (!gm.FS.analyzePath('/data').exists) gm.FS.mkdir('/data');
        if (!gm.FS.analyzePath('/data/saves').exists) gm.FS.mkdir('/data/saves');

        for (const p of targetPaths) {
          try {
            if (gm.FS.analyzePath(p).exists) gm.FS.unlink(p);
            gm.FS.writeFile(p, saveData);
          } catch (e) {}
        }

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

    if (window.EJS_emulator && window.EJS_emulator.gameManager) {
      try {
        const gm = window.EJS_emulator.gameManager;
        if (typeof gm.saveSaveFiles === 'function') gm.saveSaveFiles();
        if (typeof gm.getSaveFile === 'function') saveData = gm.getSaveFile();
      } catch (e) {
        console.warn('Error extrayendo saveFile de gameManager:', e);
      }
    }

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

  /**
   * Guarda una ROM en el almacenamiento persistente de IndexedDB
   */
  async saveRom(file) {
    if (!this.db || !file) return;
    try {
      const name = file.name || this.currentRomName || 'Pokemon - Edicion Plata SoulSilver.nds';
      const cleanTitle = name.replace(/\.(nds|zip|7z)$/i, '');

      let arrayBuffer;
      if (file instanceof ArrayBuffer) {
        arrayBuffer = file;
      } else if (file instanceof Uint8Array) {
        arrayBuffer = file.buffer;
      } else if (typeof file.arrayBuffer === 'function') {
        arrayBuffer = await file.arrayBuffer();
      } else {
        const reader = new FileReader();
        arrayBuffer = await new Promise((res, rej) => {
          reader.onload = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsArrayBuffer(file);
        });
      }

      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        return;
      }

      const uint8 = new Uint8Array(arrayBuffer);
      const record = {
        name: name,
        cleanTitle: cleanTitle,
        size: file.size || uint8.byteLength || 0,
        lastPlayed: Date.now(),
        data: uint8
      };

      const tx = this.db.transaction('roms', 'readwrite');
      tx.objectStore('roms').put(record);
      await new Promise((res) => {
        tx.oncomplete = res;
        tx.onerror = res;
      });
      console.log(`[SaveManager] ROM guardada permanentemente: ${name} (${record.size} bytes)`);
    } catch (err) {
      console.warn('Error guardando ROM en IndexedDB:', err);
    }
  }

  /**
   * Obtiene todas las ROMs guardadas ordenadas por última jugada
   */
  async getAllRecentRoms() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('roms', 'readonly');
        const store = tx.objectStore('roms');
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  /**
   * Elimina una ROM de la lista de recientes en IndexedDB
   */
  async deleteRom(name) {
    if (!this.db) return false;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('roms', 'readwrite');
        const req = tx.objectStore('roms').delete(name);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  /**
   * Actualiza el timestamp de última partida de una ROM
   */
  async updateRomLastPlayed(name) {
    if (!this.db || !name) return;
    try {
      const tx = this.db.transaction('roms', 'readwrite');
      const store = tx.objectStore('roms');
      const req = store.get(name);
      req.onsuccess = () => {
        if (req.result) {
          const record = req.result;
          record.lastPlayed = Date.now();
          store.put(record);
        }
      };
    } catch (err) {}
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
