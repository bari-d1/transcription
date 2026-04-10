const express = require("express");
const rateLimit = require("express-rate-limit");
const { pipeline } = require("stream/promises");
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const OpenAI = require("openai");

const app = express();
const PORT = 3000;

app.set("trust proxy", 1);

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "when_required",
  responseChecksumValidation: "when_required",
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BUCKET = process.env.R2_BUCKET_NAME;

// Allowed audio extensions and MIME types
const ALLOWED_EXTENSIONS = new Set([
  ".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac", ".webm",
]);

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
  "video/mp4",
]);

const MAX_FILE_SIZE_MB = 25; // OpenAI Whisper API limit
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Rate limiter: max 10 uploads per hour per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: {
    error: `Too many transcription requests. You can submit up to 10 files per hour. Please try again later.`,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// GET /upload-url — returns a presigned R2 PUT URL
app.get("/upload-url", uploadLimiter, async (req, res) => {
  const { ext, contentType, size } = req.query;
  const normalizedExt = `.${ext}`.toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(normalizedExt)) {
    return res.status(400).json({ error: `Invalid file type ".${ext}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}` });
  }

  if (contentType && !ALLOWED_MIME_TYPES.has(contentType)) {
    return res.status(400).json({ error: "File does not appear to be a valid audio file." });
  }

  if (size && Number(size) > MAX_FILE_SIZE_BYTES) {
    return res.status(400).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.` });
  }

  const key = `upload-${Date.now()}-${Math.round(Math.random() * 1e9)}${normalizedExt}`;

  try {
    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 300 }
    );
    res.json({ uploadUrl, key });
  } catch (err) {
    console.error("Failed to generate upload URL:", err);
    res.status(500).json({ error: "Could not prepare upload. Please try again." });
  }
});

// POST /transcribe — download from R2, send to Whisper API, delete from R2
app.post("/transcribe", async (req, res) => {
  const { key, originalName } = req.body;

  if (!key) return res.status(400).json({ error: "No file key provided." });

  if (!/^upload-\d+-\d+\.[a-z0-9]+$/.test(key)) {
    return res.status(400).json({ error: "Invalid file key." });
  }

  const tmpPath = path.join("/tmp", key);

  // Download file from R2
  try {
    const { Body } = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    await pipeline(Body, fs.createWriteStream(tmpPath));
  } catch (err) {
    console.error("Failed to download from R2:", err);
    return res.status(500).json({ error: "Failed to retrieve uploaded file." });
  }

  // Send to OpenAI Whisper API
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
    });

    const baseName = originalName ? path.parse(originalName).name : "transcription";
    res.json({ text: transcription.text, filename: `${baseName}.txt` });
  } catch (err) {
    console.error("Transcription failed:", err);
    res.status(500).json({ error: "Transcription failed. Please try again." });
  } finally {
    fs.unlink(tmpPath, () => {});
    r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(console.error);
  }
});

// Error handler
app.use((err, _req, res, _next) => {
  if (err.message) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: "An unexpected error occurred." });
});

app.listen(PORT, () => {
  console.log(`Transcription server running at http://localhost:${PORT}`);
});
