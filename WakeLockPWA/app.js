const storageKey = "wakelock.pwa.settings";

const defaultSettings = {
  enabled: true,
  time: "07:00",
  weekdays: [1, 2, 3, 4, 5],
  qrCode: `wakelock-${crypto.randomUUID()}`,
};

const elements = {
  nextAlarmText: document.querySelector("#nextAlarmText"),
  statusPanel: document.querySelector("#statusPanel"),
  settingsView: document.querySelector("#settingsView"),
  ringingView: document.querySelector("#ringingView"),
  ringingTime: document.querySelector("#ringingTime"),
  alarmForm: document.querySelector("#alarmForm"),
  enabledInput: document.querySelector("#enabledInput"),
  timeInput: document.querySelector("#timeInput"),
  qrCodeInput: document.querySelector("#qrCodeInput"),
  generateCodeButton: document.querySelector("#generateCodeButton"),
  testAlarmButton: document.querySelector("#testAlarmButton"),
  startScanButton: document.querySelector("#startScanButton"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  scannerVideo: document.querySelector("#scannerVideo"),
  manualUnlock: document.querySelector("#manualUnlock"),
  manualCodeInput: document.querySelector("#manualCodeInput"),
  manualUnlockButton: document.querySelector("#manualUnlockButton"),
  unlockMessage: document.querySelector("#unlockMessage"),
  finalUnlockButton: document.querySelector("#finalUnlockButton"),
  installHelpButton: document.querySelector("#installHelpButton"),
  installDialog: document.querySelector("#installDialog"),
  closeInstallDialog: document.querySelector("#closeInstallDialog"),
};

let settings = loadSettings();
let alarmTimer = null;
let audioContext = null;
let oscillator = null;
let gainNode = null;
let scannerStream = null;
let scanLoop = null;
let qrMatched = false;
const scannerCanvas = document.createElement("canvas");
const scannerCanvasContext = scannerCanvas.getContext("2d", { willReadFrequently: true });

function loadSettings() {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return defaultSettings;

  try {
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings() {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

function renderSettings() {
  elements.enabledInput.checked = settings.enabled;
  elements.timeInput.value = settings.time;
  elements.qrCodeInput.value = settings.qrCode;

  document.querySelectorAll("input[name='weekday']").forEach((input) => {
    input.checked = settings.weekdays.includes(Number(input.value));
  });

  renderNextAlarm();
}

function renderNextAlarm() {
  const nextAlarm = getNextAlarmDate();
  if (!settings.enabled || !nextAlarm) {
    elements.nextAlarmText.textContent = "OFF";
    return;
  }

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  elements.nextAlarmText.textContent = formatter.format(nextAlarm);
}

function getNextAlarmDate() {
  if (!settings.weekdays.length) return null;

  const [hour, minute] = settings.time.split(":").map(Number);
  const now = new Date();

  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);

    if (settings.weekdays.includes(candidate.getDay()) && candidate > now) {
      return candidate;
    }
  }

  return null;
}

function scheduleAlarm() {
  window.clearTimeout(alarmTimer);
  renderNextAlarm();

  const nextAlarm = getNextAlarmDate();
  if (!settings.enabled || !nextAlarm) return;

  const delay = Math.max(0, nextAlarm.getTime() - Date.now());
  alarmTimer = window.setTimeout(() => startRinging(), delay);
}

function startRinging() {
  qrMatched = false;
  elements.ringingTime.textContent = settings.time;
  elements.finalUnlockButton.disabled = true;
  elements.unlockMessage.textContent = "";
  elements.manualCodeInput.value = "";
  elements.statusPanel.classList.add("hidden");
  elements.settingsView.classList.add("hidden");
  elements.ringingView.classList.remove("hidden");
  startAlarmSound();

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("WakeLock", { body: "QRコードを読み取って解除してください。" });
  }
}

function stopRinging() {
  stopScanner();
  stopAlarmSound();
  elements.ringingView.classList.add("hidden");
  elements.statusPanel.classList.remove("hidden");
  elements.settingsView.classList.remove("hidden");
  scheduleAlarm();
}

function startAlarmSound() {
  stopAlarmSound();
  audioContext = new AudioContext();
  oscillator = audioContext.createOscillator();
  gainNode = audioContext.createGain();

  oscillator.type = "square";
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.0001;

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();

  let loud = false;
  window.alarmBeepInterval = window.setInterval(() => {
    loud = !loud;
    if (!gainNode) return;
    gainNode.gain.setTargetAtTime(loud ? 0.18 : 0.0001, audioContext.currentTime, 0.02);
  }, 420);
}

function stopAlarmSound() {
  window.clearInterval(window.alarmBeepInterval);
  if (oscillator) oscillator.stop();
  if (audioContext) audioContext.close();
  oscillator = null;
  gainNode = null;
  audioContext = null;
}

async function startScanner() {
  elements.unlockMessage.textContent = "";
  elements.manualUnlock.classList.remove("hidden");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      elements.unlockMessage.textContent = "このブラウザではカメラを開始できません。SafariでHTTPSのURLを開いてください。";
      return;
    }

    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });

    elements.scannerVideo.srcObject = scannerStream;
    elements.scannerVideo.classList.remove("hidden");
    elements.stopCameraButton.classList.remove("hidden");
    await elements.scannerVideo.play();

    if ("BarcodeDetector" in window) {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      scanLoop = window.setInterval(async () => {
        const codes = await detector.detect(elements.scannerVideo);
        const value = codes[0]?.rawValue;
        if (value) validateCode(value);
      }, 600);
    } else if ("jsQR" in window) {
      scanLoop = window.setInterval(scanWithJsQR, 600);
    } else {
      elements.unlockMessage.textContent = "QR読み取りライブラリを読み込めませんでした。入力で確認してください。";
    }
  } catch (error) {
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      elements.unlockMessage.textContent = "カメラにはHTTPSが必要です。GitHub PagesのURLをSafariで開いてください。";
      return;
    }
    elements.unlockMessage.textContent = "カメラを開始できません。Safariのカメラ権限を確認してください。";
  }
}

function scanWithJsQR() {
  if (!elements.scannerVideo.videoWidth || !elements.scannerVideo.videoHeight) return;

  scannerCanvas.width = elements.scannerVideo.videoWidth;
  scannerCanvas.height = elements.scannerVideo.videoHeight;
  scannerCanvasContext.drawImage(elements.scannerVideo, 0, 0, scannerCanvas.width, scannerCanvas.height);

  const imageData = scannerCanvasContext.getImageData(0, 0, scannerCanvas.width, scannerCanvas.height);
  const code = window.jsQR(imageData.data, imageData.width, imageData.height);
  if (code?.data) validateCode(code.data);
}

function stopScanner() {
  window.clearInterval(scanLoop);
  scanLoop = null;
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
  }
  scannerStream = null;
  elements.scannerVideo.srcObject = null;
  elements.scannerVideo.classList.add("hidden");
  elements.stopCameraButton.classList.add("hidden");
}

function validateCode(value) {
  if (value === settings.qrCode) {
    qrMatched = true;
    elements.unlockMessage.textContent = "QRコードを確認しました。解除できます。";
    elements.unlockMessage.style.color = "var(--ok)";
    elements.finalUnlockButton.disabled = false;
    stopScanner();
  } else {
    elements.unlockMessage.textContent = "登録済みコードと一致しません。";
    elements.unlockMessage.style.color = "var(--accent-dark)";
  }
}

elements.alarmForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const weekdays = [...document.querySelectorAll("input[name='weekday']:checked")].map((input) =>
    Number(input.value),
  );

  settings = {
    enabled: elements.enabledInput.checked,
    time: elements.timeInput.value,
    weekdays,
    qrCode: elements.qrCodeInput.value.trim(),
  };

  saveSettings();
  scheduleAlarm();
});

elements.generateCodeButton.addEventListener("click", () => {
  elements.qrCodeInput.value = `wakelock-${crypto.randomUUID()}`;
});

elements.testAlarmButton.addEventListener("click", startRinging);
elements.startScanButton.addEventListener("click", startScanner);
elements.stopCameraButton.addEventListener("click", stopScanner);
elements.manualUnlockButton.addEventListener("click", () => validateCode(elements.manualCodeInput.value.trim()));
elements.finalUnlockButton.addEventListener("click", () => {
  if (qrMatched) stopRinging();
});

elements.installHelpButton.addEventListener("click", () => elements.installDialog.showModal());
elements.closeInstallDialog.addEventListener("click", () => elements.installDialog.close());

async function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // Permission prompts are best-effort in browsers.
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

renderSettings();
scheduleAlarm();
requestNotificationPermission();
