# INSTRUCCIONES DEL AGENTE (AGENT_INSTRUCTIONS.md)

Este documento establece las reglas obligatorias e inmutables para cualquier agente de IA o desarrollador que trabaje en este proyecto.

---

## 🔢 Regla Estricta de Versionado

1. **Formato de versión**: `v[Mayor].[Menor].[Parche]` (ejemplo: `v0.0.1`).
2. **Inicio del Proyecto**: El proyecto comienza en **`v0.0.1`**.
3. **Incrementos por iteración/tarea (Parches)**:
   - Dentro de una misma conversación o tarea, cada avance, corrección o mejora incrementa el parche en 1:
     `v0.0.1` ➡️ `v0.0.2` ➡️ `v0.0.3` ➡️ ... ➡️ `v0.0.17`.
4. **Nuevas conversaciones / Hitos mayores**:
   - En cada **nueva conversación** con el usuario, la versión menor debe subir a:
     - 2ª Conversación: **`v0.1`** (o `v0.1.0`)
     - 3ª Conversación: **`v0.2`** (o `v0.2.0`)
     - 4ª Conversación: **`v0.3`** (o `v0.3.0`)
     - ... y así sucesivamente.
5. **Actualización obligatoria**:
   - Siempre que se actualice la versión, se debe sincronizar:
     - El archivo `VERSION`
     - El badge visual de versión en `index.html`
     - El encabezado del `README.md`
     - El mensaje del commit de Git.

---

## 🎯 Dispositivos y Plataformas Objetivo

1. **Asus ROG Ally**:
   - Soporte nativo para el mando integrado (Xbox / XInput a través de HTML5 Gamepad API).
   - Soporte táctil directo para la pantalla inferior de NDS en la pantalla táctil de 7" 120Hz del ROG Ally.
   - Modos de visualización optimizados para relación de aspecto 16:9 (Horizontal / Pantalla partida lado a lado).

2. **Opera GX + Live Server**:
   - La aplicación debe ser 100% estática (HTML/CSS/JS/WASM).
   - Debe ejecutarse instantáneamente pulsando "Go Live" en Visual Studio Code (puerto `5500`).
   - Sin dependencias de compilación en Node.js para ejecución básica.

3. **Safari (iOS / iPadOS / macOS) vía GitHub Pages**:
   - PWA instalable como aplicación de pantalla completa en iOS.
   - Controles táctiles virtuales en pantalla con vibración háptica (`navigator.vibrate`) que se muestran automáticamente cuando no hay mando físico.
   - Manejo del desbloqueo del `AudioContext` en el primer toque de usuario en WebKit/Safari.

---

## 💾 Gestión de Partidas y ROMs (Privacidad y Git)

1. **Carpeta de Guardados Local**:
   - El usuario almacena sus juegos y partidas en `C:\Users\cgzla\Documents\SoulSilver`.
   - La aplicación debe soportar enlace directo a esta carpeta mediante la **File System Access API** del navegador para escribir los archivos `.sav` / `.dsv` directamente en el disco.
   - Debe haber respaldo complementario en **IndexedDB** y botón de exportar/importar archivo `.sav`.
2. **Exclusión Estricta en Git**:
   - NUNCA incluir archivos de ROMs (`.nds`, `.zip`, `.7z`) ni archivos de guardado (`.sav`, `.dsv`, `.state`) en el control de versiones de Git.
   - La carpeta `SoulSilver` y cualquier archivo de juego debe estar explícitamente en `.gitignore`.
