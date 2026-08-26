/**
 * NDS Web Emulator - Touch Controls
 * Controles virtuales en pantalla para Safari iOS / ROG Ally / Pantalla Táctil
 * Versión: v0.8.2
 */

class TouchControls {
  constructor() {
    this.overlay = document.getElementById('touch-controls-overlay');
    this.hapticEnabled = localStorage.getItem('nds_haptic_enabled') !== 'false';
    this.visible = false;
    this.gamepadConnected = false;
    this.userPreference = localStorage.getItem('nds_touch_mode') || 'auto'; // 'auto', 'show', 'hide'
    this.cachedCanvas = null;

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

  isMobileDevice() {
    const ua = navigator.userAgent || '';
    const isIOS = (/iPad|iPhone|iPod/.test(ua)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = (window.navigator && window.navigator.standalone === true) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const isMobile = isIOS || isStandalone || /Android/i.test(ua) || (('ontouchstart' in window) && window.innerWidth < 1024);
    return isMobile;
  }

  init() {
    if (!this.overlay) return;

    // Configurar listeners en cada botón táctil
    const buttons = this.overlay.querySelectorAll('.touch-btn');
    buttons.forEach((btn) => {
      const keyName = btn.dataset.key;
      if (!keyName) return;

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

        // Manejo especial de botones L2 y R2 para control dinámico de velocidad (1x a 3x Turbo)
        if (keyName === 'r2') {
          if (window.app && typeof window.app.changeEmulationSpeed === 'function') {
            window.app.changeEmulationSpeed(1);
          }
          return;
        }

        if (keyName === 'l2') {
          if (window.app && typeof window.app.changeEmulationSpeed === 'function') {
            window.app.changeEmulationSpeed(-1);
          }
          return;
        }

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

        if (keyName && keyName !== 'r2' && keyName !== 'l2') {
          this.sendKeyEvent(keyName, false);
        }
      };

      // Si el navegador soporta Pointer Events (Safari 13+, Chrome, Opera GX, Edge)
      if (window.PointerEvent) {
        btn.addEventListener('pointerdown', pressBtn, { passive: false });
        btn.addEventListener('pointerup', releaseBtn, { passive: false });
        btn.addEventListener('pointercancel', releaseBtn, { passive: false });
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

    // En la pantalla de bienvenida mantener estrictamente oculto
    this.hide();
  }

  onGameStart() {
    this.cachedCanvas = null;
    const isMobile = this.isMobileDevice();

    if (this.userPreference === 'show') {
      this.show();
    } else if (this.userPreference === 'hide') {
      this.hide();
    } else if (isMobile) {
      // En Safari iOS / iPhone / iPad / PWA WebApp: SIEMPRE mostrar controles táctiles
      this.show();
    } else if (this.gamepadConnected || window.app?.currentLayout === 'layout-horizontal') {
      // En Asus ROG Ally, PC Desktop o modo horizontal sin táctil
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    if (this.overlay) {
      this.overlay.style.removeProperty('display');
      this.overlay.style.setProperty('display', 'flex', 'important');
      this.visible = true;
      document.documentElement.classList.add('touch-controls-visible');
      document.documentElement.classList.remove('touch-controls-hidden');
      document.body.classList.add('touch-controls-visible');
      document.body.classList.remove('touch-controls-hidden');
    }
  }

  hide() {
    if (this.overlay) {
      this.overlay.style.setProperty('display', 'none', 'important');
      this.visible = false;
      document.documentElement.classList.remove('touch-controls-visible');
      document.documentElement.classList.add('touch-controls-hidden');
      document.body.classList.remove('touch-controls-visible');
      document.body.classList.add('touch-controls-hidden');
    }
  }

  toggle() {
    if (this.visible) {
      this.userPreference = 'hide';
      localStorage.setItem('nds_touch_mode', 'hide');
      this.hide();
    } else {
      this.userPreference = 'show';
      localStorage.setItem('nds_touch_mode', 'show');
      this.show();
    }
    return this.visible;
  }

  onGamepadConnected() {
    this.gamepadConnected = true;
    if (this.userPreference !== 'show' && !this.isMobileDevice()) {
      this.hide();
    }
  }

  onGamepadDisconnected() {
    this.gamepadConnected = false;
    if (this.isMobileDevice() && this.userPreference !== 'hide' && window.app?.isEmulating) {
      this.show();
    }
  }

  triggerHaptic(ms = 20) {
    if (this.hapticEnabled && navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch (e) {}
    }
  }

  sendKeyEvent(keyName, isDown) {
    // 1. Despachador C-WASM optimizado si está presente
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

    if (!this.cachedCanvas || !this.cachedCanvas.isConnected) {
      this.cachedCanvas = document.querySelector('#game-player canvas') || document.querySelector('canvas');
    }
    if (this.cachedCanvas) {
      this.cachedCanvas.dispatchEvent(event);
    }
  }
}

window.touchControls = new TouchControls();


