# Auditoría del proyecto Analog Explorer

Fecha: 13 de noviembre de 2026. Se revisó el árbol de trabajo actual, incluidos los cambios locales de Wokwi. No se modificó código de aplicación, configuración ni credenciales. Este informe evalúa el prototipo local; no certifica el despliegue remoto.

## Dictamen

La aplicación web supera las pruebas disponibles y conserva una separación clara entre relieve, clima histórico y sensores simulados. Antes de considerar completa la integración IoT debe repararse el certificado del sketch. Antes de exponer el servicio a tráfico sostenido deben acotarse las consultas y el acceso a recursos externos.

Hallazgos: 3 de prioridad alta, 4 media y 3 baja. No se confirmó una vulnerabilidad crítica. La ausencia de hallazgos de secretos no demuestra ausencia absoluta de credenciales.

## Hallazgos de prioridad alta

### A1. Certificado inválido: bloquea la conexión segura de Wokwi

- Evidencia: `wokwi/sketch.ino:26` contiene `|` dentro del certificado PEM, carácter ajeno a Base64. La validación estricta Base64 falla y `ssl.SSLContext.load_verify_locations` rechaza el certificado completo.
- Impacto: `setCACert(ROOT_CA)` recibe material inválido; configurar el token no resuelve la conexión TLS. No se verificó la compilación ni el comportamiento del ESP32 en Wokwi.
- Corrección: reemplazar el PEM completo con una copia íntegra de la autoridad apropiada, validar su estructura y comprobar la cadena del destino. No basta con eliminar el carácter: el resto del contenido también puede estar alterado. Mantener la verificación TLS.

### A2. Cada consulta de telemetría recorre todo el historial del sitio

- Evidencia: `main.py:234` pagina sin límite temporal ni número máximo de páginas; acumula todos los metadatos en memoria. `static/app.js:112` consulta cada diez segundos por navegador activo. La ruta GET es pública.
- Impacto: tiempo, memoria y consultas a Supabase crecen con todos los registros, aunque solo se muestran cien lecturas. Un dispositivo enviando cada diez segundos produce 8.640 registros diarios. Con treinta días serían unas 260 páginas de metadatos por actualización si la API devuelve mil registros por página. Varios usuarios multiplican la carga.
- Corrección: obtener la última recepción por estación mediante agregación SQL/RPC o una tabla de estado, con índice adecuado; cachear brevemente el resultado y establecer un presupuesto total de tiempo. Definir retención del historial.

### A3. Las consultas climáticas comparten un bloqueo global y carecen de control de tráfico

- Evidencia: `main.py:153` mantiene `power_lock` durante la consulta HTTP de hasta 45 segundos, incluso antes de atender aciertos de caché. No hay límite de concurrencia pendiente, cuota por cliente ni limitación de frecuencia en la aplicación. Las rutas de telemetría y estado también pueden generar consultas externas por solicitud.
- Impacto: una consulta lenta retrasa consultas de otros sitios y resultados ya cacheados; peticiones repetidas con fechas distintas pueden sostener una cola y consumir recursos. No se ejecutó una prueba de carga ni se verificaron posibles límites del proveedor de hosting.
- Corrección: comprobar caché antes del bloqueo; agrupar peticiones de la misma clave, limitar concurrencia y cola, aplicar límites de tráfico y un plazo total por solicitud.

## Hallazgos de prioridad media

### M1. Un token no ASCII provoca HTTP 500

- Evidencia: `main.py:195` llama a `secrets.compare_digest` con cadenas. Reproducción con TestClient, token configurado de prueba y cabecera de bytes `0xff`: devuelve 500; debería rechazar la autenticación. No requiere un token válido.
- Impacto: errores internos provocables por clientes; un token configurado con Unicode también puede inutilizar la autenticación.
- Corrección: definir formato ASCII para los tokens o comparar bytes codificados explícitamente, rechazando entradas inválidas con 401. Añadir un caso de regresión.

### M2. Una credencial compartida permite suplantar cualquier estación

- Evidencia: `main.py:192` usa un único `DEVICE_TOKEN`; `station_id` y cualquier `site_id` permitido los elige el remitente.
- Impacto: quien tenga el token puede insertar lecturas para otras estaciones y sitios. No hay revocación individual, identidad vinculada al token ni protección frente a reenvíos. Es una limitación relevante para pasar de una simulación a múltiples dispositivos.
- Corrección: credenciales por dispositivo vinculadas a estación y sitios autorizados, límites de frecuencia e identificadores únicos de medición para evitar duplicados. Para una sola demo privada puede mantenerse temporalmente el diseño actual con esa limitación explícita.

### M3. Los artefactos JSON no tienen validación estructural

- Evidencia: `main.py:25` solo comprueba lectura y sintaxis JSON. Al importar, `main.py:38` accede a claves de catálogo sin capturar errores de estructura. El health check (`main.py:78`) solo comprueba existencia del resultado. `prepare_viewer.py:92` escribe directamente cada archivo, sin publicación atómica del conjunto.
- Impacto: un JSON válido pero incompleto puede impedir iniciar el servidor o causar errores; una regeneración mientras se sirve el visor puede mezclar generaciones. `check_assets.py` mitiga varios casos al desplegar, pero no valida todos los contratos ni la coherencia numérica de todo el conjunto.
- Corrección: esquemas de artefactos, validación en generación y arranque, identificador de generación común y publicación atómica. Separar salud del proceso y disponibilidad de datos.

### M4. Falta automatizar las verificaciones del repositorio

- Evidencia: no hay configuración de CI en `.github`; `render.yaml` ejecuta el control de assets al construir, pero no las pruebas de API, numéricas, navegador ni secretos. Los scripts de navegador dependen de una instalación local en `.browser-test` y de Chrome en una ruta Windows.
- Impacto: una regresión funcional puede superar el build; repetir la verificación en otra máquina exige preparación manual.
- Corrección: CI con instalación fijada de dependencias, pruebas Python, integridad, escaneo de secretos y Playwright reproducible. Fijar herramientas de desarrollo en un manifiesto propio.

## Hallazgos de prioridad baja

### B1. Documentación de seguridad desactualizada

`README.md:27` y `README.md:29` afirman que no existe repositorio ni historial local. Actualmente existen dos commits y 57 archivos candidatos en la revisión de secretos. Actualizar o fechar claramente esas afirmaciones históricas para que no describan el estado actual.

### B2. Herramientas auxiliares con dependencias no declaradas

`scripts/restart_local.py` requiere `psutil`, ausente de los manifiestos. El Python global no tiene FastAPI, aunque `.terrain-deps` sí permite ejecutar las pruebas. Documentar y fijar un entorno de desarrollo que incluya estas herramientas. Las pruebas emiten además un aviso de deprecación de Starlette respecto al uso de httpx en TestClient; no causó fallos en esta ejecución.

### B3. Captura de red sin regla de exclusión

`wokwi.pcap` está sin seguimiento y `.gitignore` no excluye capturas PCAP. El escaneo de secretos actual no encontró coincidencias, pero no analiza protocolos ni garantiza que futuras capturas no incluyan datos sensibles. Guardarlas en `artifacts/` o excluirlas explícitamente antes de publicar.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `unittest discover -v`, con `.terrain-deps` en PYTHONPATH | 24 pruebas aprobadas |
| Ejecución con Python global, sin dependencias locales | 7 pruebas numéricas aprobadas; módulo de API no importable por ausencia de FastAPI |
| `python scripts/check_assets.py` | Correcto: cuatro cuadrículas, procedencia, ranking y archivos de terceros |
| `python scripts/audit_secrets.py` | 57 archivos candidatos y 2 commits; sin coincidencias detectadas; `.env` excluido y no seguido; plantilla vacía |
| Validación estricta del PEM del sketch | Fallo Base64 y fallo de carga X.509 |
| Token no ASCII con API aislada | Reproducido HTTP 500 |
| `node scripts/browser_check.cjs`, servidor aislado en 127.0.0.1:8017 | Aprobado; sin errores JavaScript no capturados |

El navegador comprobó WebGL, los tres candidatos, cámaras sincronizadas e independientes, zoom, reset, escala real, invariancia de métricas ante exageración, selección de mapa, fechas inválidas, gráficas con datos ausentes, estados de almacenamiento simulados, catálogo, pantalla móvil, alternativa 2D y errores de API. Se ejecutó con Supabase deshabilitado y un token temporal en el proceso. El script incluye una consulta de lectura a NASA POWER; su resultado no certifica la disponibilidad continua del proveedor.

El primer intento de iniciar Chrome fue bloqueado por el entorno (EPERM); la ejecución posterior autorizada completó la prueba. Evidencia visual: `artifacts/browser/`. Informe del escáner: `artifacts/secret-audit.json`. Estos archivos están excluidos de Git.

## Aspectos correctos

- `.env` no está seguido; no se mostraron sus valores. La clave de servicio permanece en el backend.
- SQL activa RLS y revoca acceso de los roles `anon` y `authenticated` a la tabla. Esto describe el archivo local, no comprueba la configuración efectiva remota.
- Validación de temperatura, humedad, finitud, estación y fechas; comparación de token con función de tiempo constante para entradas admitidas.
- Sin interpolación silenciosa de datos climáticos ausentes ni confirmación ficticia al fallar una escritura.
- Datos de relieve con hashes, procedencia, separación espacial de entrenamiento y evaluación, y pruebas numéricas. Se usa `allow_pickle=False` al abrir NPZ.
- La interfaz distingue el parecido descriptivo de una validación científica; no usa clima o IoT para alterar el ranking.

## Límites y riesgos científicos

Dos regiones terrestres y tres candidatos fijos no permiten afirmar búsqueda global ni equivalencia geológica. Las ventanas vecinas tienen autocorrelación espacial. PCA conserva varianza, pero no demuestra capacidad científica para identificar análogos. Diferencias de resolución efectiva y fuentes de elevación pueden afectar pendientes y rugosidad. La exclusión por elevación menor o igual a cero no sustituye una máscara de tierra. Estas limitaciones ya están reconocidas en `docs/TERRAIN.md`; deben conservarse al presentar el proyecto.

## Alcance pendiente de verificación externa

No se auditó la configuración efectiva de Render/Supabase, RLS remota, copias de seguridad, certificados remotos, facturación, logs o permisos de cuenta. No se escribieron mediciones en Supabase, no se reinició el servidor del usuario, no se desplegó ni se compiló el sketch en Wokwi. No se ejecutó un escáner actualizado de vulnerabilidades de dependencias ni se contrastaron avisos de seguridad: no se afirma que las versiones estén libres de CVE. Tampoco se realizó pentest, carga sostenida ni certificación WCAG.

Orden propuesto: reparar A1 y M1; resolver A2/A3 antes de tráfico público sostenido; añadir identidad de dispositivos, contratos de artefactos y CI; actualizar documentación y herramientas. Repetir las comprobaciones tras las correcciones.
