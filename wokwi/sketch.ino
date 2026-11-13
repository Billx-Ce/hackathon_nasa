#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <time.h>

// Usar la URL pÃºblica de Render. El token solo identifica esta simulaciÃ³n.
const char* ENDPOINT = "https://analog-explorer.onrender.com/api/telemetry";
const char* DEVICE_TOKEN = "REEMPLAZAR_POR_TOKEN_DEL_DISPOSITIVO";
// Identificador exacto mostrado en la web. Las lecturas son siempre simuladas.
const char* SITE_ID = "atacama-central";
const char* STATION_ID = "wokwi-01";
// TLS validado con la raiz oficial GTS Root R4.
// TLS validado con la raiz oficial GTS Root R4.
// GTS Root R4: fuente oficial https://pki.goog/roots.pem
const char ROOT_CA[] PROGMEM = R"PEM(-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
)PEM";
DHT dht(15, DHT22);

// Persist across loop() calls so successful connections can be reused.
WiFiClientSecure secureClient;
HTTPClient http;
bool httpReady = false;
unsigned long nextAttempt = 0;
unsigned long retryDelay = 10000;
unsigned long acceptedCount = 0;
unsigned long failedCount = 0;

void closeConnection() {
  http.setReuse(false);
  http.end();
  secureClient.stop();
  httpReady = false;
}
bool timeReported = false;
bool networkChecked = false;

void setup() {
  Serial.begin(115200);
  dht.begin();
  WiFi.setAutoReconnect(true);
  WiFi.begin("Wokwi-GUEST", "", 6);
  Serial.println("Conectando WiFi...");
  while (WiFi.status() != WL_CONNECTED) { delay(500); }
  Serial.println("WiFi conectado. Sincronizando NTP...");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

void loop() {
  if ((long)(millis() - nextAttempt) < 0) { delay(10); return; }
  unsigned long attemptStart = millis();
  nextAttempt = attemptStart + 10000;
  if (WiFi.status() != WL_CONNECTED) { closeConnection(); Serial.println("Esperando WiFi..."); return; }
  if (time(nullptr) < 1700000000) { Serial.println("Esperando hora NTP para validar TLS..."); return; }
  if (!timeReported) {
    time_t now = time(nullptr);
    struct tm utc;
    gmtime_r(&now, &utc);
    char date[32];
    strftime(date, sizeof(date), "%Y-%m-%d %H:%M:%S UTC", &utc);
    Serial.printf("NTP listo: %s\n", date);
    Serial.printf("ESP32 SDK: %s; memoria libre: %u\n", ESP.getSdkVersion(), ESP.getFreeHeap());
    timeReported = true;
  }
  if (!networkChecked) {
    IPAddress address;
    if (!WiFi.hostByName("analog-explorer.onrender.com", address)) {
      Serial.println("DNS fallo: Wokwi no pudo resolver Render."); return;
    }
    Serial.printf("DNS Render: %s\n", address.toString().c_str());
    WiFiClient probe;
    bool tcpOk = probe.connect("analog-explorer.onrender.com", 443, 10000);
    Serial.println(tcpOk ? "TCP 443 accesible. Iniciando TLS..." : "TCP 443 fallo desde Wokwi.");
    probe.stop();
    if (!tcpOk) return;
    networkChecked = true;
  }
  if (!strlen(ROOT_CA)) { Serial.println("Configura ROOT_CA para verificar HTTPS de Render."); return; }
  if (String(DEVICE_TOKEN) == "REEMPLAZAR_POR_TOKEN_DEL_DISPOSITIVO" || !strlen(DEVICE_TOKEN)) { Serial.println("Configura DEVICE_TOKEN en tu copia privada de Wokwi."); return; }
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (isnan(t) || isnan(h)) { Serial.println("Lectura no disponible"); return; }
  if (!httpReady) {
    secureClient.setCACert(ROOT_CA);
    secureClient.setHandshakeTimeout(30);
    static const char* protocols[] = {"http/1.1", nullptr};
    secureClient.setAlpnProtocols(protocols);
    if (!http.begin(secureClient, ENDPOINT)) {
      closeConnection();
      Serial.println("No se pudo preparar HTTPS.");
      return;
    }
    http.setReuse(true);
    http.setConnectTimeout(30000);
    http.setTimeout(60000);
    httpReady = true;
  }
  Serial.println(secureClient.connected() ? "Reutilizando HTTPS." : "Abriendo HTTPS con certificado validado.");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  String payload = "{\"station_id\":\"" + String(STATION_ID) + "\",\"site_id\":\"" + String(SITE_ID) + "\",\"temperature_c\":" + String(t, 2) + ",\"humidity_pct\":" + String(h, 2) + "}";
  Serial.println("Iniciando envio HTTPS (puede tardar hasta 60 s)...");
  unsigned long started = millis();
  int status = http.POST(payload);
  Serial.printf("Duracion de la conexion: %lu ms\n", millis() - started);
  Serial.printf("HTTP %d\n", status);
  // Consume the complete response before reusing the HTTP connection.
  // Do not print its body or any credentials.
  bool bodyComplete = true;
  if (status > 0) {
    int expected = http.getSize();
    String response = http.getString();
    bodyComplete = expected >= 0 && response.length() == (unsigned int)expected;
  }
  if (status >= 200 && status < 300) {
    Serial.println("Medicion aceptada por el servidor.");
    acceptedCount++;
    retryDelay = 10000;
    if (!bodyComplete) closeConnection();
  } else {
    failedCount++;
    if (status < 0) {
      Serial.println(HTTPClient::errorToString(status));
      char error[160];
      int tlsError = secureClient.lastError(error, sizeof(error));
      if (tlsError) Serial.printf("TLS %d: %s\n", tlsError, error);
    } else if (status == 401 || status == 403) {
      Serial.println("Token rechazado: revisa DEVICE_TOKEN sin compartirlo.");
    } else if (status == 422) {
      Serial.println("Datos rechazados: revisa sitio y valores del sensor.");
    } else {
      Serial.println("Error del servidor. Se reintentara.");
    }
    retryDelay = retryDelay < 30000 ? retryDelay * 2 : 60000;
    closeConnection();
    nextAttempt = millis() + retryDelay;
    Serial.printf("Reintento en %lu segundos.\n", retryDelay / 1000);
  }
  Serial.printf("Aceptados: %lu; fallidos: %lu\n", acceptedCount, failedCount);
}
