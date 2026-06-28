import React, { useState, useEffect } from "react";
import { 
  Briefcase, 
  Users, 
  Award, 
  Plus, 
  Trash2, 
  RotateCcw, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  ChevronRight, 
  MapPin, 
  Mail, 
  Phone, 
  BookOpen, 
  Star, 
  AlertTriangle, 
  Sparkles, 
  ArrowLeft,
  Search,
  Filter,
  Check,
  FileText,
  Atom
} from "lucide-react";
import { Candidate, RankingResult, AnalyzeResponse, UploadPreview, RankingRow, ValidationReport } from "./types";
import DatasetUpload from "./components/DatasetUpload";
import TopResults from "./components/TopResults";
import { JD_TEMPLATES } from "./templates";

export default function App() {
  // Navigation & Core States
  const [activeTab, setActiveTab] = useState<"job-board" | "shortlist">("job-board");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateTotal, setCandidateTotal] = useState<number>(0);
  const [jobDescription, setJobDescription] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [rankings, setRankings] = useState<RankingResult[]>([]);
  const [auditInfo, setAuditInfo] = useState<{ uploaded: number; scored: number; ranked: number; exported: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState<boolean>(false);
  const [usedModelName, setUsedModelName] = useState<string>("");

  // Candidate Pool Drawer / Management States
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // New Candidate Form State
  const [newCandidate, setNewCandidate] = useState({
    name: "",
    title: "",
    experienceYears: 4,
    skills: "",
    education: "",
    location: "",
    email: "",
    phone: "",
    summary: ""
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Selected Ranked Candidate for Detailed View
  const [selectedRanking, setSelectedRanking] = useState<RankingResult | null>(null);
  const [detailTab, setDetailTab] = useState<"ai-match" | "history" | "redrob-signals">("ai-match");
  const [isInsightsExpanded, setIsInsightsExpanded] = useState<boolean>(true);

  // Reset detail tab when selected candidate changes
  useEffect(() => {
    setDetailTab("ai-match");
    setIsInsightsExpanded(true);
  }, [selectedRanking]);

  // Initial Fetch of candidates
  useEffect(() => {
    fetchCandidates();
  }, []);

  const [uploadPreview, setUploadPreview] = useState<UploadPreview | null>(null);
  const [topRows, setTopRows] = useState<RankingRow[]>([]);

  const fetchCandidates = async (page = 1, pageSize = 100) => {
    try {
      const res = await fetch(`/api/candidates?page=${page}&pageSize=${pageSize}`);
      if (!res.ok) throw new Error("Failed to load candidates pool");
      const data = await res.json();
      setCandidates(data.candidates || []);
      setCandidateTotal(Number(data.total ?? (data.candidates?.length ?? 0)));
    } catch (err: any) {
      setError(err.message || "Could not retrieve candidates pool.");
    }
  };

  // Select a JD Template
  const handleSelectTemplate = (desc: string) => {
    setJobDescription(desc);
    setError(null);
  };

  // Reset candidate pool to seed data
  const handleResetPool = async () => {
    if (!window.confirm("Are you sure you want to reset the candidate database to the default pool? Any custom profiles added will be deleted.")) {
      return;
    }
    setIsResetting(true);
    try {
      const res = await fetch("/api/candidates/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset candidates database");
      const data = await res.json();
      setCandidates(data.candidates);
      setCandidateTotal(Number(data.total ?? data.candidates?.length ?? 0));
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to reset candidate database.");
    } finally {
      setIsResetting(false);
    }
  };

  // Add Candidate Handler
  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!newCandidate.name.trim() || !newCandidate.title.trim() || !newCandidate.summary.trim()) {
      setFormError("Please fill out Name, Professional Title, and Summary.");
      return;
    }

    const skillsArray = newCandidate.skills
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCandidate,
          skills: skillsArray
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save candidate profile");
      }

      const savedCandidate = await res.json();
      setCandidates(prev => [savedCandidate, ...prev]);
      
      // Reset form
      setNewCandidate({
        name: "",
        title: "",
        experienceYears: 4,
        skills: "",
        education: "",
        location: "",
        email: "",
        phone: "",
        summary: ""
      });
      setShowAddModal(false);
    } catch (err: any) {
      setFormError(err.message || "Failed to create candidate profile.");
    }
  };

  // Delete candidate handler
  const handleDeleteCandidate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to remove this candidate profile?")) return;

    try {
      const res = await fetch(`/api/candidates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete candidate profile");
      setCandidates(prev => prev.filter(c => c.id !== id));
      // Remove from active rankings too if present
      setRankings(prev => prev.filter(r => r.candidate.id !== id));
      if (selectedRanking?.candidate.id === id) {
        setSelectedRanking(null);
      }
    } catch (err: any) {
      setError(err.message || "Could not delete candidate profile.");
    }
  };

  // Rank / Match algorithm caller
  const handleAnalyzeAndRank = async () => {
    if (!jobDescription.trim()) {
      setError("Please paste or select a Job Description before matching.");
      return;
    }

    if (candidates.length === 0) {
      setError("Your candidate pool is empty. Please add candidates or reset to the pre-seeded pool.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      // Use the new Top-100 ranking workflow endpoint
      const res = await fetch("/api/rank-top100", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "AI Matching algorithm encountered an issue.");
      }

        const data = await res.json();
      const rows: RankingRow[] = data.top100 || [];
      const uploadedCount = Number(data.uploadedCandidates ?? data.audit?.uploaded ?? candidateTotal);
      const scoredCount = Number(data.scoredCandidates ?? data.audit?.scored ?? rows.length);
      const rankedCount = Number(data.rankedCandidates ?? data.audit?.ranked ?? rows.length);
      setTopRows(rows);
      setCandidateTotal(uploadedCount);
      setAuditInfo({
        uploaded: uploadedCount,
        scored: scoredCount,
        ranked: rankedCount,
        exported: null
      });
      const mapped: RankingResult[] = rows.map(r => ({ candidate: candidates.find(c=>c.id===r.candidate_id) || { id: r.candidate_id, name: r.candidate_id, title: '', experienceYears: 0, skills: [], education: '', location: '', email: '', phone: '', summary: '' }, match: { candidateId: r.candidate_id, score: r.score, overallFit: r.reasoning, strengths: [], gaps: [], recommendation: '', interviewQuestions: [], fitScore: r.score } }));
      setRankings(mapped);
      if (mapped.length > 0) setSelectedRanking(mapped[0]);
      setActiveTab("shortlist");
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during candidate matching analysis.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUploadPreview = (preview: UploadPreview) => {
    setUploadPreview(preview);
    fetchCandidates();
  };

  const handleDefaultLoaded = (total: number) => {
    setCandidateTotal(total);
    setUploadPreview(null);
    fetchCandidates();
  };

  const handleValidate = async (rows: RankingRow[]) : Promise<ValidationReport> => {
    const res = await fetch('/api/validate-submission', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
    if (!res.ok) {
      const d = await res.json().catch(()=>({ error: 'Validation request failed' }));
      throw new Error(d.error || 'Validation failed');
    }
    return res.json();
  };

  const handleExport = () => {
    // Trigger download from server
    window.location.href = '/api/export/csv';
  };

  // Filtered candidate list based on search bar
  const filteredCandidates = candidates.filter(c => {
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.skills.some(s => s.toLowerCase().includes(q))
    );
  });

  // Score badge helper color
  const getScoreBadgeStyles = (score: number) => {
    if (score >= 85) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (score >= 60) return "bg-indigo-50 text-indigo-700 border-indigo-200";
    if (score >= 30) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-rose-50 text-rose-700 border-rose-200";
  };

  const getScoreCircleStyles = (score: number) => {
    if (score >= 85) return "stroke-emerald-500 text-emerald-500";
    if (score >= 60) return "stroke-indigo-500 text-indigo-500";
    if (score >= 30) return "stroke-amber-500 text-amber-500";
    return "stroke-rose-500 text-rose-500";
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800 antialiased" id="talentmatch-app-root">
      
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs" id="app-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                TalentMatch <span className="text-xs bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded-full">AI Recruiter</span>
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">AI-powered candidate ranking and gap-analysis workspace</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button 
              id="view-job-board-btn"
              onClick={() => setActiveTab("job-board")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === "job-board"
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              1. Job Board
            </button>
            <button 
              id="view-shortlist-btn"
              onClick={() => {
                if (rankings.length === 0) {
                  alert("Please run candidate analysis on a Job Description first to view rankings.");
                  return;
                }
                setActiveTab("shortlist");
              }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1 ${
                activeTab === "shortlist"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              } ${rankings.length === 0 ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              2. Rankings ({rankings.length})
            </button>
          </div>
        </div>
      </header>

      {/* Main Alert Bar for API or application status errors */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-3 text-sm text-red-800" id="error-banner">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
            <button 
              onClick={() => setError(null)} 
              className="text-red-600 hover:text-red-800 font-semibold ml-4 underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Primary Layout Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8" id="main-content-layout">
        
        {/* VIEW 1: JOB BOARD AND CANDIDATES POOL SCREEN */}
        {activeTab === "job-board" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="job-board-view">
            
            {/* Left side: Job description input & Templates */}
            <div className="lg:col-span-8 flex flex-col space-y-6">
              
              {/* Card Container for JD */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="bg-amber-100 text-amber-800 p-1.5 rounded-md">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-900 text-lg">Job Description workspace</h2>
                      <p className="text-xs text-slate-500">Paste your raw requirement outline, qualifications, or official JD below</p>
                    </div>
                  </div>
                  
                  {/* Quick-fill template label */}
                  <span className="text-xs text-slate-400 font-medium hidden sm:block">Select role template below to speed up test</span>
                </div>

                {/* Grid of quick role templates */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1" id="jd-templates-grid">
                  {JD_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectTemplate(tpl.description)}
                      className="group text-left border border-slate-200 rounded-lg p-2.5 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all cursor-pointer"
                    >
                      <div className="text-xs font-bold text-slate-800 group-hover:text-indigo-700 flex items-center justify-between">
                        {tpl.title}
                        <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-indigo-600 transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <span className="text-[10px] text-slate-400">Click to load text</span>
                    </button>
                  ))}
                </div>

                {/* Main Textarea */}
                <div className="relative">
                  <textarea
                    id="job-description-input"
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="E.g., Position: Senior Fullstack Engineer... We are looking for someone with 5+ years experience in React, Node, and Tailwind CSS. Experience with AI APIs and Cloud deployments is highly valued..."
                    className="w-full min-h-[380px] p-4 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-800 placeholder-slate-400 resize-y font-mono"
                  ></textarea>
                  
                  {/* Text length counter & clear indicator */}
                  <div className="absolute bottom-3 right-3 flex items-center space-x-2 text-xs text-slate-400 bg-white px-2 py-1 rounded border border-slate-100">
                    <span>{jobDescription.length} characters</span>
                    {jobDescription && (
                      <button 
                        onClick={() => setJobDescription("")} 
                        className="text-rose-500 hover:text-rose-700 font-semibold"
                        title="Clear Text"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Rank Button */}
                <div className="pt-2 flex items-center justify-between">
                  <p className="text-xs text-slate-400 max-w-sm sm:max-w-md">
                    Matches your JD against <strong className="text-slate-600">Total Candidates Loaded: {candidateTotal}</strong> using deep contextual embedding and skills mapping.
                  </p>
                  
                  <button
                    id="analyze-and-rank-btn"
                    onClick={handleAnalyzeAndRank}
                    disabled={isAnalyzing || !jobDescription.trim()}
                    className={`px-6 py-3 font-semibold text-white rounded-lg shadow-sm transition-all duration-150 flex items-center space-x-2 shrink-0 ${
                      isAnalyzing || !jobDescription.trim()
                        ? "bg-indigo-400 cursor-not-allowed opacity-75"
                        : "bg-indigo-600 hover:bg-indigo-700 cursor-pointer active:scale-95"
                    }`}
                  >
                    {isAnalyzing ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        <span>Processing with AI...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-indigo-200" />
                        <span>Analyze and Rank Candidates</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Guide card to instruct first-time users */}
              <div className="bg-slate-100 border border-slate-200 rounded-xl p-5 flex items-start space-x-3.5">
                <div className="bg-indigo-100 text-indigo-700 p-2 rounded-lg shrink-0">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">How it works</h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Our AI models assess experience levels, core/adjacent skills, education, and resume summaries dynamically against your Job Description. It yields a matching score, clear alignment highlights, technical/culture gaps, and a customized list of interview questions.
                  </p>
                </div>
              </div>
            </div>

            {/* Right side: Active Candidates Database Manager */}
            <div className="lg:col-span-4 flex flex-col space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-full overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <DatasetUpload onUploaded={handleUploadPreview} onDefaultLoaded={handleDefaultLoaded} />
                </div>

                
                {/* Header of Database */}
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4 text-slate-500" />
                    <span className="font-bold text-slate-800 text-sm">Total Candidates Loaded: {candidateTotal}</span>
                  </div>
                  
                  <button
                    onClick={handleResetPool}
                    disabled={isResetting}
                    className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 font-semibold disabled:opacity-50"
                    title="Reset to pre-seeded candidates list"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>

                {/* Search Bar & Add trigger */}
                <div className="p-3 bg-white border-b border-slate-100 flex items-center space-x-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search pool skills or name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <button
                    id="add-candidate-trigger"
                    onClick={() => setShowAddModal(true)}
                    className="bg-slate-900 hover:bg-slate-800 text-white p-1.5 rounded text-xs flex items-center space-x-1 font-semibold cursor-pointer shrink-0"
                    title="Add manual candidate profile to database"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Add Profile</span>
                  </button>
                </div>

                {/* Candidate Pool List */}
                <div className="flex-1 overflow-y-auto max-h-[480px] divide-y divide-slate-100" id="candidates-pool-list">
                  {filteredCandidates.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      No matching candidate found in pool.
                    </div>
                  ) : (
                    filteredCandidates.map((c) => (
                      <div 
                        key={c.id} 
                        className="p-3.5 hover:bg-slate-50 transition-all flex items-start justify-between group"
                      >
                        <div className="space-y-1 pr-2">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-semibold text-slate-900 text-sm leading-none">{c.name}</h4>
                            {c.isCustom && (
                              <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-1 rounded">Custom</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 font-medium">{c.title}</p>
                          <div className="flex flex-wrap gap-1 pt-1">
                            <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-mono">
                              {c.experienceYears} yrs exp
                            </span>
                            <span className="text-slate-400 text-[10px] flex items-center font-mono">
                              <MapPin className="w-2.5 h-2.5 mr-0.5 shrink-0" />
                              {c.location}
                            </span>
                          </div>
                          
                          {/* Top 3 skills preview */}
                          <div className="flex flex-wrap gap-1 pt-1.5">
                            {c.skills.slice(0, 4).map((skill, index) => (
                              <span key={index} className="bg-indigo-50 text-indigo-700 text-[9px] px-1 py-0.2 rounded">
                                {skill}
                              </span>
                            ))}
                            {c.skills.length > 4 && (
                              <span className="text-slate-400 text-[9px] font-semibold self-center">
                                +{c.skills.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Delete Candidate profile */}
                        <button
                          onClick={(e) => handleDeleteCandidate(c.id, e)}
                          className="text-slate-300 hover:text-rose-600 p-1.5 rounded hover:bg-rose-50 transition-colors shrink-0 cursor-pointer md:opacity-0 group-hover:opacity-100"
                          title="Remove from candidate database"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 text-center">
                  Scroll to view pool. Recruiter data is kept in-memory server-side.
                </div>
              </div>
            </div>

          </div>
        )}

        {/* VIEW 2: RANKINGS AND SHORTLIST DASHBOARD SCREEN */}
        {activeTab === "shortlist" && (
          <div className="flex flex-col space-y-6 animate-fade-in" id="shortlist-view">
            
            {/* Top overview metrics & switchback block */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start space-x-3.5">
                <button
                  onClick={() => setActiveTab("job-board")}
                  className="bg-slate-100 hover:bg-slate-200 p-2.5 rounded-lg text-slate-700 transition-colors cursor-pointer shrink-0"
                  title="Return to Job Description editor"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    AI Talent Match Results
                    <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-bold">Matched Successfully</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 max-w-xl">
                    Top 100 ranked candidates from <strong className="text-slate-700">Total Candidates Loaded: {auditInfo?.uploaded ?? candidateTotal}</strong>. Double-click any profile card to inspect detailed gap analysis and interview questions.
                  </p>
              {auditInfo && (
                <p className="text-xs text-slate-500 mt-1 max-w-xl">
                  Total Candidates Loaded: <strong>{auditInfo.uploaded}</strong> · Scored Candidates: <strong>{auditInfo.scored}</strong> · Top 100 Ranked Candidates: <strong>{auditInfo.ranked}</strong>. {auditInfo.uploaded === auditInfo.scored ? <span className="font-semibold text-emerald-700">✓ Full Dataset Ranking Verified</span> : <span className="font-semibold text-amber-700">Partial dataset check failed</span>}
                </p>
              )}
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => setActiveTab("job-board")}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Edit Job Description
                </button>
                <button
                  onClick={handleAnalyzeAndRank}
                  disabled={isAnalyzing}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-semibold rounded-lg shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  {isAnalyzing ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                      <span>Re-analyzing...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      <span>Re-Run AI Model</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Top 100 Table */}
            <div>
              <TopResults rows={topRows} onValidate={handleValidate} onExport={handleExport} />
            </div>

            {/* Main Ranking Split Dashboard */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="dashboard-rankings-panel">
              
              {/* Left Column: Sorted Candidates List (40% width) */}
              <div className="lg:col-span-5 flex flex-col space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">Sorted Candidates List</h3>
                
                <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1" id="ranked-shortlist-scroll">
                  {rankings.map((rank, index) => {
                    const isSelected = selectedRanking?.candidate.id === rank.candidate.id;
                    const fitScore = rank.match.fitScore ?? rank.match.score;
                    
                    return (
                      <div
                        id={`ranked-card-${rank.candidate.id}`}
                        key={rank.candidate.id}
                        onClick={() => setSelectedRanking(rank)}
                        className={`border rounded-xl p-4 transition-all duration-150 cursor-pointer text-left relative flex items-start space-x-3.5 ${
                          isSelected 
                            ? "bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500" 
                            : "bg-white border-slate-200 hover:border-slate-300 shadow-xs"
                        }`}
                      >
                        {/* Numerical Placement Badge */}
                        <div className="absolute top-3.5 right-3.5 flex items-center space-x-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            index === 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                          }`}>
                            Rank #{index + 1}
                          </span>
                        </div>

                        {/* Circle Score Badge */}
                        <div className="shrink-0 flex flex-col items-center justify-center">
                          <div className="relative w-12 h-12 flex items-center justify-center">
                            {/* Simple circular background progress */}
                            <svg className="absolute w-full h-full transform -rotate-90">
                              <circle 
                                cx="24" 
                                cy="24" 
                                r="20" 
                                className="stroke-slate-100 fill-none" 
                                strokeWidth="3" 
                              />
                              <circle 
                                cx="24" 
                                cy="24" 
                                r="20" 
                                className={`fill-none transition-all duration-1000 ${getScoreCircleStyles(fitScore)}`}
                                strokeWidth="3.5" 
                                strokeDasharray="125.6"
                                strokeDashoffset={125.6 - (125.6 * fitScore) / 100}
                              />
                            </svg>
                            <span className="font-mono text-sm font-bold text-slate-800">{fitScore}</span>
                          </div>
                          <span className="text-[9px] text-slate-400 font-bold mt-1">FIT</span>
                        </div>

                        {/* Summary Block */}
                        <div className="space-y-1 flex-1 pr-14">
                          <h4 className="font-bold text-slate-900 text-base flex items-center gap-2 flex-wrap">
                            <span>{rank.candidate.name}</span>
                            <span className={`inline-flex items-center justify-center w-5.5 h-5.5 rounded-full text-[10px] font-extrabold border shrink-0 ${
                              fitScore >= 85
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : fitScore >= 70
                                ? "bg-amber-100 text-amber-800 border-amber-300"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`} title={`AI Fit Score: ${fitScore}%`}>
                              {fitScore}
                            </span>
                          </h4>
                          <p className="text-xs text-slate-600 font-semibold">{rank.candidate.title}</p>
                          
                          <div className="flex items-center space-x-2 pt-1 text-[11px] text-slate-400 font-medium">
                            <span className="bg-slate-100 px-1.5 py-0.2 rounded text-slate-600 font-mono">
                              {rank.candidate.experienceYears} yrs
                            </span>
                            <span>•</span>
                            <span className="truncate">{rank.candidate.location}</span>
                          </div>

                          <div className="text-[11px] font-semibold text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded inline-block mt-2">
                            Rec: {rank.match.recommendation}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: AI Insights & Detailed Analysis (60% width) */}
              <div className="lg:col-span-7" id="rankings-detail-pane">
                {selectedRanking ? (
                  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
                    
                    {/* Header Candidate Summary Card */}
                    <div className="border-b border-slate-100 pb-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h3 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5 flex-wrap">
                            <span>{selectedRanking.candidate.name}</span>
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-extrabold border shrink-0 ${
                              (selectedRanking.match.fitScore ?? selectedRanking.match.score) >= 85
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : (selectedRanking.match.fitScore ?? selectedRanking.match.score) >= 70
                                ? "bg-amber-100 text-amber-800 border-amber-300"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`} title={`AI Fit Score: ${selectedRanking.match.fitScore ?? selectedRanking.match.score}%`}>
                              {selectedRanking.match.fitScore ?? selectedRanking.match.score}
                            </span>
                          </h3>
                          <p className="text-sm font-semibold text-indigo-600 mt-0.5">{selectedRanking.candidate.title}</p>
                        </div>

                        {/* Overall Score Highlight */}
                        <div className={`border rounded-lg px-4 py-2 text-center shrink-0 flex flex-col justify-center ${getScoreBadgeStyles(selectedRanking.match.fitScore ?? selectedRanking.match.score)}`}>
                          <span className="text-[10px] font-bold uppercase tracking-wider">Overall Match Score</span>
                          <span className="text-2xl font-extrabold font-mono leading-none mt-1">{selectedRanking.match.fitScore ?? selectedRanking.match.score} %</span>
                        </div>
                      </div>

                      {/* Bio Meta details */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[10px] text-slate-400 block font-bold uppercase">Experience</span>
                          <span className="text-slate-800 font-semibold mt-1 block">{selectedRanking.candidate.experienceYears} Years</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[10px] text-slate-400 block font-bold uppercase">Location</span>
                          <span className="text-slate-800 font-semibold mt-1 block truncate">{selectedRanking.candidate.location}</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[10px] text-slate-400 block font-bold uppercase">Email</span>
                          <span className="text-slate-800 font-semibold mt-1 block truncate">{selectedRanking.candidate.email}</span>
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          <span className="text-[10px] text-slate-400 block font-bold uppercase">Phone</span>
                          <span className="text-slate-800 font-semibold mt-1 block truncate">{selectedRanking.candidate.phone}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <span className="text-[10px] text-slate-400 block font-bold uppercase">Resume Summary Preview</span>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                          "{selectedRanking.candidate.summary}"
                        </p>
                      </div>

                      <div className="mt-4">
                        <span className="text-[10px] text-slate-400 block font-bold uppercase mb-1">Declared Candidate Skills</span>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedRanking.candidate.skills.map((skill, sIdx) => (
                            <span key={sIdx} className="bg-slate-100 border border-slate-200 text-slate-700 text-xs px-2.5 py-0.5 rounded-full font-medium">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* ✨ AI Recruiter Insights Interactive Callout Card */}
                      <div 
                        onClick={() => setIsInsightsExpanded(!isInsightsExpanded)}
                        className="mt-5 bg-slate-950 text-slate-100 rounded-xl p-4 border border-slate-800 shadow-md transition-all duration-250 hover:bg-slate-900 cursor-pointer relative overflow-hidden group select-none"
                      >
                        {/* Interactive glow effect */}
                        <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-indigo-500/10 blur-xl group-hover:bg-indigo-500/20 transition-all duration-500" />
                        
                        <div className="flex items-start space-x-3.5 relative z-10">
                          <div className="bg-indigo-500/10 text-indigo-300 p-2 rounded-lg border border-indigo-500/30 shrink-0">
                            <Atom className="w-5 h-5 animate-spin" style={{ animationDuration: '8s' }} />
                          </div>
                          
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold tracking-wide text-white flex items-center gap-2">
                                <span>✨ AI Recruiter Insights</span>
                                <span className="bg-indigo-500/20 text-indigo-200 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider font-mono">
                                  Semantic Analysis
                                </span>
                              </h4>
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider group-hover:text-indigo-400 transition-colors">
                                {isInsightsExpanded ? "Click to hide" : "Click to view"}
                              </span>
                            </div>
                            
                            {isInsightsExpanded && (
                              <p className="text-xs text-slate-300 leading-relaxed pt-2 font-medium animate-fade-in">
                                {selectedRanking.match.semanticReasoning || selectedRanking.match.overallFit}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Navigation Tabs for Details */}
                    {selectedRanking.candidate.redrobData && (
                      <div className="flex border-b border-slate-200 bg-slate-50 p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setDetailTab("ai-match")}
                          className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            detailTab === "ai-match"
                              ? "bg-white text-indigo-700 shadow-xs"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          AI Match Analysis
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailTab("history")}
                          className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            detailTab === "history"
                              ? "bg-white text-indigo-700 shadow-xs"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Career & Education
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailTab("redrob-signals")}
                          className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                            detailTab === "redrob-signals"
                              ? "bg-white text-indigo-700 shadow-xs"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          <Users className="w-3.5 h-3.5" />
                          Redrob Signals
                        </button>
                      </div>
                    )}

                    {/* Tab 1: AI Assessment Sections */}
                    {detailTab === "ai-match" && (
                      <div className="space-y-5">
                        
                        {/* Overall Recruitment Assessment */}
                        <div className="space-y-1.5">
                          <div className="flex items-center space-x-2 text-slate-950">
                            <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                            <h4 className="font-bold text-sm uppercase tracking-wide">
                              {selectedRanking.match.semanticReasoning ? "Semantic Fit Reasoning" : "Recruiting Analyst Verdict"}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-700 bg-indigo-50/30 border border-indigo-100/50 p-3.5 rounded-lg leading-relaxed">
                            {selectedRanking.match.semanticReasoning || selectedRanking.match.overallFit}
                          </p>
                        </div>

                        {/* Potential Risks / Recruiting Considerations */}
                        {selectedRanking.match.potentialRisks && (
                          <div className="bg-rose-50/40 border border-rose-100/80 rounded-lg p-4 space-y-2">
                            <div className="flex items-center space-x-1.5 text-rose-800 font-bold text-xs uppercase tracking-wide">
                              <AlertCircle className="w-4 h-4 text-rose-600" />
                              <span>Potential Recruiting Risks & Considerations</span>
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed pl-1">
                              {selectedRanking.match.potentialRisks}
                            </p>
                          </div>
                        )}

                        {/* Side by side: Strengths and Gaps */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          
                          {/* Strengths */}
                          <div className="bg-emerald-50/40 border border-emerald-100/80 rounded-lg p-4 space-y-2">
                            <div className="flex items-center space-x-1.5 text-emerald-800 font-bold text-xs uppercase tracking-wide">
                              <Star className="w-4 h-4 text-emerald-600 fill-emerald-100" />
                              <span>Aligned Strengths</span>
                            </div>
                            <ul className="space-y-1.5">
                              {selectedRanking.match.strengths.map((str, sIdx) => (
                                <li key={sIdx} className="text-xs text-slate-700 flex items-start">
                                  <span className="text-emerald-500 font-bold mr-1.5 shrink-0">✓</span>
                                  <span>{str}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Gaps */}
                          <div className="bg-amber-50/40 border border-amber-100/80 rounded-lg p-4 space-y-2">
                            <div className="flex items-center space-x-1.5 text-amber-800 font-bold text-xs uppercase tracking-wide">
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                              <span>Qualification Gaps</span>
                            </div>
                            <ul className="space-y-1.5">
                              {selectedRanking.match.gaps.map((gap, gIdx) => (
                                <li key={gIdx} className="text-xs text-slate-700 flex items-start">
                                  <span className="text-amber-500 font-bold mr-1.5 shrink-0">⚠</span>
                                  <span>{gap}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                        </div>

                        {/* Actionable Recruiting recommendation */}
                        <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-lg flex items-center justify-between">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-bold uppercase">Candidate Decision Advice</span>
                            <span className="text-sm font-bold text-slate-800 mt-1 block">{selectedRanking.match.recommendation}</span>
                          </div>
                          <div className="bg-white border border-slate-200 text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-600">
                            Active Status
                          </div>
                        </div>

                        {/* Tailored Interview Questions */}
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Sparkles className="w-4 h-4 text-indigo-600" />
                              <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide">Tailored Probe Questions ({selectedRanking.match.interviewQuestions.length})</h4>
                            </div>
                            <span className="text-[10px] text-slate-400 font-medium">Auto-generated relative to JD gaps</span>
                          </div>

                          <div className="space-y-2.5">
                            {selectedRanking.match.interviewQuestions.map((q, qIdx) => (
                              <div key={qIdx} className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex items-start space-x-2.5 hover:bg-slate-100/50 transition-colors">
                                <span className="bg-slate-200 text-slate-700 w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                                  {qIdx + 1}
                                </span>
                                <p className="text-xs text-slate-700 leading-relaxed font-medium">"{q}"</p>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}

                    {/* Tab 2: Detailed History */}
                    {detailTab === "history" && selectedRanking.candidate.redrobData && (
                      <div className="space-y-6">
                        {/* Career History */}
                        <div className="space-y-4">
                          <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide flex items-center gap-1.5 border-b border-slate-100 pb-2">
                            <Briefcase className="w-4 h-4 text-indigo-600" />
                            Career History
                          </h4>
                          {selectedRanking.candidate.redrobData.career_history && selectedRanking.candidate.redrobData.career_history.length > 0 ? (
                            <div className="space-y-4">
                              {selectedRanking.candidate.redrobData.career_history.map((job: any, jIdx: number) => (
                                <div key={jIdx} className="relative pl-5 border-l-2 border-indigo-100 space-y-1.5">
                                  <div className="absolute -left-[6px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500"></div>
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                    <h5 className="font-semibold text-slate-900 text-sm">{job.title}</h5>
                                    <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-600 font-mono">
                                      {job.start_date} to {job.end_date || "Present"} ({job.duration_months} mo)
                                    </span>
                                  </div>
                                  <p className="text-xs font-semibold text-indigo-600">{job.company} • <span className="text-slate-400 font-normal">{job.industry} ({job.company_size} employees)</span></p>
                                  {job.description && (
                                    <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2.5 rounded border border-slate-100 whitespace-pre-wrap">{job.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No career history records reported.</p>
                          )}
                        </div>

                        {/* Education */}
                        <div className="space-y-4">
                          <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide flex items-center gap-1.5 border-b border-slate-100 pb-2">
                            <BookOpen className="w-4 h-4 text-indigo-600" />
                            Education Detail
                          </h4>
                          {selectedRanking.candidate.redrobData.education && selectedRanking.candidate.redrobData.education.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {selectedRanking.candidate.redrobData.education.map((edu: any, eIdx: number) => (
                                <div key={eIdx} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                                  <h5 className="font-semibold text-slate-900 text-xs">{edu.degree} in {edu.field_of_study}</h5>
                                  <p className="text-xs text-slate-700">{edu.institution}</p>
                                  <div className="flex justify-between text-[10px] text-slate-500 font-mono pt-1">
                                    <span>Graduation: {edu.end_year}</span>
                                    <span>Grade: {edu.grade || "N/A"}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 italic">No education records reported.</p>
                          )}
                        </div>

                        {/* Languages */}
                        {selectedRanking.candidate.redrobData.languages && selectedRanking.candidate.redrobData.languages.length > 0 && (
                          <div className="space-y-3">
                            <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider">Languages</h4>
                            <div className="flex flex-wrap gap-2">
                              {selectedRanking.candidate.redrobData.languages.map((lang: any, lIdx: number) => (
                                <span key={lIdx} className="bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded border border-slate-200 font-medium">
                                  {lang.language} • <span className="text-indigo-600 font-semibold capitalize">{lang.proficiency}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 3: Redrob Signals */}
                    {detailTab === "redrob-signals" && selectedRanking.candidate.redrobData && (
                      <div className="space-y-6">
                        {/* Redrob Status Signals Grid */}
                        <div>
                          <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wide flex items-center gap-1.5 border-b border-slate-100 pb-2 mb-4">
                            <Users className="w-4 h-4 text-indigo-600" />
                            Activity & Engagement Signals
                          </h4>
                          
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Profile Completeness</span>
                              <div className="mt-1 flex items-baseline gap-1">
                                <span className="text-lg font-extrabold text-slate-800">{selectedRanking.candidate.redrobData.redrob_signals?.profile_completeness_score}%</span>
                              </div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Work Preference</span>
                              <span className="mt-1 text-sm font-bold text-slate-800 capitalize">{selectedRanking.candidate.redrobData.redrob_signals?.preferred_work_mode || "N/A"}</span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Open to Work</span>
                              <span className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full inline-block w-fit ${
                                selectedRanking.candidate.redrobData.redrob_signals?.open_to_work_flag
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}>
                                {selectedRanking.candidate.redrobData.redrob_signals?.open_to_work_flag ? "YES" : "NO"}
                              </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Willing to Relocate</span>
                              <span className="mt-1 text-sm font-bold text-slate-800">
                                {selectedRanking.candidate.redrobData.redrob_signals?.willing_to_relocate ? "Yes" : "No"}
                              </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Notice Period</span>
                              <span className="mt-1 text-sm font-bold text-slate-800">
                                {selectedRanking.candidate.redrobData.redrob_signals?.notice_period_days !== undefined
                                  ? `${selectedRanking.candidate.redrobData.redrob_signals.notice_period_days} Days`
                                  : "N/A"}
                              </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Github Activity</span>
                              <span className="mt-1 text-sm font-bold text-indigo-600">
                                {selectedRanking.candidate.redrobData.redrob_signals?.github_activity_score !== undefined
                                  ? `${selectedRanking.candidate.redrobData.redrob_signals.github_activity_score} / 10`
                                  : "N/A"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Recruiter Response and Funnel Analytics */}
                        <div>
                          <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider mb-2.5">Recruiting Funnel & Response Metrics</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="bg-indigo-50/40 border border-indigo-100/50 rounded-lg p-3.5 space-y-2">
                              <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>Recruiter Response Rate:</span>
                                <span className="font-bold text-slate-800">{Math.round((selectedRanking.candidate.redrobData.redrob_signals?.recruiter_response_rate || 0) * 100)}%</span>
                              </div>
                              <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>Avg Response Time:</span>
                                <span className="font-bold text-slate-800">{selectedRanking.candidate.redrobData.redrob_signals?.avg_response_time_hours || "N/A"} hours</span>
                              </div>
                              <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>Last Active On Platform:</span>
                                <span className="font-bold text-slate-800">{selectedRanking.candidate.redrobData.redrob_signals?.last_active_date || "N/A"}</span>
                              </div>
                            </div>

                            <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-3.5 space-y-2">
                              <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>Interview Completion:</span>
                                <span className="font-bold text-slate-800">{Math.round((selectedRanking.candidate.redrobData.redrob_signals?.interview_completion_rate || 0) * 100)}%</span>
                              </div>
                              <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>Offer Acceptance Rate:</span>
                                <span className="font-bold text-slate-800">{Math.round((selectedRanking.candidate.redrobData.redrob_signals?.offer_acceptance_rate || 0) * 100)}%</span>
                              </div>
                              <div className="flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>Connections Count:</span>
                                <span className="font-bold text-slate-800">{selectedRanking.candidate.redrobData.redrob_signals?.connection_count || 0}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Verified Status Indicators */}
                        <div className="flex flex-wrap gap-2 bg-slate-50 p-2.5 rounded-lg justify-around text-[11px] font-bold text-slate-500">
                          <span className="flex items-center gap-1">
                            <span className={`w-2 h-2 rounded-full inline-block ${selectedRanking.candidate.redrobData.redrob_signals?.verified_email ? "bg-emerald-500" : "bg-slate-300"}`}></span>
                            Email Verified
                          </span>
                          <span className="flex items-center gap-1">
                            <span className={`w-2 h-2 rounded-full inline-block ${selectedRanking.candidate.redrobData.redrob_signals?.verified_phone ? "bg-emerald-500" : "bg-slate-300"}`}></span>
                            Phone Verified
                          </span>
                          <span className="flex items-center gap-1">
                            <span className={`w-2 h-2 rounded-full inline-block ${selectedRanking.candidate.redrobData.redrob_signals?.linkedin_connected ? "bg-indigo-500" : "bg-slate-300"}`}></span>
                            LinkedIn Connected
                          </span>
                        </div>

                        {/* Verified Skill Assessments */}
                        {selectedRanking.candidate.redrobData.redrob_signals?.skill_assessment_scores && (
                          <div>
                            <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider mb-3">Redrob Verified Assessment Scores</h4>
                            <div className="space-y-3">
                              {Object.entries(selectedRanking.candidate.redrobData.redrob_signals.skill_assessment_scores).map(([skill, score]: [string, any]) => (
                                <div key={skill} className="space-y-1">
                                  <div className="flex justify-between text-xs font-semibold text-slate-700">
                                    <span>{skill}</span>
                                    <span>{score} %</span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${score}%` }}></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 shadow-xs flex flex-col items-center justify-center space-y-2">
                    <Users className="w-10 h-10 text-slate-300" />
                    <p className="text-sm">Select a candidate on the left to see advanced match analysis.</p>
                  </div>
                )}
              </div>

            </div>

            {/* Fallback routing disclaimer */}
            {isFallback && (
              <div className="flex items-center justify-center pt-4" id="fallback-routing-disclaimer">
                <div className="inline-flex items-center space-x-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold px-4 py-2 rounded-full shadow-xs animate-pulse">
                  <span>⚡ Processing optimized via ultra-fast backup routing</span>
                  <span className="bg-amber-100 text-[10px] text-amber-950 px-1.5 py-0.5 rounded font-mono uppercase font-black">
                    {usedModelName || "gemini-3.1-flash-lite"}
                  </span>
                </div>
              </div>
            )}

          </div>
        )}

      </main>

      {/* FOOTER AREA */}
      <footer className="mt-auto bg-white border-t border-slate-200 py-6" id="app-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            &copy; 2026 TalentMatch AI. Total Candidates Loaded: <strong className="text-slate-500 font-medium">{candidateTotal}</strong>.
          </div>
          <div className="flex items-center space-x-4">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block"></span> 
              Cloud service active
            </span>
            <span>|</span>
            <span className="text-slate-400">Gemini model: models/gemini-3.5-flash</span>
          </div>
        </div>
      </footer>

      {/* MODAL: ADD CUSTOM CANDIDATE PROFILE */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" id="add-candidate-modal">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-sm">Add New Candidate Profile</h3>
              </div>
              <button 
                onClick={() => {
                  setShowAddModal(false);
                  setFormError(null);
                }} 
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleAddCandidate} className="p-5 space-y-3.5 flex-1 overflow-y-auto max-h-[75vh]">
              {formError && (
                <div className="p-2.5 bg-rose-50 text-rose-700 text-xs rounded border border-rose-100">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={newCandidate.name}
                    onChange={(e) => setNewCandidate(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Professional Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Senior Backend Engineer"
                    value={newCandidate.title}
                    onChange={(e) => setNewCandidate(prev => ({ ...prev, title: e.target.value }))}
                    className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Experience (Years) *</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    required
                    value={newCandidate.experienceYears}
                    onChange={(e) => setNewCandidate(prev => ({ ...prev, experienceYears: Number(e.target.value) }))}
                    className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Location *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Chicago, IL"
                    value={newCandidate.location}
                    onChange={(e) => setNewCandidate(prev => ({ ...prev, location: e.target.value }))}
                    className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Email Address</label>
                  <input
                    type="email"
                    placeholder="john@example.com"
                    value={newCandidate.email}
                    onChange={(e) => setNewCandidate(prev => ({ ...prev, email: e.target.value }))}
                    className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase">Phone Number</label>
                  <input
                    type="text"
                    placeholder="+1 (555) 987-6543"
                    value={newCandidate.phone}
                    onChange={(e) => setNewCandidate(prev => ({ ...prev, phone: e.target.value }))}
                    className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Education / Certifications</label>
                <input
                  type="text"
                  placeholder="e.g. M.S. in Computer Science, Stanford"
                  value={newCandidate.education}
                  onChange={(e) => setNewCandidate(prev => ({ ...prev, education: e.target.value }))}
                  className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Core Skills (Comma separated) *</label>
                <input
                  type="text"
                  placeholder="React, TypeScript, Go, PostgreSQL, AWS"
                  value={newCandidate.skills}
                  onChange={(e) => setNewCandidate(prev => ({ ...prev, skills: e.target.value }))}
                  className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
                />
                <span className="text-[10px] text-slate-400 block mt-1">Separate skills with commas (e.g., Python, Docker, PyTorch)</span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase">Professional Summary / Bio *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Write a clear professional biography. E.g., Senior Fullstack Developer with 6 years experience specializing in cloud infrastructure, responsive design systems, and database scaling."
                  value={newCandidate.summary}
                  onChange={(e) => setNewCandidate(prev => ({ ...prev, summary: e.target.value }))}
                  className="mt-1 w-full p-2 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50 focus:bg-white resize-none"
                ></textarea>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setFormError(null);
                  }}
                  className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded shadow-xs cursor-pointer"
                >
                  Save Profile
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
