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

// Load official candidate dataset from JSON
function loadCandidateDataset(): Candidate[] {
  try {
    const jsonPath = path.join(process.cwd(), "server", "candidateDataset.json");
    if (fs.existsSync(jsonPath)) {
      const fileContent = fs.readFileSync(jsonPath, "utf8");
      const rawList = JSON.parse(fileContent);
      if (Array.isArray(rawList)) {
        return rawList.map((raw: any) => {
          // Map education array of objects to readable single string
          const eduStr = Array.isArray(raw.education) && raw.education.length > 0
            ? raw.education.map((e: any) => `${e.degree} in ${e.field_of_study} at ${e.institution} (${e.start_year}-${e.end_year})`).join("; ")
            : "N/A";
            
          // Map skills array of objects to array of string names
          const skillsArray = Array.isArray(raw.skills)
            ? raw.skills.map((s: any) => s.name)
            : [];

          const name = raw.profile?.anonymized_name || "Anonymized Candidate";
          const email = name.toLowerCase().replace(/\s+/g, ".") + "@talentmatch.ai";

          return {
            id: raw.candidate_id || `cand-${Date.now()}-${Math.random()}`,
            name,
            title: raw.profile?.headline || raw.profile?.current_title || "Software Engineer",
            experienceYears: raw.profile?.years_of_experience || 0,
            skills: skillsArray,
            education: eduStr,
            location: `${raw.profile?.location || "Remote"}, ${raw.profile?.country || ""}`,
            email: email,
            phone: "+1 (555) 000-0000",
            summary: raw.profile?.summary || "No resume summary provided.",
            redrobData: raw // Save original rich Redrob structure so UI can render cool signals & history!
          };
        });
      }
    }
  } catch (error) {
    console.error("Error reading candidate dataset, using initial candidates fallback:", error);
  }
  return [...initialCandidates];
}

// In-memory candidate storage (initialized with the loaded Redrob candidates)
let candidatesList: Candidate[] = loadCandidateDataset();

// Last generated Top results (for quick export)
let lastTopResults: any[] = [];

// Cache for candidate embedding vectors in memory: candidateId -> number[]
const candidateEmbeddingsCache = new Map<string, number[]>();

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

// POST /api/upload-jsonl - Accept raw JSONL content in request body as a stream
app.post("/api/upload-jsonl", (req, res) => {
  const routeName = '/api/upload-jsonl';
  const uploadStart = Date.now();
  let importedCount = 0;
  let invalidCount = 0;
  const sampleInvalid: any[] = [];
  const sampleValid: Candidate[] = [];
  const newCandidates: Candidate[] = [];
  let aborted = false;
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

  console.log('Upload started:', { route: routeName, startedAt: new Date().toISOString() });

  const logUploadSummary = (event: string) => {
    const durationMs = Date.now() - uploadStart;
    console.log(`Upload ${event}:`, {
      route: routeName,
      durationMs,
      importedCount,
      invalidCount,
      totalLines: importedCount + invalidCount,
      sampleValidCount: sampleValid.length,
      sampleInvalidCount: sampleInvalid.length,
    });
  };

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

  const abortUpload = (reason: string) => {
    if (aborted || completed) return;
    aborted = true;
    logUploadSummary(`aborted (${reason})`);
    cleanup();
  };

  const onLine = (line: string) => {
    if (aborted) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const result = rankingService.parseJsonlLine(trimmed);
      if (result.valid && result.candidate) {
        newCandidates.push(result.candidate);
        importedCount += 1;
        if (sampleValid.length < 5) sampleValid.push(result.candidate);
      } else {
        invalidCount += 1;
        if (sampleInvalid.length < 5) sampleInvalid.push(result.invalid);
      }
    } catch (err: any) {
      invalidCount += 1;
      if (sampleInvalid.length < 5) sampleInvalid.push({ line: trimmed, error: err?.message || 'Invalid JSONL line' });
    }
  };

  const onClose = () => {
    if (completed) return;
    cleanup();
    if (aborted) {
      return;
    }

    logUploadSummary('completed');
    candidatesList = newCandidates;
    candidateEmbeddingsCache.clear();
    lastTopResults = [];
    const response = { importedCount, invalidCount, sampleValid, sampleInvalid };
    sendJson(res, response, routeName);
  };

  const onReadlineError = (err: Error) => {
    if (completed) return;
    cleanup();
    console.error('Upload readline error:', err);
    if (!aborted) {
      safeSend(500, { error: 'Failed to process upload stream.' });
    }
  };

  const onRequestError = (err: Error) => {
    if (completed) return;
    cleanup();
    console.error('Upload request error:', err);
    if (!aborted) {
      safeSend(500, { error: 'Failed to process upload request.' });
    }
  };

  const onAborted = () => {
    abortUpload('aborted');
  };

  const onRequestClose = () => {
    abortUpload('close');
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
    const top = rankingService.selectTopK(sortedScored, 100);
    console.timeEnd('TopK selection');
    const topCount = top.length;
    console.log('Candidates Ranked:', topCount);

    if (topCount !== 100) {
      throw new Error(`Top-K selection returned ${topCount} candidates instead of 100.`);
    }

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

// POST /api/candidates/reset - Reset candidates to original seed list
app.post("/api/candidates/reset", (req, res) => {
  candidatesList = loadCandidateDataset();
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
