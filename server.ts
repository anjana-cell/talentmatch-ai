import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { initialCandidates } from "./src/initialCandidates";
import { Candidate, MatchAnalysis, RankingResult } from "./src/types";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Body parser
app.use(express.json());

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

// GET /api/candidates - Retrieve candidate pool
app.get("/api/candidates", (req, res) => {
  res.json(candidatesList);
});

// POST /api/candidates - Add a new custom candidate profile
app.post("/api/candidates", (req, res) => {
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
  res.json({ success: true, message: "Candidate database reset to default pre-seeded pool.", candidates: candidatesList });
});

// POST /api/analyze - Main AI Matcher logic
app.post("/api/analyze", async (req, res) => {
  try {
    const { jobDescription } = req.body;

    if (!jobDescription || !jobDescription.trim()) {
      return res.status(400).json({ error: "Please enter a comprehensive Job Description." });
    }

    if (candidatesList.length === 0) {
      return res.status(400).json({ error: "No candidates available for ranking. Reset or add a candidate." });
    }

    // Lazy load the Gemini client safely
    let ai;
    try {
      ai = getAIClient();
    } catch (apiError: any) {
      console.error(apiError);
      return res.status(500).json({ 
        error: apiError.message || "Missing GEMINI_API_KEY. Please configure your key in AI Studio Secrets panel." 
      });
    }

    // Build representation of current candidate pool
    const candidatesStr = candidatesList.map((c, idx) => {
      return `Candidate Index: ${idx}
ID: ${c.id}
Name: ${c.name}
Title: ${c.title}
Experience Years: ${c.experienceYears}
Key Skills: ${c.skills.join(", ")}
Education: ${c.education}
Location: ${c.location}
Professional Summary: ${c.summary}`;
    }).join("\n\n---\n\n");

    const systemInstruction = `You are an elite corporate technical recruiting specialist.
Your objective is to thoroughly analyze the provided Job Description (JD) and evaluate our list of candidates to rank them based on alignment with the role's needs.

For each candidate, you MUST output a highly precise matching assessment:
1. "candidateId": Must match their correct ID exactly.
2. "score": An integer from 0 to 100 assessing skills, experience years, seniority, and overall fitness with the JD. Use the full range:
   - 85-100: Excellent match, possesses most or all mandatory skills.
   - 60-84: Good/Moderate match, possesses several key elements but lacks some nice-to-haves or specific years.
   - 30-59: Weak match, has transferrable skills but missing core prerequisites.
   - 0-29: Unrelated background.
3. "overallFit": A highly articulate and detailed explanation of why the candidate fits or does not fit, describing specific areas of alignment or gaps.
4. "strengths": An array of 2 to 4 key technical/functional strengths that align perfectly with the JD.
5. "gaps": An array of 1 to 3 areas where they fall short of the JD requirements, or topics requiring further probe.
6. "recommendation": Actionable next-step recommendation (e.g. "Proceed to Technical Interview", "Keep in Pool", "Shortlist for Screener", or "Not a Fit").
7. "interviewQuestions": An array of 3 highly-personalized, deep technical or behavioral interview questions specifically crafted for this candidate to test their gaps or probe their direct experience relative to this exact JD.

You must analyze all candidates provided in the list. Respond strictly with JSON complying with the requested schema.`;

    const userPrompt = `JOB DESCRIPTION TO ANALYZE AND MATCH:
${jobDescription}

CANDIDATE DATABASE TO RANK:
${candidatesStr}`;

    console.log("Calling Gemini API with model: gemini-3.5-flash...");
    
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rankings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    candidateId: { 
                      type: Type.STRING, 
                      description: "The exact unique ID of the candidate evaluated." 
                    },
                    score: { 
                      type: Type.INTEGER, 
                      description: "The calculated fit score from 0 to 100." 
                    },
                    overallFit: { 
                      type: Type.STRING, 
                      description: "Polished, human-like recruitment analysis explaining why they scored this way." 
                    },
                    strengths: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "2 to 4 key alignment highlights."
                    },
                    gaps: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "1 to 3 missing items or developmental gaps."
                    },
                    recommendation: { 
                      type: Type.STRING, 
                      description: "Short recommended action (e.g., 'Proceed to Technical Interview')." 
                    },
                    interviewQuestions: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "3 highly customized, expert interview questions targeting this specific candidate's gaps or unique profile details relative to the JD."
                    }
                  },
                  required: ["candidateId", "score", "overallFit", "strengths", "gaps", "recommendation", "interviewQuestions"]
                }
              }
            },
            required: ["rankings"]
          }
        }
      }),
      15000,
      "Gemini 3.5 Flash candidate analysis timed out."
    );

    const textContent = response.text;
    if (!textContent) {
      throw new Error("Gemini returned an empty response.");
    }

    const parsedData = JSON.parse(textContent.trim());
    const aiRankings: MatchAnalysis[] = parsedData.rankings || [];

    // Map AI analysis back to full Candidate objects
    const results: RankingResult[] = aiRankings
      .map((matchAnalysis) => {
        const candidate = candidatesList.find(c => c.id === matchAnalysis.candidateId);
        if (!candidate) return null;
        return {
          candidate,
          match: matchAnalysis
        };
      })
      .filter((r): r is RankingResult => r !== null);

    // Sort descending by match score
    results.sort((a, b) => b.match.score - a.match.score);

    res.json({
      rankings: results,
      jobDescriptionAnalyzed: jobDescription
    });

  } catch (error: any) {
    console.error("Analysis Error:", error);
    res.status(500).json({ 
      error: error.message || "An unexpected error occurred during candidates analysis." 
    });
  }
});

// POST /api/rank - Semantic matching using gemini-embedding-2-preview
app.post("/api/rank", async (req, res) => {
  try {
    const { jobDescription } = req.body;

    if (!jobDescription || !jobDescription.trim()) {
      return res.status(400).json({ error: "Please enter a comprehensive Job Description." });
    }

    if (candidatesList.length === 0) {
      return res.status(400).json({ error: "No candidates available for ranking. Reset or add a candidate." });
    }

    // Lazy load the Gemini client safely
    let ai;
    try {
      ai = getAIClient();
    } catch (apiError: any) {
      console.error(apiError);
      return res.status(500).json({ 
        error: apiError.message || "Missing GEMINI_API_KEY. Please configure your key in AI Studio Secrets panel." 
      });
    }

    // Step 1: Ensure all current candidates in candidatesList have cached embeddings
    console.log("Checking and updating candidate embeddings cache...");
    for (const candidate of candidatesList) {
      if (!candidateEmbeddingsCache.has(candidate.id)) {
        try {
          const text = getCandidateText(candidate);
          const response = await withTimeout(
            ai.models.embedContent({
              model: "gemini-embedding-2-preview",
              contents: text,
            }),
            5000,
            `Embedding generation for candidate ${candidate.name} timed out.`
          );
          const vector = response.embeddings?.[0]?.values;
          if (vector) {
            candidateEmbeddingsCache.set(candidate.id, vector);
          }
        } catch (embedErr) {
          console.error(`Failed to generate embedding for candidate ${candidate.name}:`, embedErr);
        }
      }
    }

    // Step 2: Generate embedding for the incoming job description (JD)
    console.log("Generating embedding for the incoming Job Description...");
    let jdVector: number[] | undefined;
    try {
      const response = await withTimeout(
        ai.models.embedContent({
          model: "gemini-embedding-2-preview",
          contents: jobDescription,
        }),
        5000,
        "Embedding generation for job description timed out."
      );
      jdVector = response.embeddings?.[0]?.values;
    } catch (jdEmbedErr: any) {
      console.error("Failed to generate embedding for Job Description:", jdEmbedErr);
      return res.status(500).json({ error: `Failed to embed Job Description: ${jdEmbedErr.message}` });
    }

    if (!jdVector) {
      return res.status(500).json({ error: "Could not generate embedding vector for the Job Description." });
    }

    // Step 3: Calculate Cosine Similarity for each candidate and sort them
    console.log("Calculating Cosine Similarities...");
    interface CandidateWithSimilarity {
      candidate: Candidate;
      similarity: number;
    }

    const similarityList: CandidateWithSimilarity[] = [];
    for (const candidate of candidatesList) {
      const candVector = candidateEmbeddingsCache.get(candidate.id);
      if (candVector) {
        const similarity = cosineSimilarity(jdVector, candVector);
        similarityList.push({ candidate, similarity });
      } else {
        similarityList.push({ candidate, similarity: 0 });
      }
    }

    // Sort candidates descending by similarity score
    similarityList.sort((a, b) => b.similarity - a.similarity);

    // Slice top 5 closest semantic matches
    const top5Matches = similarityList.slice(0, 5);
    console.log(`Top 5 semantic matches selected. Top match similarity: ${top5Matches[0]?.similarity}`);

    // Map similarity scores to a 0-100 fit score (e.g., linear mapping from [0.3, 0.8] to [40, 98])
    const mapSimilarityToScore = (sim: number) => {
      if (sim <= 0.3) return Math.round(Math.max(10, sim * 100));
      const scaled = 40 + ((sim - 0.3) / 0.5) * 58;
      return Math.round(Math.max(10, Math.min(100, scaled)));
    };

    // Step 4: Perform detailed analysis on these top 5 candidates in parallel using Promise.all()
    let shortlistItems: any[] = [];
    let usedModelName = "gemini-3.5-flash";
    let isFallbackModelUsed = false;

    const evaluationPromises = top5Matches.map(async (item) => {
      const c = item.candidate;
      const briefSummary = `${c.title} with ${c.experienceYears} years of experience. Key skills: ${c.skills.slice(0, 5).join(", ")}. Profile: ${c.summary.substring(0, 150)}...`;
      
      const systemInstruction = `You are a professional recruiting analyst. Evaluate the candidate's suitability against the provided Job Description. Provide a numeric fit score (0-100) and a concise, high-impact 2-sentence rationale.`;

      const userPrompt = `JOB DESCRIPTION:
${jobDescription}

CANDIDATE TO EVALUATE:
Name: ${c.name}
Role/Title: ${c.title}
Experience: ${c.experienceYears} years
Skills: ${c.skills.join(", ")}
Summary: ${briefSummary}`;

      const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
      let lastErr = null;

      for (const currentModel of modelsToTry) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: currentModel,
              contents: userPrompt,
              config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    fitScore: { type: Type.INTEGER },
                    semanticReasoning: { type: Type.STRING }
                  },
                  required: ["fitScore", "semanticReasoning"]
                }
              }
            }),
            12000,
            `Gemini evaluation timed out for candidate ${c.name} with model ${currentModel}.`
          );

          const textContent = response.text;
          if (!textContent) {
            throw new Error(`Empty response received for ${c.name}`);
          }
          const parsedData = JSON.parse(textContent.trim());
          return {
            candidateId: c.id,
            fitScore: parsedData.fitScore,
            semanticReasoning: parsedData.semanticReasoning,
            modelName: currentModel
          };
        } catch (err: any) {
          lastErr = err;
          console.warn(`Attempt for candidate ${c.name} using model ${currentModel} failed:`, err.message || err);
        }
      }
      throw lastErr || new Error(`Failed to evaluate candidate ${c.name}`);
    });

    try {
      console.log("Evaluating top candidates in parallel...");
      const evaluatedResults = await Promise.all(evaluationPromises);
      
      shortlistItems = evaluatedResults.map(res => ({
        candidateId: res.candidateId,
        fitScore: res.fitScore,
        semanticReasoning: res.semanticReasoning
      }));

      const usedLite = evaluatedResults.some(res => res.modelName === "gemini-3.1-flash-lite");
      if (usedLite) {
        usedModelName = "gemini-3.1-flash-lite";
        isFallbackModelUsed = true;
      } else {
        usedModelName = "gemini-3.5-flash";
        isFallbackModelUsed = false;
      }
    } catch (parallelErr: any) {
      console.error("Parallel candidate evaluation failed or timed out. Falling back to default baseline embeddings scoring:", parallelErr);

      // Fallback default JSON layout directly inside the .catch() block:
      // "If the parallel processing fails or takes too long, immediately return the candidates sorted by their initial Vector Embedding score with a standard string like: 'Automated Match: High structural alignment based on core project and experience analysis.'"
      const results: RankingResult[] = top5Matches.map((item) => {
        const candidate = item.candidate;
        const fitScore = mapSimilarityToScore(item.similarity);
        const fallbackText = "Automated Match: High structural alignment based on core project and experience analysis.";

        const matchAnalysis: MatchAnalysis = {
          candidateId: candidate.id,
          score: fitScore,
          overallFit: fallbackText,
          strengths: candidate.skills.slice(0, 3),
          gaps: ["Verify candidate resume against specific toolchains."],
          recommendation: fitScore >= 80 ? "Proceed to Technical Interview" : "Shortlist for Screener",
          interviewQuestions: [
            `Can you describe your experience working with ${candidate.skills[0] || "these core tools"}?`,
            "What has been your most challenging recent technical initiative?"
          ],
          fitScore: fitScore,
          semanticReasoning: fallbackText,
          potentialRisks: fitScore < 75 ? "Some secondary skill alignment to be verified." : "Low risk - high alignment.",
          finalRank: 5
        };
        return {
          candidate,
          match: matchAnalysis
        };
      });

      // Sort descending strictly by similarity/fitScore
      results.sort((a, b) => {
        const aScore = a.match.fitScore ?? a.match.score;
        const bScore = b.match.fitScore ?? b.match.score;
        return bScore - aScore;
      });

      // Re-index finalRank in the final sorted order
      results.forEach((item, index) => {
        item.match.finalRank = index + 1;
      });

      // Extract raw shortlist
      const shortlist = results.map(item => ({
        candidateId: item.candidate.id,
        finalRank: item.match.finalRank,
        fitScore: item.match.fitScore,
        semanticReasoning: item.match.semanticReasoning,
        potentialRisks: item.match.potentialRisks
      }));

      return res.json({
        shortlist,
        rankings: results,
        jobDescriptionAnalyzed: jobDescription,
        isFallback: true,
        usedModelName: "vector-embedding-fallback"
      });
    }

    // Map AI analysis back to full Candidate objects
    const results: RankingResult[] = top5Matches.map((item) => {
      const candidate = item.candidate;
      let matchItem = shortlistItems.find(r => r.candidateId === candidate.id);
      let matchAnalysis: MatchAnalysis;
      if (matchItem) {
        matchAnalysis = {
          candidateId: candidate.id,
          score: matchItem.fitScore,
          overallFit: matchItem.semanticReasoning,
          strengths: candidate.skills.slice(0, 3),
          gaps: ["Verify candidate resume against specific toolchains."],
          recommendation: matchItem.fitScore >= 80 ? "Proceed to Technical Interview" : "Shortlist for Screener",
          interviewQuestions: [
            `Can you describe your experience working with ${candidate.skills[0] || "these core tools"}?`,
            "What has been your most challenging recent technical initiative?"
          ],
          fitScore: matchItem.fitScore,
          semanticReasoning: matchItem.semanticReasoning,
          potentialRisks: matchItem.fitScore < 75 ? "Some secondary skill alignment to be verified." : "Low risk - high alignment.",
          finalRank: 5
        };
      } else {
        const baselineScore = mapSimilarityToScore(item.similarity);
        matchAnalysis = {
          candidateId: candidate.id,
          score: baselineScore,
          overallFit: `${candidate.name} shows high semantic alignment.`,
          strengths: candidate.skills.slice(0, 3),
          gaps: ["No direct gaps found."],
          recommendation: "Shortlist for Screener",
          interviewQuestions: ["Tell us about your experience."],
          fitScore: baselineScore,
          semanticReasoning: `${candidate.name} shows high semantic alignment.`,
          potentialRisks: "None detected.",
          finalRank: 5
        };
      }
      return {
        candidate,
        match: matchAnalysis
      };
    });

    // Sort descending strictly by match.fitScore
    results.sort((a, b) => {
      const aScore = a.match.fitScore ?? a.match.score;
      const bScore = b.match.fitScore ?? b.match.score;
      return bScore - aScore;
    });

    // Re-index finalRank in the final sorted order to be perfectly consistent
    results.forEach((item, index) => {
      item.match.finalRank = index + 1;
    });

    // Extract the raw shortlist to return directly as requested
    const shortlist = results.map(item => ({
      candidateId: item.candidate.id,
      finalRank: item.match.finalRank,
      fitScore: item.match.fitScore,
      semanticReasoning: item.match.semanticReasoning,
      potentialRisks: item.match.potentialRisks
    }));

    res.json({
      shortlist,
      rankings: results,
      jobDescriptionAnalyzed: jobDescription,
      isFallback: isFallbackModelUsed || usedModelName === "gemini-3.1-flash-lite",
      usedModelName
    });

  } catch (error: any) {
    console.error("Semantic Ranking Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error.message || "An unexpected error occurred during candidates semantic ranking." 
      });
    }
  }
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TalentMatch AI Server is listening at http://localhost:${PORT}`);
    // Start precalculating embeddings in background on startup
    precalculateCandidateEmbeddings().then(() => {
      console.log("Startup precalculation finished successfully.");
    }).catch((err) => {
      console.error("Startup precalculation failed:", err);
    });
  });
}

startServer();
