/**
 * NDS Web Emulator - Touch Controls
 * Controles virtuales en pantalla para Safari iOS / Móvil
 * Versión: v0.0.1
 */

class TouchControls {
  constructor() {
    this.overlay = document.getElementById('touch-controls-overlay');
    this.hapticEnabled = true;
    this.visible = false;
    this.gamepadConnected = false;

    // Mapa de teclas por defecto
    this.keyMap = {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      a: 'x',        // DeSmuME por defecto suele mapear A -> X
      b: 'z',        // B -> Z
      x: 's',        // X -> S
      y: 'a',        // Y -> A
      l: 'q',        // L -> Q
      r: 'w',        // R -> W
      start: 'Enter',
      select: 'Shift'
    };

    this.init();
  }

  init() {
    if (!this.overlay) return;

    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    // Asignar eventos táctiles a cada botón virtual
    const buttons = this.overlay.querySelectorAll('.touch-btn');
    buttons.forEach((btn) => {
      const keyName = btn.dataset.key;

      const handlePress = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        this.triggerHaptic(20);
        if (keyName) this.sendKeyEvent(keyName, true);
      };

      const handleRelease = (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('pressed');
        if (keyName) this.sendKeyEvent(keyName, false);
      };

      btn.addEventListener('touchstart', handlePress, { passive: false });
      btn.addEventListener('touchend', handleRelease, { passive: false });
      btn.addEventListener('touchcancel', handleRelease, { passive: false });

      btn.addEventListener('mousedown', handlePress);
      btn.addEventListener('mouseup', handleRelease);
      btn.addEventListener('mouseleave', handleRelease);
    });

    const menuBtn = document.getElementById('btn-touch-menu');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        if (window.app) window.app.toggleSettings();
      });
    }

    if (isTouchDevice && !this.gamepadConnected) {
      this.show();
    }
  }

  show() {
    if (this.overlay && !this.gamepadConnected) {
      this.overlay.style.display = 'flex';
      this.visible = true;
    }
  }

  hide() {
    if (this.overlay) {
      this.overlay.style.display = 'none';
      this.visible = false;
    }
  }

  onGamepadConnected() {
    this.gamepadConnected = true;
    // Ocultar botones táctiles si hay mando ROG Ally para no estorbar la pantalla
    this.hide();
  }

  onGamepadDisconnected() {
    this.gamepadConnected = false;
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isTouchDevice) {
      this.show();
    }
  }

  triggerHaptic(ms = 25) {
    if (this.hapticEnabled && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (e) {}
    }
  }

  sendKeyEvent(keyName, isDown) {
    const key = this.keyMap[keyName] || keyName;
    const eventType = isDown ? 'keydown' : 'keyup';

    const event = new KeyboardEvent(eventType, {
      key: key,
      code: this.getKeyCode(key),
      bubbles: true,
      cancelable: true
    });

    window.dispatchEvent(event);
    document.dispatchEvent(event);

    const canvas = document.querySelector('#game-player canvas');
    if (canvas) {
      canvas.dispatchEvent(event);
    }
  }

  getKeyCode(key) {
    if (key.startsWith('Arrow')) return key;
    if (key.length === 1) return `Key${key.toUpperCase()}`;
    return key;
  }
}

window.touchControls = new TouchControls();
