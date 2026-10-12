/*
 * CNC Guardian Pro v0.9 — ESP32 HTTP telemetry demo
 *
 * PURPOSE: prove Wi-Fi + HTTP + JSON connectivity only.
 * IMPORTANT: these values are simulated. No physical sensors are read.
 * Replace the marked demo values only after sensor/electrical design review.
 */
#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_NAME = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

WebServer server(80);
unsigned long lastSampleMs = 0;
float temperatureC = 42.0f;
float vibrationDemo = 2.1f;
float accelerationDemo = 0.42f;
float voltageDemo = 230.0f;
float currentDemo = 3.2f;

void sendStatus() {
  // DEMO ONLY: generated values, not readings from physical sensors.
  String json = "{";
  json += "\"temperature\":" + String(temperatureC, 2) + ",";
  json += "\"vibration\":" + String(vibrationDemo, 2) + ",";
  json += "\"acceleration\":" + String(accelerationDemo, 3) + ",";
  json += "\"voltage\":" + String(voltageDemo, 2) + ",";
  json += "\"current\":" + String(currentDemo, 2) + ",";
  json += "\"source\":\"esp32-demo-simulated\"";
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", json);
}

void sendOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
  Serial.println("Test endpoint: http://<IP>/api/status");
  Serial.println("WARNING: telemetry is simulated demo data.");

  server.on("/api/status", HTTP_GET, sendStatus);
  server.on("/api/status", HTTP_OPTIONS, sendOptions);
  server.onNotFound([]() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(404, "text/plain", "Not found. Use GET /api/status");
  });
  server.begin();
}

void loop() {
  server.handleClient();

  // Smoothly vary the demonstration readings approximately once per second.
  // Replace this block with reviewed sensor acquisition when ready.
  if (millis() - lastSampleMs >= 1000) {
    lastSampleMs = millis();
    temperatureC += random(-5, 6) / 10.0f;
    vibrationDemo += random(-10, 11) / 100.0f;
    accelerationDemo += random(-5, 6) / 100.0f;
    voltageDemo += random(-5, 6) / 10.0f;
    currentDemo += random(-5, 6) / 100.0f;

    temperatureC = constrain(temperatureC, 39.0f, 49.0f);
    vibrationDemo = constrain(vibrationDemo, 1.4f, 3.0f);
    accelerationDemo = constrain(accelerationDemo, 0.2f, 0.6f);
    voltageDemo = constrain(voltageDemo, 227.0f, 233.0f);
    currentDemo = constrain(currentDemo, 2.8f, 3.7f);
  }
}
