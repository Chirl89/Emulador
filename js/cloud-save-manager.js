/**
 * NDS Web Emulator - Cloud Save Manager
 * Sincronización en tiempo real y persistencia en la nube entre iPhone, PC y ROG Ally
 * Utiliza credenciales PubNub con canal dinámico por cada ROM (${romName}-save)
 * Versión: v0.3.16
 */

class CloudSaveManager {
  constructor() {
    this.pubnub = null;
    // Por defecto usa las credenciales demo de PubNub (como en FitDuo), o las personalizadas del usuario
    this.publishKey = localStorage.getItem('pubnub_pub_key') || 'demo';
    this.subscribeKey = localStorage.getItem('pubnub_sub_key') || 'demo';
    this.userId = localStorage.getItem('pubnub_user_id') || ('user_' + Math.random().toString(36).substring(2, 9));
    this.isUploading = false;
    this.lastUploadTime = 0;
    this.currentChannel = 'game-save';

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
   * Descarga la partida (.sav) más reciente desde el canal único del juego
   * @param {string} romName Nombre del archivo ROM
   * @returns {Promise<Uint8Array|null>}
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

      // Buscar mensajes de tipo nds_cloud_save
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

      // Agrupar por syncId para obtener la versión más reciente
      const syncGroups = {};
      for (const msg of saveMessages) {
        if (!syncGroups[msg.syncId]) {
          syncGroups[msg.syncId] = {
            timestamp: msg.timestamp || 0,
            totalChunks: msg.totalChunks || 1,
            chunks: {}
          };
        }
        syncGroups[msg.syncId].chunks[msg.chunkIndex] = msg.data;
      }

      // Ordenar syncIds por timestamp descendente
      const sortedSyncIds = Object.keys(syncGroups).sort((a, b) => syncGroups[b].timestamp - syncGroups[a].timestamp);
      const latestSyncId = sortedSyncIds[0];
      const latestGroup = syncGroups[latestSyncId];

      // Reconstruir los chunks en orden
      let fullBase64 = '';
      for (let i = 0; i < latestGroup.totalChunks; i++) {
        if (latestGroup.chunks[i] === undefined) {
          console.warn(`☁️ [PubNub Cloud] Falta el bloque ${i} de la versión ${latestSyncId}`);
          return null;
        }
        fullBase64 += latestGroup.chunks[i];
      }

      const uint8 = this.base64ToUint8(fullBase64);
      if (uint8 && uint8.byteLength > 0) {
        console.log(`☁️ [PubNub Cloud] ✅ Partida "${channel}" descargada con éxito (${uint8.byteLength} bytes).`);
        this.updateUIStatus('connected');
        return uint8;
      }
    } catch (err) {
      console.warn(`☁️ [PubNub Cloud] Error descargando partida de "${channel}":`, err);
      this.updateUIStatus('error');
    }

    return null;
  }

  /**
   * Sube y sobreescribe la partida (.sav) en el canal único del juego
   * @param {Uint8Array|ArrayBuffer|Blob} saveData Datos binarios del archivo .sav
   * @param {string} romName Nombre de la ROM
   */
  async uploadCloudSave(saveData, romName) {
    if (!saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      return false;
    }

    const now = Date.now();
    if (this.isUploading || (now - this.lastUploadTime < 3000)) {
      return false;
    }

    const channel = this.getChannelForRom(romName);
    this.currentChannel = channel;
    const pubKey = (this.publishKey || 'demo').trim();
    const subKey = (this.subscribeKey || 'demo').trim();

    let uint8Data = saveData;
    if (saveData instanceof Blob) {
      uint8Data = new Uint8Array(await saveData.arrayBuffer());
    } else if (saveData instanceof ArrayBuffer) {
      uint8Data = new Uint8Array(saveData);
    }

    this.isUploading = true;
    this.lastUploadTime = now;
    this.updateUIStatus('uploading');

    try {
      const base64Data = this.uint8ToBase64(uint8Data);
      const chunkSize = 24000; // ~24KB por bloque para cumplir con el límite de PubNub
      const totalChunks = Math.ceil(base64Data.length / chunkSize);
      const syncId = 'save_' + now + '_' + Math.random().toString(36).substring(2, 6);

      console.log(`☁️ [PubNub Cloud] Subiendo "${channel}" (${uint8Data.byteLength} bytes en ${totalChunks} bloques)...`);

      // Publicar todos los bloques en paralelo
      const publishPromises = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64Data.substring(i * chunkSize, (i + 1) * chunkSize);
        const payload = {
          type: 'nds_cloud_save',
          rom: channel,
          syncId: syncId,
          timestamp: now,
          chunkIndex: i,
          totalChunks: totalChunks,
          data: chunk
        };

        const encoded = encodeURIComponent(JSON.stringify(payload));
        const pubUrl = `https://ps.pubnub.com/publish/${pubKey}/${subKey}/0/${channel}/0/${encoded}`;
        publishPromises.push(fetch(pubUrl));
      }

      await Promise.all(publishPromises);

      console.log(`☁️ [PubNub Cloud] ✅ Partida subida a "${channel}" con éxito.`);
      this.updateUIStatus('connected');

      if (window.saveManager) {
        window.saveManager.showToast(`☁️ Partida guardada en la Nube (${channel})`, 'success');
      }

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
   * Conversión rápida de Uint8Array a Base64 segura para memoria
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

