# TalentMatch AI 🚀

**TalentMatch AI** is a production-ready, two-stage recruitment engine that replaces rigid keyword matching with deep semantic talent analysis. Built on the Gemini API ecosystem and deployed securely to Google Cloud Run, it evaluates actual engineering experience over surface-level text strings.

## 🏆 What Makes It Unique

* **Two-Stage Hybrid Funnel:** It splits computational workloads efficiently. A high-speed vector embedding layer (`gemini-embedding-001`) instantly screens the entire dataset using Cosine Similarity, while a contextual LLM layer (`gemini-3.5-flash`) performs deep behavioral re-ranking on the top matches.
* **Explainable AI (XAI):** It goes beyond blind percentages. The platform outputs structured JSON justifications, rendering custom **AI Recruiter Insights** that map hidden conceptual bridges (e.g., connecting "distributed data pipelines" to "database scalability").
* **Production-Grade Resilience:** To handle heavy judging traffic, the backend implements an autonomous fault-tolerant loop. If the primary model experiences a traffic bottleneck, it instantly switches the payload to `gemini-3.1-flash-lite`, ensuring 100% application uptime.
* **Zero-Trust Security:** The React UI is completely decoupled from the Node.js backend. Sensitive API credentials reside strictly in private server environment variables, preventing client-side exposure.

---

## 🛠️ Local Development Setup

### Prerequisites
Ensure you have **Node.js** installed on your machine.

### 1. Configure Environment Variables
Navigate into your `backend/` directory and create a `.env` file:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
