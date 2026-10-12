CNC GUARDIAN PRO v0.9 — HARDWARE CONNECTION STARTER
===================================================

Files
-----
index.html      Dashboard structure and connection controls
style.css       Responsive dashboard styling
script.js       Simulation, charts, analytics, fault rules, ESP32 polling
esp32_demo.ino  Arduino IDE example HTTP server for connection testing
HARDWARE_GUIDE.txt  Setup, endpoint format and safety notes

Run the dashboard
------------------
1. Extract the complete folder.
2. Open index.html in Chrome or Edge.
3. Keep internet access available for Chart.js and Google Fonts.
4. Simulation mode is the default.
5. For ESP32 mode, enter the board's address followed by /api/status, then select
   “ESP32 HTTP endpoint” and click “Connect / Test”.

Important
---------
The included ESP32 sketch returns TEST/SIMULATED values so you can verify network
communication without sensors. It is not a real sensor acquisition system. Replace
the marked placeholder readings only after choosing suitable sensors and reviewing
their electrical interfaces. This project is not a CNC safety system.

Browser note
------------
The dashboard uses fetch() to contact the ESP32. The ESP32 sketch enables CORS.
Some browsers restrict HTTP requests from file:// pages or mixed-content contexts.
If your browser blocks the request, serve the dashboard over a local development
server (for example VS Code Live Server) and ensure the ESP32 endpoint allows CORS.
Both devices must be on the same local network. Do not expose the ESP32 HTTP server
to the public internet.
