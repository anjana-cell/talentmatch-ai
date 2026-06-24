import { Candidate } from "./types";

export const initialCandidates: Candidate[] = [
  {
    id: "cand-1",
    name: "Sarah Jenkins",
    title: "Senior Frontend Engineer",
    experienceYears: 7,
    skills: ["React", "TypeScript", "Tailwind CSS", "Next.js", "Redux Toolkit", "Vite", "HTML5/CSS3", "Jest", "CI/CD", "Figma to Code"],
    education: "B.S. in Computer Science, Boston University",
    location: "Boston, MA (Hybrid)",
    email: "sarah.jenkins@talentmatch.ai",
    phone: "+1 (555) 123-4567",
    summary: "Senior Frontend Developer with over 7 years of experience building responsive, highly interactive web applications. Expert in React and modern CSS systems. Deeply passionate about user experience, animation, performance optimization, and maintaining clean, accessible codebases."
  },
  {
    id: "cand-2",
    name: "David Chen",
    title: "Principal Software Engineer (Backend)",
    experienceYears: 10,
    skills: ["Node.js", "Go (Golang)", "PostgreSQL", "Kubernetes", "AWS (EC2/RDS/S3)", "Redis", "gRPC", "Docker", "Microservices", "System Architecture"],
    education: "M.S. in Software Engineering, Carnegie Mellon University",
    location: "San Francisco, CA (Remote)",
    email: "david.chen@talentmatch.ai",
    phone: "+1 (555) 234-5678",
    summary: "Principal Backend Developer with a decade of expertise designing and scaling distributed systems, cloud microservices, and high-performance databases. Specialized in handling high-throughput APIs, data migration, and DevOps orchestration under Kubernetes."
  },
  {
    id: "cand-3",
    name: "Elena Rostova",
    title: "Lead AI/ML & Data Scientist",
    experienceYears: 6,
    skills: ["Python", "PyTorch", "TensorFlow", "Generative AI", "Large Language Models (LLMs)", "Scikit-Learn", "SQL", "Pandas/NumPy", "NLP", "Data Visualization"],
    education: "Ph.D. in Applied Mathematics, Stanford University",
    location: "Palo Alto, CA (On-site)",
    email: "elena.rostova@talentmatch.ai",
    phone: "+1 (555) 345-6789",
    summary: "Lead Data Scientist and ML Engineer with extensive research and practical experience in LLM fine-tuning, retrieval-augmented generation (RAG), and neural networks. Skilled in translating complex business problems into production-grade predictive and generative AI pipelines."
  },
  {
    id: "cand-4",
    name: "Marcus Vance",
    title: "Senior DevOps & Cloud Infrastructure Engineer",
    experienceYears: 8,
    skills: ["AWS", "Terraform", "GitHub Actions", "Docker", "Linux (Ubuntu/RHEL)", "Bash", "Prometheus", "Grafana", "Nginx", "IAM & Security"],
    education: "B.S. in Information Technology, University of Texas at Austin",
    location: "Austin, TX (Hybrid)",
    email: "marcus.vance@talentmatch.ai",
    phone: "+1 (555) 456-7890",
    summary: "Senior Infrastructure Engineer specializing in Infrastructure as Code (IaC) with Terraform, cloud security auditing, automated deployment pipelines, and observability setups. Adept at cutting cloud expenses while achieving 99.99% system uptime."
  },
  {
    id: "cand-5",
    name: "Sophia Martinez",
    title: "Senior Product Manager",
    experienceYears: 5,
    skills: ["Agile/Scrum", "Product Roadmap", "SaaS Strategy", "User Research", "A/B Testing", "Mixpanel", "Jira", "SQL", "Stakeholder Management", "Product Analytics"],
    education: "B.A. in Business Administration, University of Washington",
    location: "Seattle, WA (Remote)",
    email: "sophia.martinez@talentmatch.ai",
    phone: "+1 (555) 567-8901",
    summary: "Metrics-driven Product Manager with 5+ years of experience steering cross-functional agile teams from product discovery to successful launch. Proven record in increasing retention and conversion rates for high-traffic B2B and fintech products."
  },
  {
    id: "cand-6",
    name: "Alex Wong",
    title: "Lead Product Designer (UI/UX)",
    experienceYears: 4,
    skills: ["Figma", "Design Systems", "User Journeys", "Wireframing", "Interactive Prototyping", "Adobe Creative Suite", "HTML/CSS", "Usability Testing", "Brand Identity"],
    education: "B.F.A. in Graphic Design, Rhode Island School of Design",
    location: "New York, NY (Hybrid)",
    email: "alex.wong@talentmatch.ai",
    phone: "+1 (555) 678-9012",
    summary: "Creative product designer dedicated to crafting beautiful, intuitive, and accessible user experiences. Expert in establishing component-driven Figma design systems that bridge the gap between design concepts and responsive frontend implementation."
  },
  {
    id: "cand-7",
    name: "Taylor Reed",
    title: "Senior Technical Writer & Developer Advocate",
    experienceYears: 5,
    skills: ["Markdown", "API Documentation", "Git/GitHub", "JavaScript", "Hugo/Docusaurus", "Technical Blogging", "Public Speaking", "Community Engagement", "Screencasting"],
    education: "B.A. in English & Computer Science minor, Northwestern University",
    location: "Chicago, IL (Remote)",
    email: "taylor.reed@talentmatch.ai",
    phone: "+1 (555) 789-0123",
    summary: "Technical communicator bridging developer relations and high-quality product manuals. Experienced in writing highly clear API guides, tutorials, and maintaining developer portals that dramatically lower customer onboarding friction."
  },
  {
    id: "cand-8",
    name: "Jordan Blake",
    title: "HR & Talent Acquisition Partner",
    experienceYears: 4,
    skills: ["Technical Sourcing", "Applicant Tracking Systems (ATS)", "Onboarding", "HR Compliance", "Interviewing", "LinkedIn Recruiter", "Employer Branding", "Negotiation"],
    education: "B.A. in Psychology, University of Michigan",
    location: "Denver, CO (Hybrid)",
    email: "jordan.blake@talentmatch.ai",
    phone: "+1 (555) 890-1234",
    summary: "Enthusiastic human resources specialist with 4 years in technical recruitment. Passionate about building inclusive hiring pipelines, crafting stellar candidate experiences, and partnering with hiring managers to identify and onboard top-tier engineering talent."
  },
  {
    id: "cand-9",
    name: "Aisha Diop",
    title: "Information Security Analyst",
    experienceYears: 5,
    skills: ["Penetration Testing", "OAuth 2.0 / SAML", "SOC 2 Audit", "Vulnerability Assessment", "Firewalls", "Wireshark", "Encryption", "Python (Security Scripting)", "AWS IAM"],
    education: "B.S. in Cybersecurity, Georgia Institute of Technology",
    location: "Atlanta, GA (On-site)",
    email: "aisha.diop@talentmatch.ai",
    phone: "+1 (555) 901-2345",
    summary: "Certified cybersecurity professional with deep expertise in security frameworks, network intrusion monitoring, and compliance reviews. Adept at working alongside engineering teams to implement bulletproof authorization mechanisms and secure data policies."
  },
  {
    id: "cand-10",
    name: "Liam O'Connor",
    title: "Junior Full Stack Developer",
    experienceYears: 3,
    skills: ["React", "Express.js", "MongoDB", "Node.js", "Python", "Flask", "PostgreSQL", "Git", "Tailwind CSS", "RESTful APIs"],
    education: "Full Stack Software Engineering Certificate, General Assembly",
    location: "Dublin, Ireland (Hybrid)",
    email: "liam.oconnor@talentmatch.ai",
    phone: "+353 (1) 555-8901",
    summary: "Energetic and adaptable full-stack engineer who transitioned from a background in project management. Possesses strong baseline skills in the MERN stack and a relentless drive to solve complex logic challenges and learn new technologies."
  }
];
