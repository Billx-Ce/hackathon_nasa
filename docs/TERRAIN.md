# Experimento de relieve: Jezero / Tierra

Referencia de trabajo elegida: centro 18,38° N, 77,58° E, Marte. Se adquiere un cuadrado local de 100 × 100 km y se compara su ventana central de 10 × 10 km. Es una decisión del prototipo para explorar relieve regional, no una propuesta de emplazamiento de base. Jezero tiene contexto de exploración y estudios de depósitos antiguos: [NASA, investigación de Jezero](https://ntrs.nasa.gov/citations/20170002464), [NASA, dossier de aterrizaje](https://mars.nasa.gov/system/downloadable_items/45586_ingenuity_landing_press_kit.pdf).

## Datos y trazabilidad

| Cuerpo | Producto | Referencia vertical | Escala original |
| --- | --- | --- | --- |
| Marte | MGS MOLA DEM global distribuido por USGS | Areoide marciano; metros | 463,0935 m en la cuadrícula ecuatorial; espaciamiento físico longitudinal varía con latitud |
| Tierra | Mapzen Terrain Tiles, Skadi, mosaico global distribuido en AWS | Geoide WGS84/EGM96; metros | Teselas de 1 grado, resolución registrada en grados en cada manifiesto |

Fuentes: [catálogo USGS MOLA](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m), [GeoTIFF MOLA](https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif), [registro AWS](https://registry.opendata.aws/terrain-tiles/), [especificación Skadi](https://github.com/tilezen/joerd/blob/master/docs/formats.md), [composición de fuentes](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md), [atribución y condiciones](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). MOLA actualmente redirige a un objeto público S3; se registra la URL efectiva usada. Mapzen Skadi es un mosaico de fuentes, no se atribuye cada píxel a una versión concreta de SRTM sin metadatos que lo demuestren.

Crédito: Mapzen; global SRTM y GMTED2010 cortesía del U.S. Geological Survey; ETOPO1, NOAA. Datos MOLA: NASA/MGS/MOLA, distribución USGS. No se afirma respaldo de esas instituciones a las modificaciones o conclusiones del prototipo.

Cada `.json` conserva fecha de recuperación UTC, URL, CRS original y local, resolución, datum, transformación, método y SHA-256 del recorte `.npz`. Las teselas Skadi descargadas también tienen hash. El hash MOLA corresponde al recorte preparado, no al archivo global completo. La fecha de recuperación no es fecha de observación: son productos históricos con procesamiento e interpolación. No se ha estimado aquí su incertidumbre vertical.

## Preparación común

- Regiones terrestres: 100 km de lado centrados en La Joya (−16,5°, −71,9°) y Atacama (−24,1°, −69,9°). Las pampas al sur de La Joya quedan dentro del mismo recorte y no cuentan como región independiente.
- Proyección azimutal equidistante local (AEQD) para cada región, metros; Marte usa esfera de radio **3 396 190 m**, consistente con el CRS del producto MOLA. Tierra usa WGS84. No se fuerza un CRS terrestre a Marte.
- Cuadrícula de 200 × 200 celdas de 500 m. GDAL `average` agrega la elevación fuente; no se transforma altura marciana en altura terrestre. Distorsiones locales son pequeñas en esta extensión, pero AEQD no conserva todas las distancias entre puntos.
- Ventanas de 20 × 20 celdas (10 km de lado), sin solapamiento. La referencia usa filas y columnas 90:110 del recorte marciano; el ranking usa ventanas del sector este terrestre, no los puntos del selector de clima.
- Se exige cobertura finita completa. No se rellena nodata con ceros. Se descartan conservadoramente ventanas terrestres que contengan alturas ≤ 0 m para excluir sectores oceánicos/costeros. **Esto no es una máscara de tierra validada** y también excluiría depresiones terrestres legítimas. La exclusión queda registrada.
- Igual celda no significa igual resolución efectiva: MOLA y el mosaico terrestre tienen distinta instrumentación, interpolación y suavizado. 500 m no permite evaluar obstáculos de rover, estabilidad local ni seguridad de construcción.

## Descriptores

Cada ventana resta su media para evitar comparar altitudes absolutas entre planetas. La resta no cambia pendientes ni amplitud del relieve.

| Característica | Definición | Unidad |
| --- | --- | --- |
| Relieve robusto | Percentil 95 menos percentil 5 | m |
| Dispersión vertical | Desviación estándar poblacional | m |
| Pendiente media, P90 y dispersión | `atan(sqrt(dx² + dy²))`, diferencias centrales a 500 m | grados |
| Rugosidad por laplaciano discreto | RMS de la suma de cuatro vecinos menos cuatro veces el centro | m a la escala de 500 m |
| Rugosidad sin tendencia | RMS residual de ajustar un plano por mínimos cuadrados | m |

Gradiente y laplaciano usan solo las 18 × 18 celdas interiores: no se inventan vecinos en bordes. El laplaciano no se divide por distancia al cuadrado; es un índice de rugosidad dependiente de escala, no una curvatura física. Los percentiles y el plano usan las 400 celdas.

## IA y evaluación

Se implementa aprendizaje no supervisado **estandarización + PCA por SVD + recuperación por distancia euclídea**, usando NumPy. No hay LLM ni clasificación supervisada. Fundamento de [PCA](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.PCA.html) y [estandarización](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.StandardScaler.html); la implementación local no depende de scikit-learn.

En cada región terrestre, columnas 0–4 entrenan, columna 5 es una franja de 10 km de separación y columnas 6–9 evalúan. Media, desviación estándar y componentes se ajustan **solo** con entrenamiento. No se usa Marte para ajustar ni escoger componentes. Se conserva el mínimo número de componentes que explica al menos el 95 % de la varianza de entrenamiento, sin blanqueo.

La base usa los siete descriptores estandarizados y distancia euclídea; PCA usa su proyección aprendida. Ambas distancias son adimensionales; cero corresponde a identidad descriptiva, no a equivalencia científica. No se convierten a porcentajes de similitud.

`results.json` incluye reconstrucción en ventanas reservadas, varianza explicada, correlación de rangos con la base, coincidencia del top 5, sensibilidad al entrenar con una sola región y detección de extrapolación. Estas métricas examinan compresión y estabilidad interna. Sin etiquetas expertas o análogos positivos/negativos documentados, **no se calcula exactitud, precisión ni capacidad para identificar análogos científicos** (`scientific_accuracy: null`). Coincidir con la base no prueba superioridad de PCA.

Solo hay dos regiones terrestres. Las ventanas vecinas tienen autocorrelación espacial; 95 ventanas no equivalen a 95 sitios independientes. Falta evaluar más regiones, escalas (por ejemplo 1 km), incertidumbre de los DEM, geología y validación externa. NASA POWER y Wokwi no entran al modelo ni a las métricas.

## Reproducir

```powershell
.venv/Scripts/python -m pip install -r requirements-terrain.lock.txt
.venv/Scripts/python terrain.py acquire
.venv/Scripts/python terrain.py analyze
.venv/Scripts/python -m unittest -v
```

`acquire` requiere acceso HTTPS a USGS/S3 y descarga bloques MOLA y teselas Skadi públicas sin clave. Las teselas se cachean localmente y se excluyen de Git. Los recortes preparados y sus manifiestos sí se conservan. `analyze` funciona sin red y rechaza recortes con hash o escala incorrectos. El servidor Render solo necesita las dependencias originales y sirve el JSON ya calculado en `/api/terrain`; no descarga grandes DEM en cada consulta. Para regenerar con otras regiones hay que modificar explícitamente el experimento, adquirir de nuevo y reevaluar.

## Comparador Three.js y tres candidatos

`prepare_viewer.py` verifica los hashes y exporta cuatro cuadrículas pequeñas a `data/viewer`. Referencia: filas/columnas 90:110 de Jezero. Candidatos prefijados dentro de las ventanas reservadas: La Joya (fila de ventana 5, columna 6), Atacama central (5, 6) y Atacama noreste (1, 8). No se eligieron los tres mejores del ranking global; son ejemplos distintos y sin solapamiento. Hay dos regiones fuente, no tres grupos independientes. Las coordenadas exactas se transforman desde el AEQD correspondiente y coinciden con las utilizadas por el contexto NASA POWER y el mapa.

La malla conecta los 20 × 20 centros de celdas, con 9,5 km entre centros extremos. El dominio de las celdas mide 10 km de lado. Se usa elevación menos la media local, en metros, dividida por 1000 al representarla junto a distancias horizontales en km; después se aplica el factor visual indicado. No hay interpolación que genere nuevas mediciones. La cuadrícula visual tiene líneas cada 2 km. Ambas cámaras usan el mismo espacio métrico y pueden compartir posición y objetivo.

Los colores comparten límites entre ambos terrenos para evitar que el mismo color represente magnitudes distintas en cada visor. Se puede mostrar elevación relativa o pendiente. El mapa de pendiente de color usa diferencias unilaterales de segundo orden en el borde; los descriptores científicos siguen usando solo diferencias centrales interiores, como antes. No se recalculan métricas a partir de los triángulos ni con las alturas exageradas. Sin WebGL se representan las mismas 400 celdas como mapas 2D.

La explicación por variable utiliza `delta = (Earth − Mars) / training_scale`, `q = PᵀP delta`, y aporte `delta_j * q_j`, donde P contiene las componentes PCA. La suma de aportes es la distancia PCA al cuadrado. Los aportes pueden ser negativos por cancelación entre variables correlacionadas; no son probabilidades, porcentajes de importancia o pruebas causales. La comparación base mantiene las siete coordenadas estandarizadas.
