/**
 * NDS Web Emulator - Cloud Save Manager (PubNub Files API)
 * Sincronización en tiempo real y persistencia en la nube entre iPhone, PC y ROG Ally
 * Versión: v0.3.15
 */

class CloudSaveManager {
  constructor() {
    this.pubnub = null;
    this.publishKey = localStorage.getItem('pubnub_pub_key') || '';
    this.subscribeKey = localStorage.getItem('pubnub_sub_key') || '';
    this.channel = localStorage.getItem('pubnub_channel') || 'soulsilver-cloud-saves';
    this.userId = localStorage.getItem('pubnub_user_id') || ('user_' + Math.random().toString(36).substring(2, 9));
    this.isUploading = false;
    this.lastUploadedHash = null;
    this.lastUploadTime = 0;

    localStorage.setItem('pubnub_user_id', this.userId);
    this.initPubNub();
  }

  /**
   * Inicializa la instancia del cliente PubNub si las claves están configuradas
   */
  initPubNub() {
    if (!this.publishKey || !this.subscribeKey || typeof PubNub === 'undefined') {
      this.pubnub = null;
      this.updateUIStatus('unconfigured');
      return false;
    }

    try {
      this.pubnub = new PubNub({
        publishKey: this.publishKey.trim(),
        subscribeKey: this.subscribeKey.trim(),
        userId: this.userId.trim()
      });

      console.log('✅ Cliente PubNub inicializado para canal:', this.channel);
      this.updateUIStatus('connected');
      return true;
    } catch (err) {
      console.error('Error inicializando PubNub:', err);
      this.pubnub = null;
      this.updateUIStatus('error');
      return false;
    }
  }

  isConfigured() {
    return Boolean(this.pubnub && this.publishKey && this.subscribeKey);
  }

  /**
   * Guarda las credenciales de PubNub y reinicia la conexión
   */
  saveCredentials(pubKey, subKey, channel) {
    this.publishKey = (pubKey || '').trim();
    this.subscribeKey = (subKey || '').trim();
    if (channel) this.channel = channel.trim();

    localStorage.setItem('pubnub_pub_key', this.publishKey);
    localStorage.setItem('pubnub_sub_key', this.subscribeKey);
    localStorage.setItem('pubnub_channel', this.channel);

    return this.initPubNub();
  }

  /**
   * Prueba la conexión con PubNub publicando un ping de verificación
   */
  async testConnection(pubKey, subKey, channel) {
    const testPubKey = (pubKey || this.publishKey || '').trim();
    const testSubKey = (subKey || this.subscribeKey || '').trim();
    const testChannel = (channel || this.channel || 'soulsilver-cloud-saves').trim();

    if (!testPubKey || !testSubKey) {
      return { success: false, message: 'Por favor introduce Publish Key y Subscribe Key de PubNub.' };
    }

    if (typeof PubNub === 'undefined') {
      return { success: false, message: 'El SDK de PubNub no se ha cargado. Verifica tu conexión a internet.' };
    }

    try {
      const testClient = new PubNub({
        publishKey: testPubKey,
        subscribeKey: testSubKey,
        userId: 'tester_' + Math.random().toString(36).substring(2, 7)
      });

      // Publicar mensaje de prueba rápido
      await testClient.publish({
        channel: testChannel + '_ping',
        message: { ping: true, time: Date.now() }
      });

      return { success: true, message: '¡Conexión con PubNub establecida con éxito! ☁️' };
    } catch (err) {
      console.error('Error en prueba de conexión PubNub:', err);
      return { success: false, message: 'Error de autenticación con PubNub: ' + (err.message || 'Verifica las claves.') };
    }
  }

  /**
   * Descarga la partida (.sav) más reciente desde el canal de PubNub
   * @param {string} romName Nombre de la ROM activa
   * @returns {Promise<Uint8Array|null>}
   */
  async fetchLatestCloudSave(romName) {
    if (!this.isConfigured()) {
      return null;
    }

    const baseName = (romName || 'Pokemon - Edicion Plata SoulSilver').replace(/\.(nds|zip|7z|sav|dsv)$/i, '').trim();
    const targetFileName = `${baseName}.sav`;

    try {
      this.updateUIStatus('downloading');
      console.log(`☁️ [PubNub Cloud] Buscando partida en la nube para "${targetFileName}"...`);

      // 1. Listar archivos en el canal
      const listResponse = await this.pubnub.listFiles({
        channel: this.channel,
        limit: 20
      });

      if (!listResponse || !listResponse.data || listResponse.data.length === 0) {
        console.log('☁️ [PubNub Cloud] No hay archivos en el canal de la nube aún.');
        this.updateUIStatus('connected');
        return null;
      }

      // 2. Buscar el archivo correspondiente a este juego
      const matchingFiles = listResponse.data.filter(f => 
        f.name === targetFileName || f.name === `${baseName}.dsv` || f.name.includes(baseName) || f.name.endsWith('.sav')
      );

      if (matchingFiles.length === 0) {
        console.log(`☁️ [PubNub Cloud] No se encontró guardado previo para "${baseName}".`);
        this.updateUIStatus('connected');
        return null;
      }

      // Ordenar por fecha (el más reciente primero)
      matchingFiles.sort((a, b) => new Date(b.created) - new Date(a.created));
      const targetFile = matchingFiles[0];

      console.log(`☁️ [PubNub Cloud] Partida encontrada: ${targetFile.name} (ID: ${targetFile.id}, Creada: ${targetFile.created})`);

      // 3. Obtener URL de descarga directa de PubNub Files
      const urlResponse = await this.pubnub.getFileUrl({
        channel: this.channel,
        id: targetFile.id,
        name: targetFile.name
      });

      if (!urlResponse || !urlResponse.url) {
        throw new Error('No se pudo generar la URL de descarga del archivo en PubNub');
      }

      // 4. Descargar los bytes binarios
      const res = await fetch(urlResponse.url);
      if (!res.ok) throw new Error(`HTTP Error ${res.status} al descargar de PubNub`);
      const buffer = await res.arrayBuffer();

      if (buffer && buffer.byteLength > 0) {
        console.log(`☁️ [PubNub Cloud] ✅ Partida descargada con éxito (${buffer.byteLength} bytes)`);
        this.updateUIStatus('connected');
        return new Uint8Array(buffer);
      }
    } catch (err) {
      console.warn('☁️ [PubNub Cloud] Error descargando partida de la nube:', err);
      this.updateUIStatus('error');
    }

    return null;
  }

  /**
   * Sube y sobreescribe el archivo .sav en la nube de PubNub
   * @param {Uint8Array|ArrayBuffer|Blob} saveData Datos binarios del .sav
   * @param {string} romName Nombre de la ROM
   */
  async uploadCloudSave(saveData, romName) {
    if (!this.isConfigured() || !saveData || (saveData.byteLength !== undefined && saveData.byteLength === 0)) {
      return false;
    }

    // Cooldown para no saturar la API de PubNub
    const now = Date.now();
    if (this.isUploading || (now - this.lastUploadTime < 3500)) {
      return false;
    }

    const baseName = (romName || 'Pokemon - Edicion Plata SoulSilver').replace(/\.(nds|zip|7z|sav|dsv)$/i, '').trim();
    const filename = `${baseName}.sav`;
    const uint8 = saveData instanceof Uint8Array ? saveData : (saveData instanceof ArrayBuffer ? new Uint8Array(saveData) : null);
    const blob = saveData instanceof Blob ? saveData : new Blob([uint8 || saveData], { type: 'application/octet-stream' });

    this.isUploading = true;
    this.lastUploadTime = now;
    this.updateUIStatus('uploading');

    try {
      console.log(`☁️ [PubNub Cloud] Subiendo y sobreescribiendo "${filename}" (${blob.size} bytes)...`);

      // 1. Subir archivo binario a PubNub Files API
      const uploadResult = await this.pubnub.sendFile({
        channel: this.channel,
        message: {
          type: 'cloud_save_update',
          rom: baseName,
          filename: filename,
          size: blob.size,
          updatedAt: new Date().toISOString()
        },
        file: {
          data: blob,
          name: filename,
          mimeType: 'application/octet-stream'
        }
      });

      console.log('☁️ [PubNub Cloud] ✅ Subida completada:', uploadResult);
      this.updateUIStatus('connected');

      if (window.saveManager) {
        window.saveManager.showToast(`☁️ Partida guardada en la Nube (PubNub)`, 'success');
      }

      // 2. Limpieza de versiones obsoletas en segundo plano
      this.cleanOldFiles(baseName, uploadResult?.data?.id);

      this.isUploading = false;
      return true;
    } catch (err) {
      console.error('☁️ [PubNub Cloud] Error subiendo archivo a PubNub:', err);
      this.updateUIStatus('error');
      this.isUploading = false;
      return false;
    }
  }

  /**
   * Elimina archivos antiguos del mismo juego en el canal para mantener limpia la nube
   */
  async cleanOldFiles(baseName, keepFileId) {
    if (!this.pubnub) return;
    try {
      const list = await this.pubnub.listFiles({ channel: this.channel, limit: 30 });
      if (!list || !list.data) return;

      const targetFileName = `${baseName}.sav`;
      const oldFiles = list.data.filter(f => f.name === targetFileName && f.id !== keepFileId);

      for (const old of oldFiles) {
        try {
          await this.pubnub.deleteFile({
            channel: this.channel,
            id: old.id,
            name: old.name
          });
          console.log(`☁️ [PubNub Cloud] Versión antigua eliminada: ${old.id}`);
        } catch (e) {}
      }
    } catch (e) {}
  }

  /**
   * Actualiza los indicadores visuales de estado de la nube en la barra superior
   */
  updateUIStatus(status) {
    const statusItem = document.getElementById('cloud-status');
    const label = document.getElementById('cloud-status-label');

    if (!statusItem || !label) return;

    statusItem.className = 'status-item';

    switch (status) {
      case 'connected':
        statusItem.classList.add('active');
        label.textContent = `Nube: Conectada (${this.channel})`;
        statusItem.setAttribute('title', `Sincronización en la nube con PubNub activa en canal "${this.channel}"`);
        break;
      case 'uploading':
        statusItem.classList.add('active');
        label.textContent = 'Nube: Guardando... ☁️';
        break;
      case 'downloading':
        statusItem.classList.add('active');
        label.textContent = 'Nube: Descargando... ☁️';
        break;
      case 'unconfigured':
        label.textContent = 'Nube: Sin configurar';
        statusItem.setAttribute('title', 'Configura tus claves de PubNub en Ajustes para sincronización en la nube');
        break;
      case 'error':
        statusItem.classList.add('error');
        label.textContent = 'Nube: Error conexión';
        break;
    }
  }
}

// Instancia global
window.cloudSaveManager = new CloudSaveManager();
