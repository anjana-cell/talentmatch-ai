export interface Candidate {
  id: string;
  name: string;
  title: string;
  experienceYears: number;
  skills: string[];
  education: string;
  location: string;
  email: string;
  phone: string;
  summary: string;
  avatarUrl?: string;
  isCustom?: boolean; // True if the recruiter added them manually
  redrobData?: any;    // Rich original Redrob platform profile & signals data
}

export interface MatchAnalysis {
  candidateId: string;
  score: number; // 0 to 100
  overallFit: string;
  strengths: string[];
  gaps: string[];
  recommendation: string;
  interviewQuestions: string[];
  // Intelligent evaluation and re-ranking parameters
  fitScore?: number;
  semanticReasoning?: string;
  potentialRisks?: string;
  finalRank?: number;
}

export interface RankingResult {
  candidate: Candidate;
  match: MatchAnalysis;
}

export interface AnalyzeRequest {
  jobDescription: string;
}

export interface AnalyzeResponse {
  rankings: RankingResult[];
  jobDescriptionAnalyzed: string;
  isFallback?: boolean;
  usedModelName?: string;
}

// New interfaces for the Redrob workflow
export interface UploadPreview {
  importedCount: number;
  validCount: number;
  invalidCount: number;
  sampleValid?: Candidate[];
  sampleInvalid?: any[];
}

export interface RankingRow {
  candidate_id: string;
  rank: number;
  score: number; // integer 0..100
  reasoning: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
