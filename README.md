# Analog Explorer · Marte

Prototipo académico para NASA Space Apps: **“Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars”**. El alcance actual es Marte. La aplicación compara relieve regional real; no certifica análogos científicos ni recomienda emplazamientos de bases o rutas de rover.

## Mejoras de experiencia y comprobación actual

- Comparador con encuadre más cercano, iluminación lateral y ajuste al tamaño del visor. Se mantienen dimensiones, datos reales, giro, zoom, reset y sincronización. El botón **Escala real ×1** elimina la exageración visual; no modifica métricas ni clasificación. Sin WebGL, sigue disponible la alternativa 2D y se explican los controles deshabilitados.
- Una lectura de resultados identifica al candidato con menor distancia **entre los tres fijos analizados** y explica las diferencias de relieve, pendiente y variables del modelo. Atacama central encabeza el catálogo actual; no se presenta como resultado de una búsqueda global ni como una probabilidad de equivalencia.
- **Condiciones ambientales del sitio de ensayo** presenta gráficas de temperatura (°C) y humedad relativa (%), promedios del periodo, mínimos/máximos de los promedios diarios y cobertura por variable. Los datos ausentes no se convierten en cero ni se unen con una línea a través del hueco. La tabla queda en un desplegable. La ubicación, fechas, fuente y recuperación se muestran junto a la consulta.
- Fechas iniciales explícitas en ISO (enero de 2024), límites publicados por `/api/climate-limits` y validación tanto en navegador como servidor: desde 1981-01-01 hasta ayer en UTC, hasta 366 días inclusive, inicio no posterior al final. La disponibilidad reciente depende de NASA POWER. Un año como `0025` produce un error visible y no se corrige silenciosamente.
- El estado de almacenamiento procede de **la consulta actual del historial**, no de la existencia de variables: sin configuración, fallo, lectura exitosa sin registros o lectura exitosa con registros. `/api/telemetry` añade `connection_state`; conserva `storage` y `readings`. Las respuestas API y el frontend principal se sirven sin caché para evitar reutilizar estados antiguos.
- Wokwi se presenta como apoyo al ensayo: ESP32 simulado → servidor público previsto en Render → Supabase → historial de la aplicación. La publicación del servidor sigue pendiente; las lecturas simuladas no afectan al análisis científico.
- Página legible **`/catalogue`** con candidatos, método, evaluación, límites y fuentes; la descarga JSON es opcional. El pie agrupa “Acerca del proyecto”, “Fuentes de datos” e “Información técnica”. Las variables detalladas y sus aportes quedan en un desplegable secundario.

Se reinició el servidor local cargando las variables sin mostrarlas y se comprobó que `/api/telemetry?site_id=atacama-central` devuelve almacenamiento `supabase`, estado `connected-with-readings` y la medición de prueba ya existente. No se reprodujo el mensaje de configuración ausente con la respuesta actual. El mensaje anterior solo podía aparecer cuando el frontend recibía `temporary-memory`; un proceso anterior sin las variables cargadas o una respuesta reutilizada podía producirlo, pero no se atribuye una causa histórica concreta sin evidencia.

La consulta real de NASA POWER del 1 al 7 de enero de 2024 para Atacama central devolvió siete días y se utilizó para revisar las gráficas. Se probaron aparte respuestas controladas de errores, datos faltantes e historiales vacíos; esas respuestas de prueba no se guardan en Supabase ni sustituyen datos reales de la aplicación. No se enviaron nuevas mediciones en esta mejora. No se publicó en GitHub ni se desplegó en Render.

## Ejecutar

### Revisión antes de subir a GitHub

`.gitignore` excluye `.env`, sus variantes y copias (`.env*`), configuraciones locales, claves privadas, archivos habituales de credenciales, entornos de desarrollo y `artifacts/`. Solo `.env.example` se incluye como plantilla, con valores vacíos. Las variables reales se configurarán en **Environment de Render**; no deben copiarse a JavaScript, documentación o Wokwi salvo el token específico del dispositivo.

Ejecutar `python scripts/audit_secrets.py` antes de preparar una subida. La revisión utiliza las reglas reales de Git y busca coincidencias con credenciales locales, tokens reconocibles, JWT, claves privadas y asignaciones de credenciales en los archivos candidatos. Solo informa rutas y categorías, nunca valores. El informe local queda en `artifacts/secret-audit.json`, excluido de Git.

En esta revisión la carpeta **todavía no era un repositorio Git**: no había índice ni historial local, y por tanto `.env` no podía estar registrado. Se comprobaron 53 archivos candidatos mediante un repositorio temporal, sin inicializar esta carpeta, sin detectar secretos. La plantilla contenía únicamente valores vacíos y `.env` estaba excluido. No se publicó nada. La revisión debe repetirse si cambian archivos; no garantiza que futuros cambios estén libres de secretos.

Cuando exista un repositorio, el script comprueba archivos seguidos y commits disponibles mediante referencias y reflog. Si `.env` estuviera registrado, retirarlo con `git rm --cached -- .env` conserva el archivo local; debe verificarse de nuevo el índice. Si una clave aparece en commits anteriores, quitarla del último archivo no la elimina del historial: se debe revocar o rotar y sanear el historial antes de publicar. No hay un historial local previo que revisar en el estado actual.

### Interrupciones de Wokwi y antigüedad de las mediciones

Cerrar la simulación no borra los registros de Supabase ni genera lecturas de reemplazo. La aplicación muestra el historial disponible y, por cada estación del sitio, la última recepción del servidor en **UTC** y el tiempo transcurrido:

- Menos de 60 segundos: **Recibiendo datos**.
- Desde los 60 segundos: **Sin datos recientes** (frecuencia esperada: 10 segundos).
- Consulta exitosa sin historial: **Sin mediciones recibidas**.

El servidor proporciona la hora de consulta y la antigüedad por estación. Un contador monotónico del navegador avanza el indicador cada segundo, sin depender de la hora local del equipo ni de que lleguen nuevas lecturas. La consulta automática cada diez segundos está activada por defecto; puede pausarse, pero el indicador de antigüedad sigue actualizándose. Al volver a una pestaña visible se consulta de nuevo si está activada la actualización automática.

Una consulta fallida se informa por separado: el historial de la última consulta exitosa permanece visible, marcado como no actualizado, con los estados conocidos y sus horas originales. Si nunca se logró cargar, se muestra el error y no se afirma que la estación carezca de datos. Los resultados se reemplazan y deduplican al consultar de nuevo; no se añaden copias del historial anterior. El comparador y el análisis del relieve no esperan estas consultas.

`GET /api/telemetry` conserva los últimos 100 registros del sitio y añade `server_time`, `stations`, `expected_interval_seconds` y `stale_after_seconds`. Los estados incluyen estaciones silenciosas aunque sus lecturas hayan quedado fuera de esos 100 registros: se consulta por páginas la metadata histórica de Supabase. En historiales grandes convendría sustituir ese recorrido por una agregación indexada en la base de datos. No se necesita modificar el esquema actual para esta entrega.

Verificación actual: **24 pruebas Python aprobadas** y `node scripts/telemetry_check.cjs` aprobado con reloj y respuestas controladas en Chrome: estaciones independientes, transición sin nuevas lecturas, conservación del historial ante error, reanudación sin duplicados y selección de terreno independiente. No se escribieron mediciones externas durante esta comprobación. La ejecución real de Wokwi contra una URL pública sigue pendiente.

Python 3.11 o posterior. Desde esta carpeta, en PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.lock.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
.venv/Scripts/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Abrir http://127.0.0.1:8000. No se necesita Node, compilación del frontend ni clave NASA para usar la aplicación. Three.js, Leaflet, cartografía y cuatro recortes pequeños se sirven localmente. Solo NASA POWER y una instancia configurada de Supabase requieren conexión externa durante el uso. No se descargan mapas globales en cada consulta.

`requirements.txt` permite rangos de versiones; `requirements.lock.txt` registra las versiones comprobadas. Las herramientas de análisis geoespacial son opcionales y tienen sus propios archivos de dependencias. Durante el desarrollo de esta entrega se utilizó un directorio local `.terrain-deps` ignorado por Git; no es necesario para el despliegue.

## Qué está implementado

| Función | Estado real |
| --- | --- |
| FastAPI y frontend en español | Funcionales localmente |
| Dos visores Three.js | Jezero a la izquierda; candidato seleccionado a la derecha |
| Controles | Arrastrar, rueda, botones de giro/zoom/reset; cámaras sincronizables; teclado ←/→, +/−, Inicio al enfocar un visor |
| Colores y escala | Elevación relativa o pendiente, leyenda compartida, celda 500 m, recorte 10 km, cuadrícula visual 2 km y exageración vertical ×1–×30 |
| Sin WebGL 2 | Mismos datos en mapas 2D; zoom y reset funcionan; giro orbital y exageración se deshabilitan con explicación |
| Móvil | Visores apilados y tablas con desplazamiento interno |
| Candidatos y localización | Tres ventanas verificadas, selector, clasificación y mapa 2D interactivo con Leaflet/Natural Earth |
| Similitudes | PCA entrenado, distancia base, diferencias por variable y aportes con signo a la distancia PCA² |
| NASA POWER | Consulta histórica terrestre con procedencia, fecha UTC, caché y valores faltantes; enero de 2024 por defecto |
| IoT | POST autenticado, historial por candidato, actualización manual o cada 10 segundos; siempre marcado simulado |
| Supabase | Conexión real comprobada: escritura simulada mediante FastAPI y lectura confirmada desde `telemetry`; credenciales solo en `.env` |
| Wokwi | Proyecto ESP32/DHT22 preparado; URL, token y certificado TLS pendientes; no compilado ni probado contra servicio publicado |
| Render | Blueprint, dependencias fijadas y validación de artefactos preparados; no desplegado en una cuenta externa |

Las dos últimas integraciones no se presentan como verificadas en cuentas reales. Sin Supabase se usa memoria temporal de hasta 500 lecturas, que se pierde al reiniciar o cambiar instancia. La configuración incompleta produce error; no se sustituye una escritura fallida por un guardado ficticio.

## Datos reales y candidatos

Referencia: **Jezero**, centro 18,38° N / 77,58° E. De un DEM regional de 100 × 100 km se extrae su ventana central de 10 × 10 km. Los tres candidatos son ventanas prefijadas, sin solapamiento, en el sector reservado para evaluación; no son los tres mejores lugares encontrados globalmente:

| ID / Wokwi `site_id` | Lugar | Centro aproximado |
| --- | --- | --- |
| `la-joya-este` | La Joya · sector este, Perú | −16,5451°, −71,7595° |
| `atacama-central` | Atacama · sector central, Chile | −24,1451°, −69,7524° |
| `atacama-noreste` | Atacama · sector noreste, Chile | −23,7836°, −69,5566° |

El orden en pantalla depende del modelo, no del orden de esta tabla. La Joya y Atacama son **dos regiones fuente**, aunque se muestran tres candidatos. Los identificadores antiguos `la-joya`, `pampas-la-joya` y `atacama-control` siguen aceptándose para no romper la integración previa; sus historiales se conservan separados y pueden consultarse por la API.

Fuentes: [MGS MOLA / USGS](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m), [Mapzen Terrain Tiles / Skadi](https://registry.opendata.aws/terrain-tiles/), [especificación y datum de Skadi](https://github.com/tilezen/joerd/blob/master/docs/formats.md), [atribución](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Datos globales SRTM/GMTED2010 cortesía de USGS; ETOPO1, NOAA; distribución terrestre Mapzen. El mosaico no demuestra qué versión de SRTM corresponde a cada píxel.

Los manifiestos registran URL, recuperación UTC, CRS original y local, unidades, datum, resolución, transformación, ausencia de nodata y hashes. Marte usa radio de 3 396 190 m; Tierra, WGS84. Cada región se agrega mediante promedio GDAL a una proyección AEQD local y celdas de 500 m. Las alturas se centran por ventana: **no se comparan altitudes absolutas de planetas distintos**. La malla conecta centros de celdas y abarca 9,5 km; el dominio de sus 20 × 20 celdas es 10 × 10 km.

El MOLA global de aproximadamente 463 m en el ecuador sirve para relieve regional. No resuelve obstáculos pequeños ni rutas seguras de rover. Las resoluciones efectivas e instrumentos difieren aunque la celda final coincida. La fecha de recuperación no es fecha de observación.

## IA y alcance de la evaluación

Se mantienen siete descriptores: relieve P95−P05, dispersión vertical, pendiente media/P90/dispersión, rugosidad por laplaciano discreto y RMS sin tendencia planar. Se calculan en Python a partir del DEM científico, antes de crear el visor. Cambiar cámara, color o exageración no modifica esos resultados.

Aprendizaje no supervisado: estandarización y **PCA por SVD**, con el mínimo número de componentes que conserva al menos 95 % de la varianza de entrenamiento. No es una fórmula arbitraria etiquetada como IA. La recuperación usa distancia euclídea en el espacio aprendido y se compara con una base euclídea sobre los siete descriptores estandarizados. No hay LLM ni clasificación supervisada.

Se entrenó con **95 ventanas** terrestres y se evaluó con **80**, con una franja de separación espacial de 10 km. Dos componentes conservan **95,68 %** de la varianza. El top 5 coincide con la base: **no se demostró superioridad de PCA**. El relieve robusto y el laplaciano de Jezero quedan fuera del rango de entrenamiento, por lo que existe extrapolación. No hay etiquetas expertas ni exactitud científica calculada (`scientific_accuracy: null`). Las ventanas vecinas tienen autocorrelación; 95 ventanas no equivalen a 95 regiones independientes.

La tabla muestra diferencias físicas y aportes con signo a la distancia PCA². Estos últimos suman la distancia al cuadrado y pueden ser negativos por correlación entre variables; no representan porcentajes de importancia. Los índices no son probabilidades de equivalencia planetaria.

[Método completo, fórmulas y limitaciones](docs/TERRAIN.md). Pendiente: más regiones independientes, sensibilidad a resolución, incertidumbre de los DEM y validación geológica externa.

## Regenerar datos y visores

Los recortes originales preparados (`data/terrain/*.npz`), manifiestos, experimento y archivos del visor (`data/viewer/*.json`) deben incluirse al subir el repositorio. Las teselas grandes de descarga y los entornos locales están ignorados por Git.

```powershell
.venv/Scripts/python -m pip install -r requirements-terrain.lock.txt
# Solo para descargar de nuevo; requiere acceso HTTPS a USGS/S3:
.venv/Scripts/python terrain.py acquire
# Funcionan sin red con los recortes incluidos:
.venv/Scripts/python terrain.py analyze
.venv/Scripts/python prepare_viewer.py
.venv/Scripts/python scripts/check_assets.py
```

`analyze` verifica hashes y escalas. No se rellena nodata con ceros. Se excluyen conservadoramente ventanas terrestres con alturas ≤ 0 m por posible costa/océano; no es una máscara de tierra validada. Los cuatro archivos del visor pesan decenas de KB cada uno. El servidor de producción solo necesita las dependencias de FastAPI.

Las bibliotecas del navegador están fijadas: Three.js 0.170.0 y Leaflet 1.9.4, con licencias y SHA-256 en `static/vendor`. El mapa Natural Earth v5.1.2 es de dominio público, usa coordenadas terrestres en un localizador Web Mercator y no se usa para mediciones científicas. Para volver a descargar estos recursos: `python scripts/fetch_vendor.py`. No se usa un CDN durante las visitas.

## Supabase y secretos

1. Crear un proyecto Supabase y ejecutar `supabase/schema.sql` en el editor SQL. La tabla habilita RLS, revoca acceso público y concede lectura/escritura al rol del servidor.
2. Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `DEVICE_TOKEN` en `.env` local o en las variables de Render. No poner claves en JavaScript, Wokwi, Git ni capturas. Generar un token propio para el dispositivo.
3. Consultar `/api/storage/status`: hace una lectura de la tabla sin escribir. `/api/health` solo indica configuración presente y **no prueba** conexión.
4. Verificar escritura enviando una medición simulada autenticada y leer el historial. Las pruebas unitarias verifican el adaptador con respuestas simuladas. Además se realizó una comprobación real de escritura/lectura con la configuración local, descrita abajo.

Comprobación real completada el 22 de octubre de 2026 (Lima): `station_id=supabase-check-20261023T011409Z-3d39b1`, `site_id=atacama-central`, fila `id=1`, temperatura 24,5 °C, humedad 45 %, `simulated=true`. Se escribió mediante `POST /api/telemetry` y se verificó tanto el historial del servidor como la fila de la tabla `telemetry`. No se usó memoria temporal. El token de dispositivo se generó y guardó localmente sin mostrarlo.

El script `scripts/verify_supabase.py` permite repetir esta comprobación cargando `.env` sin imprimir secretos. Reutiliza el `station_id` del comprobante local para evitar duplicados, inicia el servidor con las variables actuales y comprueba la fila existente antes de escribir. El comprobante está en `artifacts/supabase-check.json` y está ignorado por Git. Esta comprobación no significa que Render o Wokwi ya estén publicados o conectados.

Endpoint: `POST /api/telemetry`, cabecera `X-Device-Token` y cuerpo:

```json
{"station_id":"wokwi-01","site_id":"atacama-central","temperature_c":24,"humidity_pct":45}
```

El servidor impone `simulated: true`, valida coordenadas de candidato mediante su ID y marca recepción UTC. El historial del prototipo es público y solo para demostración académica simulada. Un uso real necesitaría cuentas, autorización por dispositivo y límites de solicitudes.

## Wokwi

Importar `wokwi/diagram.json`, `sketch.ino` y `libraries.txt` en un proyecto ESP32 Arduino. Configurar `ENDPOINT` con la URL HTTPS de Render, `DEVICE_TOKEN`, `SITE_ID` y un certificado raíz PEM vigente en `ROOT_CA`. El ID inicial es `atacama-central`; la web indica el ID de cada candidato. El sketch sincroniza la hora mediante NTP para validar TLS, lee el DHT22 y envía cada diez segundos; no desactiva la validación del certificado.

Cambiar temperatura/humedad en el DHT22 simulado y consultar el historial. No se ha compilado ni ejecutado esta versión en Wokwi y no se dispone todavía de una URL publicada ni de secretos externos. Las lecturas simuladas **no entran al modelo** y no son evidencia científica.

## Render

### Integridad de recursos y saltos de línea

`.gitattributes` marca `static/vendor/**` y `data/terrain/*.npz` como `-text`: Git debe guardar y recuperar sus bytes exactos, independientemente de `core.autocrlf`. No editar ni normalizar estos archivos automáticamente: el build comprueba SHA-256 mediante `scripts/check_assets.py`.

Se corrigió un fallo causado por `core.autocrlf=true`: el archivo local `leaflet.css` conservaba 661 saltos CRLF y coincidía con el manifiesto, pero el blob del commit tenía LF y no coincidía. También afectaba a `LEAFLET-LICENSE.txt` (26 saltos CRLF). Los otros cinco recursos verificados del manifiesto y los tres `.npz` ya coincidían con Git. Se volvieron a registrar los bytes originales verificados; **no se cambiaron los hashes ni se desactivó el verificador**. El manifiesto solo recuperó sus saltos de línea locales bajo la nueva regla; sus URLs y hashes permanecen iguales.

La regla requiere registrar de nuevo los recursos ya seguidos: no basta con añadir `.gitattributes` si el índice sigue conteniendo bytes normalizados. El cambio preparado incluye esa corrección.

Validación reproducible del índice preparado, sin crear commits en la rama del proyecto:

```powershell
python scripts/check_clean_checkout.py
```

Este script exporta únicamente archivos del índice (sin `.env`), valida recursos y crea un repositorio temporal independiente para obtener un checkout con `core.autocrlf=false`, equivalente en bytes al checkout Linux de Render. Allí ejecuta el verificador y las pruebas. La comprobación pasó con los siete recursos de terceros, los recortes científicos y 24 pruebas Python. Las dependencias de pruebas deben estar instaladas en el Python utilizado; el análisis numérico requiere `requirements-terrain.lock.txt`. No se ha realizado un despliegue nuevo desde esta comprobación local.

Subir esta carpeta como raíz de un repositorio y crear un servicio desde `render.yaml`. El build instala `requirements.lock.txt` y comprueba artefactos científicos y bibliotecas; falla si faltan o sus hashes no coinciden. Inicio: `uvicorn main:app --host 0.0.0.0 --port $PORT`, health check `/api/health`, Python 3.11.11. Configurar las tres variables secretas en Render; el blueprint no contiene sus valores.

Tras desplegar: abrir la web, probar ambos visores y un candidato, consultar `/api/storage/status`, enviar una lectura desde Wokwi y confirmar su persistencia tras reiniciar el servicio. No se creó ni publicó ningún recurso en una cuenta externa durante esta entrega.

## Pruebas y revisión visual

```powershell
.venv/Scripts/python -m unittest -v
.venv/Scripts/python scripts/check_assets.py
node --check static/app.js
node --check static/viewers.js
```

**22 pruebas Python aprobadas** con las dependencias geoespaciales: fórmulas de pendientes, invariancia a altura absoluta, hashes, subventanas exactas, aportes del modelo, APIs, autenticación, recepción simulada, errores, adaptador Supabase con mocks, límites de fechas, año `0025`, periodos inválidos, periodo bisiesto de 366 días, vista legible y política de caché. Sin NumPy las pruebas numéricas se omiten; para ejecutarlas instalar `requirements-terrain.lock.txt`.

Verificación de navegador opcional, con el servidor iniciado y Chrome instalado:

```powershell
npm.cmd install --prefix .browser-test --no-audit --no-fund playwright@1.58.2
node scripts/browser_check.cjs
```

`CHROME_PATH` permite indicar otro ejecutable; `TEST_BASE_URL` cambia la URL local de prueba. Se verificaron dos contextos WebGL reales en Chrome con renderizado software, giro, zoom, reset, cámaras sincronizadas e independientes, colores, exageración sin cambiar métricas, candidatos, móvil a 390 px, errores y alternativa al bloquear WebGL. Se revisaron capturas de escritorio, móvil y 2D en `artifacts/browser/` (ignoradas por Git). No se comprobó en un teléfono físico o GPU distinta, ni se envió telemetría ficticia a una base externa.

La comprobación de navegador incluye además el botón ×1, selección desde el mapa, encuadre de los vértices científicos para los tres candidatos a ×1/×10/×30, rechazo del año `0025` sin cambiar su valor, periodos invertidos o demasiado largos sin llamar a NASA, dos gráficas, medias que excluyen nulos, cortes de línea ante datos faltantes, los cuatro estados de almacenamiento y la página `/catalogue`. `desktop.png` y `mobile-charts.png` muestran las gráficas con datos reales cuando NASA está disponible; las respuestas controladas se usan solo para las aserciones de prueba. `fallback-2d.png` documenta la alternativa sin WebGL.

## Fuentes adicionales

- [NASA POWER API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/): contexto meteorológico terrestre, no clima de Marte.
- [NASA, Jezero](https://ntrs.nasa.gov/citations/20170002464).
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls).
- [Leaflet](https://leafletjs.com/reference.html), [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/).
- [Wokwi ESP32 WiFi](https://docs.wokwi.com/guides/esp32-wifi).
- [Supabase REST API](https://supabase.com/docs/guides/api), [Render FastAPI](https://render.com/docs/deploy-fastapi).
