# 🎮 NDS Web Emulator (ROG Ally & Safari Edition)

[![Version](https://img.shields.io/badge/version-v0.8.0-00f0ff.svg)](./VERSION)
[![Platform](https://img.shields.io/badge/platform-Web%20|%20ROG%20Ally%20|%20Safari%20iOS%20|%20Opera%20GX-ff0055.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

Un emulador web de **Nintendo DS (NDS)** de alto rendimiento basado en WebAssembly (DeSmuME / melonDS core), optimizado específicamente para:
1. **💉 Integración Total con PKHeX Web Studio**: Edita tus partidas `.sav` (Pokémon, dinero, medallas, objetos, cajas del PC, IVs/EVs, shinies) directamente desde el emulador con sincronización bidireccional y carga automática antes de iniciar la partida.
2. **🚀 Panel de Preparación y Lanzamiento de Juegos**: Al seleccionar un juego o pulsar en recientes, el emulador no arranca de golpe; te permite elegir entre iniciar el juego o abrir PKHeX, mostrando el estado de la partida vinculada.
3. **🚀 Máxima Fluidez & 60 FPS en Safari iOS**: Optimizaciones en el motor WebAssembly (DSP de audio ultrarrápido sin interpolación costosa, latencia de audio adaptada a WebKit para evitar parones, selector de Frameskip y aceleración GPU nativa por capas `translate3d`).
4. **🕹️ Corrección Total de Gatillos L y R**: Inyección limpia de botones directos C-WASM sin disparos accidentales de funciones de pantalla (Screen Swap) ni pantallas en blanco.
5. **🛡️ Sistema Acorazado de Guardado & Bóveda Time-Machine**: Historial con hasta 30 snapshots automáticos por juego, prevención total de sobreescritura con SRAM en blanco, resolución inteligente de conflictos por marcas de tiempo y restauración con 1 clic.
6. **☁️ Sincronización en la Nube con PubNub (Cloud Saves)**: Tu partida se descarga automáticamente de la nube al iniciar el juego en cualquier dispositivo y se sobreescribe en la nube cada vez que guardas en Pokémon.
7. **Acceso Directo a ROMs Recientes (.nds)**: Lista de juegos jugados en orden de última partida para jugar o editar en PKHeX con 1 clic sin tener que navegar por archivos ni volver a seleccionarlos.
8. **📱 Controles Táctiles Optimizados para Safari iOS**: Geometría ajustada anti-desborde lateral en pantallas móviles, alineación perfecta de Select y Start a la altura inferior de la cruceta, selector de opacidad y respuesta háptica instantánea.
9. **⚙️ Menú de Configuración en Bienvenida & Ajustes Reales en Partida**: Panel dedicado en pantalla principal para gestión de PubNub, Bóveda, frameskip y carpetas locales; y ajustes en vivo para sonido (volumen, activación, desbloqueo), filtros gráficos (Pixel Art, Smooth, CRT), velocidad, salto de cuadros y núcleos.
10. **Asus ROG Ally**: Mando integrado XInput reconocido automáticamente, pantalla táctil interactiva y modo de pantalla panorámica 16:9.
11. **Opera GX (Live Server)**: Ejecución 100% estática y ultrarrápida sin necesidad de compilar, con enrutador de teclado directo C-WASM (`simulateInput`).
12. **Guardado Directo en Disco & Auto-Sobreescritura**: Vinculación de carpeta local (`C:\Users\cgzla\Documents\SoulSilver`) para sobreescribir automáticamente tus partidas `.sav` en PC.

---

## ⚙️ Menú de Configuración y Ajustes de Emulación

- **Configuración en Bienvenida**: Botón inferior dedicado para gestionar la Bóveda Time-Machine, vinculación de carpetas locales, sincronización con PubNub y actualización directa desde GitHub.
- **Ajustes en Partida (⚙️)**:
  - **🔊 Audio**: Interruptor de sonido, control deslizante de volumen (0% a 100%) y botón de reactivación/desbloqueo WebAudio para Safari.
  - **⚡ Velocidad y Núcleo**: Selector de velocidad (1.0x, 1.5x, 2.0x, 3.0x Turbo) y selector de núcleo WASM (DeSmuME / melonDS).
  - **📺 Pantalla y Gráficos**: Cambio de layout (Horizontal / Vertical / Táctil) y filtros gráficos (Pixel Art nítido, Suavizado bilineal y Filtro Retro CRT).
  - **📱 Controles Táctiles**: Modo de visibilidad (Auto / Siempre / Oculto), opacidad de botones táctiles (30% - 100%) y vibración háptica.
2. Haz clic derecho en `index.html` y selecciona **"Open with Live Server"** (o pulsa el botón **"Go Live"** en la barra inferior azul de VS Code).
3. Tu navegador **Opera GX** se abrirá automáticamente en `http://127.0.0.1:5500/index.html`.
4. Haz clic en **"📂 Seleccionar ROM (.nds)"** o en **"📁 Abrir Juego desde Carpeta"** seleccionando:
   `C:\Users\cgzla\Documents\SoulSilver\Pokemon - Edicion Plata SoulSilver.nds`
5. ¡A jugar!

---

## 💉 PKHeX Web Studio & Panel de Preparación de Juego

A partir de la versión **`v0.8.0`**, el emulador incorpora una suite integrada de edición de guardados de Pokémon:

1. **🚀 Panel de Preparación**: Al seleccionar una ROM `.nds` o pulsar en un juego reciente, no se inicia la emulación inmediatamente. Se abre un panel interactivo que muestra:
   - Nombre y peso de la ROM.
   - Estado de la partida `.sav` asociada (tamaño, última modificación, snapshots en Bóveda y sincronización en la nube).
   - Botón **`▶️ Iniciar Juego`** para comenzar inmediatamente.
   - Botón **`💉 Abrir en PKHeX`** para editar la partida antes de jugar.
   - Acceso rápido a la **Bóveda Time-Machine**, exportar e importar `.sav`.

2. **💉 Flujo de Edición con PKHeX**:
   - Pulsa **`💉 Abrir en PKHeX`** en el panel de lanzamiento o en cualquier juego reciente.
   - Pulsa **`📥 1. Descargar .sav Actual`** para obtener la partida activa del juego.
   - En la ventana inferior de PKHeX (o PKMDS), abre el archivo `.sav` descargado con el botón **"Open..."**.
   - Modifica lo que desees: Pokémon en cajas o equipo, IVs (31), EVs (252), movimientos, shininess, objetos de la mochila, dinero, medallas, etc.
   - Exporta la partida en PKHeX pulsando **"Export SAV..."**.
   - Arrastra o selecciona el archivo exportado en **`📤 2. Aplicar .sav Editado`**.
   - ¡El emulador inyecta automáticamente los cambios en IndexedDB, en la Bóveda Time-Machine, en disco y en la Nube!
   - Pulsa **`▶️ 3. Iniciar Juego`** y tu partida arrancará exactamente con las modificaciones que hiciste en PKHeX.

---

## 💾 Gestión de Partidas y Archivos `.sav`

### En PC / Opera GX / Asus ROG Ally:
- **Sobreescritura directa**: Pulsa el botón **"📁 Vincular Carpeta SoulSilver"** o **"📁 Abrir Juego desde Carpeta"**. Al conceder permisos, cada vez que guardes en el menú de Pokémon o pulses **"💾 Guardar (.sav)"**, el emulador sobreescribirá directamente el archivo `.sav` en tu disco local sin ventanas de descarga molestas.
- **Auto-Guardado seguro en segundo plano**: Sincroniza automáticamente cada 4 segundos solo cuando hay cambios reales verificados.

### En Safari (iOS / iPhone / iPad):
- **Menú Emergente de Confirmación al Guardar**: Cada vez que guardas dentro del juego (ej. menú Guardar en Pokémon) o pulsas "💾 Guardar (.sav)", aparece un cuadro emergente elegante que confirma que la partida está protegida en la Bóveda del emulador y te ofrece **"📥 Descargar .sav"** para guardarlo al instante en la app **Archivos** de iOS.
- **Persistencia Duradera (IndexedDB v4)**: Tu partida se guarda automáticamente en memoria interna con persistencia concedida por el navegador para que no pierdas tu progreso al reiniciar la PWA o cerrar Safari.
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
- Salto a versiones menores `v0.1`, `v0.2`, `v0.5.0` en cada nueva conversación / hito mayor.
