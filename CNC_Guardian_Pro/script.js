// ============================================================
// CNC Guardian Pro v0.8
// Simulated telemetry, charts, component highlighting and
// rule-based fault diagnosis. No physical machine is connected.
// ============================================================

(() => {
    "use strict";

    // ---------- DOM helper and demo thresholds ----------
    const $ = (id) => document.getElementById(id);

    // These thresholds are illustrative, not machine safety limits.
    const defaultLimits = {
        temperature: { warning: 55, critical: 60, max: 90 },
        vibration: { warning: 4, critical: 5, max: 12 },
        acceleration: { warning: 0.8, critical: 1, max: 2.5 },
        voltage: { low: 220, high: 240, min: 190, max: 255 },
        current: { warning: 4.5, critical: 5, max: 8 }
    };

    // Keep a separate editable copy so Restore Defaults is predictable.
    let limits = JSON.parse(JSON.stringify(defaultLimits));

    // Calibration offsets affect displayed/analysed simulated values only.
    const calibrationDefaults = {
        temperature: 0, vibration: 0, acceleration: 0, voltage: 0, current: 0
    };
    let calibrationOffsets = { ...calibrationDefaults };

    // Demo profiles are educational presets, not real machine specifications.
    const machineProfiles = {
        general: {
            label: "General Demo",
            limits: {
                temperature: { warning: 55, critical: 60 },
                vibration: { warning: 4, critical: 5 },
                acceleration: { warning: 0.8, critical: 1 },
                voltage: { low: 220, high: 240 },
                current: { warning: 4.5, critical: 5 }
            }
        },
        precision: {
            label: "Precision Milling (demo)",
            limits: {
                temperature: { warning: 50, critical: 57 },
                vibration: { warning: 3, critical: 4 },
                acceleration: { warning: 0.6, critical: 0.85 },
                voltage: { low: 222, high: 238 },
                current: { warning: 4, critical: 4.8 }
            }
        },
        heavy: {
            label: "Heavy Cutting (demo)",
            limits: {
                temperature: { warning: 60, critical: 68 },
                vibration: { warning: 4.5, critical: 6 },
                acceleration: { warning: 0.9, critical: 1.2 },
                voltage: { low: 215, high: 245 },
                current: { warning: 5, critical: 6 }
            }
        }
    };
    let activeProfile = "general";

    function effectiveReadings() {
        const result = {};
        Object.keys(readings).forEach((key) => {
            result[key] = Math.max(0, readings[key] + calibrationOffsets[key]);
        });
        return result;
    }

    const sensorNames = {
        temperature: "Temperature",
        vibration: "Vibration",
        acceleration: "Acceleration",
        voltage: "Voltage",
        current: "Current"
    };

    const chartColors = {
        temperature: "#f39b72",
        vibration: "#ba8af6",
        acceleration: "#66c7f0",
        voltage: "#f5cb61",
        current: "#4bd3ae"
    };

    // ---------- Simulation state ----------
    let running = true;
    let sampleCount = 0;
    let previousState = "NORMAL";
    let previousDiagnosis = "";
    let scenario = "normal";

    let readings = {
        temperature: 42,
        vibration: 2.1,
        acceleration: 0.42,
        voltage: 230,
        current: 3.2
    };

    // v0.9: data-source state. ESP32 mode polls a user-provided JSON endpoint.
    let dataSource = "simulation";
    let liveConnected = false;
    let liveRequestInProgress = false;
    let lastLiveTimestamp = null;
    let lastLiveError = "";
    const LIVE_POLL_INTERVAL_MS = 1500;

    const charts = {};

    // v0.8: persist historical samples in this browser using localStorage.
    // This is local to this browser/profile and is not a server backup.
    const STORAGE_KEY = "cncGuardianPro.history.v08";
    const MAX_HISTORY_RECORDS = 5000;
    let historySaveCounter = 0;
    let storageAvailable = true;

    function loadStoredHistory() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((record) => record && record.timestamp)
                .map((record) => ({
                    ...record,
                    timestamp: new Date(record.timestamp)
                }))
                .filter((record) => !Number.isNaN(record.timestamp.getTime()))
                .slice(-MAX_HISTORY_RECORDS);
        } catch (error) {
            storageAvailable = false;
            console.warn("Could not load CNC Guardian history:", error);
            return [];
        }
    }

    const historyRecords = loadStoredHistory();

    function persistHistory(force = false) {
        if (!storageAvailable) return false;
        historySaveCounter += 1;
        // Save every five samples to avoid repeatedly serializing the whole log.
        if (!force && historySaveCounter < 5) return true;
        historySaveCounter = 0;
        try {
            const serializable = historyRecords.map((record) => ({
                ...record,
                timestamp: record.timestamp.toISOString()
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
            return true;
        } catch (error) {
            storageAvailable = false;
            console.warn("Could not save CNC Guardian history:", error);
            const message = $("historyMessage");
            if (message) {
                message.textContent = "Browser storage is unavailable or full. Export CSV to keep your data.";
            }
            return false;
        }
    }

    window.addEventListener("pagehide", () => persistHistory(true));

    // ---------- Threshold configuration ----------
    const thresholdFields = {
        temperatureWarning: "tempWarning",
        temperatureCritical: "tempCritical",
        vibrationWarning: "vibrationWarning",
        vibrationCritical: "vibrationCritical",
        accelerationWarning: "accelerationWarning",
        accelerationCritical: "accelerationCritical",
        voltageLow: "voltageLow",
        voltageHigh: "voltageHigh",
        currentWarning: "currentWarning",
        currentCritical: "currentCritical"
    };

    function populateThresholdInputs() {
        $("tempWarning").value = limits.temperature.warning;
        $("tempCritical").value = limits.temperature.critical;
        $("vibrationWarning").value = limits.vibration.warning;
        $("vibrationCritical").value = limits.vibration.critical;
        $("accelerationWarning").value = limits.acceleration.warning;
        $("accelerationCritical").value = limits.acceleration.critical;
        $("voltageLow").value = limits.voltage.low;
        $("voltageHigh").value = limits.voltage.high;
        $("currentWarning").value = limits.current.warning;
        $("currentCritical").value = limits.current.critical;
    }

    function readThresholdInputs() {
        const ids = Object.values(thresholdFields);
        const values = {};

        for (const id of ids) {
            const input = $(id);
            const value = Number(input.value);

            if (input.value.trim() === "" || !Number.isFinite(value)) {
                return { valid: false, message: "Enter a valid number in every threshold field." };
            }

            const min = Number(input.min);
            const max = Number(input.max);
            if (value < min || value > max) {
                return {
                    valid: false,
                    message: `${input.labels[0].textContent} must be between ${min} and ${max}.`
                };
            }

            values[id] = value;
        }

        if (values.tempWarning >= values.tempCritical) {
            return { valid: false, message: "Temperature warning must be lower than its critical threshold." };
        }
        if (values.vibrationWarning >= values.vibrationCritical) {
            return { valid: false, message: "Vibration warning must be lower than its critical threshold." };
        }
        if (values.accelerationWarning >= values.accelerationCritical) {
            return { valid: false, message: "Acceleration warning must be lower than its critical threshold." };
        }
        if (values.currentWarning >= values.currentCritical) {
            return { valid: false, message: "Current warning must be lower than its critical threshold." };
        }
        if (values.voltageLow >= values.voltageHigh) {
            return { valid: false, message: "Voltage lower boundary must be below its upper boundary." };
        }

        return { valid: true, values };
    }

    function applyThresholdSettings(restoreDefaults = false) {
        if (restoreDefaults) {
            limits = JSON.parse(JSON.stringify(defaultLimits));
            populateThresholdInputs();
            $("thresholdMessage").textContent = "Default illustrative thresholds restored.";
            $("thresholdBadge").textContent = "DEFAULTS ACTIVE";
            updateDashboard("Default thresholds restored");
            return;
        }

        const result = readThresholdInputs();
        if (!result.valid) {
            $("thresholdMessage").textContent = result.message;
            $("thresholdMessage").className = "threshold-error";
            return;
        }

        const v = result.values;
        limits = {
            ...limits,
            temperature: { ...limits.temperature, warning: v.tempWarning, critical: v.tempCritical },
            vibration: { ...limits.vibration, warning: v.vibrationWarning, critical: v.vibrationCritical },
            acceleration: { ...limits.acceleration, warning: v.accelerationWarning, critical: v.accelerationCritical },
            voltage: { ...limits.voltage, low: v.voltageLow, high: v.voltageHigh },
            current: { ...limits.current, warning: v.currentWarning, critical: v.currentCritical }
        };

        $("thresholdMessage").textContent = "Thresholds applied. Sensor states and diagnosis have been recalculated.";
        $("thresholdMessage").className = "threshold-success";
        $("thresholdBadge").textContent = "CUSTOM LIMITS";
        updateDashboard("Custom thresholds applied");
        addEvent("Custom demo thresholds applied", "INFO", "Threshold configuration");
    }

    $("applyThresholds").addEventListener("click", () => applyThresholdSettings());
    $("resetThresholds").addEventListener("click", () => applyThresholdSettings(true));
    populateThresholdInputs();

    // ---------- Chart creation ----------
    function createChart(sensorKey) {
        const canvas = $(sensorKey + "Chart");

        if (typeof Chart === "undefined") {
            if (canvas) {
                canvas.parentElement.innerHTML =
                    "<p>Charts need an internet connection to load Chart.js. " +
                    "Reconnect and refresh this page.</p>";
            }
            return;
        }

        charts[sensorKey] = new Chart(canvas, {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    label: sensorNames[sensorKey],
                    data: [],
                    borderColor: chartColors[sensorKey],
                    backgroundColor: chartColors[sensorKey] + "20",
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    tension: 0.32
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { intersect: false, mode: "index" },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#0b1522",
                        borderColor: "#344961",
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        grid: { color: "#223247" },
                        ticks: {
                            color: "#7890a8",
                            maxTicksLimit: 6,
                            font: { size: 9 }
                        }
                    },
                    y: {
                        grid: { color: "#223247" },
                        ticks: {
                            color: "#7890a8",
                            maxTicksLimit: 5,
                            font: { size: 9 }
                        }
                    }
                }
            }
        });
    }

    Object.keys(sensorNames).forEach(createChart);

    function timeLabel() {
        return new Date().toLocaleTimeString([], {
            minute: "2-digit",
            second: "2-digit"
        });
    }

    // ---------- Sensor threshold evaluation ----------
    function evaluateSensors() {
        const values = effectiveReadings();
        const status = {
            temperature: values.temperature >= limits.temperature.critical
                ? "CRITICAL"
                : values.temperature >= limits.temperature.warning
                    ? "WARNING" : "NORMAL",

            vibration: values.vibration >= limits.vibration.critical
                ? "CRITICAL"
                : values.vibration >= limits.vibration.warning
                    ? "WARNING" : "NORMAL",

            acceleration: values.acceleration >= limits.acceleration.critical
                ? "CRITICAL"
                : values.acceleration >= limits.acceleration.warning
                    ? "WARNING" : "NORMAL",

            voltage: values.voltage < limits.voltage.low ||
                values.voltage > limits.voltage.high
                ? "WARNING" : "NORMAL",

            current: values.current >= limits.current.critical
                ? "CRITICAL"
                : values.current >= limits.current.warning
                    ? "WARNING" : "NORMAL"
        };

        const criticalCount = Object.values(status)
            .filter((value) => value === "CRITICAL").length;
        const warningCount = Object.values(status)
            .filter((value) => value === "WARNING").length;

        let overall = "NORMAL";

        if (
            criticalCount >= 2 ||
            (status.temperature === "CRITICAL" && status.vibration !== "NORMAL")
        ) {
            overall = "CRITICAL";
        } else if (criticalCount > 0 || warningCount > 0) {
            overall = "WARNING";
        }

        return {
            status,
            criticalCount,
            warningCount,
            overall
        };
    }

    // ---------- Rule-based multi-sensor diagnosis ----------
    function diagnose(sensorResult) {
        const s = sensorResult.status;
        const values = effectiveReadings();
        const t = values.temperature;
        const v = values.vibration;
        const a = values.acceleration;
        const volts = values.voltage;
        const amps = values.current;

        const voltageAbnormal = s.voltage !== "NORMAL";
        const currentHigh = s.current !== "NORMAL";
        const evidence = [];

        // Rule 1: heat and vibration together suggest a spindle-zone issue.
        if (t >= limits.temperature.critical && v >= limits.vibration.critical) {
            evidence.push(`Temperature ${t.toFixed(1)} °C is high.`);
            evidence.push(`Vibration ${v.toFixed(1)} mm/s is high.`);
            if (a >= limits.acceleration.warning) {
                evidence.push(`Acceleration ${a.toFixed(2)} g is also elevated.`);
            }

            return {
                id: "spindle-thermal-mechanical",
                severity: "CRITICAL",
                title: "Possible spindle thermal/mechanical issue",
                summary: "High temperature and vibration are occurring together in this simulation.",
                evidence,
                causes: "Possible causes include bearing wear, mechanical imbalance, poor lubrication, or excessive cutting load.",
                action: "Inspect the spindle assembly, bearing condition, lubrication, tool setup, and cutting load. Follow the machine maker's approved safety procedure."
            };
        }

        // Rule 2: vibration and acceleration together suggest abnormal motion.
        if (v >= limits.vibration.critical && a >= limits.acceleration.critical) {
            evidence.push(`Vibration ${v.toFixed(1)} mm/s exceeds the demo critical threshold.`);
            evidence.push(`Acceleration ${a.toFixed(2)} g exceeds the demo critical threshold.`);

            return {
                id: "mechanical-vibration",
                severity: "CRITICAL",
                title: "Possible abnormal mechanical vibration",
                summary: "Vibration and acceleration are both elevated, indicating an abnormal motion pattern.",
                evidence,
                causes: "Possible causes include imbalance, loose mounting, tool-holder problems, or bearing damage.",
                action: "Inspect tool clamping, spindle mounting, bearings, and mechanical fasteners. Do not treat this rule as a confirmed fault diagnosis."
            };
        }

        // Rule 3: abnormal supply voltage and high current together.
        if (voltageAbnormal && amps >= limits.current.critical) {
            evidence.push(`Voltage is ${volts.toFixed(1)} V, outside the demo range of 220–240 V.`);
            evidence.push(`Current is ${amps.toFixed(1)} A, above the demo critical threshold.`);

            return {
                id: "electrical-load",
                severity: "CRITICAL",
                title: "Possible electrical supply or drive-load issue",
                summary: "Voltage deviation and high current are occurring together.",
                evidence,
                causes: "Possible causes include supply instability, a heavily loaded drive, wiring problems, or a motor fault.",
                action: "Have a qualified person check the supply, drive alarms, motor load, and wiring using approved procedures. Do not open live electrical equipment."
            };
        }

        // Rule 4: heat alone.
        if (t >= limits.temperature.critical) {
            evidence.push(`Temperature is ${t.toFixed(1)} °C, above the demo critical threshold.`);

            return {
                id: "thermal-only",
                severity: "CRITICAL",
                title: "Possible overheating in the spindle/work area",
                summary: "The temperature threshold has been crossed, but this rule alone cannot identify the cause.",
                evidence,
                causes: "Possible causes include excessive load, cooling problems, friction, or a sensor/modelled reading anomaly.",
                action: "Review the temperature trend and inspect cooling, lubrication, tool load, and the relevant machine documentation."
            };
        }

        // Rule 5: vibration elevated, even if acceleration is not critical.
        if (v >= limits.vibration.critical || a >= limits.acceleration.critical) {
            if (v >= limits.vibration.critical) {
                evidence.push(`Vibration is ${v.toFixed(1)} mm/s.`);
            }
            if (a >= limits.acceleration.critical) {
                evidence.push(`Acceleration is ${a.toFixed(2)} g.`);
            }

            return {
                id: "motion-anomaly",
                severity: "CRITICAL",
                title: "Possible abnormal motion or vibration",
                summary: "A motion sensor has crossed its demo critical threshold.",
                evidence,
                causes: "Possible causes include imbalance, loose tooling, a mechanical resonance, or a sensor issue.",
                action: "Review the trend and inspect tooling and the spindle/machine mounting using approved maintenance procedures."
            };
        }

        // Rule 6: electrical issue that does not meet the combined critical rule.
        if (voltageAbnormal || currentHigh) {
            if (voltageAbnormal) {
                evidence.push(`Voltage is ${volts.toFixed(1)} V; demo normal range is 220–240 V.`);
            }
            if (currentHigh) {
                evidence.push(`Current is ${amps.toFixed(1)} A.`);
            }

            return {
                id: "electrical-check",
                severity: sensorResult.overall === "CRITICAL" ? "CRITICAL" : "WARNING",
                title: "Electrical reading needs review",
                summary: "One or more electrical readings are outside the configured demo range.",
                evidence,
                causes: "Possible causes include supply variation, changing motor load, or a measurement issue.",
                action: "Review the trend and any drive/controller alarms. Ask a qualified person to check electrical equipment where needed."
            };
        }

        // Rule 7: warning-level temperature, vibration, or acceleration.
        const warningEvidence = [];
        if (s.temperature === "WARNING") {
            warningEvidence.push(`Temperature ${t.toFixed(1)} °C is elevated.`);
        }
        if (s.vibration === "WARNING") {
            warningEvidence.push(`Vibration ${v.toFixed(1)} mm/s is elevated.`);
        }
        if (s.acceleration === "WARNING") {
            warningEvidence.push(`Acceleration ${a.toFixed(2)} g is elevated.`);
        }

        if (warningEvidence.length > 0) {
            return {
                id: "early-warning",
                severity: "WARNING",
                title: "Early warning: inspect the trend",
                summary: "A reading is approaching or has crossed a warning threshold.",
                evidence: warningEvidence,
                causes: "The pattern may reflect changing load, developing vibration, heating, or normal process variation; more context is needed.",
                action: "Continue observing the trend and compare readings with the machine manufacturer's limits and normal baseline."
            };
        }

        return {
            id: "normal",
            severity: "NORMAL",
            title: "No abnormal pattern detected",
            summary: "The simulated sensor readings are within the demonstration ranges.",
            evidence: ["No configured sensor threshold is currently crossed."],
            causes: "No fault hypothesis is active in the current simulation.",
            action: "Continue observing the trends. Real-machine limits must be validated before practical use."
        };
    }

    // ---------- Event history ----------
    function addEvent(message, severity, rule) {
        const tableBody = $("events");

        if (tableBody.querySelector(".empty")) {
            tableBody.innerHTML = "";
        }

        const row = document.createElement("tr");
        const values = [
            new Date().toLocaleTimeString(),
            message,
            rule,
            severity,
            "Recorded"
        ];

        values.forEach((value, index) => {
            const cell = document.createElement("td");

            if (index === 3) {
                const badge = document.createElement("span");
                badge.className = "severity " + severity.toLowerCase();
                badge.textContent = value;
                cell.appendChild(badge);
            } else {
                cell.textContent = value;
                if (index === 4) cell.style.color = "#8ef0cc";
            }

            row.appendChild(cell);
        });

        tableBody.prepend(row);

        // Keep the event table bounded.
        while (tableBody.children.length > 30) {
            tableBody.removeChild(tableBody.lastElementChild);
        }
    }

    // ---------- Graph updates ----------
    function updateCharts() {
        const label = timeLabel();
        const values = effectiveReadings();

        Object.keys(charts).forEach((key) => {
            const chart = charts[key];
            chart.data.labels.push(label);
            chart.data.datasets[0].data.push(Number(values[key].toFixed(2)));

            while (chart.data.labels.length > 30) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }

            chart.update("none");
        });
    }

    // ---------- Machine component highlighting ----------
    function clearComponentHighlights() {
        [
            "spindleAssembly", "spindleHousing", "spindleCarriage",
            "workpiece", "driveMotor", "tempSensor", "vibSensor"
        ].forEach((id) => {
            const element = $(id);
            if (element) {
                element.classList.remove("component-warning", "component-critical");
            }
        });
    }

    function highlightComponent(id, state) {
        const element = $(id);
        if (!element || state === "NORMAL") return;

        element.classList.add(
            state === "CRITICAL" ? "component-critical" : "component-warning"
        );
    }

    function updateComponentHighlights(result) {
        clearComponentHighlights();

        const tempState = result.status.temperature;
        const vibrationState = result.status.vibration;
        const accelerationState = result.status.acceleration;
        const electricalIssue = result.status.voltage !== "NORMAL" ||
            result.status.current !== "NORMAL";

        highlightComponent("tempSensor", tempState);
        highlightComponent("spindleHousing", tempState);
        highlightComponent("spindleCarriage", tempState);
        if (tempState !== "NORMAL") highlightComponent("workpiece", tempState);

        const motionState =
            vibrationState === "CRITICAL" || accelerationState === "CRITICAL"
                ? "CRITICAL"
                : vibrationState === "WARNING" || accelerationState === "WARNING"
                    ? "WARNING" : "NORMAL";

        highlightComponent("vibSensor", motionState);
        highlightComponent("spindleAssembly", motionState);
        highlightComponent("workpiece", motionState);

        const electricalState = result.status.current === "CRITICAL"
            ? "CRITICAL"
            : electricalIssue ? "WARNING" : "NORMAL";
        highlightComponent("driveMotor", electricalState);

        const affectedAreas = [];
        if (tempState !== "NORMAL") affectedAreas.push("spindle / thermal zone");
        if (motionState !== "NORMAL") affectedAreas.push("spindle tool / vibration zone");
        if (electricalIssue) affectedAreas.push("drive motor / electrical zone");

        const statusLine = $("componentStatus");
        statusLine.className = "component-status" +
            (result.overall === "NORMAL" ? "" : " " + result.overall.toLowerCase());
        $("componentText").textContent = affectedAreas.length
            ? "Affected: " + [...new Set(affectedAreas)].join(" · ")
            : "No affected component detected";
    }

    // ---------- Diagnosis panel ----------
    function updateDiagnosis(diagnosis) {
        const badge = $("diagnosisSeverity");
        badge.textContent = diagnosis.severity;
        badge.className = "diagnosis-badge " + diagnosis.severity.toLowerCase();

        $("diagnosisTitle").textContent = diagnosis.title;
        $("diagnosisSummary").textContent = diagnosis.summary;
        $("diagnosisCauses").textContent = diagnosis.causes;
        $("diagnosisAction").textContent = diagnosis.action;

        const evidenceList = $("diagnosisEvidence");
        evidenceList.innerHTML = "";

        diagnosis.evidence.forEach((item) => {
            const listItem = document.createElement("li");
            listItem.textContent = item;
            evidenceList.appendChild(listItem);
        });

        // Log a new diagnosis only when the rule changes.
        if (diagnosis.id !== previousDiagnosis) {
            if (diagnosis.severity !== "NORMAL") {
                addEvent(
                    diagnosis.title,
                    diagnosis.severity,
                    "Rule: " + diagnosis.id
                );
            }
            previousDiagnosis = diagnosis.id;
        }
    }

    // ---------- v0.7 historical logging and analysis ----------
    function recordHistoricalSample(result, diagnosis, values) {
        const timestamp = new Date();
        historyRecords.push({
            timestamp,
            scenario,
            profile: machineProfiles[activeProfile].label,
            temperature: Number(values.temperature.toFixed(2)),
            vibration: Number(values.vibration.toFixed(3)),
            acceleration: Number(values.acceleration.toFixed(3)),
            voltage: Number(values.voltage.toFixed(2)),
            current: Number(values.current.toFixed(3)),
            temperatureStatus: result.status.temperature,
            vibrationStatus: result.status.vibration,
            accelerationStatus: result.status.acceleration,
            voltageStatus: result.status.voltage,
            currentStatus: result.status.current,
            machineStatus: result.overall,
            diagnosis: diagnosis.title
        });

        if (historyRecords.length > MAX_HISTORY_RECORDS) {
            historyRecords.shift();
        }
        persistHistory();
        renderHistoricalAnalysis();
    }

    function getFilteredHistory() {
        const range = $("historyRange").value;
        if (range === "all") return historyRecords;

        const minutes = Number(range);
        const cutoff = Date.now() - minutes * 60 * 1000;
        return historyRecords.filter((record) => record.timestamp.getTime() >= cutoff);
    }

    function renderHistoricalAnalysis() {
        const rows = getFilteredHistory();
        const criticalCount = rows.filter((row) => row.machineStatus === "CRITICAL").length;
        const warningCount = rows.filter((row) => row.machineStatus === "WARNING").length;
        const peakTemperature = rows.length
            ? Math.max(...rows.map((row) => row.temperature)) : null;
        const peakVibration = rows.length
            ? Math.max(...rows.map((row) => row.vibration)) : null;

        $("historySamples").textContent = rows.length.toLocaleString();
        $("historyCritical").textContent = criticalCount.toLocaleString();
        $("historyWarnings").textContent = warningCount.toLocaleString();
        $("historyPeakTemp").textContent = peakTemperature === null ? "—" : `${peakTemperature.toFixed(1)} °C`;
        $("historyPeakVibration").textContent = peakVibration === null ? "—" : `${peakVibration.toFixed(2)}*`;
        renderPerformanceAnalytics(rows);

        const body = $("historyRows");
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="8" class="empty">No samples are available in this time range yet.</td></tr>';
            return;
        }

        // Show newest samples first, but keep the complete filtered set for CSV export.
        body.innerHTML = "";
        rows.slice(-12).reverse().forEach((record) => {
            const row = document.createElement("tr");
            const values = [
                record.timestamp.toLocaleTimeString(),
                record.temperature.toFixed(1),
                record.vibration.toFixed(2),
                record.acceleration.toFixed(2),
                record.voltage.toFixed(1),
                record.current.toFixed(2),
                record.machineStatus,
                record.diagnosis
            ];
            values.forEach((value, index) => {
                const cell = document.createElement("td");
                cell.textContent = value;
                if (index === 6) {
                    cell.className = record.machineStatus === "CRITICAL"
                        ? "history-critical"
                        : record.machineStatus === "WARNING" ? "history-warning" : "history-normal";
                }
                row.appendChild(cell);
            });
            body.appendChild(row);
        });

        $("historyMessage").textContent = storageAvailable
            ? `Showing the latest ${Math.min(rows.length, 12)} of ${rows.length} samples. History is saved in this browser; export CSV for a separate backup.`
            : `Showing the latest ${Math.min(rows.length, 12)} of ${rows.length} samples. Browser storage is unavailable; export CSV to keep a copy.`;
    }

    // Estimate simulated availability from sample-to-sample intervals.
    // WARNING and CRITICAL samples count as simulated unavailable time only.
    function renderPerformanceAnalytics(rows) {
        const ordered = [...rows].sort((a, b) => a.timestamp - b.timestamp);
        let observedMs = 0;
        let simulatedDowntimeMs = 0;
        const MAX_INTERVAL_MS = 5000;

        for (let index = 1; index < ordered.length; index += 1) {
            const previous = ordered[index - 1];
            const current = ordered[index];
            const interval = Math.min(
                MAX_INTERVAL_MS,
                Math.max(0, current.timestamp.getTime() - previous.timestamp.getTime())
            );
            observedMs += interval;
            if (previous.machineStatus !== "NORMAL") simulatedDowntimeMs += interval;
        }

        const availability = observedMs > 0
            ? ((observedMs - simulatedDowntimeMs) / observedMs) * 100
            : null;
        const minutes = simulatedDowntimeMs / 60000;

        if ($("historyAvailability")) {
            $("historyAvailability").textContent = availability === null
                ? "—" : `${availability.toFixed(1)}%`;
            $("historyDowntime").textContent = `${minutes.toFixed(2)} min`;
        }

        const frequency = new Map();
        ordered.forEach((record) => {
            if (record.machineStatus === "NORMAL") return;
            const diagnosis = record.diagnosis || "Unclassified alert";
            frequency.set(diagnosis, (frequency.get(diagnosis) || 0) + 1);
        });

        const topFaults = [...frequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        const faultList = $("faultFrequencyList");
        if (faultList) {
            faultList.replaceChildren();
            if (!topFaults.length) {
                const item = document.createElement("li");
                item.textContent = "No warning or critical samples in this range.";
                faultList.appendChild(item);
            } else {
                topFaults.forEach(([name, count]) => {
                    const item = document.createElement("li");
                    const label = document.createElement("span");
                    const value = document.createElement("b");
                    label.textContent = name;
                    value.textContent = `${count} samples`;
                    item.append(label, value);
                    faultList.appendChild(item);
                });
            }
        }
    }

    function clearPersistentHistory() {
        historyRecords.length = 0;
        try {
            localStorage.removeItem(STORAGE_KEY);
            storageAvailable = true;
        } catch (error) {
            storageAvailable = false;
        }
        renderHistoricalAnalysis();
        $("historyMessage").textContent = "Saved history cleared from this browser.";
    }

    function csvEscape(value) {
        const text = String(value ?? "");
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function downloadHistoryCsv() {
        const rows = getFilteredHistory();
        if (!rows.length) {
            $("historyMessage").textContent = "No samples in this time range yet. Let the simulation run, then export again.";
            return;
        }

        const columns = [
            ["Timestamp", (r) => r.timestamp.toISOString()],
            ["Scenario", (r) => r.scenario],
            ["Machine profile", (r) => r.profile],
            ["Temperature_C", (r) => r.temperature],
            ["Vibration_demo_units", (r) => r.vibration],
            ["Acceleration_demo_units", (r) => r.acceleration],
            ["Voltage_demo_units", (r) => r.voltage],
            ["Current_demo_units", (r) => r.current],
            ["Temperature_status", (r) => r.temperatureStatus],
            ["Vibration_status", (r) => r.vibrationStatus],
            ["Acceleration_status", (r) => r.accelerationStatus],
            ["Voltage_status", (r) => r.voltageStatus],
            ["Current_status", (r) => r.currentStatus],
            ["Machine_status", (r) => r.machineStatus],
            ["Possible_diagnosis", (r) => r.diagnosis]
        ];

        const csv = [
            columns.map(([name]) => csvEscape(name)).join(","),
            ...rows.map((record) => columns.map(([, getter]) => csvEscape(getter(record))).join(","))
        ].join("\r\n");

        const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `cnc-guardian-history-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        $("historyMessage").textContent = `Exported ${rows.length} samples to CSV.`;
        addEvent(`Exported ${rows.length} historical samples`, "INFO", "CSV data export");
    }

    $("historyRange").addEventListener("change", renderHistoricalAnalysis);
    $("downloadCsv").addEventListener("click", downloadHistoryCsv);
    if ($("clearHistory")) {
        $("clearHistory").addEventListener("click", clearPersistentHistory);
    }

    // ---------- Full dashboard refresh ----------
    function updateDashboard(reason) {
        sampleCount += 1;

        const result = evaluateSensors();
        const diagnosis = diagnose(result);
        const values = effectiveReadings();
        const displayMax = {
            temperature: 90,
            vibration: 12,
            acceleration: 2.5,
            voltage: 255,
            current: 8
        };

        // Update each sensor's value, state label, and progress bar.
        Object.keys(readings).forEach((key) => {
            const valueElement = $(key + "Val");
            const stateElement = $(key + "State");
            const barElement = $(key + "Bar");
            const sensorState = result.status[key];

            if (valueElement) {
                valueElement.textContent = values[key].toFixed(
                    key === "acceleration" ? 2 : 1
                );
            }

            if (stateElement) {
                stateElement.textContent = sensorState;
                stateElement.className = sensorState.toLowerCase();
            }

            if (barElement) {
                const percentage = key === "voltage"
                    ? ((values[key] - 190) / 65) * 100
                    : (values[key] / displayMax[key]) * 100;

                barElement.style.width =
                    Math.max(3, Math.min(100, percentage)) + "%";
                barElement.style.background = sensorState === "CRITICAL"
                    ? "var(--red)"
                    : sensorState === "WARNING"
                        ? "var(--yellow)" : "var(--green)";
            }
        });

        const now = new Date().toLocaleTimeString();
        $("clock").textContent = now;
        $("last").textContent = now;
        $("samples").textContent = sampleCount;
        $("machineChip").textContent = !running
            ? "PAUSED"
            : result.overall === "NORMAL" ? "RUNNING" : result.overall;

        const healthBadge = $("healthBadge");
        healthBadge.textContent = result.overall;
        healthBadge.className = "badge " + result.overall.toLowerCase();
        document.body.classList.toggle(
            "alert-critical",
            result.overall === "CRITICAL"
        );

        const healthScore = result.overall === "CRITICAL"
            ? 38 : result.overall === "WARNING" ? 72 : 96;

        $("score").innerHTML = healthScore + "<span>/100</span>";
        $("score").style.color = result.overall === "CRITICAL"
            ? "var(--red)"
            : result.overall === "WARNING" ? "var(--yellow)" : "var(--green)";
        $("meterFill").style.width = healthScore + "%";
        $("meterFill").style.background = result.overall === "CRITICAL"
            ? "var(--red)"
            : result.overall === "WARNING"
                ? "var(--yellow)"
                : "linear-gradient(90deg,#36d6a2,#5ec9e7)";

        $("summary").textContent = result.overall === "CRITICAL"
            ? "Multiple abnormal conditions"
            : result.overall === "WARNING"
                ? "Inspection recommended"
                : "Operating within demo limits";

        $("description").textContent = result.overall === "NORMAL"
            ? "No simulated critical conditions detected."
            : "One or more configured sensor rules have been crossed.";

        $("alerts").textContent = result.criticalCount + result.warningCount;

        const alertBox = $("alertbox");
        alertBox.className = "alertbox " + result.overall.toLowerCase();
        $("banner").textContent = result.overall === "CRITICAL"
            ? "! CRITICAL: multiple sensor rules"
            : result.overall === "WARNING"
                ? "⚠ Warning: inspect readings" : "✓ All systems normal";
        $("bannerText").textContent = result.overall === "CRITICAL"
            ? "Multiple simulated readings crossed configured limits."
            : result.overall === "WARNING"
                ? "One or more readings need attention."
                : "Monitoring simulated telemetry.";

        // Sensor markers change color to match their individual states.
        const temperatureMarker = $("tempSensor").querySelector("circle");
        const vibrationMarker = $("vibSensor").querySelector("circle");
        const markerColor = (state, normalColor) => state === "NORMAL"
            ? normalColor : state === "WARNING" ? "#ffc45c" : "#ff5d6c";

        temperatureMarker.setAttribute(
            "fill", markerColor(result.status.temperature, "#36d6a2")
        );
        vibrationMarker.setAttribute(
            "fill", markerColor(result.status.vibration, "#5c8dff")
        );

        updateComponentHighlights(result);
        updateDiagnosis(diagnosis);
        recordHistoricalSample(result, diagnosis, values);
        updateCharts();

        // Record changes in the overall status.
        if (result.overall !== previousState) {
            if (result.overall === "CRITICAL") {
                addEvent("Overall machine status is critical", "CRITICAL", "Overall status rule");
            } else if (result.overall === "WARNING") {
                addEvent("Overall machine status is warning", "WARNING", "Overall status rule");
            } else {
                addEvent("Machine status returned to normal", "INFO", "Overall status rule");
            }
            previousState = result.overall;
        } else if (reason && reason.includes("scenario")) {
            addEvent(reason, result.overall === "NORMAL" ? "INFO" : result.overall,
                "Scenario selected by user");
        }
    }

    // ---------- Scenario setup ----------
    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function applyScenario(name) {
        scenario = name;

        if (name === "normal") {
            readings = {
                temperature: randomBetween(42, 46),
                vibration: randomBetween(2, 2.5),
                acceleration: randomBetween(0.35, 0.5),
                voltage: randomBetween(229, 231),
                current: randomBetween(3, 3.4)
            };
        } else if (name === "overheat") {
            readings = {
                temperature: randomBetween(68, 76),
                vibration: 2.4,
                acceleration: 0.45,
                voltage: 230,
                current: 3.6
            };
        } else if (name === "vibration") {
            readings = {
                temperature: 46,
                vibration: randomBetween(6.2, 8.4),
                acceleration: randomBetween(1.15, 1.6),
                voltage: 230,
                current: 3.8
            };
        } else if (name === "electrical") {
            readings = {
                temperature: 46,
                vibration: 2.6,
                acceleration: 0.5,
                voltage: randomBetween(205, 212),
                current: randomBetween(5.3, 6.2)
            };
        } else if (name === "multi") {
            readings = {
                temperature: randomBetween(71, 78),
                vibration: randomBetween(7.4, 8.9),
                acceleration: randomBetween(1.4, 1.9),
                voltage: randomBetween(210, 216),
                current: randomBetween(5.6, 6.5)
            };
        }

        updateDashboard(name === "normal"
            ? "Normal operation scenario"
            : name + " scenario triggered");
    }

    // ---------- v0.9: ESP32 HTTP telemetry ----------
    function setConnectionStatus(message, state = "") {
        const status = $("connectionStatus");
        status.textContent = message;
        status.className = "connection-status" + (state ? " " + state : "");
    }

    function setDataSourceUI() {
        const live = dataSource === "esp32";
        document.body.classList.toggle("live-mode", live);
        $("scenario").disabled = live;
        $("trigger").disabled = live;
        $("start").disabled = live;
        $("pause").disabled = live;
        $("reset").disabled = live;
        $("connectEsp32").textContent = live ? "Connect / Test" : "Test endpoint";
        $("connectionBadge").textContent = live
            ? (liveConnected ? "ESP32 CONNECTED" : "ESP32 MODE")
            : "SIMULATION";
        $("connectionBadge").className = "badge " + (live && liveConnected ? "good" : live ? "warning" : "good");
        $("dataModePill").innerHTML = live
            ? '<i></i> ESP32 TELEMETRY'
            : '<i></i> SIMULATED LIVE DATA';
        const sidefoot = document.querySelector(".sidefoot");
        if (sidefoot) {
            const label = sidefoot.querySelector("b");
            const detail = sidefoot.querySelector("small");
            if (label) label.textContent = live ? (liveConnected ? "ESP32 LIVE MODE" : "ESP32 WAITING") : "SIMULATION MODE";
            if (detail) detail.textContent = live ? "Local network HTTP telemetry" : "No physical sensors connected";
        }
    }

    function validateTelemetry(payload) {
        const keys = ["temperature", "vibration", "acceleration", "voltage", "current"];
        if (!payload || typeof payload !== "object") {
            throw new Error("Response must be a JSON object.");
        }
        const clean = {};
        for (const key of keys) {
            const value = Number(payload[key]);
            if (!Number.isFinite(value) || value < 0 || value > 100000) {
                throw new Error('Missing or invalid numeric field: "' + key + '".');
            }
            clean[key] = value;
        }
        return clean;
    }

    async function pollEsp32(showFailure = false) {
        if (dataSource !== "esp32" || liveRequestInProgress) return;
        const endpoint = $("esp32Endpoint").value.trim();
        let url;
        try {
            url = new URL(endpoint);
            if (!/^https?:$/.test(url.protocol)) throw new Error("Use an http:// or https:// endpoint.");
        } catch (error) {
            liveConnected = false;
            lastLiveError = error.message || "Enter a valid endpoint URL.";
            setDataSourceUI();
            setConnectionStatus(lastLiveError, "error");
            return;
        }

        liveRequestInProgress = true;
        setConnectionStatus("Connecting to " + url.href + " …", "connecting");
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3500);
        try {
            const response = await fetch(url.href, {
                method: "GET",
                cache: "no-store",
                signal: controller.signal
            });
            if (!response.ok) throw new Error("HTTP " + response.status + " from ESP32 endpoint.");
            const payload = await response.json();
            const clean = validateTelemetry(payload);
            readings = clean;
            scenario = "hardware";
            liveConnected = true;
            lastLiveError = "";
            lastLiveTimestamp = new Date();
            setDataSourceUI();
            setConnectionStatus("Connected. Last telemetry received at " + lastLiveTimestamp.toLocaleTimeString() + ". Source: " + (payload.source || "ESP32 endpoint") + ".", "connected");
            updateDashboard("ESP32 telemetry sample");
        } catch (error) {
            liveConnected = false;
            lastLiveError = error.name === "AbortError"
                ? "Connection timed out. Check the ESP32 IP address and Wi-Fi."
                : (error instanceof TypeError
                    ? "Could not reach the endpoint. Check the IP, network and CORS settings."
                    : error.message);
            setDataSourceUI();
            setConnectionStatus(lastLiveError + (showFailure ? " No live sample was accepted." : " Retrying automatically."), "error");
        } finally {
            window.clearTimeout(timeout);
            liveRequestInProgress = false;
        }
    }

    $("dataSource").addEventListener("change", () => {
        dataSource = $("dataSource").value;
        liveConnected = false;
        if (dataSource === "simulation") {
            scenario = "normal";
            running = true;
            document.body.classList.remove("sim-paused");
            applyScenario("normal");
            setDataSourceUI();
            setConnectionStatus("Simulation is active. No hardware is connected.");
        } else {
            running = false;
            setDataSourceUI();
            setConnectionStatus("ESP32 mode selected. Click Connect / Test. Simulation controls are disabled in this mode.", "connecting");
        }
    });

    $("connectEsp32").addEventListener("click", () => {
        if (dataSource !== "esp32") {
            const endpoint = $("esp32Endpoint").value.trim();
            if (!endpoint) {
                setConnectionStatus("Enter the ESP32 endpoint URL first.", "error");
                return;
            }
            // Test endpoint without switching the dashboard away from simulation.
            const original = dataSource;
            dataSource = "esp32";
            pollEsp32(true).finally(() => {
                dataSource = original;
                setDataSourceUI();
            });
            return;
        }
        pollEsp32(true);
    });

    // ---------- Controls ----------
    $("start").addEventListener("click", () => {
        running = true;
        document.body.classList.remove("sim-paused");
        $("start").textContent = "▶ Running";
        updateDashboard("Simulation resumed");
    });

    $("pause").addEventListener("click", () => {
        running = false;
        document.body.classList.add("sim-paused");
        $("machineChip").textContent = "PAUSED";
        $("start").textContent = "▶ Resume";
    });

    $("reset").addEventListener("click", () => {
        running = true;
        document.body.classList.remove("sim-paused");
        previousState = "NORMAL";
        previousDiagnosis = "";
        $("start").textContent = "▶ Start";
        applyScenario("normal");
        addEvent("Simulation reset", "INFO", "Manual reset");
    });

    $("trigger").addEventListener("click", () => {
        if (dataSource === "esp32") return;
        running = true;
        document.body.classList.remove("sim-paused");
        $("start").textContent = "▶ Running";
        applyScenario($("scenario").value);
    });

    $("clear").addEventListener("click", () => {
        $("events").innerHTML =
            '<tr><td colspan="5" class="empty">Log cleared. New events will appear here.</td></tr>';
        addEvent("Visible event log cleared", "INFO", "Manual log action");
    });

    // ---------- v0.6 machine profiles ----------
    function setThresholdInputsFromLimits() {
        $("tempWarning").value = limits.temperature.warning;
        $("tempCritical").value = limits.temperature.critical;
        $("vibrationWarning").value = limits.vibration.warning;
        $("vibrationCritical").value = limits.vibration.critical;
        $("accelerationWarning").value = limits.acceleration.warning;
        $("accelerationCritical").value = limits.acceleration.critical;
        $("voltageLow").value = limits.voltage.low;
        $("voltageHigh").value = limits.voltage.high;
        $("currentWarning").value = limits.current.warning;
        $("currentCritical").value = limits.current.critical;
    }

    $("applyProfile").addEventListener("click", () => {
        const key = $("machineProfile").value;
        const profile = machineProfiles[key];
        if (!profile) return;

        // Preserve display scales while applying profile thresholds.
        limits = {
            ...limits,
            temperature: { ...limits.temperature, ...profile.limits.temperature },
            vibration: { ...limits.vibration, ...profile.limits.vibration },
            acceleration: { ...limits.acceleration, ...profile.limits.acceleration },
            voltage: { ...limits.voltage, ...profile.limits.voltage },
            current: { ...limits.current, ...profile.limits.current }
        };
        activeProfile = key;
        setThresholdInputsFromLimits();
        $("profileBadge").textContent = profile.label.toUpperCase();
        $("profileMessage").textContent = `${profile.label} loaded. Threshold settings below now show this profile's illustrative values.`;
        $("profileMessage").className = "tool-message success";
        $("thresholdBadge").textContent = key === "general" ? "DEFAULTS ACTIVE" : "PROFILE ACTIVE";
        $("thresholdMessage").textContent = "Profile thresholds loaded. You can edit them and apply custom limits.";
        $("thresholdMessage").className = "threshold-success";
        updateDashboard("Machine profile applied");
        addEvent(`${profile.label} profile loaded`, "INFO", "Demo machine profile");
    });

    // ---------- v0.6 simulated calibration offsets ----------
    const calibrationInputIds = {
        temperature: "offsetTemperature",
        vibration: "offsetVibration",
        acceleration: "offsetAcceleration",
        voltage: "offsetVoltage",
        current: "offsetCurrent"
    };

    function applyCalibration(reset = false) {
        const next = {};
        for (const [key, id] of Object.entries(calibrationInputIds)) {
            const input = $(id);
            const value = reset ? 0 : Number(input.value);
            if (input.value.trim() === "" && !reset || !Number.isFinite(value)) {
                $("calibrationMessage").textContent = "Enter a valid numeric offset in every field.";
                $("calibrationMessage").className = "tool-message error";
                return;
            }
            const min = Number(input.min);
            const max = Number(input.max);
            if (value < min || value > max) {
                $("calibrationMessage").textContent = `${input.labels[0].textContent} must be between ${min} and ${max}.`;
                $("calibrationMessage").className = "tool-message error";
                return;
            }
            next[key] = value;
        }

        calibrationOffsets = next;
        Object.entries(calibrationInputIds).forEach(([key, id]) => {
            $(id).value = calibrationOffsets[key];
        });
        const active = Object.values(calibrationOffsets).some(value => value !== 0);
        $("calibrationBadge").textContent = active ? "OFFSETS ACTIVE" : "ZERO OFFSETS";
        $("calibrationMessage").textContent = reset
            ? "All simulated calibration offsets reset to zero."
            : "Offsets applied to displayed simulated readings, charts and rule-based diagnosis.";
        $("calibrationMessage").className = "tool-message success";
        updateDashboard(reset ? "Calibration offsets reset" : "Calibration offsets applied");
        addEvent(reset ? "Calibration offsets reset" : "Simulated calibration offsets applied", "INFO", "Simulation calibration");
    }

    $("applyCalibration").addEventListener("click", () => applyCalibration(false));
    $("resetCalibration").addEventListener("click", () => applyCalibration(true));

    // ---------- v0.6 downloadable plain-text fault report ----------
    function downloadFaultReport() {
        const values = effectiveReadings();
        const result = evaluateSensors();
        const diagnosis = diagnose(result);
        const timestamp = new Date();
        const lines = [
            "CNC GUARDIAN PRO — DEMONSTRATION REPORT",
            "========================================",
            `Generated: ${timestamp.toLocaleString()}`,
            "Data source: SIMULATED — no physical CNC connection",
            `Machine profile: ${machineProfiles[activeProfile].label}`,
            `Scenario: ${scenario}`,
            `Overall status: ${result.overall}`,
            `Illustrative health score: ${result.overall === "CRITICAL" ? 38 : result.overall === "WARNING" ? 72 : 96}/100`,
            "",
            "SENSOR READINGS",
            "---------------",
            `Temperature: ${values.temperature.toFixed(1)} °C — ${result.status.temperature}`,
            `Vibration: ${values.vibration.toFixed(2)} mm/s* — ${result.status.vibration}`,
            `Acceleration: ${values.acceleration.toFixed(2)} g* — ${result.status.acceleration}`,
            `Voltage: ${values.voltage.toFixed(1)} V* — ${result.status.voltage}`,
            `Current: ${values.current.toFixed(2)} A* — ${result.status.current}`,
            "",
            "RULE-BASED DIAGNOSIS",
            "--------------------",
            `Severity: ${diagnosis.severity}`,
            `Possible issue: ${diagnosis.title}`,
            `Summary: ${diagnosis.summary}`,
            "Evidence:",
            ...(diagnosis.evidence || []).map(item => `- ${item}`),
            `Possible causes: ${diagnosis.causes}`,
            `Suggested inspection: ${diagnosis.action}`,
            "",
            "ACTIVE DEMO THRESHOLDS",
            "----------------------",
            `Temperature warning/critical: ${limits.temperature.warning} / ${limits.temperature.critical} °C`,
            `Vibration warning/critical: ${limits.vibration.warning} / ${limits.vibration.critical} mm/s*`,
            `Acceleration warning/critical: ${limits.acceleration.warning} / ${limits.acceleration.critical} g*`,
            `Voltage acceptable demo range: ${limits.voltage.low}–${limits.voltage.high} V*`,
            `Current warning/critical: ${limits.current.warning} / ${limits.current.critical} A*`,
            "",
            "CALIBRATION OFFSETS (SIMULATED)",
            "------------------------------",
            ...Object.entries(calibrationOffsets).map(([key, value]) => `${sensorNames[key]}: ${value}`),
            "",
            "RECENT EVENT HISTORY",
            "--------------------",
            ...Array.from($("events").querySelectorAll("tr")).map(row =>
                Array.from(row.querySelectorAll("td")).map(cell => cell.textContent.trim()).join(" | ")
            ),
            "",
            "LIMITATIONS",
            "-----------",
            "All readings, thresholds, profiles, and diagnoses in this report are illustrative only.",
            "The report is not a safety certificate, validated fault diagnosis, or substitute for the machine manufacturer's guidance.",
            "* Units and limits must be verified for any real machine before practical use."
        ];

        const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
        link.href = url;
        link.download = `cnc-guardian-report-${stamp}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        addEvent("Fault report downloaded", "INFO", "Report export");
    }

    $("downloadReport").addEventListener("click", downloadFaultReport);

    // ---------- Initial graph history ----------
    for (let index = 0; index < 8; index += 1) {
        Object.keys(charts).forEach((key) => {
            const chart = charts[key];
            chart.data.labels.push(timeLabel());
            chart.data.datasets[0].data.push(
                readings[key] + (Math.random() - 0.5) *
                (key === "temperature" ? 2 : 0.2)
            );
        });
    }

    Object.values(charts).forEach((chart) => chart.update("none"));
    updateDashboard("Initial state");

    // ---------- Continuous simulated telemetry ----------
    function advanceSimulation() {
        if (scenario === "normal") {
            readings.temperature = Math.max(39, Math.min(49,
                readings.temperature + (Math.random() - 0.5) * 1.8));
            readings.vibration = Math.max(1.4, Math.min(3,
                readings.vibration + (Math.random() - 0.5) * 0.3));
            readings.acceleration = Math.max(0.2, Math.min(0.6,
                readings.acceleration + (Math.random() - 0.5) * 0.07));
            readings.voltage = Math.max(227, Math.min(233,
                readings.voltage + (Math.random() - 0.5) * 1.2));
            readings.current = Math.max(2.8, Math.min(3.7,
                readings.current + (Math.random() - 0.5) * 0.2));
        } else if (scenario === "overheat") {
            readings.temperature = randomBetween(66, 78);
            readings.vibration = randomBetween(2.2, 2.7);
            readings.acceleration = randomBetween(0.4, 0.5);
            readings.voltage = randomBetween(229, 231);
            readings.current = randomBetween(3.4, 3.8);
        } else if (scenario === "vibration") {
            readings.temperature = randomBetween(44, 48);
            readings.vibration = randomBetween(6.1, 8.5);
            readings.acceleration = randomBetween(1.1, 1.65);
            readings.voltage = randomBetween(229, 231);
            readings.current = randomBetween(3.6, 4.0);
        } else if (scenario === "electrical") {
            readings.temperature = randomBetween(44, 48);
            readings.vibration = randomBetween(2.4, 2.8);
            readings.acceleration = randomBetween(0.45, 0.55);
            readings.voltage = randomBetween(205, 213);
            readings.current = randomBetween(5.2, 6.2);
        } else if (scenario === "multi") {
            readings.temperature = randomBetween(71, 78);
            readings.vibration = randomBetween(7.2, 9);
            readings.acceleration = randomBetween(1.35, 1.9);
            readings.voltage = randomBetween(210, 216);
            readings.current = randomBetween(5.5, 6.5);
        }

        updateDashboard("Automatic simulated sample");
    }

    // Keep one timer; Pause freezes values, charts and spindle animation.
    // One scheduler handles both data sources; live values are never overwritten by demo values.
    window.setInterval(() => {
        $("clock").textContent = new Date().toLocaleTimeString();
        if (dataSource === "simulation") {
            if (running) advanceSimulation();
        } else {
            pollEsp32(false);
        }
    }, LIVE_POLL_INTERVAL_MS);

    setDataSourceUI();
})();
