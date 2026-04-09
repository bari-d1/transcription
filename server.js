const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Allowed audio MIME types
const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
  "audio/webm",
  "video/mp4", // m4a files are sometimes detected as video/mp4
]);

const ALLOWED_EXTENSIONS = new Set([
  ".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac", ".webm",
]);

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Rate limiter: max 10 uploads per hour per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    error: `Too many transcription requests. You can submit up to 10 files per hour. Please try again later.`,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Multer config: validate file type during upload
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(
        new Error(
          `Invalid file type. Allowed formats: ${[...ALLOWED_EXTENSIONS].join(", ")}`
        )
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("File does not appear to be a valid audio file."));
    }
    cb(null, true);
  },
});

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// POST /transcribe — upload + transcribe
app.post("/transcribe", uploadLimiter, upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided." });
  }

  const filePath = req.file.path;

  const python = spawn("python3", ["transcribe.py", filePath]);

  let stdout = "";
  let stderr = "";

  python.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  python.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  python.on("close", (code) => {
    // Clean up uploaded file
    fs.unlink(filePath, () => {});

    if (code !== 0) {
      console.error("Transcription failed:", stderr);
      return res.status(500).json({ error: "Transcription failed. Please try again." });
    }

    const text = stdout.trim();
    if (!text) {
      return res.status(500).json({ error: "Transcription produced no output." });
    }

    res.json({ text, filename: path.parse(req.file.originalname).name + ".txt" });
  });

  python.on("error", (err) => {
    fs.unlink(filePath, () => {});
    console.error("Failed to start Python:", err);
    res.status(500).json({ error: "Server error: could not start transcription process." });
  });
});

// Handle multer errors (file size, type)
app.use((err, _req, res, _next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.` });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: "An unexpected error occurred." });
});

app.listen(PORT, () => {
  console.log(`Transcription server running at http://localhost:${PORT}`);
});
