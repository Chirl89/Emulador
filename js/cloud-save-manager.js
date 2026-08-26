/**
 * NDS Web Emulator - Cloud Save Manager
 * Sincronización bidireccional en tiempo real y persistencia en la nube
 * Validación de integridad por chunks, timestamps y resolución de conflictos
 * Versión: v0.9.0
 */

class CloudSaveManager {
  constructor() {
    this.pubnub = null;
    this.publishKey = localStorage.getItem('pubnub_pub_key') || 'demo';
    this.subscribeKey = localStorage.getItem('pubnub_sub_key') || 'demo';
    this.userId = localStorage.getItem('pubnub_user_id') || ('user_' + Math.random().toString(36).substring(2, 9));
    this.isUploading = false;
    this.lastUploadTime = 0;
    this.currentChannel = 'game-save';
    this.lastCloudMeta = null;

    localStorage.setItem('pubnub_user_id', this.userId);
    this.initPubNub();
  }

  /**
   * Genera el nombre de canal único y aislado para cada ROM
   * Formato: ${nombre_del_juego}-save (ej. pokemon_edicion_plata_soulsilver-save)
   */
  getChannelForRom(romName) {
    const rawName = (romName || window.app?.currentRomName || 'Pokemon - Edicion Plata SoulSilver')
      .replace(/\.(nds|zip|7z|sav|dsv)$/i, '')
      .trim();

    const cleanName = rawName
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar tildes y acentos
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase()
      .replace(/^_|_$/g, '');

    return `${cleanName || 'game'}-save`;
  }

  /**
   * Inicializa la instancia de PubNub
   */
  initPubNub() {
    const pubKey = (this.publishKey || 'demo').trim();
    const subKey = (this.subscribeKey || 'demo').trim();

    try {
      if (typeof PubNub !== 'undefined') {
        this.pubnub = new PubNub({
          publishKey: pubKey,
          subscribeKey: subKey,
          userId: this.userId.trim()
        });
      }
      this.updateUIStatus('connected');
      return true;
    } catch (err) {
      console.error('Error inicializando PubNub:', err);
      this.updateUIStatus('error');
      return false;
    }
  }

  isConfigured() {
    return Boolean(this.publishKey && this.subscribeKey);
  }

  /**
   * Guarda credenciales personalizadas si el usuario las introduce en Ajustes
   */
  saveCredentials(pubKey, subKey) {
    this.publishKey = (pubKey || 'demo').trim();
    this.subscribeKey = (subKey || 'demo').trim();

    localStorage.setItem('pubnub_pub_key', this.publishKey);
    localStorage.setItem('pubnub_sub_key', this.subscribeKey);

    return this.initPubNub();
  }

  /**
   * Prueba la conexión con PubNub
   */
  async testConnection(pubKey, subKey) {
    const testPubKey = (pubKey || this.publishKey || 'demo').trim();
    const testSubKey = (subKey || this.subscribeKey || 'demo').trim();
    const testChannel = 'nds_sync_test_ping';

    try {
      const url = `https://ps.pubnub.com/publish/${testPubKey}/${testSubKey}/0/${testChannel}/0/${encodeURIComponent(JSON.stringify({ ping: true, time: Date.now() }))}`;
      const res = await fetch(url);
      if (res.ok) {
        return { success: true, message: '¡Conexión con PubNub establecida con éxito! ☁️' };
      } else {
        return { success: false, message: `Error de respuesta PubNub (HTTP ${res.status}).` };
      }
    } catch (err) {
      return { success: false, message: 'Error conectando con PubNub: ' + err.message };
    }
  }

  /**
   * Descarga la partida (.sav) más reciente desde el canal único del juego con metadatos
   * @param {string} romName Nombre del archivo ROM
   * @returns {Promise<{data: Uint8Array, timestamp: number, syncId: string, byteLength: number, hash: number}|null>}
   */
  async fetchLatestCloudSave(romName) {
    const channel = this.getChannelForRom(romName);
    this.currentChannel = channel;
    const subKey = (this.subscribeKey || 'demo').trim();

    try {
      this.updateUIStatus('downloading');
      console.log(`☁️ [PubNub Cloud] Consultando partida en canal: "${channel}"...`);

      const historyUrl = `https://ps.pubnub.com/v2/history/sub-key/${subKey}/channel/${channel}?count=100&include_token=true`;
      const res = await fetch(historyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const messages = (json && json[0]) ? json[0] : [];

      if (!messages || messages.length === 0) {
        console.log(`☁️ [PubNub Cloud] No hay partida guardada en la nube aún para el canal "${channel}".`);
        this.updateUIStatus('connected');
        return null;
      }

      // Buscar mensajes válidos de tipo nds_cloud_save
      const saveMessages = [];
      for (const item of messages) {
        const msg = (item && item.message) ? item.message : item;
        if (msg && msg.type === 'nds_cloud_save' && msg.syncId) {
          saveMessages.push(msg);
        }
      }

      if (saveMessages.length === 0) {
        console.log(`☁️ [PubNub Cloud] Sin bloques de guardado válidos en "${channel}".`);
        this.updateUIStatus('connected');
        return null;
      }

      // Agrupar por syncId para reconstruir la versión más reciente
      const syncGroups = {};
      const nowMax = Date.now() + 86400000; // Máximo 24h en el futuro por desfase horario
      for (const msg of saveMessages) {
        const msgTime = Number(msg.timestamp) || 0;
        if (msgTime > nowMax) continue; // Descartar timestamps corruptos del futuro lejano

        if (!syncGroups[msg.syncId]) {
          syncGroups[msg.syncId] = {
            syncId: msg.syncId,
            timestamp: msgTime,
            totalChunks: Number(msg.totalChunks) || 1,
            byteLength: Number(msg.byteLength) || 0,
            hash: Number(msg.hash) || 0,
            chunks: {}
          };
        }
        syncGroups[msg.syncId].chunks[msg.chunkIndex] = msg.data;
      }

      // Ordenar syncIds por timestamp descendente
      const sortedSyncIds = Object.keys(syncGroups).sort((a, b) => (syncGroups[b].timestamp || 0) - (syncGroups[a].timestamp || 0));

      // Buscar el grupo más reciente que tenga TODOS sus chunks completos
      let completeGroup = null;
      for (const sId of sortedSyncIds) {
        const group = syncGroups[sId];
        let isComplete = true;
        for (let i = 0; i < group.totalChunks; i++) {
          if (group.chunks[i] === undefined) {
            isComplete = false;
            break;
          }
        }
        if (isComplete) {
          completeGroup = group;
          break;
        }
      }

      if (!completeGroup) {
        console.warn(`☁️ [PubNub Cloud] No se encontraron versiones completas de chunks en "${channel}"`);
        this.updateUIStatus('connected');
        return null;
      }

      // Reconstruir los chunks en orden
      let fullBase64 = '';
      for (let i = 0; i < completeGroup.totalChunks; i++) {
        fullBase64 += completeGroup.chunks[i];
      }

      const uint8 = this.base64ToUint8(fullBase64);
      const isSramOk = (window.saveManager && typeof window.saveManager.isSramValidAndProgressed === 'function')
        ? window.saveManager.isSramValidAndProgressed(uint8)
        : (uint8 && uint8.byteLength >= 512);

      if (uint8 && uint8.byteLength >= 512 && isSramOk) {
        console.log(`☁️ [PubNub Cloud] ✅ Partida "${channel}" reconstruida con éxito (${uint8.byteLength} bytes, fecha: ${new Date(completeGroup.timestamp).toLocaleString()}).`);
        this.updateUIStatus('connected');

        this.lastCloudMeta = {
          syncId: completeGroup.syncId,
          timestamp: completeGroup.timestamp,
          byteLength: uint8.byteLength,
          hash: completeGroup.hash || (window.saveManager?.computeHash(uint8) || 0)
        };

        return {
          data: uint8,
          timestamp: completeGroup.timestamp,
          syncId: completeGroup.syncId,
          byteLength: uint8.byteLength,
          hash: this.lastCloudMeta.hash
        };
      }
    } catch (err) {
      console.warn(`☁️ [PubNub Cloud] Error descargando partida de "${channel}":`, err);
      this.updateUIStatus('error');
    }

    return null;
  }

  /**
   * Sube la partida (.sav) al canal único del juego con metadatos completos y chunks seguros
   * @param {Uint8Array|ArrayBuffer|Blob} saveData Datos binarios del archivo .sav
   * @param {string} romName Nombre de la ROM
   * @param {number} customTimestamp Marca de tiempo sincronizada con el guardado local
   */
  async uploadCloudSave(saveData, romName, customTimestamp = null) {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      return false;
    }

    let uint8Data = saveData;
    if (saveData instanceof Blob) {
      uint8Data = new Uint8Array(await saveData.arrayBuffer());
    } else if (saveData instanceof ArrayBuffer) {
      uint8Data = new Uint8Array(saveData);
    }

    // VALIDACIÓN ANTI-VACÍO: Evitar subir SRAM en blanco o corrupta
    if (window.saveManager && !window.saveManager.isSramValidAndProgressed(uint8Data)) {
      console.log('☁️ [PubNub Cloud] Guardado omitido: SRAM no inicializada o sin progreso.');
      return false;
    }

    const now = Number(customTimestamp) || Date.now();
    const channel = this.getChannelForRom(romName);
    this.currentChannel = channel;
    const pubKey = (this.publishKey || 'demo').trim();
    const subKey = (this.subscribeKey || 'demo').trim();
    const hash = window.saveManager ? window.saveManager.computeHash(uint8Data) : 0;

    this.isUploading = true;
    this.lastUploadTime = now;
    this.updateUIStatus('uploading');

    try {
      const base64Data = this.uint8ToBase64(uint8Data);
      const chunkSize = 24000; // ~24KB por bloque para cumplir con el límite de PubNub
      const totalChunks = Math.ceil(base64Data.length / chunkSize);
      const syncId = 'save_' + now + '_' + Math.random().toString(36).substring(2, 6);

      console.log(`☁️ [PubNub Cloud] Subiendo "${channel}" (fecha: ${new Date(now).toLocaleTimeString()}, ${uint8Data.byteLength} bytes en ${totalChunks} bloques)...`);

      // Publicar todos los bloques en paralelo con metadatos
      const publishPromises = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64Data.substring(i * chunkSize, (i + 1) * chunkSize);
        const payload = {
          type: 'nds_cloud_save',
          rom: channel,
          syncId: syncId,
          timestamp: now,
          byteLength: uint8Data.byteLength,
          hash: hash,
          chunkIndex: i,
          totalChunks: totalChunks,
          isVerifiedSave: true,
          version: 'v0.9.0',
          data: chunk
        };

        const encoded = encodeURIComponent(JSON.stringify(payload));
        const pubUrl = `https://ps.pubnub.com/publish/${pubKey}/${subKey}/0/${channel}/0/${encoded}`;
        publishPromises.push(
          fetch(pubUrl).then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json().catch(() => ({}));
          })
        );
      }

      await Promise.all(publishPromises);

      this.lastCloudMeta = {
        syncId: syncId,
        timestamp: now,
        byteLength: uint8Data.byteLength,
        hash: hash
      };

      console.log(`☁️ [PubNub Cloud] ✅ Partida subida a "${channel}" con éxito (Timestamp: ${now}).`);
      this.updateUIStatus('connected');
      this.isUploading = false;
      return true;
    } catch (err) {
      console.error(`☁️ [PubNub Cloud] Error subiendo a "${channel}":`, err);
      this.updateUIStatus('error');
      this.isUploading = false;
      return false;
    }
  }

  /**
   * Forzar subida manual de la partida actual
   */
  async forceCloudUpload(romName) {
    if (!window.saveManager) return false;
    const rec = await window.saveManager.getLocalSaveRecord(romName || window.app?.currentRomName);
    if (!rec || !rec.data) {
      window.saveManager.showToast('⚠️ No hay partida local para subir.', 'warning');
      return false;
    }
    const ok = await this.uploadCloudSave(rec.data, romName || window.app?.currentRomName, Number(rec.timestamp) || Date.now());
    if (ok) {
      window.saveManager.showToast('☁️ Partida local subida a la Nube con éxito.', 'success');
    }
    return ok;
  }

  /**
   * Forzar descarga manual del respaldo desde la Nube
   */
  async forceCloudDownload(romName) {
    if (!window.saveManager) return false;
    const name = romName || window.app?.currentRomName;
    const cloudRes = await this.fetchLatestCloudSave(name);
    if (cloudRes && cloudRes.data) {
      const baseName = window.saveManager.sanitizeName(name);
      const filename = `${baseName}.sav`;
      const cTimestamp = Number(cloudRes.timestamp) || Date.now();

      await window.saveManager.saveToIndexedDB(filename, cloudRes.data, cTimestamp);
      if (window.saveManager.directoryHandle) {
        window.saveManager.writeToDisk(filename, cloudRes.data).catch(() => {});
      }
      window._activeRomSaveData = cloudRes.data;
      window.saveManager.lastSavedHash = window.saveManager.computeHash(cloudRes.data);
      if (window.app) window.app.lastSavedHash = window.app.computeSaveHash(cloudRes.data);

      if (window.EJS_emulator?.gameManager?.FS) {
        try {
          const gm = window.EJS_emulator.gameManager;
          if (window.app && typeof window.app.injectSaveFilesToFS === 'function') {
            window.app.injectSaveFilesToFS(gm.FS, cloudRes.data, name);
          }
          if (typeof gm.loadSaveFiles === 'function') gm.loadSaveFiles();
        } catch (e) {}
      }

      window.saveManager.showToast(`☁️ Respaldo de la Nube restaurado con éxito (${new Date(cTimestamp).toLocaleTimeString()})`, 'success');
      return true;
    } else {
      window.saveManager.showToast('⚠️ No se encontró partida en la Nube.', 'warning');
      return false;
    }
  }

  /**
   * Conversión rápida de Uint8Array a Base64
   */
  uint8ToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 0x8000;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
  }

  /**
   * Conversión rápida de Base64 a Uint8Array
   */
  base64ToUint8(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Actualiza el indicador visual de estado en la cabecera
   */
  updateUIStatus(status) {
    const statusItem = document.getElementById('cloud-status');
    const label = document.getElementById('cloud-status-label');

    if (!statusItem || !label) return;

    statusItem.className = 'status-item';
    const channelName = this.currentChannel || 'soulsilver-save';

    switch (status) {
      case 'connected':
        statusItem.classList.add('active');
        label.textContent = `Nube: Conectada (${channelName})`;
        statusItem.setAttribute('title', `Sincronización activa en canal "${channelName}"`);
        break;
      case 'uploading':
        statusItem.classList.add('active');
        label.textContent = 'Nube: Guardando... ☁️';
        break;
      case 'downloading':
        statusItem.classList.add('active');
        label.textContent = 'Nube: Descargando... ☁️';
        break;
      case 'error':
        statusItem.classList.add('error');
        label.textContent = 'Nube: Error de conexión';
        break;
      default:
        label.textContent = 'Nube: Conectada';
        break;
    }
  }
}

// Instancia global
window.cloudSaveManager = new CloudSaveManager();
