/**
 * NDS Web Emulator - Gamepad Manager
 * Soporte especializado para Asus ROG Ally (Mando integrado XInput) y mandos estándar
 * Versión: v0.0.1
 */

class GamepadController {
  constructor() {
    this.connectedGamepadIndex = null;
    this.pollInterval = null;
    this.lastButtonStates = {};
    this.deadzone = 0.25;
    this.isRogAlly = false;

    this.initEvents();
  }

  initEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log('Gamepad conectado:', e.gamepad.id, 'Índice:', e.gamepad.index);
      this.connectedGamepadIndex = e.gamepad.index;
      
      // Detectar Asus ROG Ally o controlador Xbox
      const idLower = e.gamepad.id.toLowerCase();
      this.isRogAlly = idLower.includes('rog') || idLower.includes('ally') || idLower.includes('xinput') || idLower.includes('xbox');
      
      this.updateStatusUI(true, e.gamepad.id);
      this.startPolling();
      
      if (window.touchControls) {
        window.touchControls.onGamepadConnected();
      }

      this.vibrate(100, 0.4, 0.4);
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('Gamepad desconectado:', e.gamepad.id);
      if (this.connectedGamepadIndex === e.gamepad.index) {
        this.connectedGamepadIndex = null;
        this.updateStatusUI(false);
        this.stopPolling();

        if (window.touchControls) {
          window.touchControls.onGamepadDisconnected();
        }
      }
    });
  }

  startPolling() {
    if (this.pollInterval) return;
    this.pollInterval = requestAnimationFrame(this.poll.bind(this));
  }

  stopPolling() {
    if (this.pollInterval) {
      cancelAnimationFrame(this.pollInterval);
      this.pollInterval = null;
    }
  }

  poll() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this.connectedGamepadIndex];

    if (gp && gp.connected) {
      this.processGamepadInput(gp);
      this.updateGamepadTesterUI(gp);
    }

    this.pollInterval = requestAnimationFrame(this.poll.bind(this));
  }

  /**
   * Procesa la entrada del mando físico y dispara atajos o eventos
   */
  processGamepadInput(gp) {
    // Mapeo estándar (Xbox / ROG Ally):
    // 0: A, 1: B, 2: X, 3: Y
    // 4: LB, 5: RB, 6: LT, 7: RT
    // 8: Back/View, 9: Start/Menu
    // 10: L3, 11: R3
    // 12: Up, 13: Down, 14: Left, 15: Right

    const isPressed = (btnIndex) => gp.buttons[btnIndex] && gp.buttons[btnIndex].pressed;
    const justPressed = (btnIndex) => {
      const current = isPressed(btnIndex);
      const prev = !!this.lastButtonStates[btnIndex];
      return current && !prev;
    };

    // Atajo: R3 (Stick Derecho) cambia el modo de pantalla (Horizontal <-> Vertical)
    if (justPressed(11)) {
      if (window.app) {
        window.app.toggleNextLayout();
        this.vibrate(60, 0.3, 0.3);
      }
    }

    // Atajo: L3 (Stick Izquierdo) Guardado rápido
    if (justPressed(10)) {
      if (window.app) {
        window.app.quickSaveState();
        this.vibrate(80, 0.5, 0.2);
      }
    }

    // Atajo: Start + Select juntos = Pantalla completa
    if (isPressed(8) && isPressed(9)) {
      if (!this.fullscreenToggledRecently) {
        this.fullscreenToggledRecently = true;
        if (window.app) window.app.toggleFullscreen();
        setTimeout(() => { this.fullscreenToggledRecently = false; }, 1000);
      }
    }

    // Actualizar estados para detección de flancos
    for (let i = 0; i < gp.buttons.length; i++) {
      this.lastButtonStates[i] = isPressed(i);
    }
  }

  /**
   * Efecto de vibración háptica en el mando Asus ROG Ally
   */
  async vibrate(duration = 100, weakMagnitude = 0.5, strongMagnitude = 0.5) {
    try {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[this.connectedGamepadIndex];
      if (gp && gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
        await gp.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: duration,
          weakMagnitude: weakMagnitude,
          strongMagnitude: strongMagnitude
        });
      }
    } catch (e) {
      // Navegador o mando sin soporte de vibración
    }
  }

  updateStatusUI(connected, id = '') {
    const label = document.getElementById('gamepad-label');
    const statusItem = document.getElementById('gamepad-status');
    if (!label || !statusItem) return;

    if (connected) {
      const name = this.isRogAlly ? 'ROG Ally Conectado' : 'Gamepad Activo';
      label.textContent = `Mando: ${name}`;
      statusItem.classList.add(this.isRogAlly ? 'active-rog' : 'active');
      statusItem.setAttribute('title', id);
    } else {
      label.textContent = 'Mando: Desconectado';
      statusItem.classList.remove('active', 'active-rog');
      statusItem.removeAttribute('title');
    }
  }

  /**
   * Muestra visualmente los botones presionados en el modal de ajustes
   */
  updateGamepadTesterUI(gp) {
    const tester = document.getElementById('gamepad-tester');
    if (!tester || tester.offsetParent === null) return; // Solo si el modal está abierto

    const updateBtn = (id, pressed) => {
      const el = document.getElementById(id);
      if (el) {
        if (pressed) el.classList.add('pressed');
        else el.classList.remove('pressed');
      }
    };

    updateBtn('gp-btn-a', gp.buttons[0]?.pressed);
    updateBtn('gp-btn-b', gp.buttons[1]?.pressed);
    updateBtn('gp-btn-x', gp.buttons[2]?.pressed);
    updateBtn('gp-btn-y', gp.buttons[3]?.pressed);
    updateBtn('gp-btn-l', gp.buttons[4]?.pressed);
    updateBtn('gp-btn-r', gp.buttons[5]?.pressed);
    updateBtn('gp-btn-lt', gp.buttons[6]?.pressed);
    updateBtn('gp-btn-rt', gp.buttons[7]?.pressed);

    const dpadEl = document.getElementById('gp-dpad');
    if (dpadEl) {
      const up = gp.buttons[12]?.pressed;
      const down = gp.buttons[13]?.pressed;
      const left = gp.buttons[14]?.pressed;
      const right = gp.buttons[15]?.pressed;
      dpadEl.textContent = `D-Pad: ${up ? '▲' : ''}${down ? '▼' : ''}${left ? '◀' : ''}${right ? '▶' : (up || down || left || right ? '' : '⚪')}`;
      if (up || down || left || right) dpadEl.classList.add('pressed');
      else dpadEl.classList.remove('pressed');
    }

    const stickLEl = document.getElementById('gp-stick-l');
    if (stickLEl && gp.axes.length >= 2) {
      const x = gp.axes[0].toFixed(2);
      const y = gp.axes[1].toFixed(2);
      stickLEl.textContent = `Stick Izq: (${x}, ${y})`;
    }

    const stickREl = document.getElementById('gp-stick-r');
    if (stickREl && gp.axes.length >= 4) {
      const x = gp.axes[2].toFixed(2);
      const y = gp.axes[3].toFixed(2);
      stickREl.textContent = `Stick Der: (${x}, ${y})`;
    }
  }
}

window.gamepadController = new GamepadController();
