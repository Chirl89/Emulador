/**
 * NDS Web Emulator - Gamepad Manager
 * Soporte especializado para Asus ROG Ally (Mando integrado XInput) y mandos estándar
 * Versión: v0.8.0
 */

class GamepadController {
  constructor() {
    this.connectedGamepadIndex = null;
    this.pollInterval = null;
    this.lastButtonStates = {};
    this.activeInputs = {};
    this.deadzone = 0.30;
    this.isRogAlly = false;
    this.fullscreenToggledRecently = false;

    // Tabla de mapeo para RetroArch/DeSmuME WASM
    this.retroArchButtonMap = {
      b: 0,
      y: 1,
      select: 2,
      start: 3,
      up: 4,
      down: 5,
      left: 6,
      right: 7,
      a: 8,
      x: 9,
      l: 10,
      r: 11
    };

    // Códigos de teclado exactos esperados por EmulatorJS (DeSmuME)
    this.inputDefinitions = {
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

      this.vibrate(120, 0.4, 0.4);
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('Gamepad desconectado:', e.gamepad.id);
      if (this.connectedGamepadIndex === e.gamepad.index) {
        // Liberar cualquier tecla presionada
        this.releaseAllInputs();
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
    const pollLoop = () => {
      this.poll();
      this.pollInterval = requestAnimationFrame(pollLoop);
    };
    this.pollInterval = requestAnimationFrame(pollLoop);
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
  }

  /**
   * Procesa la entrada del mando físico, convierte analógicos a cruceta y dispara eventos
   */
  processGamepadInput(gp) {
    const isPressed = (btnIndex) => Boolean(gp.buttons[btnIndex] && (gp.buttons[btnIndex].pressed || gp.buttons[btnIndex].value > 0.5));
    const justPressed = (btnIndex) => {
      const current = isPressed(btnIndex);
      const prev = Boolean(this.lastButtonStates[btnIndex]);
      return current && !prev;
    };

    // 1. Atajos de función especial y velocidad
    // RT / R2 (Botón 7 o gatillo analógico derecho) -> Acelerar emulación (1x -> 1.5x -> 2x -> 3x Turbo)
    if (justPressed(7)) {
      if (window.app && typeof window.app.changeEmulationSpeed === 'function') {
        window.app.changeEmulationSpeed(1);
        this.vibrate(50, 0.4, 0.4);
      }
    }

    // LT / L2 (Botón 6 o gatillo analógico izquierdo) -> Desacelerar emulación (hacia 1x)
    if (justPressed(6)) {
      if (window.app && typeof window.app.changeEmulationSpeed === 'function') {
        window.app.changeEmulationSpeed(-1);
        this.vibrate(50, 0.2, 0.4);
      }
    }

    // R3 (Stick Derecho) -> Alternar modo de pantalla
    if (justPressed(11)) {
      if (window.app) {
        window.app.toggleNextLayout();
        this.vibrate(60, 0.3, 0.3);
      }
    }

    // L3 (Stick Izquierdo) -> Guardado rápido
    if (justPressed(10)) {
      if (window.app) {
        window.app.quickSaveState();
        this.vibrate(80, 0.5, 0.2);
      }
    }

    // Start + Select juntos -> Pantalla completa
    if (isPressed(8) && isPressed(9)) {
      if (!this.fullscreenToggledRecently) {
        this.fullscreenToggledRecently = true;
        if (window.app) window.app.toggleFullscreen();
        setTimeout(() => { this.fullscreenToggledRecently = false; }, 1000);
      }
    }

    // 2. Mapeo de botones de juego NDS
    const axisX = (gp.axes && gp.axes.length > 0) ? gp.axes[0] : 0;
    const axisY = (gp.axes && gp.axes.length > 1) ? gp.axes[1] : 0;

    const currentInputStates = {
      // D-Pad físico + Stick Analógico Izquierdo
      up:     isPressed(12) || axisY < -this.deadzone,
      down:   isPressed(13) || axisY > this.deadzone,
      left:   isPressed(14) || axisX < -this.deadzone,
      right:  isPressed(15) || axisX > this.deadzone,

      // Botones de acción NDS
      a:      isPressed(0), // Xbox A -> NDS A
      b:      isPressed(1), // Xbox B -> NDS B
      x:      isPressed(2), // Xbox X -> NDS X
      y:      isPressed(3), // Xbox Y -> NDS Y

      // Gatillos L / R de Nintendo DS (LB y RB)
      l:      isPressed(4), // LB (L1) -> NDS L
      r:      isPressed(5), // RB (R1) -> NDS R

      // Select / Start
      select: isPressed(8),
      start:  isPressed(9)
    };

    // Sincronizar estados y disparar simulateInput / dispatchKey
    for (const [inputName, active] of Object.entries(currentInputStates)) {
      const wasActive = Boolean(this.activeInputs[inputName]);
      if (active && !wasActive) {
        this.activeInputs[inputName] = true;
        this.dispatchKey(inputName, true);
      } else if (!active && wasActive) {
        this.activeInputs[inputName] = false;
        this.dispatchKey(inputName, false);
      }
    }

    // Actualizar historial de botones
    for (let i = 0; i < gp.buttons.length; i++) {
      this.lastButtonStates[i] = isPressed(i);
    }
  }

  /**
   * Dispara entrada directa al emulador (simulateInput C-WASM) y teclado de respaldo
   */
  dispatchKey(inputName, isDown) {
    if (!inputName) return;
    const name = inputName.toLowerCase();

    // 1. Inyección directa a nivel WebAssembly C-API (0ms lag, inmune a foco e iframes)
    const buttonId = this.retroArchButtonMap[name];
    if (buttonId !== undefined && window.EJS_emulator && window.EJS_emulator.gameManager) {
      const gm = window.EJS_emulator.gameManager;
      const sim = (typeof gm.simulateInput === 'function') ? gm.simulateInput.bind(gm) : (gm.functions?.simulateInput ? gm.functions.simulateInput.bind(gm) : null);
      if (sim) {
        try {
          sim(0, buttonId, isDown ? 1 : 0);
        } catch (e) {}
      }
    }

    // 2. Método DOM de respaldo (KeyboardEvent a contenedor y canvas)
    const def = this.inputDefinitions[name];
    if (!def) return;

    const eventType = isDown ? 'keydown' : 'keyup';
    const keysToSend = [def];

    if (name === 'l') {
      keysToSend.push({ key: 'l', code: 'KeyL', keyCode: 76 });
    }

    keysToSend.forEach(kDef => {
      const event = new KeyboardEvent(eventType, {
        key: kDef.key,
        code: kDef.code,
        bubbles: true,
        cancelable: true,
        view: window
      });

      try {
        Object.defineProperty(event, 'keyCode', { get: () => kDef.keyCode });
        Object.defineProperty(event, 'which', { get: () => kDef.keyCode });
        Object.defineProperty(event, 'charCode', { get: () => (isDown ? kDef.keyCode : 0) });
      } catch (e) {}

      const targets = [
        document.querySelector('#game-player canvas'),
        (window.EJS_emulator && window.EJS_emulator.elements && window.EJS_emulator.elements.parent),
        document.querySelector('#game-player'),
        window
      ];

      targets.forEach(t => {
        if (t && typeof t.dispatchEvent === 'function') {
          try { t.dispatchEvent(event); } catch (e) {}
        }
      });
    });
  }

  releaseAllInputs() {
    for (const [inputName, active] of Object.entries(this.activeInputs)) {
      if (active) {
        this.dispatchKey(inputName, false);
      }
    }
    this.activeInputs = {};
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
      // Sin soporte de vibración
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
    if (!tester || tester.offsetParent === null) return;

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
    updateBtn('gp-btn-lt', gp.buttons[6]?.pressed || gp.buttons[6]?.value > 0.5);
    updateBtn('gp-btn-rt', gp.buttons[7]?.pressed || gp.buttons[7]?.value > 0.5);

    const dpadEl = document.getElementById('gp-dpad');
    if (dpadEl) {
      const up = gp.buttons[12]?.pressed || (gp.axes[1] < -this.deadzone);
      const down = gp.buttons[13]?.pressed || (gp.axes[1] > this.deadzone);
      const left = gp.buttons[14]?.pressed || (gp.axes[0] < -this.deadzone);
      const right = gp.buttons[15]?.pressed || (gp.axes[0] > this.deadzone);
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

