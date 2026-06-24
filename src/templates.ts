export interface JDTemplate {
  id: string;
  title: string;
  icon: string;
  description: string;
}

export const JD_TEMPLATES: JDTemplate[] = [
  {
    id: "frontend-dev",
    title: "Senior React Developer",
    icon: "Layout",
    description: `Position: Senior React Frontend Developer
Experience: 5-8 years of experience building modern web clients
Location: Boston, MA / Hybrid

Responsibilities:
- Build, optimize, and maintain responsive, modular web interfaces using React 18+, TypeScript, and Tailwind CSS.
- Collaborate with designers in Figma to translate visual mockups into pixel-perfect, accessible, and clean frontend components.
- Optimize application performance, bundle size, and render cycles for sub-second page loads.
- Work closely with backend teams to integrate RESTful and GraphQL APIs.

Core Requirements:
- Expert-level knowledge of JavaScript (ES6+), modern React state management (Redux Toolkit or Context), and TypeScript.
- Strong proficiency in modern CSS utility frameworks, particularly Tailwind CSS.
- Experience writing front-end unit and integration tests (Jest, Testing Library).
- Solid understanding of semantic HTML, web accessibility (WCAG), and responsive design principles.`
  },
  {
    id: "ml-engineer",
    title: "Lead AI/ML Scientist",
    icon: "Brain",
    description: `Position: Lead AI/ML Scientist & Data Researcher
Experience: 5+ years of practical industry experience in ML engineering
Location: Palo Alto, CA / On-site or Hybrid

Responsibilities:
- Design, train, and deploy generative AI applications, large language models (LLMs), and retrieval-augmented generation (RAG) pipelines.
- Fine-tune deep learning models using PyTorch or TensorFlow for high-accuracy NLP and predictive tasks.
- Optimize data engineering workflows and perform heavy dataset analytics in SQL and Pandas.
- Partner with product leaders to turn research-stage concepts into productionized AI services.

Core Requirements:
- M.S. or Ph.D. in Computer Science, Applied Mathematics, or a highly quantitative field.
- Expert-level Python programming and deep learning packages (PyTorch, TensorFlow, Scikit-Learn).
- Proven hands-on experience working with LLMs, prompt engineering, vector databases, and AI model evaluation.
- Proficient in writing structured PostgreSQL queries and pipeline orchestration.`
  },
  {
    id: "devops",
    title: "DevOps Cloud Architect",
    icon: "Cloud",
    description: `Position: Senior DevOps & Infrastructure Engineer
Experience: 6+ years in cloud orchestration
Location: Austin, TX / Remote or Hybrid

Responsibilities:
- Maintain, secure, and scale multi-zone infrastructure deployments on AWS or Google Cloud.
- Lead transition to fully managed Infrastructure as Code (IaC) using Terraform.
- Create, optimize, and maintain robust automated CI/CD pipelines (GitHub Actions, Jenkins).
- Implement enterprise-grade observability, monitoring, and alerting dashboards using Prometheus, Grafana, and ELK stack.

Core Requirements:
- Solid proficiency in cloud architecture (AWS IAM, VPC, EC2, RDS, S3).
- Hands-on expertise writing modular, clean Terraform scripts.
- Strong experience with containerization (Docker, Kubernetes) and microservices routing.
- Expertise in Linux administration, Shell/Bash scripting, and server configuration.`
  },
  {
    id: "product-manager",
    title: "SaaS Product Manager",
    icon: "Compass",
    description: `Position: Senior Product Manager (SaaS & Fintech)
Experience: 4-6 years in software product management
Location: Seattle, WA / Remote

Responsibilities:
- Define product strategy, maintain the long-term SaaS roadmap, and prioritize features for cross-functional engineering teams.
- Lead user research, analyze user journeys, and discover actionable customer friction points.
- Define key performance indicators (KPIs) and monitor product engagement using Mixpanel, Amplitude, or SQL dashboarding.
- Author clear, actionable epic briefs and feature cards in Jira.

Core Requirements:
- Proven track record launching successful B2B SaaS or Fintech platforms.
- Deep understanding of Agile/Scrum processes and experience collaborating closely with engineers.
- Strong competency in data-driven decision making, product analytics tools, and basic SQL query writing.
- Superb stakeholder management and communication skills.`
  }
];
