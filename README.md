# 🎮 NDS Web Emulator (ROG Ally & Safari Edition)

[![Version](https://img.shields.io/badge/version-v0.4.1-00f0ff.svg)](./VERSION)
[![Platform](https://img.shields.io/badge/platform-Web%20|%20ROG%20Ally%20|%20Safari%20iOS%20|%20Opera%20GX-ff0055.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

Un emulador web de **Nintendo DS (NDS)** de alto rendimiento basado en WebAssembly (DeSmuME / melonDS core), optimizado específicamente para:
1. **Acceso Directo a ROMs Recientes (.nds)**: Lista de juegos jugados en orden de última partida para jugar con 1 clic sin tener que navegar por archivos ni volver a seleccionarlos.
2. **Asus ROG Ally**: Mando integrado XInput reconocido automáticamente, pantalla táctil interactiva y modo de pantalla panorámica 16:9.
3. **Opera GX (Live Server)**: Ejecución 100% estática y ultrarrápida sin necesidad de compilar, con enrutador de teclado directo C-WASM (`simulateInput`).
4. **Safari en iOS / iPadOS / macOS**: PWA instalable con controles virtuales en pantalla, respuesta háptica y compatibilidad total.
5. **☁️ Sincronización en la Nube con PubNub (Cloud Saves)**: Tu partida se descarga automáticamente de la nube al iniciar el juego en cualquier dispositivo y se sobreescribe en la nube cada vez que guardas en Pokémon.
6. **Guardado Directo en Disco & Auto-Sobreescritura**: Vinculación de carpeta local (`C:\Users\cgzla\Documents\SoulSilver`) para sobreescribir automáticamente tus partidas `.sav` en PC.

---

## ☁️ Configuración de Guardado en la Nube (PubNub)

1. Abre el emulador y pulsa en **⚙️ Ajustes**.
2. En la sección **"☁️ Sincronización en la Nube con PubNub"**, introduce tu **Publish Key** (`pub-c-...`) y **Subscribe Key** (`sub-c-...`).
3. Elige tu canal/ID de partida (por defecto: `soulsilver-cloud-saves`).
4. Pulsa **"💾 Guardar y Conectar"** o **"🔗 Probar Conexión"**.
5. ¡Listo! Ahora tu partida se sincronizará sola entre tu iPhone, PC y ROG Ally en tiempo real.

---

## 🚀 Inicio Rápido en Local (Opera GX + Live Server)

1. Abre la carpeta `c:\Users\cgzla\Documents\Emulador` en **Visual Studio Code**.
2. Haz clic derecho en `index.html` y selecciona **"Open with Live Server"** (o pulsa el botón **"Go Live"** en la barra inferior azul de VS Code).
3. Tu navegador **Opera GX** se abrirá automáticamente en `http://127.0.0.1:5500/index.html`.
4. Haz clic en **"📂 Seleccionar ROM (.nds)"** o en **"📁 Abrir Juego desde Carpeta"** seleccionando:
   `C:\Users\cgzla\Documents\SoulSilver\Pokemon - Edicion Plata SoulSilver.nds`
5. ¡A jugar!

---

## 💾 Gestión de Partidas y Archivos `.sav`

### En PC / Opera GX / Asus ROG Ally:
- **Sobreescritura directa**: Pulsa el botón **"📁 Vincular Carpeta SoulSilver"** o **"📁 Abrir Juego desde Carpeta"**. Al conceder permisos, cada vez que guardes en el menú de Pokémon o pulses **"💾 Guardar (.sav)"**, el emulador sobreescribirá directamente el archivo `.sav` en tu disco local sin ventanas de descarga molestas.
- **Auto-Guardado en segundo plano**: Sincroniza automáticamente cada 5 segundos y al cerrar o recargar la pestaña.

### En Safari (iOS / iPhone / iPad):
- **Menú Emergente de Confirmación al Guardar**: Cada vez que guardas dentro del juego (ej. menú Guardar en Pokémon) o pulsas "💾 Guardar (.sav)", aparece un cuadro emergente elegante que confirma que la partida está guardada en la memoria interna del emulador y te ofrece **"📥 Descargar .sav"** para guardarlo al instante en la app **Archivos** de iOS.
- **Persistencia Automática (IndexedDB)**: Tu partida se guarda automáticamente en memoria interna segura para que no pierdas tu progreso al reiniciar la PWA o cerrar Safari.
- **Importar Partidas**: Puedes cargar cualquier archivo `.sav` previo con el botón **"📥 Importar Partida Existente (.sav)"**.

---

## ⌨️ Controles en Opera GX (Teclado de PC)

| Tecla de Teclado | Botón Nintendo DS |
| :--- | :--- |
| **Flechas de Dirección** | Cruceta NDS (Arriba, Abajo, Izquierda, Derecha) |
| **Z** | Botón A |
| **X** | Botón B |
| **A** | Botón X |
| **S** | Botón Y |
| **Q** | Botón L |
| **E / W** | Botón R |
| **Enter** | START |
| **V / Shift** | SELECT |
| **Clic / Toque con Ratón en Pantalla Inferior** | Stylus / Pantalla Táctil NDS |

---

## 🕹️ Guía de Controles en Asus ROG Ally & Mando Xbox

El emulador mapea de forma nativa los controles del ROG Ally mediante la Gamepad API de HTML5 y conexión directa WebAssembly:

| Botón ROG Ally | Acción en Nintendo DS | Atajo Especial |
| :--- | :--- | :--- |
| **D-Pad / Stick Izquierdo** | Cruceta NDS (Arriba, Abajo, Izq, Der) | - |
| **Botón A** | Botón A de NDS | - |
| **Botón B** | Botón B de NDS | - |
| **Botón X** | Botón X de NDS | - |
| **Botón Y** | Botón Y de NDS | - |
| **LB (Parachoques Izq)** | Botón L | - |
| **RB (Parachoques Der)** | Botón R | - |
| **LT / RT (Gatillos)** | ZL / ZR | - |
| **View (Select)** | Botón SELECT | - |
| **Menu (Start)** | Botón START | - |
| **Stick Derecho (R3)** | - | 🔄 **Alternar modo de pantalla** (Horizontal / Vertical) |
| **Stick Izquierdo (L3)** | - | ⚡ **Guardado Rápido** |
| **Pantalla Táctil de 7"** | - | ✍️ **Pantalla táctil inferior de NDS directa** |

---

## 🍏 Instalación en Safari (iOS / iPadOS) vía GitHub Pages

1. Sube este repositorio a tu cuenta de GitHub.
2. En los ajustes de tu repositorio en GitHub, ve a **Settings > Pages > Build and deployment** y selecciona **GitHub Actions**.
3. Abre el enlace de GitHub Pages en **Safari** desde tu iPhone o iPad.
4. Pulsa el botón **Compartir** de Safari y selecciona **"Añadir a la pantalla de inicio"**.
5. Al abrir la app desde la pantalla de inicio, se ejecutará a pantalla completa sin barra de navegación y con controles táctiles en pantalla con respuesta háptica.

---

## 📌 Reglas de Versionado e Instrucciones del Agente

Consulta el archivo [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md) para ver las reglas de ciclo de vida del proyecto:
- Inicio en **`v0.0.1`**.
- Incremento de parches `v0.0.2`, ..., `v0.0.17`.
- Salto a versiones menores `v0.1`, `v0.2`, etc., en cada nueva conversación.
