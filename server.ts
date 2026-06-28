import express from "express";
import path from "path";
import fs from "fs";
import readline from "readline";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { initialCandidates } from "./src/initialCandidates";
import { Candidate, MatchAnalysis, RankingResult } from "./src/types";
import * as rankingService from "./server/rankingService";
import validationService from "./server/validationService";
import exportService from "./server/exportService";

let preloadedCandidates: Candidate[] = [];

try {
  const fileContent = fs.readFileSync("data/candidates.json", "utf8");
  const parsed = JSON.parse(fileContent);
  if (Array.isArray(parsed)) {
    preloadedCandidates = parsed as Candidate[];
    console.log(`Preloaded ${preloadedCandidates.length} candidates into memory.`);
  }
} catch (error) {
  console.error("Error preloading candidate dataset from data/candidates.json:", error);
}

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;
app.disable("x-powered-by");

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection:', reason, promise);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// In-memory candidate storage (initialized from preloaded pool or seed fallback)
let candidatesList: Candidate[] = preloadedCandidates.length > 0 ? preloadedCandidates : [...initialCandidates];

// Last generated Top results (for quick export)
let lastTopResults: any[] = [];

// Cache for candidate embedding vectors in memory: candidateId -> number[]
const candidateEmbeddingsCache = new Map<string, number[]>();

interface UploadSession {
  uploadId: string;
  fileName: string;
  nextChunkIndex: number;
  importedCount: number;
  invalidCount: number;
  sampleValid: Candidate[];
  sampleInvalid: any[];
  newCandidates: Candidate[];
  aborted: boolean;
  startedAt: number;
}

const uploadSessions = new Map<string, UploadSession>();

function createUploadSession(uploadId: string, fileName: string): UploadSession {
  const session: UploadSession = {
    uploadId,
    fileName,
    nextChunkIndex: 0,
    importedCount: 0,
    invalidCount: 0,
    sampleValid: [],
    sampleInvalid: [],
    newCandidates: [],
    aborted: false,
    startedAt: Date.now(),
  };
  uploadSessions.set(uploadId, session);
  return session;
}

function getUploadSession(uploadId: string, fileName: string): UploadSession {
  const existing = uploadSessions.get(uploadId);
  if (existing) return existing;
  return createUploadSession(uploadId, fileName);
}

function cleanupUploadSession(uploadId: string) {
  uploadSessions.delete(uploadId);
}

function abortUploadSession(session: UploadSession, reason: string) {
  if (session.aborted) return;
  session.aborted = true;
  const durationMs = Date.now() - session.startedAt;
  console.warn('Upload session aborted:', { uploadId: session.uploadId, reason, durationMs, importedCount: session.importedCount, invalidCount: session.invalidCount });
  cleanupUploadSession(session.uploadId);
}

function commitUploadSession(session: UploadSession) {
  candidatesList = session.newCandidates;
  candidateEmbeddingsCache.clear();
  lastTopResults = [];
  cleanupUploadSession(session.uploadId);
}

// Helper function to combine each candidate's key text fields into a single rich string
function getCandidateText(c: Candidate): string {
  const parts: string[] = [];
  parts.push(`Name: ${c.name}`);
  parts.push(`Title: ${c.title}`);
  parts.push(`Experience: ${c.experienceYears} years`);
  parts.push(`Skills: ${c.skills.join(", ")}`);
  parts.push(`Location: ${c.location}`);
  parts.push(`Education: ${c.education}`);
  parts.push(`Professional Summary: ${c.summary}`);

  // Include detailed Redrob career history & projects if available
  if (c.redrobData) {
    if (Array.isArray(c.redrobData.career_history)) {
      const history = c.redrobData.career_history.map((job: any) => 
        `Job Title: ${job.title} at ${job.company || "Company"} (${job.start_date} - ${job.end_date || "Present"}). Description: ${job.description || ""}`
      ).join("\n");
      parts.push(`Career History:\n${history}`);
    }
    if (Array.isArray(c.redrobData.projects)) {
      const projects = c.redrobData.projects.map((proj: any) => 
        `Project Title: ${proj.title}. Description: ${proj.description || ""}. Skills used: ${Array.isArray(proj.skills_used) ? proj.skills_used.join(", ") : ""}`
      ).join("\n");
      parts.push(`Projects:\n${projects}`);
    }
  }
  return parts.join("\n\n");
}

// Mathematical helper to calculate Cosine Similarity between two numeric vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(`Vectors must be of the same length (got ${vecA.length} and ${vecB.length})`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0; // Avoid division by zero
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Helper function to enforce a strict timeout on any promise
function withTimeout(promise: Promise<any>, timeoutMs: number, errorMessage: string = "Operation timed out"): Promise<any> {
  let timeoutId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeoutId);
      return result;
    }),
    timeoutPromise,
  ]);
}

function sendJson(res: express.Response, payload: any, routeName: string) {
  if (res.headersSent) {
    console.warn(`Skipping duplicate response for ${routeName}.`);
    return;
  }

  try {
    const sizeMB = Buffer.byteLength(JSON.stringify(payload), 'utf8') / 1024 / 1024;
    console.log(`Response size: ${sizeMB.toFixed(3)} MB`, routeName);
    if (sizeMB > 5) {
      console.warn(`Large response (>5MB) for ${routeName}.`);
    }
  } catch (err) {
    console.warn(`Could not calculate response size for ${routeName}:`, err);
  }
  res.json(payload);
}

// Pre-calculate and cache candidate embedding vectors
async function precalculateCandidateEmbeddings() {
  console.log("Pre-calculating candidate embeddings...");
  try {
    const ai = getAIClient();
    let count = 0;
    for (const candidate of candidatesList) {
      if (!candidateEmbeddingsCache.has(candidate.id)) {
        const text = getCandidateText(candidate);
        const response = await withTimeout(
          ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: text,
          }),
          5000,
          `Embedding precalculation timed out for candidate ${candidate.id}`
        );
        const vector = response.embeddings?.[0]?.values;
        if (vector) {
          candidateEmbeddingsCache.set(candidate.id, vector);
          count++;
        }
      }
    }
    console.log(`Pre-calculation complete. Cached ${count} new embeddings. Total in cache: ${candidateEmbeddingsCache.size}`);
  } catch (error) {
    console.error("Error pre-calculating candidate embeddings on startup:", error);
  }
}

// Lazy-initialized Gemini client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined. Please add your Gemini API Key in the Settings > Secrets panel of the AI Studio UI.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 15000,
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// API Routes

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", count: candidatesList.length });
});

// GET /api/candidates - Retrieve candidate pool with pagination and capped preview
app.get("/api/candidates", (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(500, Number(req.query.pageSize) || 100));
  const total = candidatesList.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const candidates = candidatesList.slice(start, end);
  const response = { total, page, pageSize, candidates };
  const sizeMB = Buffer.byteLength(JSON.stringify(response), 'utf8') / 1024 / 1024;
  console.log('Response size:', sizeMB.toFixed(3), 'MB', 'GET /api/candidates');
  if (sizeMB > 5) console.warn('Large response (>5MB) for /api/candidates with pageSize', pageSize);
  res.json(response);
});

// POST /api/load-default-dataset - Activate preloaded default candidate dataset from memory
app.post('/api/load-default-dataset', (req, res) => {
  try {
    candidatesList = [...preloadedCandidates];
    candidateEmbeddingCache = {};
    lastTopResults = null;
    return res.json({
      success: true,
      totalCandidates: candidatesList.length,
      candidates: candidatesList
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/upload-jsonl - Accept raw JSONL content in request body as a stream
app.post("/api/upload-jsonl", (req, res) => {
  const routeName = '/api/upload-jsonl';
  const uploadStart = Date.now();
  let completed = false;
  let responseSent = false;

  const safeSend = (status: number, payload: any) => {
    if (responseSent || res.headersSent) {
      console.warn(`Skipping duplicate response for ${routeName}.`);
      return;
    }
    responseSent = true;
    res.status(status).json(payload);
  };

  const uploadIdHeader = String(req.headers['x-upload-id'] ?? '');
  const chunkIndexHeader = req.headers['x-upload-chunk-index'];
  const isFinalChunk = String(req.headers['x-upload-final'] ?? '').toLowerCase() === 'true';
  const fileNameHeader = String(req.headers['x-file-name'] ?? 'upload.jsonl');
  const isChunked = uploadIdHeader !== '' && chunkIndexHeader !== undefined;
  const chunkIndex = isChunked ? Number(chunkIndexHeader) : 0;

  if (isChunked && (!uploadIdHeader || Number.isNaN(chunkIndex) || chunkIndex < 0)) {
    return safeSend(400, { error: 'Invalid chunk upload metadata.' });
  }

  const session = isChunked
    ? getUploadSession(uploadIdHeader, fileNameHeader)
    : createUploadSession(`single-${Date.now()}-${Math.random()}`, fileNameHeader);

  if (session.aborted) {
    return safeSend(499, { error: 'Previous upload session was aborted.' });
  }

  if (isChunked && chunkIndex !== session.nextChunkIndex) {
    return safeSend(409, { error: `Unexpected chunk index: ${chunkIndex}. Expected ${session.nextChunkIndex}.` });
  }

  const logUploadSummary = (event: string, chunkDurationMs: number) => {
    const durationMs = Date.now() - uploadStart;
    console.log(`Upload ${event}:`, {
      route: routeName,
      uploadId: session.uploadId,
      chunkIndex: isChunked ? chunkIndex : undefined,
      isFinalChunk,
      durationMs,
      chunkDurationMs,
      importedCount: session.importedCount,
      invalidCount: session.invalidCount,
      totalLines: session.importedCount + session.invalidCount,
      sampleValidCount: session.sampleValid.length,
      sampleInvalidCount: session.sampleInvalid.length,
    });
  };

  const timerLabel = `upload-jsonl-${session.uploadId}-${chunkIndex}`;
  const chunkStart = Date.now();
  console.time(timerLabel);
  console.log('Upload started:', { route: routeName, uploadId: session.uploadId, chunkIndex, isFinalChunk, startedAt: new Date(uploadStart).toISOString() });

  const cleanup = () => {
    if (completed) return;
    completed = true;
    rl.removeListener('line', onLine);
    rl.removeListener('close', onClose);
    rl.removeListener('error', onReadlineError);
    req.removeListener('aborted', onAborted);
    req.removeListener('close', onRequestClose);
    req.removeListener('error', onRequestError);
  };

  const onLine = (line: string) => {
    if (session.aborted) return;
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const result = rankingService.parseJsonlLine(trimmed);
      if (result.valid && result.candidate) {
        session.newCandidates.push(result.candidate);
        session.importedCount += 1;
        if (session.sampleValid.length < 5) session.sampleValid.push(result.candidate);
      } else {
        session.invalidCount += 1;
        if (session.sampleInvalid.length < 5) session.sampleInvalid.push(result.invalid);
      }
    } catch (err: any) {
      session.invalidCount += 1;
      if (session.sampleInvalid.length < 5) session.sampleInvalid.push({ line: trimmed, error: err?.message || 'Invalid JSONL line' });
    }
  };

  const onClose = () => {
    if (completed) return;
    cleanup();

    if (session.aborted) {
      return;
    }

    const chunkDurationMs = Date.now() - chunkStart;
    session.nextChunkIndex += 1;
    if (isFinalChunk || !isChunked) {
      commitUploadSession(session);
      const response = {
        importedCount: session.importedCount,
        invalidCount: session.invalidCount,
        sampleValid: session.sampleValid,
        sampleInvalid: session.sampleInvalid,
      };
      sendJson(res, response, routeName);
      logUploadSummary('completed', chunkDurationMs);
      console.timeEnd(timerLabel);
      return;
    }

    sendJson(res, {
      uploadId: session.uploadId,
      chunkIndex,
      importedCount: session.importedCount,
      invalidCount: session.invalidCount,
    }, routeName);
    logUploadSummary('chunk-received', chunkDurationMs);
    console.timeEnd(timerLabel);
  };

  const onReadlineError = (err: Error) => {
    if (completed) return;
    cleanup();
    console.error('Upload readline error:', err);
    abortUploadSession(session, 'readline-error');
    console.timeEnd(timerLabel);
    if (!responseSent) {
      safeSend(500, { error: 'Failed to process upload stream.' });
    }
  };

  const onRequestError = (err: Error) => {
    if (completed) return;
    cleanup();
    console.error('Upload request error:', err);
    abortUploadSession(session, 'request-error');
    console.timeEnd(timerLabel);
    if (!responseSent) {
      safeSend(500, { error: 'Failed to process upload request.' });
    }
  };

  const onAborted = () => {
    abortUploadSession(session, 'aborted');
    cleanup();
    console.timeEnd(timerLabel);
  };

  const onRequestClose = () => {
    if (!completed && !session.aborted) {
      abortUploadSession(session, 'close');
      cleanup();
      console.timeEnd(timerLabel);
    }
  };

  const rl = readline.createInterface({ input: req, crlfDelay: Infinity });
  rl.on('line', onLine);
  rl.on('close', onClose);
  rl.on('error', onReadlineError);
  req.on('aborted', onAborted);
  req.on('close', onRequestClose);
  req.on('error', onRequestError);
});

// POST /api/rank-top100 - Compute Top-100 ranking from current candidate pool
app.post("/api/rank-top100", express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { jobDescription } = req.body || {};
    if (!jobDescription || typeof jobDescription !== 'string') {
      return res.status(400).json({ error: 'jobDescription (string) is required in body.' });
    }

    const uploadedCount = candidatesList.length;
    console.log('Candidates Uploaded:', uploadedCount);

    console.time('Candidate scoring');
    const scored = await rankingService.scoreCandidates(jobDescription, candidatesList);
    console.timeEnd('Candidate scoring');

    const scoredCount = scored.length;
    console.log('Candidates Scored:', scoredCount);

    if (scoredCount !== uploadedCount) {
      throw new Error('Ranking pipeline did not process the entire dataset.');
    }

    console.time('Candidate sorting');
    const sortedScored = rankingService.sortScoredCandidates(scored);
    console.timeEnd('Candidate sorting');

    console.time('TopK selection');
    const top = sortedScored.slice(0, 100).map((item, idx) => ({ ...item, rank: idx + 1 }));
    console.timeEnd('TopK selection');
    const topCount = top.length;
    console.log('Candidates Ranked:', topCount);

    const response = {
      uploadedCandidates: uploadedCount,
      scoredCandidates: scoredCount,
      rankedCandidates: topCount,
      rankingCompleted: true,
      top100: top,
      audit: {
        uploaded: uploadedCount,
        scored: scoredCount,
        ranked: topCount,
        exported: null
      }
    };
    lastTopResults = top;
    sendJson(res, response, '/api/rank-top100');
  } catch (err: any) {
    console.error('Ranking error:', err);
    res.status(500).json({ error: err.message || 'Failed to compute ranking.' });
  }
});

// POST /api/validate-submission - Validate provided rows or last generated
app.post('/api/validate-submission', express.json({ limit: '2mb' }), (req, res) => {
  try {
    const rows = req.body?.rows || lastTopResults;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'No rows provided and no cached results available.' });
    if (rows.length !== 100) return res.status(400).json({ error: 'Validation requires exactly 100 rows.' });

    const report = validationService.validateSubmission(rows);
    sendJson(res, report, '/api/validate-submission');
  } catch (err: any) {
    console.error('Validation error:', err);
    res.status(500).json({ error: err.message || 'Validation failed.' });
  }
});

// GET /api/export/csv - Export lastTopResults as CSV (top 100). If no cached, return error.
app.get('/api/export/csv', (req, res) => {
  try {
    if (!Array.isArray(lastTopResults) || lastTopResults.length === 0) {
      return res.status(400).json({ error: 'No Top-100 results available to export. Run ranking first.' });
    }

    if (lastTopResults.length !== 100) {
      return res.status(400).json({ error: `Top results length is ${lastTopResults.length}; must be exactly 100 to export.` });
    }

    console.time('CSV generation');
    const csv = exportService.serializeCsv(lastTopResults);
    console.timeEnd('CSV generation');
    console.log('Candidates Exported:', lastTopResults.length);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="top100_candidates.csv"');
    res.send(csv);
  } catch (err: any) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate CSV.' });
  }
});

// POST /api/candidates - Add a new custom candidate profile
app.post("/api/candidates", express.json({ limit: "50mb" }), (req, res) => {
  try {
    const { name, title, experienceYears, skills, education, location, email, phone, summary } = req.body;

    if (!name || !title || !summary) {
      return res.status(400).json({ error: "Name, Title, and Professional Summary are required." });
    }

    const newCandidate: Candidate = {
      id: `custom-${Date.now()}`,
      name,
      title,
      experienceYears: Number(experienceYears) || 0,
      skills: Array.isArray(skills) ? skills.filter(Boolean) : [],
      education: education || "Self-taught / N/A",
      location: location || "Remote",
      email: email || "candidate@example.com",
      phone: phone || "N/A",
      summary,
      isCustom: true
    };

    candidatesList.unshift(newCandidate);
    res.status(201).json(newCandidate);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to add candidate." });
  }
});

// DELETE /api/candidates/:id - Delete a candidate
app.delete("/api/candidates/:id", (req, res) => {
  const { id } = req.params;
  const index = candidatesList.findIndex(c => c.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "Candidate not found." });
  }
  
  const removed = candidatesList.splice(index, 1);
  res.json({ success: true, removed: removed[0] });
});

// POST /api/candidates/reset - Reset candidates to preloaded default pool
app.post("/api/candidates/reset", (req, res) => {
  candidatesList = preloadedCandidates.length > 0 ? preloadedCandidates : [...initialCandidates];
  candidateEmbeddingsCache.clear();
  const pageSize = 20;
  const response = {
    success: true,
    message: "Candidate database reset to default pre-seeded pool.",
    total: candidatesList.length,
    page: 1,
    pageSize,
    candidates: candidatesList.slice(0, pageSize)
  };
  sendJson(res, response, '/api/candidates/reset');
});

// POST /api/analyze - Deprecated endpoint
app.post("/api/analyze", async (req, res) => {
  console.warn("Deprecated endpoint /api/analyze accessed. Use /api/rank-top100 instead.");
  return res.status(410).json({
    error: "This endpoint is deprecated for hackathon compliance. Use /api/rank-top100 for complete dataset ranking and CSV export."
  });
});

// POST /api/rank - Deprecated endpoint
app.post("/api/rank", async (req, res) => {
  console.warn("Deprecated endpoint /api/rank accessed. Use /api/rank-top100 instead.");
  return res.status(410).json({
    error: "This endpoint is deprecated for hackathon compliance. Use /api/rank-top100 for complete dataset ranking and CSV export."
  });
});

// Express error handler for any route middleware failures
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Express error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error.' });
});

// Vite Middleware for dev or static files serving for production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting in DEVELOPMENT mode with Vite dev middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in PRODUCTION mode, serving static files...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`TalentMatch AI Server is listening at http://localhost:${PORT}`);
    // Start precalculating embeddings in background on startup
    precalculateCandidateEmbeddings().then(() => {
      console.log("Startup precalculation finished successfully.");
    }).catch((err) => {
      console.error("Startup precalculation failed:", err);
    });
  });

  server.on('error', (err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}

startServer();
