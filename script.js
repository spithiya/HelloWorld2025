let openai = null;
let openaiKeyInUse = null;
let openaiInitReason = null;

function ensureOpenAI() {
    const globalScope = typeof window !== "undefined" ? window : globalThis;
    const OpenAIConstructor = globalScope && globalScope.OpenAI ? globalScope.OpenAI : undefined;
    const keyFromWindow = globalScope && globalScope.OPENAI_API_KEY ? globalScope.OPENAI_API_KEY : undefined;
    const keyFromProcess = typeof process !== "undefined" && process.env ? process.env["OPENAI_API_KEY"] : undefined;
    const resolvedKey = keyFromWindow || keyFromProcess || null;

    if (!OpenAIConstructor) {
        openaiInitReason = "library";
        return null;
    }
    if (!resolvedKey) {
        openaiInitReason = "key";
        return null;
    }

    if (!openai || resolvedKey !== openaiKeyInUse) {
        try {
            openai = new OpenAIConstructor({
                apiKey: resolvedKey,
                ...(typeof window !== "undefined" ? { dangerouslyAllowBrowser: true } : {})
            });
            openaiKeyInUse = resolvedKey;
        } catch (error) {
            console.error("Failed to initialize OpenAI client:", error);
            openai = null;
            openaiInitReason = "init";
            return null;
        }
    }

    openaiInitReason = null;
    return openai;
}

function describeOpenAIInitIssue() {
    if (openaiInitReason === "library") {
        return "OpenAI client library not loaded";
    }
    if (openaiInitReason === "key") {
        return "OpenAI API key not configured";
    }
    if (openaiInitReason === "init") {
        return "OpenAI client failed to initialize";
    }
    return "OpenAI client unavailable";
}

function initializeHydrationApp() {
    let dailyGoal = 110;
    let latestTotal = 0;
    let lastCalculatedNeed = null;

    const entries = [];

    const insights = [
        "Tip: Pair each caffeinated drink with 8 fl oz of water.",
        "High-output training days call for an extra 12-16 fl oz.",
        "Produce and soups can contribute 18-24 fl oz toward your target.",
        "Yesterday's intake tapered after 6 PM; schedule a 10 fl oz top-off."
    ];

    const ui = {
        logRows: document.getElementById("log-rows"),
        radialCircle: document.querySelector("[data-stat=\"radial\"]"),
        radialContainer: document.querySelector(".radial"),
        radialLabel: document.querySelector("[data-stat=\"radial-label\"]"),
        summaryTop: document.querySelector("[data-stat=\"summary-top\"]"),
        summarySecondary: document.querySelector("[data-stat=\"summary-secondary\"]"),
        summaryTip: document.querySelector("[data-stat=\"summary-tip\"]"),
        dayTotal: document.querySelector("[data-stat=\"day-total\"]"),
        dailyGoal: document.querySelector("[data-stat=\"daily-goal\"]"),
        insightsList: document.getElementById("insights-list"),
        dropzone: document.getElementById("dropzone"),
        fileInput: document.getElementById("photo-input"),
        analyzeButton: document.getElementById("analyze-button"),
        electrolyteToggle: document.getElementById("electrolyte-toggle"),
        analysisCard: document.querySelector(".analysis-card"),
        analysisHeaderCopy: document.querySelector(".analysis-card header p"),
        analysisPreview: document.querySelector(".analysis-preview"),
        analysisPreviewImage: document.getElementById("analysis-preview-image"),
        analysisTitle: document.querySelector("[data-analysis-field=\"title\"]"),
        analysisTimestamp: document.querySelector("[data-analysis-field=\"timestamp\"]"),
        analysisMetrics: document.querySelector(".analysis-metrics"),
        analysisWater: document.querySelector("[data-analysis-field=\"water\"]"),
        analysisElectrolytes: document.querySelector("[data-analysis-field=\"electrolytes\"]"),
        analysisSummary: document.querySelector("[data-analysis-field=\"summary\"]"),
        analysisTags: document.querySelector("[data-analysis-field=\"tags\"]"),
        toast: document.querySelector(".toast"),
        scrollTriggers: document.querySelectorAll("[data-scroll-target]"),
        calculatorForm: document.getElementById("intake-form"),
        weightInput: document.getElementById("input-weight"),
        heightFeetInput: document.getElementById("input-height-ft"),
        heightInchesInput: document.getElementById("input-height-in"),
        activityInput: document.getElementById("input-activity"),
        climateInput: document.getElementById("input-climate"),
        calculateButton: document.getElementById("calculate-intake"),
        applyGoalButton: document.getElementById("apply-goal"),
        calculatorResultValue: document.querySelector("[data-calculator-field=\"total\"]"),
        calculatorResultNote: document.querySelector("[data-calculator-field=\"details\"]")
    };

    const initialOpenAIClient = ensureOpenAI();
    if (!initialOpenAIClient) {
        console.warn(describeOpenAIInitIssue() + '; GPT analysis disabled.');
    }

    let currentUpload = null;
    let currentObjectUrl = null;
    let insightIndex = 0;
    let insightTimer = null;

    if (ui.dailyGoal) {
        ui.dailyGoal.textContent = formatAmount(dailyGoal);
    }
    if (ui.applyGoalButton) {
        ui.applyGoalButton.disabled = true;
    }
    const yearElement = document.getElementById("year");
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    ui.scrollTriggers.forEach(function (button) {
        button.addEventListener("click", function (event) {
            const selector = event.currentTarget.getAttribute("data-scroll-target");
            const target = selector ? document.querySelector(selector) : null;
            if (target) {
                target.scrollIntoView({ behavior: "smooth" });
            }
        });
    });

    if (ui.fileInput) {
        ui.fileInput.addEventListener("change", function (event) {
            const file = event.target.files && event.target.files[0];
            if (file) {
                prepareUpload(file);
            }
        });
    }

    if (ui.dropzone) {
        ui.dropzone.addEventListener("dragover", function (event) {
            event.preventDefault();
            ui.dropzone.classList.add("dragging");
        });

        ui.dropzone.addEventListener("dragleave", function () {
            ui.dropzone.classList.remove("dragging");
        });

        ui.dropzone.addEventListener("drop", function (event) {
            event.preventDefault();
            ui.dropzone.classList.remove("dragging");
            const file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
            if (file) {
                if (ui.fileInput) {
                    ui.fileInput.files = event.dataTransfer.files;
                }
                prepareUpload(file);
            }
        });
    }

    if (ui.analyzeButton) {
        ui.analyzeButton.addEventListener("click", async function () {
            if (!currentUpload) {
                return;
            }
            const readyClient = ensureOpenAI();
            if (!readyClient) {
                showToast(describeOpenAIInitIssue());
                if (ui.analysisHeaderCopy) {
                    ui.analysisHeaderCopy.textContent = "Connect OpenAI before sending.";
                }
                ui.analyzeButton.disabled = false;
                ui.analyzeButton.textContent = "Send to GPT";
                return;
            }
            ui.analyzeButton.disabled = true;
            ui.analyzeButton.textContent = "Sending...";
            if (ui.analysisHeaderCopy) {
                ui.analysisHeaderCopy.textContent = "GPT is reviewing the photo...";
            }
            showToast("Photo queued for GPT analysis");
            try {
                const includeElectrolytes = ui.electrolyteToggle ? ui.electrolyteToggle.checked : false;
                const analysis = await simulateAnalysis(currentUpload.file, includeElectrolytes);
                displayAnalysis(analysis);
                registerEntry(analysis);
                currentUpload = null;
                if (ui.fileInput) {
                    ui.fileInput.value = "";
                }
            } catch (error) {
                console.error("Image analysis failed:", error);
                showToast("Analysis failed. Please try again.");
                if (ui.analysisHeaderCopy) {
                    ui.analysisHeaderCopy.textContent = "Analysis unavailable. Try again.";
                }
            } finally {
                ui.analyzeButton.textContent = "Send to GPT";
                ui.analyzeButton.disabled = !currentUpload;
            }
        });
    }

    if (ui.calculatorForm) {
        ui.calculatorForm.addEventListener("submit", function (event) {
            event.preventDefault();
        });
    }

    if (ui.calculateButton) {
        ui.calculateButton.addEventListener("click", function () {
            calculateIntake();
        });
    }

    if (ui.applyGoalButton) {
        ui.applyGoalButton.addEventListener("click", function () {
            if (!lastCalculatedNeed) {
                showToast("Run the calculator first");
                return;
            }
            setDailyGoal(lastCalculatedNeed);
            showToast("Daily goal updated to " + formatAmount(lastCalculatedNeed));
        });
    }

    renderLog();
    cycleInsights();

    function prepareUpload(file) {
        if (!file.type.startsWith("image/")) {
            showToast("Please choose an image file");
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            showToast("Image must be under 15 MB");
            return;
        }
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
        }
        currentObjectUrl = URL.createObjectURL(file);
        currentUpload = { file: file, previewUrl: currentObjectUrl };
        if (ui.analysisPreviewImage) {
            ui.analysisPreviewImage.src = currentObjectUrl;
            ui.analysisPreviewImage.alt = "Uploaded meal";
        }
        if (ui.analysisPreview) {
            ui.analysisPreview.hidden = false;
        }
        if (ui.analysisTitle) {
            ui.analysisTitle.textContent = prettifyFilename(file.name);
        }
        if (ui.analysisTimestamp) {
            ui.analysisTimestamp.textContent = timeStamp(new Date());
        }
        if (ui.analysisHeaderCopy) {
            ui.analysisHeaderCopy.textContent = "Ready to analyze. Click send when you are set.";
        }
        if (ui.analysisSummary) {
            ui.analysisSummary.hidden = true;
        }
        if (ui.analysisTags) {
            ui.analysisTags.hidden = true;
        }
        if (ui.analysisMetrics) {
            ui.analysisMetrics.hidden = true;
        }
        if (ui.analyzeButton) {
            ui.analyzeButton.disabled = false;
        }
    }

    async function simulateAnalysis(file, includeElectrolytes) {
        const client = ensureOpenAI();
        if (!client) {
            throw new Error(describeOpenAIInitIssue());
        }
        if (!file) {
            throw new Error("No file provided for analysis.");
        }

        const uploadSeed = generateSeed(file);

        const uploaded = await client.files.create({
            file: file,
            purpose: "vision"
        });

        const response = await client.responses.create({
            model: "gpt-4.1-mini",
            input: [
                {
                    role: "user",
                    content: [
                        { type: "input_text", text: "Analyze the food and drink in the photo and return the estimated water content in fluid ounces. Reply with only the numeric value." },
                        {
                            type: "input_image",
                            file_id: uploaded.id
                        }
                    ]
                }
            ]
        });

        const outputText = extractOutputText(response);
        const water = parseWaterAmount(outputText);
        const normalizedWater = Number.isFinite(water) ? water : 0;
        const electrolytes = includeElectrolytes ? buildElectrolyteAdvice(uploadSeed) : "Skipped per settings.";
        const tags = pickTags(uploadSeed);

        return {
            title: prettifyFilename(file.name || "Water entry"),
            water: normalizedWater,
            electrolytes: electrolytes,
            summary: summarizeWater(normalizedWater, includeElectrolytes),
            tags: tags,
            timestamp: new Date(),
            previewUrl: currentUpload ? currentUpload.previewUrl : null
        };
    }

    function displayAnalysis(analysis) {
        if (ui.analysisPreview) {
            ui.analysisPreview.hidden = !analysis.previewUrl;
        }
        if (ui.analysisPreviewImage && analysis.previewUrl) {
            ui.analysisPreviewImage.src = analysis.previewUrl;
        }
        if (ui.analysisHeaderCopy) {
            ui.analysisHeaderCopy.textContent = "Latest GPT water estimate";
        }
        if (ui.analysisTitle) {
            ui.analysisTitle.textContent = analysis.title;
        }
        if (ui.analysisTimestamp) {
            ui.analysisTimestamp.textContent = timeStamp(analysis.timestamp);
        }
        if (ui.analysisWater) {
            ui.analysisWater.textContent = formatAmount(analysis.water);
        }
        if (ui.analysisElectrolytes) {
            ui.analysisElectrolytes.textContent = analysis.electrolytes;
        }
        if (ui.analysisSummary) {
            ui.analysisSummary.textContent = analysis.summary;
            ui.analysisSummary.hidden = false;
        }

        if (ui.analysisTags) {
            ui.analysisTags.innerHTML = "";
            const tags = Array.isArray(analysis.tags) ? analysis.tags : [];
            tags.forEach(function (tag) {
                const chip = document.createElement("span");
                chip.textContent = tag;
                ui.analysisTags.appendChild(chip);
            });
            ui.analysisTags.hidden = tags.length === 0;
        }

        if (ui.analysisMetrics) {
            ui.analysisMetrics.hidden = false;
        }
        if (ui.analysisCard) {
            ui.analysisCard.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        showToast("Water estimate ready");
    }

    function registerEntry(analysis) {
        entries.unshift({
            timestamp: analysis.timestamp,
            label: analysis.title,
            water: Number.isFinite(analysis.water) ? analysis.water : 0,
            electrolytes: analysis.electrolytes,
            tags: Array.isArray(analysis.tags) ? analysis.tags.slice() : [],
            summary: analysis.summary
        });
        while (entries.length > 8) {
            entries.pop();
        }
        renderLog();
    }

    function renderLog() {
        const totalWater = entries.reduce(function (sum, entry) {
            return sum + (Number(entry.water) || 0);
        }, 0);
        latestTotal = totalWater;

        if (ui.logRows) {
            ui.logRows.innerHTML = "";
            entries.forEach(function (entry) {
                const row = document.createElement("tr");
                row.innerHTML = [
                    "<td>" + timeStamp(entry.timestamp) + "</td>",
                    "<td>" + entry.label + "</td>",
                    "<td>" + formatAmount(entry.water) + "</td>",
                    "<td>" + entry.electrolytes + "</td>"
                ].join("");
                ui.logRows.appendChild(row);
            });
        }

        updateTotals(totalWater);
    }

    function updateTotals(totalWater) {
        const pct = clamp(Math.round((totalWater / dailyGoal) * 100), 0, 150);
        const circumference = 326;
        const offset = circumference - (circumference * Math.min(pct, 100)) / 100;

        if (ui.dayTotal) {
            ui.dayTotal.textContent = formatAmount(totalWater);
        }
        if (ui.radialCircle) {
            ui.radialCircle.style.strokeDashoffset = String(offset);
            ui.radialCircle.setAttribute("stroke-dashoffset", String(offset));
            ui.radialCircle.setAttribute("aria-valuenow", String(Math.min(pct, 100)));
        }
        if (ui.radialLabel) {
            ui.radialLabel.textContent = pct + "%";
        }
        if (ui.radialContainer) {
            ui.radialContainer.setAttribute("aria-label", pct + "% of water goal achieved");
        }

        const topLine = pct >= 100 ? "Goal achieved" : pct >= 70 ? "On track" : "Add more water";
        const secondaryLine = "Logged " + formatAmount(totalWater) + " out of " + formatAmount(dailyGoal) + ".";
        const tipLine = pct < 100 ? insights[(insightIndex + 1) % insights.length] : "Shift focus to steady electrolyte intake.";

        if (ui.summaryTop) {
            ui.summaryTop.innerHTML = "<strong>" + topLine + "</strong>";
        }
        if (ui.summarySecondary) {
            ui.summarySecondary.textContent = secondaryLine;
        }
        if (ui.summaryTip) {
            ui.summaryTip.textContent = tipLine;
        }
    }

    function cycleInsights() {
        if (!ui.insightsList) {
            return;
        }
        ui.insightsList.innerHTML = "";
        const first = insights[insightIndex % insights.length];
        const second = insights[(insightIndex + 1) % insights.length];
        [first, second].forEach(function (line) {
            const li = document.createElement("li");
            li.textContent = line;
            ui.insightsList.appendChild(li);
        });
        insightIndex = (insightIndex + 1) % insights.length;
        if (insightTimer) {
            clearTimeout(insightTimer);
        }
        insightTimer = setTimeout(cycleInsights, 8000);
    }

    function calculateIntake() {
        const weight = Number(ui.weightInput.value);
        if (!weight || Number.isNaN(weight)) {
            showToast("Enter your weight to calculate a target");
            return;
        }
        const feet = Number(ui.heightFeetInput.value);
        const inches = Number(ui.heightInchesInput.value);
        const totalInches = clamp((Number.isNaN(feet) ? 0 : feet * 12) + (Number.isNaN(inches) ? 0 : inches), 48, 84);
        const activity = Number(ui.activityInput.value || 0);
        const climate = Number(ui.climateInput.value || 0);

        const effectiveHeight = totalInches || 65;
        let base = weight * 0.5;
        let heightAdjustment = 0;
        if (effectiveHeight > 65) {
            heightAdjustment = (effectiveHeight - 65) * 0.4;
        } else if (effectiveHeight < 65) {
            heightAdjustment = (effectiveHeight - 65) * 0.3;
        }

        let total = base + heightAdjustment + activity + climate;
        total = clamp(total, 64, 180);
        lastCalculatedNeed = Math.round(total * 10) / 10;

        ui.calculatorResultValue.textContent = formatAmount(lastCalculatedNeed);
        ui.calculatorResultNote.textContent = buildCalculatorNote({
            weight: weight,
            height: effectiveHeight,
            activity: ui.activityInput.options[ui.activityInput.selectedIndex].text,
            climate: ui.climateInput.options[ui.climateInput.selectedIndex].text
        });
        ui.applyGoalButton.disabled = false;
        showToast("Calculator updated");
    }

    function setDailyGoal(value) {
        dailyGoal = Math.round(value * 10) / 10;
        ui.dailyGoal.textContent = formatAmount(dailyGoal);
        updateTotals(latestTotal);
    }

    function showToast(message) {
        if (!ui.toast) {
            console.warn(message);
            return;
        }
        ui.toast.textContent = message;
        ui.toast.hidden = false;
        ui.toast.classList.add("visible");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(function () {
            ui.toast.classList.remove("visible");
            ui.toast.hidden = true;
        }, 2500);
    }

    function prettifyFilename(name) {
        return name
            .replace(/\.[^.]+$/, "")
            .replace(/[\-_]+/g, " ")
            .replace(/\s+/g, " ")
            .replace(/\b\w/g, function (char) {
                return char.toUpperCase();
            }) || "Water entry";
    }

    function timeStamp(value) {
        const date = value instanceof Date ? value : new Date(value);
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function formatNumber(value) {
        const rounded = Math.round(Number(value) * 10) / 10;
        if (Number.isNaN(rounded)) {
            return "0";
        }
        if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
            return Math.round(rounded).toLocaleString();
        }
        return rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }

    function formatAmount(value) {
        return formatNumber(value) + " fl oz";
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function pickTags(seed) {
        const library = ["electrolytes", "greens", "citrus", "protein", "caffeine", "post workout", "recovery"];
        const tags = [];
        for (let i = 0; i < library.length; i += 1) {
            if ((seed + i * 17) % 5 === 0 && tags.length < 3) {
                tags.push(library[i]);
            }
        }
        return tags;
    }

    function extractOutputText(response) {
        if (!response) {
            return "";
        }
        if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
            return response.output_text.trim();
        }
        if (Array.isArray(response.output)) {
            for (const message of response.output) {
                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (typeof part.text === "string" && part.text.trim().length > 0) {
                            return part.text.trim();
                        }
                    }
                }
            }
        }
        if (Array.isArray(response.data)) {
            for (const item of response.data) {
                if (Array.isArray(item.content)) {
                    for (const part of item.content) {
                        if (typeof part.text === "string" && part.text.trim().length > 0) {
                            return part.text.trim();
                        }
                    }
                }
                if (typeof item.text === "string" && item.text.trim().length > 0) {
                    return item.text.trim();
                }
            }
        }
        if (response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
            return String(response.choices[0].message.content).trim();
        }
        return "";
    }

    function parseWaterAmount(value) {
        if (!value) {
            return 0;
        }
        const match = String(value).match(/\d+(?:\.\d+)?/);
        if (!match) {
            return 0;
        }
        return Math.max(0, Math.round(parseFloat(match[0]) * 10) / 10);
    }

    function generateSeed(file) {
        if (file && typeof file.lastModified === "number") {
            return file.lastModified;
        }
        if (file && typeof file.size === "number") {
            return Date.now() + file.size;
        }
        return Date.now();
    }

    function summarizeWater(water, includeElectrolytes) {
        let base = "Approx " + formatAmount(water) + " captured from this serving.";
        if (!includeElectrolytes) {
            return base + " Electrolyte suggestions skipped.";
        }
        if (water >= 20) {
            return base + " Consider pairing with light sodium to aid absorption.";
        }
        if (water >= 12) {
            return base + " Add produce or a mineral mix to round out the profile.";
        }
        return base + " Follow up with another 8-10 fl oz to stay on pace.";
    }

    function buildElectrolyteAdvice(seed) {
        const offset = seed % 3;
        if (offset === 0) {
            return "Add 500 mg sodium";
        }
        if (offset === 1) {
            return "Pair with potassium rich snack";
        }
        return "Blend sodium, potassium, and magnesium";
    }

    function buildCalculatorNote(context) {
        const feet = Math.floor(context.height / 12);
        const inches = Math.round(context.height % 12);
        const heightDescriptor = context.height ? feet + " ft " + inches + " in" : "assumed 5 ft 5 in";
        return "Weight " + Math.round(context.weight) + " lb | " + heightDescriptor + " | " + context.activity + " | " + context.climate;
    }
}

export { initializeHydrationApp };

