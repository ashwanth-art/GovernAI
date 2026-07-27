# RAG Chatbot AI Governance Evaluation - Backend Flow

> **Standard-Driven Evaluation Architecture**
> Prepared by: AI Governance Assessment Engine Design Team
> Date: July 2026

> **Implementation note:** This file began as a target-architecture proposal and includes Python/FastAPI/YAML examples that are not present in the deployed TypeScript application. For the implementation-accurate startup, API, database, assessment, logging, source-mapping, testing, and deployment description, use [`TECHNICAL_DOCUMENTATION.md`](./TECHNICAL_DOCUMENTATION.md).

---

## 1. Architecture Overview

### Core Principle: Evaluation Follows Selection

The system does not run a fixed checklist against every client. Instead, the user tells the system **which industry they operate in** and **which compliance standards matter to them**, and the backend evaluates the chatbot **only against those standards** - nothing more, nothing less.

This is the defining characteristic of the platform: **dynamic, standard-driven evaluation.**

```
INDUSTRY SELECTED --> STANDARDS RECOMMENDED --> USER PICKS ANY SUPPORTED SET --> EVALUATE ONLY THOSE --> ONE REPORT PER STANDARD
```

### Why This Works

Each compliance standard already contains its own governance, security, and risk requirements internally - there's no need to run separate, generic engines for those concepts. The evaluation engine simply loads the control pack for whichever standard was selected and tests every control inside it:

- **ISO 42001** covers AI policy, data security, and bias testing within its 38 Annex A controls
- **HIPAA** covers admin safeguards, technical safeguards, and physical safeguards within its own structure
- **NYC LL144** covers auditor requirements, bias testing, and transparency disclosures

Underneath these standard-specific structures, every individual control is also tagged to one of **5 common governance pillars** (Trust, Security, Governance, Compliance, Data Protection) so that results stay comparable across industries and standards, and so the system can automatically detect when fixing one gap satisfies requirements in multiple standards at once. See Section 6.

---

## 2. Complete Pipeline Flow

![Backend Pipeline Flow](diagrams/backend_flow_detail.svg)

### Pipeline Steps

**Step 1: Selection Screen (what the user sees)**
- Select industry from a dropdown (10 industries supported)
- The system immediately recommends the 2-3 most relevant standards for that industry, pre-checked
- User can accept the recommendation or adjust it, selecting any number of supported standards (at least one)
- Select access tier (Tier 1/2/3) and provide the matching credentials

**Step 2: Validate + Load**
- Validate the chatbot endpoint and credentials
- Confirm the target is actually a RAG system (not a plain LLM wrapper)
- Discover architecture (model, vector DB, embedding model)
- Load the control pack **only for the standards selected in Step 1** - nothing else is loaded

**Step 3: Evaluate (one engine per picked standard)**
- Each selected standard spins up its own evaluation engine, running in parallel
- Controls are filtered by tier so only testable controls run
- Every control carries a pillar tag (Trust / Security / Governance / Compliance / Data Protection)
- OWASP LLM Top 10 security probes run alongside every assessment regardless of which standards were picked, since no paper standard replaces real adversarial testing

**Step 4: Reports (exactly matches Step 1)**
- One report generated per selected standard, in that standard's native format
- A Cross-Standard Insights report is added automatically when 2+ standards are selected
- A 5-Pillar Radar Summary rolls everything up for an at-a-glance comparable view
- If the user picked any number of standards, the same number of reports is generated - no unused frameworks, no missing ones, nothing evaluated that wasn't selected

---

## 3. Dynamic Standard Selection - The Core Differentiator

Selecting the right standards is the single most important decision a user makes, and the platform is built around making that decision easy and defensible.

### How It Works

1. **User selects industry** (e.g. Healthcare, Finance, HR/Recruitment, Education, Autonomous Vehicles, etc.)
2. **System looks up the industry-to-standard mapping** (see Section 4) and pre-selects the 2-3 most popular, most relevant standards for that industry
3. **Each recommended standard shows why it's recommended** - mandatory/legal, certifiable/business-trust, or methodological/best-practice
4. **User can add or remove standards** from the list, or search for additional ones
5. **The evaluation engine loads exactly those control packs** - no more, no less
6. **Reports come back in the native format of each selected standard**, plus a cross-standard insights view

### Why This Is the Selling Point

| Benefit | What It Means in Practice |
|---------|---------------------------|
| **Relevance over volume** | No generic 34-control checklist for every client. A healthcare client is tested against HIPAA, not against manufacturing safety rules that will never apply to them |
| **Audit-ready output** | Each report is generated in the exact structure an auditor or regulator expects - HIPAA safeguards, ISO Annex A, NIST functions - not a generic scorecard |
| **Extensible without re-engineering** | A new regulation passes? Add one YAML control pack and it appears as a selectable standard immediately. The evaluation engine itself never changes |
| **Combines legal + business needs** | Users are guided to pick one mandatory (legal) standard and one certifiable (client-trust) standard, covering both legal risk and business credibility in a single assessment |
| **Cross-standard efficiency** | Because every control is pillar-tagged, the system automatically finds gaps that affect multiple standards at once, so remediation effort isn't duplicated |

---

## 4. Industry-Based Standard Recommendations

### Available Industries and Standards

| Industry | Standard 1 (most popular) | Standard 2 | Standard 3 |
|----------|--------------------------|------------|------------|
| **Healthcare** | HIPAA (mandatory, US) | ISO 42001 (certifiable) | NIST AI RMF |
| **Finance/Banking** | MAS AI Guidelines / SR 11-7 | SOC 2 Type II | ISO 42001 |
| **Insurance** | NAIC Model Bulletin | ISO 42001 | EU AI Act |
| **HR/Recruitment** | NYC LL144 (mandatory, NYC) | Colorado AI Act | EU AI Act |
| **Education** | FERPA | NIST AI RMF | ISO 42001 |
| **Autonomous Vehicles** | UNECE ADS Regulation | ISO 21448 (SOTIF) | UK AV Act 2024 |
| **Legal/Judiciary** | CEPEJ Ethical Charter | EU AI Act | Canada AIA |
| **Manufacturing** | EU Machinery Regulation | IEC 62443 | ISO 13849 |
| **Media/Content** | China Deep Synthesis Regs | C2PA Standard | EU AI Act |
| **Government/Public Sector** | US OMB M-24-10 | Canada AIA | Netherlands IAMA |

### Why Multiple Standards Per Industry?

No single standard covers everything an organization needs:

| Standard Type | What It Does | Example |
|--------------|--------------|---------|
| **Mandatory/Regulatory** | Legal requirement - must comply | HIPAA, NYC LL144, EU AI Act |
| **Certifiable** | Get a certificate to show clients | ISO 42001, SOC 2 |
| **Methodological** | Best-practice guidance | NIST AI RMF, CEPEJ Charter |

Many organizations start with one mandatory framework and one certifiable framework, then add any other supported standards required by their jurisdictions, customers, or risk program.

---

## 5. Three-Tier Access Model

The tier determines how many controls within each standard can actually be tested.

| Tier | Access Level | What You Provide | Coverage |
|------|-------------|------------------|----------|
| **Tier 1** | API Only | Chatbot endpoint + API key | ~55-60% of controls |
| **Tier 2** | API + Target Adapters | + Bearer tokens for target-host audit/monitoring adapters, CI/CD URL | Up to ~80-85% mapped, subject to evidence returned |
| **Tier 3** | Source + Staging Inputs | + Source code repo, staging env, model registry | Requires dedicated connectors for full verification |

### What Each Tier Unlocks

**Tier 1 (Black-Box):**
- Prompt injection testing
- Data leakage probes
- Output filtering checks
- Response consistency analysis
- Hallucination detection
- Self-reported compliance questionnaire probes

**Tier 2 (adds Gray-Box):**
- Protected `GET /api/audit/config` call on the assessed target's host
- Protected `GET /api/monitoring/summary` call on the assessed target's host
- `HEAD` reachability check against the supplied CI/CD URL
- Mapping of returned adapter evidence to configuration, logging, access, encryption, and isolation controls

The infrastructure and monitoring provider names are report context; the current implementation does not sign in to Render, AWS, Azure, GCP, Prometheus, Grafana, Datadog, or CloudWatch directly. CI/CD workflow runs and logs are not read by the reachability check.

**Tier 3 (adds White-Box):**
- Source code review for security vulnerabilities
- Model card and documentation verification
- Training data audit for bias/PII
- Vector DB content scanning
- Staging environment penetration testing
- Full dependency vulnerability scan

### Tier Coverage by Standard

| Standard | Tier 1 | Tier 2 | Tier 3 |
|----------|--------|--------|--------|
| HIPAA | 7/12 controls | 10/12 | 12/12 |
| ISO 42001 | 22/38 controls | 32/38 | 38/38 |
| NIST AI RMF | 15/27 controls | 23/27 | 27/27 |
| EU AI Act | 12/22 controls | 18/22 | 22/22 |
| SOC 2 Type II | 8/17 controls | 15/17 | 17/17 |
| NYC LL144 | 6/8 controls | 7/8 | 8/8 |

Controls that cannot be tested at the current tier are marked **"Not Assessed - requires Tier X"** in the report, with confidence scored at 0.

---

## 6. Governance Pillars and Trustworthy-AI Characteristics

![Governance Pillars Mapping](diagrams/governance_pillars_mapping.svg)

### The Common Layer Under Every Standard

Even though evaluation is organized by standard, every single control - regardless of which standard it comes from - is tagged to one of **5 governance pillars**:

| Pillar | Covers | Built on (NIST Trustworthy-AI Characteristics) |
|--------|--------|--------------------------------------------------|
| **Trust** | Explainability, human oversight, accuracy, fairness/bias monitoring | Valid & Reliable, Explainable & Interpretable, Fair (bias managed) |
| **Security** | IAM, encryption, network isolation, guardrails, injection defence | Secure & Resilient |
| **Governance** | Operating model, AI inventory, model cards, roles, release control | Accountable & Transparent |
| **Compliance** | Regulatory mapping, impact assessments, audit trails, breach runbooks | Accountable & Transparent |
| **Data Protection** | Minimisation, PII redaction, retention rules, data-subject rights | Privacy-Enhanced |

These 5 pillars are themselves built on the **7 trustworthy-AI characteristics** defined by the NIST AI Risk Management Framework: Valid & Reliable, Safe, Secure & Resilient, Accountable & Transparent, Explainable & Interpretable, Privacy-Enhanced, and Fair (bias managed).

### Why Pillar Tagging Matters

1. **Cross-standard comparability** - a client who runs HIPAA + ISO 42001 can see how they're doing on "Security" overall, not just per standard
2. **Shared-gap detection** - if a HIPAA control and an ISO control both tag to "Security" and both fail for the same underlying reason (e.g. no encryption at rest), the system flags this as one fix that resolves two findings
3. **Consistent executive reporting** - leadership gets a simple 5-pillar radar chart regardless of which specific standards were technically evaluated
4. **Future-proofing** - when a new standard is added via a YAML control pack, tagging its controls to the existing 5 pillars means it plugs directly into existing dashboards and cross-standard insight logic with no extra engineering

### Example: Same Pillar, Different Standards

| Standard | Control | Pillar Tag(s) | Trustworthy-AI Characteristic |
|----------|---------|---------------|-------------------------------|
| HIPAA | 164.312(a)(2)(iv) Encryption | Security, Data Protection | Secure & Resilient |
| ISO 42001 | A.6.2.7 Data Security | Security, Data Protection | Secure & Resilient |
| HIPAA | 164.308(a)(1) Risk Analysis | Governance, Compliance | Accountable & Transparent |
| NYC LL144 | Bias Audit - selection rate by group | Trust | Fair (bias managed) |
| ISO 42001 | A.4.3 AI System Risk Assessment | Trust, Governance | Valid & Reliable |
| OWASP LLM01 | Prompt Injection Resistance | Security | Secure & Resilient |

Because the HIPAA encryption control and the ISO 42001 data security control share the same pillar tags, fixing the underlying encryption gap resolves both findings at once - this is exactly what the Cross-Standard Insights report surfaces.

---

## 7. Per-Standard Evaluation Engine

![Per-Standard Evaluation Detail](diagrams/per_standard_evaluation.svg)

### Internal Flow

Each selected standard follows this flow:

```
LOAD CONTROL PACK --> FILTER BY TIER --> EXECUTE TESTS --> SCORE --> FORMAT REPORT
```

### 7.1 Control Pack Structure

Each standard is defined as a YAML control pack, and every control carries a `pillar_tag` alongside its test definition:

```yaml
# control_packs/hipaa.yaml
standard:
  id: hipaa
  name: "HIPAA (Health Insurance Portability and Accountability Act)"
  version: "45 CFR Parts 160, 162, 164"
  report_format: "hipaa_safeguard_report"
  scoring: "equal_weight_per_category"

controls:
  - id: "164.308(a)(1)"
    name: "Risk Analysis"
    category: "Administrative Safeguards"
    test_type: "config_check"      # or "adversarial_probe" or "document_verify"
    tier_minimum: 2                 # minimum tier needed to test this
    pillar_tags: ["governance", "compliance"]
    weight: 1.0
    probes:
      - type: "api_check"
        target: "cloud_config"
        check: "risk_assessment_document_exists"
      - type: "log_check"
        target: "monitoring"
        check: "risk_reviews_scheduled"
    pass_criteria: "all_probes_pass"
    evidence_needed: "risk_assessment_report, review_schedule"
    remediation: "Conduct formal risk analysis per NIST SP 800-30"

  - id: "164.312(a)(2)(iv)"
    name: "Encryption and Decryption"
    category: "Technical Safeguards"
    test_type: "config_check"
    tier_minimum: 2
    pillar_tags: ["security", "data_protection"]
    weight: 1.0
    probes:
      - type: "api_check"
        target: "cloud_config"
        check: "encryption_at_rest_enabled"
      - type: "api_check"
        target: "network"
        check: "tls_1_2_or_higher"
    pass_criteria: "all_probes_pass"
    evidence_needed: "encryption_config_screenshot, TLS_cert_details"
    remediation: "Enable AES-256 encryption at rest, enforce TLS 1.2+"
```

### 7.2 Test Types

| Test Type | How It Works | Tier Required | Example |
|-----------|-------------|---------------|---------|
| **adversarial_probe** | Send crafted inputs to the chatbot API | Tier 1+ | Prompt injection, data extraction attempts |
| **config_check** | Query infrastructure APIs for settings | Tier 2+ | Check if encryption enabled, logs configured |
| **document_verify** | Check for existence/content of policies | Tier 3 (or self-report at Tier 1) | Model card exists, bias testing report filed |

### 7.3 Execution via LangGraph

Each standard's evaluation is a LangGraph state machine:

```python
from langgraph.graph import StateGraph, END

class StandardEvalState(TypedDict):
    standard_id: str
    controls: list[Control]
    current_index: int
    results: list[ControlResult]
    tier: int
    credentials: dict

def load_controls(state):
    pack = load_yaml(f"control_packs/{state['standard_id']}.yaml")
    filtered = [c for c in pack['controls'] if c['tier_minimum'] <= state['tier']]
    return {"controls": filtered, "current_index": 0}

def execute_control(state):
    control = state['controls'][state['current_index']]
    result = run_probes(control, state['credentials'])
    return {
        "results": state['results'] + [result],
        "current_index": state['current_index'] + 1
    }

def should_continue(state):
    if state['current_index'] >= len(state['controls']):
        return "score"
    return "execute"

def score_standard(state):
    weights = get_scoring_scheme(state['standard_id'])
    score = weighted_average(state['results'], weights)
    return {"final_score": score}

graph = StateGraph(StandardEvalState)
graph.add_node("load", load_controls)
graph.add_node("execute", execute_control)
graph.add_node("score", score_standard)
graph.set_entry_point("load")
graph.add_edge("load", "execute")
graph.add_conditional_edges("execute", should_continue)
graph.add_edge("score", END)
```

### 7.4 OWASP Security Testing (Always Included)

Regardless of which standards the user selects, OWASP LLM Top 10 security probes always run:

| OWASP ID | Vulnerability | Test Method | Pillar Tag |
|----------|--------------|-------------|-----------|
| LLM01 | Prompt Injection | Direct + indirect injection attempts | Security |
| LLM02 | Sensitive Info Disclosure | PII extraction probes | Security, Data Protection |
| LLM03 | Training Data Poisoning | RAG retrieval manipulation tests | Security, Trust |
| LLM04 | Model Denial of Service | Resource exhaustion probes | Security |
| LLM05 | Insecure Output Handling | XSS/injection in responses | Security |
| LLM06 | Excessive Agency | Tool-use boundary tests | Security, Governance |
| LLM07 | System Prompt Leakage | Extraction techniques | Security |
| LLM08 | Vector DB Poisoning | Retrieval integrity checks | Security, Trust |

OWASP findings are **mapped to relevant controls** in whichever standards are selected via shared pillar tags. For example:
- A prompt injection finding (Security) maps to HIPAA 164.312(a)(1) Access Control (also Security)
- A data leakage finding (Security, Data Protection) maps to ISO 42001 A.6.2.7 Data Security
- If no selected standard covers that pillar area, the finding appears in a separate "Security Findings" appendix

---

## 8. Scoring Model

### Per-Standard Scoring

Each standard uses its own native scoring scheme:

| Standard | Scoring Method | Pass Threshold |
|----------|---------------|----------------|
| HIPAA | Equal weight per safeguard category (Admin/Tech/Physical) | 100% required (regulatory) |
| ISO 42001 | Conformity levels: Conforms / Minor NC / Major NC / Not Assessed | 0 Major NC for certification |
| NIST AI RMF | Maturity levels 1-5 per function (Govern/Map/Measure/Manage) | Level 3+ recommended |
| EU AI Act | Mandatory requirements checklist (pass/fail per article) | 100% for high-risk systems |
| SOC 2 | Controls effective/not effective with exceptions noted | All controls effective |
| NYC LL144 | 4/5ths rule for bias + disclosure requirements | Statistical threshold |

### Pillar Rollup Scoring

In addition to the native per-standard score, every assessment also produces a **5-pillar radar score**, computed by averaging all tested controls (across all selected standards) that share each pillar tag. This is what powers the "5-Pillar Radar Summary" shown in every report package, regardless of which specific standards were evaluated.

### Score Presentation

Each control result includes:
- **Status**: Pass / Fail / Partial / Not Assessed
- **Score**: 0.0 to 1.0 (for weighted calculation)
- **Confidence**: How certain we are (lower if tier limits testing)
- **Evidence**: What we observed/collected
- **Pillar Tag(s)**: Which of the 5 pillars this control rolls up to
- **Remediation**: Specific fix if failed

---

## 9. Report Generation

### Per-Standard Reports

Each standard generates a report **in that standard's native format**:

**HIPAA Report Structure:**
```
1. Entity Information + Assessment Scope
2. Administrative Safeguards (45 CFR 164.308)
   - Each control: PASS/FAIL + evidence + remediation + pillar tag
3. Technical Safeguards (45 CFR 164.312)
   - Each control: PASS/FAIL + evidence + remediation + pillar tag
4. Physical Safeguards (45 CFR 164.310)
   - Each control: PASS/FAIL + evidence + remediation + pillar tag
5. Overall Compliance Status + Pillar Breakdown
6. Remediation Priority List
```

**ISO 42001 Report Structure:**
```
1. Statement of Applicability
2. Clause 4-10 Conformity Assessment
3. Annex A Control Results (per control, with pillar tag)
4. Non-Conformities (Major/Minor)
5. Observations and Opportunities for Improvement
6. Certificate Readiness Assessment + Pillar Breakdown
```

**NIST AI RMF Report Structure:**
```
1. AI System Profile
2. Govern Function Assessment (maturity levels)
3. Map Function Assessment (maturity levels)
4. Measure Function Assessment (maturity levels)
5. Manage Function Assessment (maturity levels)
6. Risk Summary + Recommended Actions
```

### Cross-Standard Insights Report

When 2+ standards are selected, an additional insights report is generated, built directly from shared pillar tags:

```
CROSS-STANDARD INSIGHTS
========================
1. Shared Gaps (same pillar tag across standards - fix once, satisfy both):
   - Gap: No encryption at rest
     Affects: HIPAA 164.312(a)(2)(iv) + ISO A.6.2.7  [pillar: Security, Data Protection]
     Priority: CRITICAL (impacts both)
     Single Fix: Enable AES-256 on cloud storage

2. Standard-Specific Gaps:
   - HIPAA only: Missing BAA with cloud provider  [pillar: Compliance]
   - ISO only: No formal AI policy document  [pillar: Governance]

3. Priority Matrix:
   CRITICAL: 2 shared gaps
   HIGH: 1 HIPAA-specific
   MEDIUM: 3 ISO-specific (documentation)
   LOW: 1 ISO-specific (nice-to-have)

4. 5-Pillar Radar Summary:
   Trust: 74%  Security: 61%  Governance: 80%  Compliance: 88%  Data Protection: 65%

5. Effort Estimate:
   Fix shared gaps first = 2 standards improved simultaneously
   Total remediation items: 7
   Estimated effort: 3-4 weeks
```

---

## 10. Technical Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Orchestration** | LangGraph (Python) | State machine for evaluation flow |
| **API Server** | FastAPI | REST endpoints + SSE streaming |
| **Control Packs** | YAML files | Standard definitions (portable, version-controlled) |
| **Task Queue** | Celery + Redis | Parallel standard evaluation |
| **Database** | PostgreSQL (Neon) | Assessment results, history |
| **Cache** | Upstash Redis | Rate limiting, session state |
| **LLM** | GPT-4o / Claude | Probe generation, result analysis |
| **Frontend** | Next.js 14 | Input forms + live dashboard |
| **Streaming** | Server-Sent Events (SSE) | Real-time progress to frontend |
| **Reports** | WeasyPrint + Jinja2 | PDF generation per standard |

### Backend Folder Structure

```
backend/
  app/
    main.py                    # FastAPI app + SSE endpoints
    models/                    # Pydantic schemas
    routers/
      assessments.py           # Start/status/results endpoints
      standards.py             # List standards per industry
    engine/
      orchestrator.py          # LangGraph coordinator
      standard_eval.py         # Per-standard evaluation engine
      probe_runner.py          # Execute individual probes
      owasp_runner.py          # OWASP LLM Top 10 tests
      scoring.py               # Per-standard + pillar rollup scoring
      pillar_mapper.py         # Cross-standard shared-gap detection
    control_packs/
      hipaa.yaml
      iso42001.yaml
      nist_ai_rmf.yaml
      eu_ai_act.yaml
      soc2.yaml
      nyc_ll144.yaml
      mas_ai.yaml
      ... (one per standard)
    connectors/
      aws.py                   # AWS config reader
      gcp.py                   # GCP config reader
      azure.py                 # Azure config reader
      datadog.py               # Monitoring API
      github.py                # CI/CD + source access
    reports/
      templates/               # Jinja2 templates per standard
      generator.py             # PDF/DOCX report builder
      cross_insights.py        # Multi-standard gap analysis
```

---

## 11. Frontend Overview

![Frontend Panels](diagrams/frontend_panels.svg)

### Input Panel

The frontend collects:

1. **Industry Selection** - Dropdown with 10 industries
2. **Standard Selection** - Checkboxes with no artificial maximum, dynamically pre-populated with the most relevant standards for the selected industry. Each recommended standard explains why it is recommended (mandatory / certifiable / methodological)
3. **Tier Selection** - Toggle between Tier 1/2/3 with live coverage % update per selected standard
4. **Credentials** - Dynamic form based on tier:
   - Tier 1: API endpoint + key only
   - Tier 2: + Bearer tokens for the target-host audit/config and monitoring adapters, plus a CI/CD URL
   - Tier 3: + Git repo URL, staging environment URL

### Output Panel (Tabbed)

| Tab | Content |
|-----|---------|
| **Live Progress** | Real-time stream separating live network requests from fast local control mappings, with endpoint, method, HTTP status, latency, source type, and result |
| **[Standard 1] Report** | Full formatted report in that standard's structure |
| **[Standard 2] Report** | Full formatted report in that standard's structure |
| **Cross Insights** | Shared gaps, priority matrix, 5-pillar radar summary, effort estimate |
| **Download** | PDF download for each report + combined package |

A persistent banner across the output panel reinforces the core mechanic: *"Only the standards selected in the input panel are ever evaluated - nothing runs unrequested."*

The deployed assessment uses GovernAI's built-in compliance control mappings. It does not fetch official ISO, regulator, or standards pages during each run, and its output is assessment evidence rather than an official certification or legal determination.

### Real-Time Communication (SSE)

```python
# Backend: FastAPI SSE endpoint
@app.get("/api/assessments/{id}/stream")
async def stream_assessment(id: str):
    async def event_generator():
        async for event in engine.run_assessment(id):
            yield {
                "event": event.type,  # "control_start", "control_result", "standard_complete"
                "data": json.dumps({
                    "standard": event.standard_id,
                    "control_id": event.control_id,
                    "status": event.status,     # "pass", "fail", "partial"
                    "score": event.score,
                    "pillar_tags": event.pillar_tags,
                    "message": event.message
                })
            }
    return EventSourceResponse(event_generator())
```

```typescript
// Frontend: React hook
function useAssessmentStream(assessmentId: string) {
  const [progress, setProgress] = useState<Record<string, StandardProgress>>({});

  useEffect(() => {
    const source = new EventSource(`/api/assessments/${assessmentId}/stream`);
    source.addEventListener('control_result', (e) => {
      const data = JSON.parse(e.data);
      setProgress(prev => updateStandardProgress(prev, data));
    });
    source.addEventListener('standard_complete', (e) => {
      const data = JSON.parse(e.data);
      // Switch to report tab for this standard
    });
    return () => source.close();
  }, [assessmentId]);

  return progress;
}
```

### Source lineage shown during execution

The production UI separates three facts that must not be conflated:

1. **Observed target evidence** — an actual request to the assessed chatbot, target-host adapter, or supplied CI/CD URL. The trace records the method, endpoint, HTTP result, latency, request sequence, and the exact validation rule.
2. **Local control mapping** — the GovernAI backend applies its versioned built-in control pack to evidence already collected from the target. These mappings are paced in the SSE workflow so the UI visibly advances one control at a time.
3. **Official authority reference** — every supported standard records an authority, title, HTTPS reference, lifecycle status, and note. This link proves where the framework can be checked, but it is labelled **reference only — not fetched in this run** unless a future evidence collector actually requests that page.

Each `standard_start`, `control_result`, and `standard_complete` event includes:

```json
{
  "sequence": 24,
  "sourceType": "control_mapping",
  "officialAuthority": "U.S. Department of Health and Human Services",
  "officialReferenceTitle": "HIPAA Security Rule",
  "officialReferenceUrl": "https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html",
  "officialPageFetched": false,
  "validationMethod": "Apply the selected control-pack rule to the live evidence available at this tier."
}
```

The final report repeats the official authority reference and the access disclosure. Licensed ISO, IEC, and AICPA sources are identified as official previews rather than implying that proprietary standards text was copied or fetched. Superseded selections, including SR 11-7 and OMB M-24-10, link to their current replacement guidance and display that lifecycle warning.

---

## 12. Deployment

| Component | Platform | Reason |
|-----------|----------|--------|
| Frontend (Next.js) | Vercel | Optimized for Next.js, edge caching |
| Backend (FastAPI) | Railway / Fly.io | Long-running evaluations (5-15 min), no serverless timeout |
| Database | Neon PostgreSQL | Serverless Postgres, auto-scaling |
| Cache/Queue | Upstash Redis | Serverless Redis for task queue |
| Control Packs | Git repo (versioned) | Easy to update standards, PR-based changes |

### Local Development

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev  # localhost:3000, proxies /api to :8000
```

---

## 13. Adding New Standards

To add a new standard (e.g., a new regulation passes):

1. **Create control pack**: `control_packs/new_standard.yaml`
2. **Define controls**: Each with id, test_type, tier_minimum, pillar_tags, probes, pass_criteria
3. **Create report template**: `reports/templates/new_standard.jinja2`
4. **Add to industry mapping**: Update `standards.py` to include in relevant industries
5. **Test**: Run against a test chatbot, verify all controls execute correctly and pillar tags roll up properly

No code changes are needed to the evaluation engine itself. The system is entirely data-driven via YAML control packs, and pillar tagging means new standards plug directly into existing cross-standard insight logic and dashboards.

---

## 14. Summary

| Question | Answer |
|----------|--------|
| What drives the evaluation? | The industry and standards the user selects on the input screen |
| How many engines? | One per selected supported standard, with no artificial selection maximum |
| What about security? | OWASP runs always, findings map to standard controls via shared pillar tags |
| How is output formatted? | Each standard gets its own native report format |
| What if standards overlap? | Cross-insights report shows shared gaps using pillar tags |
| How do results stay comparable? | Every control also rolls up to 5 governance pillars (Trust, Security, Governance, Compliance, Data Protection) |
| How to add new standards? | Add a YAML control pack + report template - it plugs into the same pillar system automatically |
| What determines depth? | The access tier (1/2/3) limits which controls can be tested |
| Is anything hardcoded? | Yes. The deployed implementation generates framework checks from twelve reusable TypeScript templates in `lib/catalog.ts`; YAML control packs are a recommended future architecture. |
