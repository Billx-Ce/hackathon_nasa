# Conexion de Wokwi

1. Copia todo sketch.ino al editor del programa en Wokwi. Conserva diagram.json y libraries.txt del circuito existente (DHT22 en GPIO 15).
2. Solo en tu copia privada de Wokwi, sustituye REEMPLAZAR_POR_TOKEN_DEL_DISPOSITIVO por el DEVICE_TOKEN de .env, dentro de las comillas. Nunca uses la clave de Supabase.
3. Si el proyecto de Wokwi es publico, el token sera visible en su codigo. Usa un entorno privado para introducirlo; no publiques ni compartas esa copia.
4. Abre https://analog-explorer.onrender.com para despertar Render y pulsa Play en Wokwi. Espera WiFi, NTP y HTTP 2xx.
5. Comprueba la nueva fila en Supabase y el historial de Atacama central.

El programa verifica TLS usando la raiz extraida de una cadena validada y comprobada de nuevo contra el dominio con esa raiz como unica autoridad. No se desactiva la verificacion. Si cambia la autoridad HTTPS de Render, revisa el certificado.

Hay reintentos con espera de hasta 60 segundos. Si se pierde la respuesta de un envio aceptado, puede haber duplicados. Al cerrar Wokwi cesan los envios; Supabase conserva el historial.

El archivo local versionable conserva el marcador del token. No copies de vuelta a Git el codigo con secretos ni agregues .env. No necesitas redesplegar Render si solo cambia Wokwi.

## Estabilidad HTTPS
La CPU simulada usa 64 MHz. El programa conserva HTTPClient y WiFiClientSecure, consume las respuestas y solicita reutilizar la conexion. El servidor puede cerrarla y sera necesario negociar TLS de nuevo. En condiciones normales intenta enviar cada 10 segundos desde el inicio del intento anterior. Si un envio tarda mas de 10 segundos, no se acumulan muestras ni se garantiza esa frecuencia. Ante errores cierra la conexion y espera 20, 40 y hasta 60 segundos. No reenvia automaticamente la misma muestra ni implementa deduplicacion. Los contadores resumen aceptados y fallidos.

Prueba pendiente en Wokwi: observar al menos 20 envios, los mensajes de reutilizacion, recuperacion tras cortar WiFi y las filas en Supabase. No se ha compilado Arduino en este equipo.
