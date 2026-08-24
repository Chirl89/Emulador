/**
 * NDS Web Emulator - Touch Controls
 * Controles virtuales en pantalla para Safari iOS / ROG Ally / Pantalla Táctil
 * Versión: v0.1.2
 */

class TouchControls {
  constructor() {
    this.overlay = document.getElementById('touch-controls-overlay');
    this.hapticEnabled = true;
    this.visible = false;
    this.gamepadConnected = false;
    this.userPreference = 'auto'; // 'auto', 'show', 'hide'

    // Mapa de teclas y códigos exactos esperados por EmulatorJS (DeSmuME)
    this.keyDefinitions = {
      up:     { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      down:   { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      left:   { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      right:  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      a:      { key: 'z', code: 'KeyZ', keyCode: 90 },
      b:      { key: 'x', code: 'KeyX', keyCode: 88 },
      x:      { key: 'a', code: 'KeyA', keyCode: 65 },
      y:      { key: 's', code: 'KeyS', keyCode: 83 },
      l:      { key: 'q', code: 'KeyQ', keyCode: 81 },
      r:      { key: 'e', code: 'KeyE', keyCode: 69 },
      start:  { key: 'Enter', code: 'Enter', keyCode: 13 },
      select: { key: 'v', code: 'KeyV', keyCode: 86 }
    };

    this.init();
  }

  init() {
    if (!this.overlay) return;

    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    // Configurar listeners en cada botón táctil
    const buttons = this.overlay.querySelectorAll('.touch-btn');
    buttons.forEach((btn) => {
      const keyName = btn.dataset.key;
      if (!keyName && btn.id !== 'btn-touch-menu') return;

      let isPressed = false;

      const pressBtn = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (isPressed) return;
        isPressed = true;
        btn.classList.add('pressed');
        this.triggerHaptic(20);
        if (keyName) this.sendKeyEvent(keyName, true);
      };

      const releaseBtn = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (!isPressed) return;
        isPressed = false;
        btn.classList.remove('pressed');
        if (keyName) this.sendKeyEvent(keyName, false);
      };

      // Si el navegador soporta Pointer Events (Opera GX, Chrome, Safari 13+, Edge)
      if (window.PointerEvent) {
        btn.addEventListener('pointerdown', pressBtn);
        btn.addEventListener('pointerup', releaseBtn);
        btn.addEventListener('pointercancel', releaseBtn);
        btn.addEventListener('pointerleave', (e) => {
          if (isPressed && e.buttons === 0) releaseBtn(e);
        });
      } else {
        // Fallback táctil y ratón para navegadores sin PointerEvent
        btn.addEventListener('touchstart', pressBtn, { passive: false });
        btn.addEventListener('touchend', releaseBtn, { passive: false });
        btn.addEventListener('touchcancel', releaseBtn, { passive: false });
        btn.addEventListener('mousedown', pressBtn);
        btn.addEventListener('mouseup', releaseBtn);
        btn.addEventListener('mouseleave', releaseBtn);
      }
    });

    const menuBtn = document.getElementById('btn-touch-menu');
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.app) window.app.toggleSettings();
      });
    }

    // Auto-mostrar si es dispositivo táctil y no hay mando físico activo
    if (isTouchDevice && !this.gamepadConnected) {
      this.show();
    }
  }

  show() {
    if (this.overlay) {
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

  toggle() {
    if (this.visible) {
      this.userPreference = 'hide';
      this.hide();
    } else {
      this.userPreference = 'show';
      this.show();
    }
    return this.visible;
  }

  onGamepadConnected() {
    this.gamepadConnected = true;
    if (this.userPreference !== 'show') {
      this.hide();
    }
  }

  onGamepadDisconnected() {
    this.gamepadConnected = false;
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isTouchDevice && this.userPreference !== 'hide') {
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
    // Si gamepadController ya tiene el despachador optimizado, usarlo
    if (window.gamepadController && typeof window.gamepadController.dispatchKey === 'function') {
      window.gamepadController.dispatchKey(keyName, isDown);
      return;
    }

    const def = this.keyDefinitions[keyName];
    if (!def) return;

    const eventType = isDown ? 'keydown' : 'keyup';
    const event = new KeyboardEvent(eventType, {
      key: def.key,
      code: def.code,
      bubbles: true,
      cancelable: true,
      view: window
    });

    try {
      Object.defineProperty(event, 'keyCode', { get: () => def.keyCode });
      Object.defineProperty(event, 'which', { get: () => def.keyCode });
      Object.defineProperty(event, 'charCode', { get: () => (isDown ? def.keyCode : 0) });
    } catch (e) {}

    window.dispatchEvent(event);
    document.dispatchEvent(event);
    if (document.body) document.body.dispatchEvent(event);

    const canvas = document.querySelector('#game-player canvas') || document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(event);
    }
  }
}

window.touchControls = new TouchControls();

