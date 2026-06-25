import { Candidate } from "../src/types";
import { GoogleGenAI } from "@google/genai";

// Lightweight ranking service that does not depend on external APIs.
// Designed to be deterministic and fast for very large datasets.

export interface ParseJsonlResult {
  valid: boolean;
  candidate?: Candidate;
  invalid?: { line: string; error: string };
}

export function parseJsonlLine(line: string): ParseJsonlResult {
  try {
    const raw = JSON.parse(line);
    const name = raw.profile?.anonymized_name || raw.name || raw.full_name || "Anonymized Candidate";
    const candidate: Candidate = {
      id: raw.candidate_id || raw.id || `cand-${Date.now()}-${Math.floor(Math.random()*10000)}`,
      name,
      title: raw.profile?.headline || raw.title || raw.role || "Unknown",
      experienceYears: Number(raw.profile?.years_of_experience ?? raw.experienceYears ?? 0),
      skills: Array.isArray(raw.skills) ? raw.skills.map((s: any) => typeof s === 'string' ? s : (s.name || JSON.stringify(s))).filter(Boolean) : [],
      education: Array.isArray(raw.education) ? raw.education.map((e:any)=> e.degree? `${e.degree} in ${e.field_of_study||''}`: JSON.stringify(e)).join('; ') : (raw.education || "N/A"),
      location: `${raw.profile?.location || raw.location || 'Remote'}`,
      email: raw.profile?.email || raw.email || `${name.toLowerCase().replace(/\s+/g, '.') }@talentmatch.ai`,
      phone: raw.profile?.phone || raw.phone || "",
      summary: raw.profile?.summary || raw.summary || "",
      redrobData: raw
    };
    return { valid: true, candidate };
  } catch (err: any) {
    return { valid: false, invalid: { line, error: err.message || 'Invalid JSON' } };
  }
}

export function parseJsonl(text: string): { valid: Candidate[]; invalid: any[] } {
  const valid: Candidate[] = [];
  const invalid: any[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const result = parseJsonlLine(line);
    if (result.valid && result.candidate) valid.push(result.candidate);
    else if (result.invalid) invalid.push(result.invalid);
  }
  return { valid, invalid };
}

// Scoring: multi-factor ranking model built for better hiring signal alignment
export interface ScoredCandidate {
  candidate_id: string;
  score: number;
  reasoning: string;
  breakdown: {
    technicalScore: number;
    behavioralScore: number;
    skillRelevance: number;
    experienceDepth: number;
    careerProgression: number;
    projectComplexity: number;
    productExperience: number;
    searchExperience: number;
    aiExperience: number;
    leadership: number;
    impact: number;
    learningVelocity: number;
    penalties: number;
  };
  penaltyFlags: string[];
}

const normalizeTextRe = /[^a-z0-9\s]+/g;
const normalizeWhitespaceRe = /\s+/g;

function normalizeText(text: string): string {
  return (text || "").toLowerCase().replace(normalizeTextRe, " ").replace(normalizeWhitespaceRe, " ").trim();
}

const titleSignals = ['lead', 'senior', 'staff', 'principal', 'director', 'head', 'vp', 'chief', 'manager', 'architect'];
const projectKeywords = ['scalable', 'platform', 'distributed', 'enterprise', 'cloud', 'performance', 'optimization', 'automation', 'microservices', 'api', 'deployment', 'security', 'compliance'];
const productKeywords = ['product', 'saas', 'b2b', 'consumer', 'user', 'customer', 'stakeholder', 'roadmap', 'launch', 'feature'];
const searchKeywords = ['search', 'recommendation', 'ranking', 'query', 'retrieval', 'personalization', 'results', 'relevance', 'feed'];
const aiKeywords = ['machine learning', 'ml', 'artificial intelligence', 'ai', 'deep learning', 'neural network', 'data science', 'nlp', 'computer vision', 'predictive', 'model'];
const leadershipKeywords = ['managed', 'mentored', 'led', 'owned', 'coached', 'spearheaded', 'director', 'head of'];
const impactKeywords = ['increased', 'reduced', 'improved', 'grew', 'revenue', 'users', 'customers', 'retention', 'efficiency', 'latency', 'throughput', '%'];
const learningKeywords = ['learned', 'self-taught', 'certified', 'course', 'bootcamp', 'experimented', 'upskilled', 'published', 'conference', 'research'];

const technologyKeywords = ['javascript', 'typescript', 'node', 'node.js', 'react', 'angular', 'vue', 'python', 'java', 'go', 'rust', 'kubernetes', 'docker', 'aws', 'gcp', 'azure', 'spark', 'hadoop', 'terraform', 'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'api', 'microservices', 'serverless', 'cloud'];
const domainKeywords = ['healthcare', 'finance', 'financial', 'ecommerce', 'adtech', 'gaming', 'education', 'logistics', 'media', 'telecom', 'security', 'energy', 'enterprise', 'saas', 'consumer', 'b2b', 'b2c'];
const senioritySignals = ['senior', 'staff', 'principal', 'lead', 'director', 'manager', 'head', 'vp', 'principal', 'architect', 'junior', 'associate', 'entry', 'mid-level', 'mid'];
const leadershipSignals = ['lead', 'manage', 'managed', 'leading', 'mentored', 'mentor', 'owned', 'spearheaded', 'coordinated', 'stakeholder', 'team'];
const aiMlSignals = ['machine learning', 'ml', 'artificial intelligence', 'ai', 'deep learning', 'neural network', 'data science', 'computer vision', 'nlp', 'predictive'];
const searchRankingSignals = ['search', 'ranking', 'recommendation', 'recommender', 'query', 'retrieval', 'relevance', 'information retrieval', 'personalization'];
const productSignals = ['product', 'roadmap', 'user', 'customer', 'stakeholder', 'feature', 'launch', 'market', 'strategy'];
const roleSignals = ['engineer', 'developer', 'architect', 'manager', 'lead', 'specialist', 'consultant', 'scientist', 'analyst'];

const synonymMap: Record<string, string[]> = {
  'machine learning': ['ml'],
  'artificial intelligence': ['ai'],
  'recommendation': ['recommender', 'recommendations'],
  'search': ['search ranking', 'search relevance'],
  'backend': ['server', 'server-side'],
  'frontend': ['ui', 'ux'],
  'data science': ['analytics', 'big data'],
  'node.js': ['node'],
  'typescript': ['ts'],
  'javascript': ['js']
};

const synonymLookup = new Map<string, string[]>();
for (const [base, synonyms] of Object.entries(synonymMap)) {
  const normalizedBase = normalizeText(base);
  const normalizedGroup = new Set([normalizedBase, ...synonyms.map(normalizeText)]);
  const groupArray = Array.from(normalizedGroup);
  for (const token of groupArray) {
    synonymLookup.set(token, groupArray);
  }
}

interface JobDescriptionAnalysis {
  jdText: string;
  jdTextTokens: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  technologies: string[];
  seniority: string;
  leadership: boolean;
  aiMl: boolean;
  searchRanking: boolean;
  product: boolean;
  domainKeywords: string[];
  roleKeywords: string[];
  allKeywords: string[];
  summary: string;
  source: 'gemini' | 'local';
}

function createTokenCounts(text: string): Record<string, number> {
  const tokenCounts: Record<string, number> = {};
  for (const token of text.split(' ').filter(Boolean)) {
    tokenCounts[token] = (tokenCounts[token] || 0) + 1;
  }
  return tokenCounts;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface PatternSpec {
  singleTokens: string[];
  phraseRegexes: RegExp[];
}

function buildPatternSpec(patterns: string[]): PatternSpec {
  const tokens = new Set<string>();
  const phraseRegexes: RegExp[] = [];

  for (const rawPattern of patterns) {
    const normalized = normalizeText(rawPattern);
    if (!normalized) continue;
    if (normalized.includes(' ')) {
      phraseRegexes.push(new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'g'));
    } else {
      tokens.add(normalized);
    }
  }

  return {
    singleTokens: Array.from(tokens),
    phraseRegexes
  };
}

function expandSynonyms(patterns: string[]): string[] {
  const expanded = new Set<string>();
  for (const pattern of patterns) {
    const normalized = normalizeText(pattern);
    if (!normalized) continue;
    expanded.add(normalized);
    const mapped = synonymLookup.get(normalized);
    if (mapped) {
      for (const alias of mapped) {
        expanded.add(alias);
      }
    }
  }
  return Array.from(expanded);
}

function extractKeyPhrases(text: string, patterns: string[]): string[] {
  const unique: string[] = [];
  const normalizedText = normalizeText(text);
  for (const pattern of expandSynonyms(patterns)) {
    const normalizedPattern = normalizeText(pattern);
    const re = new RegExp(`\\b${escapeRegex(normalizedPattern)}\\b`, 'g');
    if (re.test(normalizedText) && !unique.includes(normalizedPattern)) {
      unique.push(normalizedPattern);
    }
  }
  return unique;
}

function analyzeTextByPatterns(text: string, patterns: string[]): number {
  return countPatternsFromText(normalizeText(text), createTokenCounts(normalizeText(text)), expandSynonyms(patterns));
}

const jdAnalysisCache = new Map<string, JobDescriptionAnalysis>();

async function analyzeJobDescription(jobDescription: string): Promise<JobDescriptionAnalysis> {
  const normalizedJD = normalizeText(jobDescription);
  const cacheKey = normalizedJD.slice(0, 1000);
  if (jdAnalysisCache.has(cacheKey)) {
    return jdAnalysisCache.get(cacheKey)!;
  }

  const requiredSkills = extractKeyPhrases(normalizedJD, [...technologyKeywords, ...roleSignals]);
  const preferredSkills = extractKeyPhrases(normalizedJD, ['preferred', 'nice to have', ...technologyKeywords]).filter(p => !requiredSkills.includes(p));
  const technologies = extractKeyPhrases(normalizedJD, technologyKeywords);
  const seniority = senioritySignals.find(sig => normalizedJD.includes(sig)) || 'mid-level';
  const leadership = leadershipSignals.some(sig => normalizedJD.includes(sig));
  const aiMl = aiMlSignals.some(sig => normalizedJD.includes(sig));
  const searchRanking = searchRankingSignals.some(sig => normalizedJD.includes(sig));
  const product = productSignals.some(sig => normalizedJD.includes(sig));
  const domains = extractKeyPhrases(normalizedJD, domainKeywords);
  const roles = extractKeyPhrases(normalizedJD, roleSignals);
  const allKeywords = Array.from(new Set([...requiredSkills, ...preferredSkills, ...technologies, ...domains, ...roles]));
  const summary = [];
  if (aiMl) summary.push('AI/ML focus');
  if (searchRanking) summary.push('search or ranking domain');
  if (product) summary.push('product-focused work');
  if (leadership) summary.push('leadership requirement');
  if (domains.length) summary.push(`domain: ${domains.join(', ')}`);
  const analysis: JobDescriptionAnalysis = {
    jdText: normalizedJD,
    jdTextTokens: Array.from(new Set(normalizedJD.split(' ').filter(Boolean))),
    requiredSkills,
    preferredSkills,
    technologies,
    seniority,
    leadership,
    aiMl,
    searchRanking,
    product,
    domainKeywords: domains,
    roleKeywords: roles,
    allKeywords,
    summary: summary.length ? summary.join(', ') : 'JD-aligned role',
    source: 'local'
  };

  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const chat = ai.chats.create({ model: 'gemini-3.5-mini' });
      const response = await chat.sendMessage({
        message: `Extract the job characteristics from the following job description as JSON with keys: required_skills, preferred_skills, technologies, seniority, leadership, ai_ml, search_ranking, product, domain_keywords, role_keywords. Only return valid JSON.\n\nJob Description:\n${jobDescription}`,
        config: { temperature: 0.0 }
      });
      const text = String(response.text || '');
      const parsed = JSON.parse(text);
      const geminiAnalysis: JobDescriptionAnalysis = {
        jdText: normalizedJD,
        jdTextTokens: Array.from(new Set(normalizedJD.split(' ').filter(Boolean))),
        requiredSkills: Array.isArray(parsed.required_skills) ? parsed.required_skills.map(String) : requiredSkills,
        preferredSkills: Array.isArray(parsed.preferred_skills) ? parsed.preferred_skills.map(String) : preferredSkills,
        technologies: Array.isArray(parsed.technologies) ? parsed.technologies.map(String) : technologies,
        seniority: typeof parsed.seniority === 'string' ? parsed.seniority : seniority,
        leadership: typeof parsed.leadership === 'boolean' ? parsed.leadership : leadership,
        aiMl: typeof parsed.ai_ml === 'boolean' ? parsed.ai_ml : aiMl,
        searchRanking: typeof parsed.search_ranking === 'boolean' ? parsed.search_ranking : searchRanking,
        product: typeof parsed.product === 'boolean' ? parsed.product : product,
        domainKeywords: Array.isArray(parsed.domain_keywords) ? parsed.domain_keywords.map(String) : domains,
        roleKeywords: Array.isArray(parsed.role_keywords) ? parsed.role_keywords.map(String) : roles,
        allKeywords: Array.from(new Set([...(Array.isArray(parsed.required_skills) ? parsed.required_skills.map(String) : requiredSkills), ...(Array.isArray(parsed.preferred_skills) ? parsed.preferred_skills.map(String) : preferredSkills), ...(Array.isArray(parsed.technologies) ? parsed.technologies.map(String) : technologies), ...(Array.isArray(parsed.domain_keywords) ? parsed.domain_keywords.map(String) : domains), ...(Array.isArray(parsed.role_keywords) ? parsed.role_keywords.map(String) : roles)])),
        summary: summary.length ? summary.join(', ') : 'JD-aligned role',
        source: 'gemini'
      };
      jdAnalysisCache.set(cacheKey, geminiAnalysis);
      return geminiAnalysis;
    } catch (err) {
      // fall back to local extraction if Gemini fails
    }
  }

  jdAnalysisCache.set(cacheKey, analysis);
  return analysis;
}

function countTokensFromCounts(tokenCounts: Record<string, number>, tokens: string[]): number {
  return tokens.reduce((count, token) => count + (tokenCounts[token] || 0), 0);
}

function countPatternsFromText(text: string, tokenCounts: Record<string, number>, patterns: PatternSpec | string[]): number {
  const spec = Array.isArray(patterns) ? buildPatternSpec(patterns) : patterns;
  return spec.singleTokens.reduce((count, token) => count + (tokenCounts[token] || 0), 0)
    + spec.phraseRegexes.reduce((count, regex) => {
      const matches = text.match(regex);
      return count + (matches?.length || 0);
    }, 0);
}

const currentYear = new Date().getFullYear();

function extractTimelinePenalty(candidate: Candidate): number {
  const history = candidate.redrobData?.career_history;
  if (!Array.isArray(history) || history.length < 2) return 0;

  const ranges = history
    .map((job: any) => {
      const start = Number(job.start_year || job.start_date?.slice(0, 4));
      const end = Number(job.end_year || job.end_date?.slice(0, 4) || currentYear);
      return Number.isFinite(start) ? { start, end: Number.isFinite(end) ? end : currentYear } : null;
    })
    .filter((range): range is { start: number; end: number } => range !== null && typeof range.start === 'number');

  let penalty = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].end < ranges[i].start) penalty += 2;
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].end >= ranges[j].start && ranges[j].end >= ranges[i].start) {
        penalty += 2;
      }
    }
  }
  return Math.min(penalty, 6);
}

function computeGenericResumePenalty(candidate: Candidate): number {
  const summary = normalizeText(candidate.summary || "");
  if (summary.length < 80) return 3;
  const uniqueTokenCount = new Set(summary.split(/\s+/).filter(Boolean)).size;
  if (uniqueTokenCount < 22) return 2;
  if (!Array.isArray(candidate.skills) || candidate.skills.length < 3) return 2;
  return 0;
}

function computeKeywordStuffingPenalty(summaryTokens: string[], summaryTokenCounts: Record<string, number>, jdTokens: string[], _summaryText: string): number {
  const repeated = Object.values(summaryTokenCounts).filter(count => count >= 4).length;
  if (repeated >= 2) return 4;
  if (repeated === 1) return 2;

  let stuffScore = 0;
  for (const token of jdTokens) {
    if (token.length < 4) continue;
    stuffScore += Math.min(summaryTokenCounts[token] || 0, 3);
  }
  return stuffScore > 12 ? 3 : 0;
}

function computeSuspiciousProfilePenalty(candidate: Candidate): number {
  const hasSkills = Array.isArray(candidate.skills) && candidate.skills.length > 0;
  const hasSummary = typeof candidate.summary === 'string' && candidate.summary.trim().length >= 40;
  if (!hasSkills && !hasSummary) return 4;
  if (!hasSkills) return 3;
  if (!hasSummary) return 2;
  return 0;
}

function computeRedrobBehavioralScore(candidate: Candidate) {
  const signals = candidate.redrobData?.redrob_signals || {};
  const profileCompleteness = Number(signals.profile_completeness_score ?? 0);
  const openToWork = signals.open_to_work_flag ? 1 : 0;
  const searchAppearance = Number(signals.search_appearance_30d ?? 0);
  const savedByRecruiters = Number(signals.saved_by_recruiters_30d ?? 0);
  const profileViews = Number(signals.profile_views_received_30d ?? 0);
  const applicationsSubmitted = Number(signals.applications_submitted_30d ?? 0);
  const recruiterResponseRate = Number(signals.recruiter_response_rate ?? 0);
  const avgResponseTime = Number(signals.avg_response_time_hours ?? 0);
  const interviewCompletionRate = Number(signals.interview_completion_rate ?? 0);
  const offerAcceptanceRate = Number(signals.offer_acceptance_rate ?? 0);
  const githubActivityScore = Number(signals.github_activity_score ?? 0);
  const connectionCount = Number(signals.connection_count ?? 0);
  const endorsementsReceived = Number(signals.endorsements_received ?? 0);
  const verifiedEmail = signals.verified_email ? 1 : 0;
  const verifiedPhone = signals.verified_phone ? 1 : 0;
  const linkedinConnected = signals.linkedin_connected ? 1 : 0;
  const noticePeriodDays = Number(signals.notice_period_days ?? 999);
  const lastActiveDate = signals.last_active_date ? new Date(signals.last_active_date) : null;

  const rawSkills = Array.isArray(candidate.redrobData?.skills) ? candidate.redrobData.skills : [];
  const skillEndorsementSum = rawSkills.reduce((sum: number, skill: any) => sum + (Number(skill.endorsements ?? 0) || 0), 0);
  const skillEndorsementIndicator = Math.min(1, Math.round(Math.min(skillEndorsementSum, 30) / 20));

  const skillAssessmentScores = signals.skill_assessment_scores;
  const assessmentValues = Array.isArray(skillAssessmentScores)
    ? []
    : Object.values(skillAssessmentScores || {}).filter((value: any) => typeof value === 'number') as number[];
  const averageAssessment = assessmentValues.length
    ? assessmentValues.reduce((sum, value) => sum + value, 0) / assessmentValues.length
    : 0;

  const lastActiveDays = lastActiveDate ? Math.max(0, Math.floor((Date.now() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24))) : 999;
  const recentActivityScore = lastActiveDays <= 30 ? 1 : 0;
  const applicationActivityScore = Math.min(1, Math.round(Math.min(applicationsSubmitted, 6) / 2));
  const endorsementSignal = Math.min(1, Math.round(Math.min(endorsementsReceived, 20) / 20));

  const profileCompletenessScore = Math.min(6, Math.round(profileCompleteness / 16.7));
  const availabilityScore = Math.min(4, (openToWork ? 2 : 0) + (noticePeriodDays <= 30 ? 2 : noticePeriodDays <= 60 ? 1 : 0));
  const recruiterResponseScore = Math.min(4, Math.round(recruiterResponseRate * 4));
  const avgResponseScore = avgResponseTime > 0 ? (avgResponseTime <= 48 ? 2 : avgResponseTime <= 96 ? 1 : 0) : 0;
  const engagementScore = Math.min(4,
    Math.round(Math.min(300, searchAppearance) / 150)
    + Math.min(1, savedByRecruiters)
    + Math.min(1, Math.floor(profileViews / 100))
    + Math.min(1, Math.round(Math.min(connectionCount, 500) / 250))
    + applicationActivityScore
  );
  const reliabilityScore = Math.min(4,
    Math.round(interviewCompletionRate * 3)
    + Math.min(1, Math.round(offerAcceptanceRate * 2))
    + skillEndorsementIndicator
    + endorsementSignal
  );
  const verificationScore = Math.min(3, verifiedEmail + verifiedPhone + linkedinConnected);
  const githubScore = Math.min(2, Math.round(Math.min(10, githubActivityScore) / 5));
  const assessmentScore = Math.min(2, Math.round(averageAssessment / 50));
  const recencyScore = Math.min(1, recentActivityScore);

  const behavioralScore = Math.min(30,
    profileCompletenessScore
    + availabilityScore
    + recruiterResponseScore
    + avgResponseScore
    + engagementScore
    + reliabilityScore
    + verificationScore
    + githubScore
    + assessmentScore
    + recencyScore
  );
  const notes: string[] = [];
  if (profileCompletenessScore) notes.push(`Completeness ${profileCompletenessScore}/6`);
  if (availabilityScore) notes.push(`Availability ${availabilityScore}/4`);
  if (recruiterResponseScore || avgResponseScore) notes.push(`Recruiter responsiveness ${recruiterResponseScore + avgResponseScore}/6`);
  if (engagementScore) notes.push(`Platform engagement ${engagementScore}/4`);
  if (reliabilityScore) notes.push(`Interview reliability ${reliabilityScore}/4`);
  if (verificationScore) notes.push(`Verified contact ${verificationScore}/3`);
  if (githubScore) notes.push(`Developer activity ${githubScore}/2`);
  if (assessmentScore) notes.push(`Skill assessment ${assessmentScore}/2`);
  if (recencyScore) notes.push(`Recent platform activity`);

  return {
    score: behavioralScore,
    notes: notes.length ? notes : [`Behavioral signal support ${behavioralScore}/30`],
    breakdown: {
      profileCompletenessScore,
      availabilityScore,
      recruiterResponseScore,
      avgResponseScore,
      engagementScore,
      reliabilityScore,
      verificationScore,
      githubScore,
      assessmentScore,
      recencyScore,
    }
  };
}

export async function scoreCandidates(jd: string, candidates: Candidate[]): Promise<ScoredCandidate[]> {
  const analysis = await analyzeJobDescription(jd);
  const jdText = analysis.jdText;
  const allJdPatterns = expandSynonyms(analysis.allKeywords.length ? analysis.allKeywords : [jdText]);
  const allJdTokenCounts = allJdPatterns.map(p => normalizeText(p));
  const seniorityNormalized = normalizeText(analysis.seniority);

  const requiredSpec = buildPatternSpec(expandSynonyms(analysis.requiredSkills));
  const preferredSpec = buildPatternSpec(expandSynonyms(analysis.preferredSkills));
  const technologySpec = buildPatternSpec(expandSynonyms(analysis.technologies));
  const roleSpec = buildPatternSpec(expandSynonyms(analysis.roleKeywords));
  const domainSpec = buildPatternSpec(expandSynonyms(analysis.domainKeywords));
  const searchSpec = buildPatternSpec(expandSynonyms(searchRankingSignals));
  const aiSpec = buildPatternSpec(expandSynonyms(aiMlSignals));
  const productSpec = buildPatternSpec(expandSynonyms(productSignals));
  const projectSpec = buildPatternSpec(projectKeywords);
  const productExperienceSpec = buildPatternSpec(productKeywords);
  const searchExperienceSpec = buildPatternSpec(searchKeywords);
  const aiExperienceSpec = buildPatternSpec(aiKeywords);
  const leadershipSpec = buildPatternSpec(leadershipKeywords);
  const impactSpec = buildPatternSpec(impactKeywords);
  const learningSpec = buildPatternSpec(learningKeywords);

  return candidates.map(c => {
    const normalizedCandidateText = normalizeText(`${c.title || ''} ${c.summary || ''} ${c.skills.join(' ')} ${c.education || ''} ${c.location || ''}`);
    const candidateTokenCounts = createTokenCounts(normalizedCandidateText);
    const summaryNormalized = normalizeText(c.summary || '');
    const summaryTokens = summaryNormalized.split(' ').filter(Boolean);
    const summaryTokenCounts = createTokenCounts(summaryNormalized);
    const titleText = normalizeText(c.title || '');

    const requiredMatch = Math.min(10, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, requiredSpec));
    const preferredMatch = Math.min(8, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, preferredSpec));
    const technologyMatch = Math.min(10, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, technologySpec));
    const roleMatch = Math.min(8, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, roleSpec));
    const domainMatch = Math.min(6, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, domainSpec));
    const searchMatch = analysis.searchRanking ? Math.min(6, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, searchSpec)) : 0;
    const aiMatch = analysis.aiMl ? Math.min(6, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, aiSpec)) : 0;
    const productMatch = analysis.product ? Math.min(6, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, productSpec)) : 0;
    const seniorityAlignment = seniorityNormalized && titleText.includes(seniorityNormalized) ? 3 : 0;
    const jdOverlap = Math.min(18, countTokensFromCounts(candidateTokenCounts, allJdTokenCounts));

    const skillRelevance = Math.min(18, requiredMatch * 2 + technologyMatch * 1 + preferredMatch * 1 + roleMatch);
    const technologyScore = Math.min(10, technologyMatch + Math.floor(aiMatch / 2));
    const roleScore = Math.min(8, roleMatch + seniorityAlignment);
    const domainScore = Math.min(6, domainMatch + Math.floor(productMatch / 2));
    const searchAiScore = Math.min(10, searchMatch + aiMatch);

    const experienceDepth = Math.min(18, Math.round(Math.min(20, c.experienceYears || 0) * 0.9));
    const titleScore = Math.min(8, titleSignals.filter(sig => titleText.includes(sig)).length * 3);
    const careerProgression = Math.min(8, titleScore + Math.min(4, Math.floor((c.experienceYears || 0) / 6)));
    const projectComplexity = Math.min(10, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, projectSpec));
    const productExperience = Math.min(8, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, productExperienceSpec));
    const searchExperience = Math.min(8, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, searchExperienceSpec));
    const aiExperience = Math.min(8, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, aiExperienceSpec));
    const leadership = Math.min(5, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, leadershipSpec));
    const impact = Math.min(6, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, impactSpec));
    const learningVelocity = Math.min(5, countPatternsFromText(normalizedCandidateText, candidateTokenCounts, learningSpec));

    const timelinePenalty = extractTimelinePenalty(c);
    const genericPenalty = computeGenericResumePenalty(c);
    const stuffingPenalty = computeKeywordStuffingPenalty(summaryTokens, summaryTokenCounts, analysis.jdTextTokens, summaryNormalized);
    const suspiciousPenalty = computeSuspiciousProfilePenalty(c);
    const penalties = Math.min(15, timelinePenalty + genericPenalty + stuffingPenalty + suspiciousPenalty);

    const rawTechnicalScore = skillRelevance + technologyScore + roleScore + domainScore + searchAiScore + experienceDepth + careerProgression + projectComplexity + productExperience + searchExperience + aiExperience + leadership + impact + learningVelocity;
    const technicalScore = Math.min(70, Math.round((rawTechnicalScore / 110) * 70));
    const behavioral = computeRedrobBehavioralScore(c);
    const finalScore = Math.max(0, Math.min(100, technicalScore + behavioral.score - penalties));

    const reasoningParts: string[] = [];
    if (requiredMatch >= 5) reasoningParts.push('Strong core skill alignment with the JD requirements');
    else if (requiredMatch >= 3) reasoningParts.push('Good core skill relevance for the role');
    if (technologyMatch >= 3) reasoningParts.push('Technology stack matches the JD requirements');
    if (searchMatch >= 2) reasoningParts.push('Relevant search/ranking experience and terminology');
    if (aiMatch >= 2) reasoningParts.push('Relevant AI/ML expertise');
    if (productMatch >= 2) reasoningParts.push('Product and stakeholder-facing experience');
    if (domainMatch >= 1 && analysis.domainKeywords.length) reasoningParts.push(`Experience in domain: ${analysis.domainKeywords.join(', ')}`);
    if (seniorityAlignment) reasoningParts.push(`${analysis.seniority} level alignment`);
    if (!reasoningParts.length) reasoningParts.push('Relevant profile detected for the requested JD');
    if (behavioral.score >= 18) reasoningParts.push('Positive behavioral signal alignment');
    if (penalties) reasoningParts.push(`Penalties: ${penalties} points`);

    return {
      candidate_id: c.id,
      score: finalScore,
      reasoning: `${reasoningParts.slice(0, 3).join('; ')} | Final score ${finalScore}/100`,
      breakdown: {
        technicalScore,
        behavioralScore: behavioral.score,
        skillRelevance,
        experienceDepth,
        careerProgression,
        projectComplexity,
        productExperience,
        searchExperience,
        aiExperience,
        leadership,
        impact,
        learningVelocity,
        penalties
      },
      penaltyFlags: [
        timelinePenalty ? 'timeline inconsistencies' : null,
        genericPenalty ? 'generic resume' : null,
        stuffingPenalty ? 'keyword stuffing' : null,
        suspiciousPenalty ? 'suspicious profile format' : null
      ].filter(Boolean) as string[]
    };
  });
}

export function sortScoredCandidates(scored: { candidate_id: string; score: number; reasoning: string }[]) {
  return [...scored].sort((a,b) => b.score - a.score);
}

export function selectTopK(scored: { candidate_id: string; score: number; reasoning: string }[], k: number) {
  const top = scored.slice(0, k).map((item, idx) => ({ ...item, rank: idx + 1 }));
  return top;
}

export default { parseJsonl, scoreCandidates, selectTopK };
