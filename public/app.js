const dropZone = document.querySelector(".drop-zone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const removeFile = document.getElementById("removeFile");
const errorMsg = document.getElementById("errorMsg");
const transcribeBtn = document.querySelector(".btn-transcribe");
const progressWrap = document.getElementById("progressWrap");
const resultCard = document.getElementById("resultCard");
const resultText = document.getElementById("resultText");
const downloadBtn = document.getElementById("downloadBtn");

const ALLOWED_EXTENSIONS = new Set(["mp3", "mp4", "m4a", "wav", "ogg", "flac", "webm"]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB (OpenAI Whisper API limit)

let selectedFile = null;
let downloadFilename = "transcription.txt";

// --- File selection ---

browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

["dragleave", "dragend"].forEach((ev) =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove("drag-over"))
);

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

removeFile.addEventListener("click", resetFile);

// --- Validation ---

function handleFile(file) {
  clearError();

  const ext = file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    showError(`Invalid file type ".${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`);
    return;
  }

  if (file.size > MAX_SIZE_BYTES) {
    showError(`File too large (${formatBytes(file.size)}). Maximum size is 100MB.`);
    return;
  }

  if (file.size === 0) {
    showError("The selected file is empty.");
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.hidden = false;
  transcribeBtn.disabled = false;
  resultCard.hidden = true;
}

function resetFile() {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.hidden = true;
  transcribeBtn.disabled = true;
  clearError();
}

// --- Transcription ---

transcribeBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  clearError();
  setLoading(true);

  try {
    // Step 1: get a presigned upload URL from the server
    const ext = selectedFile.name.split(".").pop().toLowerCase();
    const urlRes = await fetch(
      `/upload-url?ext=${encodeURIComponent(ext)}&contentType=${encodeURIComponent(selectedFile.type)}&size=${selectedFile.size}`
    );
    const urlData = await urlRes.json();
    if (!urlRes.ok) {
      showError(urlData.error || "Upload failed. Please try again.");
      return;
    }

    // Step 2: upload the file directly to R2
    const uploadRes = await fetch(urlData.uploadUrl, {
      method: "PUT",
      body: selectedFile,
      headers: { "Content-Type": selectedFile.type || "application/octet-stream" },
    });
    if (!uploadRes.ok) {
      showError("Upload failed. Please try again.");
      return;
    }

    // Step 3: ask the server to transcribe
    const res = await fetch("/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: urlData.key, originalName: selectedFile.name }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "Transcription failed. Please try again.");
      return;
    }

    downloadFilename = data.filename || "transcription.txt";
    resultText.value = data.text;
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    showError("Network error. Please check your connection and try again.");
  } finally {
    setLoading(false);
  }
});

// --- Download ---

downloadBtn.addEventListener("click", () => {
  const text = resultText.value;
  if (!text) return;

  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadFilename;
  a.click();
  URL.revokeObjectURL(url);
});

// --- Helpers ---

function setLoading(on) {
  progressWrap.hidden = !on;
  transcribeBtn.disabled = on;
  transcribeBtn.textContent = on ? "Transcribing…" : "Transcribe";
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}

function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = "";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
