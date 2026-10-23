#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <time.h>

// Usar la URL pública de Render. El token solo identifica esta simulación.
const char* ENDPOINT = "https://TU-SERVICIO.onrender.com/api/telemetry";
const char* DEVICE_TOKEN = "REEMPLAZAR_POR_TOKEN_DEL_DISPOSITIVO";
// Identificador exacto mostrado en la web. Las lecturas son siempre simuladas.
const char* SITE_ID = "atacama-central";
const char* STATION_ID = "wokwi-01";
// Pegar aquí el certificado raíz PEM vigente que valida el HTTPS de Render.
// No se desactiva la verificación TLS. Completar al conocer el servicio real.
const char ROOT_CA[] PROGMEM = "";
DHT dht(15, DHT22);

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.setAutoReconnect(true);
  WiFi.begin("Wokwi-GUEST", "", 6);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

void loop() {
  delay(10000);
  if (WiFi.status() != WL_CONNECTED) { Serial.println("Esperando WiFi..."); return; }
  if (time(nullptr) < 1700000000) { Serial.println("Esperando hora NTP para validar TLS..."); return; }
  if (!strlen(ROOT_CA)) { Serial.println("Configura ROOT_CA para verificar HTTPS de Render."); return; }
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (isnan(t) || isnan(h)) { Serial.println("Lectura no disponible"); return; }
  WiFiClientSecure secureClient;
  secureClient.setCACert(ROOT_CA);
  HTTPClient http;
  if (!http.begin(secureClient, ENDPOINT)) { Serial.println("No se pudo iniciar la conexión"); return; }
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  String payload = "{\"station_id\":\"" + String(STATION_ID) + "\",\"site_id\":\"" + String(SITE_ID) + "\",\"temperature_c\":" + String(t, 2) + ",\"humidity_pct\":" + String(h, 2) + "}";
  int status = http.POST(payload);
  Serial.printf("HTTP %d\n", status);
  Serial.println(http.getString());
  http.end();
}
