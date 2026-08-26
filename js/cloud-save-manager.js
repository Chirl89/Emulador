/**
 * NDS Web Emulator - Cloud Save Manager
 * Sincronización pasiva en la nube y persistencia con marca de tiempo obligatoria
 * Purga de mensajes sin timestamp y validación estricta de integridad
 * Versión: v0.9.3
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
   */
  getChannelForRom(romName) {
    const rawName = (romName || window.app?.currentRomName || 'Pokemon - Edicion Plata SoulSilver')
      .replace(/\.(nds|zip|7z|sav|dsv)$/i, '')
      .trim();

    const cleanName = rawName
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
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

  saveCredentials(pubKey, subKey) {
    this.publishKey = (pubKey || 'demo').trim();
    this.subscribeKey = (subKey || 'demo').trim();

    localStorage.setItem('pubnub_pub_key', this.publishKey);
    localStorage.setItem('pubnub_sub_key', this.subscribeKey);

    return this.initPubNub();
  }

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
   * Purga el canal en PubNub para eliminar historial residual o corrupto
   */
  async purgeCloudChannel(romName) {
    const channel = this.getChannelForRom(romName);
    const subKey = (this.subscribeKey || 'demo').trim();
    console.log(`🧹 [PubNub Cloud] Purgando mensajes en canal "${channel}"...`);

    try {
      if (this.pubnub && typeof this.pubnub.deleteMessages === 'function') {
        await this.pubnub.deleteMessages({ channel: channel });
        console.log(`🧹 [PubNub Cloud] Canal "${channel}" vaciado vía SDK.`);
        return true;
      }
    } catch (e) {
      console.warn('Error en deleteMessages SDK:', e);
    }

    try {
      const deleteUrl = `https://ps.pubnub.com/v3/history/sub-key/${subKey}/channel/${channel}`;
      const res = await fetch(deleteUrl, { method: 'DELETE' });
      if (res.ok) {
        console.log(`🧹 [PubNub Cloud] Canal "${channel}" vaciado vía REST.`);
        return true;
      }
    } catch (e) {
      console.warn('Error en deleteMessages REST:', e);
    }
    return false;
  }

  /**
   * Descarga la partida (.sav) más reciente desde el canal único de la ROM
   * PURGA automáticamente cualquier mensaje que carezca de marca de tiempo válida
   */
  async fetchLatestCloudSave(romName) {
    const channel = this.getChannelForRom(romName);
    this.currentChannel = channel;
    const subKey = (this.subscribeKey || 'demo').trim();

    try {
      this.updateUIStatus('downloading');
      console.log(`☁️ [PubNub Cloud] Consultando partida en canal: "${channel}"...`);

      const historyUrl = `https://ps.pubnub.com/v2/history/sub-key/${subKey}/channel/${channel}?count=100&include_token=true`;
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
      const res = await fetch(historyUrl, controller ? { signal: controller.signal } : {});
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const messages = (json && json[0]) ? json[0] : [];

      if (!messages || messages.length === 0) {
        console.log(`☁️ [PubNub Cloud] No hay partida guardada en la nube aún para "${channel}".`);
        this.updateUIStatus('connected');
        return null;
      }

      // Buscar mensajes válidos de tipo nds_cloud_save con timestamp ESTRICTAMENTE POSITIVO
      const saveMessages = [];
      let foundInvalidWithoutTimestamp = false;

      for (const item of messages) {
        const msg = (item && item.message) ? item.message : item;
        if (msg && msg.type === 'nds_cloud_save' && msg.syncId) {
          const ts = Number(msg.timestamp);
          if (!ts || isNaN(ts) || ts <= 0) {
            foundInvalidWithoutTimestamp = true;
          } else {
            saveMessages.push(msg);
          }
        }
      }

      // Si hay mensajes corruptos sin fecha y no hay ninguno válido, purgar canal
      if (foundInvalidWithoutTimestamp && saveMessages.length === 0) {
        console.warn(`🧹 [PubNub Cloud] Mensajes sin marca de tiempo detectados en "${channel}". Purgando canal...`);
        this.purgeCloudChannel(romName).catch(() => {});
        this.updateUIStatus('connected');
        return null;
      }

      if (saveMessages.length === 0) {
        this.updateUIStatus('connected');
        return null;
      }

      // Agrupar por syncId
      const syncGroups = {};
      const nowMax = Date.now() + 86400000; // Máximo 24h en el futuro
      for (const msg of saveMessages) {
        const msgTime = Number(msg.timestamp);
        if (!msgTime || isNaN(msgTime) || msgTime <= 0 || msgTime > nowMax) continue;

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

      // Ordenar syncIds por timestamp descendente (más reciente primero)
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

      // Reconstruir chunks
      let fullBase64 = '';
      for (let i = 0; i < completeGroup.totalChunks; i++) {
        fullBase64 += completeGroup.chunks[i];
      }

      const uint8 = this.base64ToUint8(fullBase64);
      const isSramOk = (window.saveManager && typeof window.saveManager.isSramValidAndProgressed === 'function')
        ? window.saveManager.isSramValidAndProgressed(uint8)
        : (uint8 && uint8.byteLength >= 512);

      if (uint8 && uint8.byteLength >= 512 && isSramOk && completeGroup.timestamp > 0) {
        console.log(`☁️ [PubNub Cloud] ✅ Partida "${channel}" reconstruida (${uint8.byteLength} bytes, Fecha: ${new Date(completeGroup.timestamp).toLocaleString()}).`);
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
   * Sube la partida (.sav) al canal único del juego con marca de tiempo garantizada
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

    // Validación anti-vacío
    if (window.saveManager && !window.saveManager.isSramValidAndProgressed(uint8Data)) {
      console.log('☁️ [PubNub Cloud] Guardado omitido: SRAM no inicializada o sin progreso.');
      return false;
    }

    // Timestamp SIEMPRE obligatorio
    const now = (customTimestamp && Number(customTimestamp) > 0) ? Number(customTimestamp) : Date.now();
    const channel = this.getChannelForRom(romName);
    this.currentChannel = channel;
    const pubKey = (this.publishKey || 'demo').trim();
    const subKey = (this.subscribeKey || 'demo').trim();
    const hash = window.saveManager ? window.saveManager.computeHash(uint8Data) : 0;

    const base64Data = this.uint8ToBase64(uint8Data);
    const chunkSize = 24 * 1024;
    const totalChunks = Math.ceil(base64Data.length / chunkSize);
    const syncId = `save_${now}_${Math.random().toString(36).substring(2, 7)}`;

    console.log(`☁️ [PubNub Cloud] Subiendo guardado "${channel}" (${uint8Data.byteLength}B en ${totalChunks} chunks, Timestamp: ${now} [${new Date(now).toLocaleString()}])`);
    this.isUploading = true;
    this.updateUIStatus('uploading');

    let successCount = 0;
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
        version: 'v0.9.3',
        data: chunk
      };

      try {
        const url = `https://ps.pubnub.com/publish/${pubKey}/${subKey}/0/${channel}/0/${encodeURIComponent(JSON.stringify(payload))}`;
        const res = await fetch(url);
        if (res.ok) {
          successCount++;
        }
      } catch (err) {
        console.warn(`Error enviando chunk ${i + 1}/${totalChunks} a PubNub:`, err);
      }
    }

    this.isUploading = false;
    if (successCount === totalChunks) {
      this.lastUploadTime = now;
      this.lastCloudMeta = { syncId, timestamp: now, byteLength: uint8Data.byteLength, hash };
      this.updateUIStatus('connected');
      console.log(`☁️ [PubNub Cloud] ✅ Respaldo completado en canal "${channel}".`);
      return true;
    } else {
      console.warn(`☁️ [PubNub Cloud] Subida incompleta (${successCount}/${totalChunks} chunks).`);
      this.updateUIStatus('error');
      return false;
    }
  }

  /**
   * Fuerza la restauración manual desde la Nube hacia Local
   */
  async forceCloudDownload(romName) {
    const channel = this.getChannelForRom(romName);
    const baseName = window.saveManager ? window.saveManager.sanitizeName(romName) : 'game';
    const filename = `${baseName}.sav`;

    const cloudSave = await this.fetchLatestCloudSave(romName);
    if (cloudSave && cloudSave.data && cloudSave.data.byteLength >= 512 && cloudSave.timestamp > 0) {
      const ts = Number(cloudSave.timestamp);

      if (window.saveManager) {
        await window.saveManager.saveToIndexedDB(filename, cloudSave.data, ts);
        if (window.saveManager.directoryHandle) {
          window.saveManager.writeToDisk(filename, cloudSave.data).catch(() => {});
        }
        window.saveManager.lastSavedHash = window.saveManager.computeHash(cloudSave.data);
      }

      window._activeRomSaveData = cloudSave.data;

      // Inyectar en emulador si está corriendo
      if (window.app && window.EJS_emulator?.gameManager?.FS) {
        window.app.injectSaveFilesToFS(window.EJS_emulator.gameManager.FS, cloudSave.data, romName);
        if (typeof window.EJS_emulator.gameManager.loadSaveFiles === 'function') {
          window.EJS_emulator.gameManager.loadSaveFiles();
        }
      }

      if (window.saveManager) {
        window.saveManager.showToast(`☁️ Partida restaurada desde la Nube (${new Date(ts).toLocaleString()})`, 'success');
      }
      return true;
    } else {
      if (window.saveManager) {
        window.saveManager.showToast('⚠️ No se encontró ninguna partida con marca de tiempo válida en la nube.', 'warning');
      }
      return false;
    }
  }

  uint8ToBase64(uint8) {
    let binary = '';
    const len = uint8.byteLength;
    const chunk = 8192;
    for (let i = 0; i < len; i += chunk) {
      const sub = uint8.subarray(i, Math.min(i + chunk, len));
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }

  base64ToUint8(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  updateUIStatus(status) {
    const statusTextEl = document.getElementById('cloud-status-text');
    const badgeEl = document.getElementById('cloud-status-badge');
    const settingsBadge = document.getElementById('settings-cloud-badge');

    const updateBadge = (el, text, className) => {
      if (!el) return;
      el.textContent = text;
      el.className = `status-badge ${className}`;
    };

    if (status === 'connected') {
      if (statusTextEl) statusTextEl.textContent = '🟢 Conectado (PubNub)';
      updateBadge(badgeEl, '🟢 Conectado', 'active');
      updateBadge(settingsBadge, '🟢 Conectado', 'active');
    } else if (status === 'uploading') {
      if (statusTextEl) statusTextEl.textContent = '☁️ Sincronizando respaldo...';
      updateBadge(badgeEl, '☁️ Subiendo...', 'syncing');
      updateBadge(settingsBadge, '☁️ Subiendo...', 'syncing');
    } else if (status === 'downloading') {
      if (statusTextEl) statusTextEl.textContent = '☁️ Consultando respaldo...';
      updateBadge(badgeEl, '☁️ Descargando...', 'syncing');
      updateBadge(settingsBadge, '☁️ Descargando...', 'syncing');
    } else if (status === 'error') {
      if (statusTextEl) statusTextEl.textContent = '🔴 Error de conexión';
      updateBadge(badgeEl, '🔴 Error', 'inactive');
      updateBadge(settingsBadge, '🔴 Error', 'inactive');
    }
  }
}

// Instancia global
window.cloudSaveManager = new CloudSaveManager();
