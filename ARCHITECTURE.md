# DC 2100 APEX OS Architecture

## Status

MVP Architecture Lock

## Primary Objective

Support the complete DC 2100 content operating loop:

SOURCE WATCH
→ VIRAL SCAN
→ FILTER
→ RANK
→ ANALYZE
→ DC 2100 TRANSFORM
→ CONTENT PACK
→ CEO APPROVAL
→ MANUAL VIDEO GENERATION
→ DASHBOARD UPLOAD
→ QA
→ YOUTUBE PUBLISH
→ ANALYTICS RETURN
→ WINNER REINFORCEMENT
→ YPP PROGRESS TRACKING

The architecture must prioritize:

- speed of development
- low operational complexity
- clear service boundaries
- easy manual control
- measurable AI cost
- measurable video-generation cost
- future scalability without premature microservices

---

# 1. Platform Stack

## Development and Source Control

GitHub

GitHub Codespaces

GitHub Actions

GitHub is the source of truth for:

- application code
- prompts
- schemas
- Canon
- roadmap
- deployment configuration
- CI checks

---

## Frontend

Next.js

Hosted on:

Netlify

The Dashboard is responsible for user interaction and decision workflows.

The Dashboard must not perform heavy background processing.

---

## Backend Runtime

Railway

Initial service architecture:

APEX API

APEX Worker

PostgreSQL

Storage Bucket

Do not split Scanner, Analyzer, Transformer, Publisher, and Analytics into separate Railway services during MVP.

They remain business modules.

---

# 2. High-Level Topology

GitHub
  |
  +-- Codespaces
  |
  +-- GitHub Actions
  |
  +-- Netlify
  |     |
  |     +-- Next.js Dashboard
  |
  +-- Railway
        |
        +-- APEX API
        |
        +-- APEX Worker
        |
        +-- PostgreSQL
        |
        +-- Storage Bucket

External APIs:

Gemini API

OpenAI API

YouTube Data API

YouTube Analytics API

External manual video models:

Kling

Veo

Seedance

即夢

---

# 3. Frontend Responsibilities

Location:

apps/dashboard

Platform:

Next.js + Netlify

Responsibilities:

- Dashboard overview
- Signal review
- Candidate review
- CEO approval controls
- Creative Pack review
- Generation Queue
- manual video result upload
- QA controls
- Publish Queue
- Analytics
- YPP Mission Control
- model performance inspection

The frontend does not:

- run scheduled scanning
- execute large Gemini batches
- execute large OpenAI batches
- poll YouTube analytics continuously
- perform long-running background jobs

Those responsibilities belong to Railway.

---

# 4. APEX API Responsibilities

Location:

apps/api

Platform:

Railway

Primary responsibilities:

- authenticated Dashboard API
- Source management API
- Signal API
- Candidate API
- Creative Pack API
- Generation Queue API
- Video upload coordination
- QA workflow API
- Publisher API
- Analytics API
- YPP progress API

The API should remain request-response oriented.

Long-running jobs should be delegated to the Worker.

---

# 5. APEX Worker Responsibilities

Location:

jobs/worker

Platform:

Railway

Responsibilities:

- Source Watch
- Viral Scan
- News Scan
- Filter
- Rank
- Batch Analyze
- DC 2100 Transform
- Creative Pack batch jobs
- YouTube analytics polling
- metric snapshot creation
- Winner reinforcement jobs
- scheduled operational jobs

The Worker may invoke modules from:

functions/scanner

functions/analyzer

functions/transformer

functions/publisher

---

# 6. Business Modules

The functions directory contains domain modules.

It does not mean one deployment per directory.

## Scanner

functions/scanner

Responsibilities:

- fetch source data
- normalize signals
- calculate velocity metrics
- filter signals
- rank signals

## Analyzer

functions/analyzer

Responsibilities:

- prepare model input
- call Gemini API
- validate structured output
- create Structure Cards

## Transformer

functions/transformer

Responsibilities:

- load Canon
- map source signal to DC 2100
- assign story role
- assign country context
- assign vehicle context
- assign resource conflict
- produce satire angle
- produce story function

## Publisher

functions/publisher

Responsibilities:

- YouTube upload coordination
- scheduling
- retry logic
- post state tracking
- analytics association

---

# 7. Data Layer

Platform:

Railway PostgreSQL

Initial tables or logical domains:

sources

signals

contents

creative_packs

videos

posts

metric_snapshots

vehicles

countries

Possible supporting tables:

status_history

generation_takes

qa_reviews

prompt_versions

script_versions

model_runs

The exact schema will be defined in Day 2.

---

# 8. File Storage

Platform:

Railway Storage Bucket

Primary stored assets:

- generated video results
- approved video files
- reference images
- temporary generation assets
- upload artifacts

Database records should store metadata and object references.

Large binary files must not be stored directly inside PostgreSQL.

---

# 9. Automated AI Layer

Automated AI uses two providers:

Gemini API

OpenAI API

The goal is not to call both providers for every record.

The goal is intelligent routing by task value.

---

# 10. Gemini API Responsibilities

Gemini is the high-volume intelligence layer.

Primary responsibilities:

- bulk viral structure analysis
- first-pass signal understanding
- first-pass classification
- batch news analysis
- first-pass DC 2100 transformation
- low-cost candidate filtering

Typical flow:

100 Signals
→ Gemini Batch Analysis
→ Top Candidates

Gemini output should use validated structured schemas.

---

# 11. OpenAI API Responsibilities

OpenAI API is the high-value automated creative and reasoning layer.

Primary responsibilities:

- final Candidate reasoning when required
- DC 2100 transformation QA
- Script generation
- Hook generation
- Hook comparison
- political satire calibration
- Prompt QA
- structured Creative Pack output

OpenAI API should be used selectively.

Not every Signal requires OpenAI processing.

---

# 12. ChatGPT Plus Responsibilities

ChatGPT Plus is separate from automated APIs.

It acts as the CEO Copilot.

Primary responsibilities:

- final strategic judgment
- Canon review
- high-risk content review
- political satire review
- Script QA
- Prompt QA
- visual direction review
- analytics interpretation
- production strategy

Manual analysis is intentionally preserved for high-value decisions.

---

# 13. AI Routing Principle

Default routing:

SOURCE SIGNAL
→ GEMINI ANALYSIS
→ RANK
→ GEMINI TRANSFORMATION
→ RECOMMENDATION

For high-value or uncertain Candidates:

RECOMMENDATION
→ OPENAI API DEEP PROCESSING
→ CEO REVIEW

After CEO approval:

APPROVED CANDIDATE
→ SCRIPT
→ PROMPT
→ METADATA
→ CREATIVE PACK

The exact model selection policy may evolve after cost and quality data are collected.

---

# 14. Video Generation Principle

MVP does not use automated video-generation APIs.

Generation process:

Creative Pack
→ CEO Approval
→ Copy Prompt
→ External Model
→ Manual Generate
→ Upload Result
→ QA

Model pool:

Kling

Veo

Seedance

即夢

Other models may be tested manually.

Every generation attempt should record:

- model
- take number
- generation time
- credit cost
- QA result
- reject reason

---

# 15. CI and Deployment Flow

Development flow:

Codespaces
→ Git Commit
→ Git Push
→ GitHub Actions
→ Deployment

GitHub Actions should eventually run:

- install
- lint
- typecheck
- test
- build validation

Frontend deployment:

GitHub
→ Netlify

Backend deployment:

GitHub
→ Railway

Railway production deployment should wait for successful CI when configured.

---

# 16. Scheduled Operations

Railway Worker handles scheduled jobs.

Initial target schedule:

06:00

Source Watch

Viral Scan

News Scan

07:00

Filter

Rank

Analyze

Transform

08:00

CEO Decision window

08:30

Creative Pack generation

Publishing period:

Afternoon to evening

Analytics snapshot targets:

1H

6H

24H

72H

7D

Exact implementation may use separate scheduled job executions.

---

# 17. Security Rules

Secrets must never be committed to GitHub.

Sensitive environment variables may include:

DATABASE_URL

GEMINI_API_KEY

STORY_ADMIN_TOKEN

OPENAI_API_KEY

YOUTUBE_CLIENT_ID

YOUTUBE_CLIENT_SECRET

YOUTUBE_REFRESH_TOKEN

Storage credentials

Application authentication secrets

Use:

Railway environment variables

Netlify environment variables

GitHub Actions secrets

Never commit:

.env

credentials JSON

service account keys

private keys

refresh tokens

---

# 18. API Boundary Principle

The Dashboard should communicate with APEX API.

Preferred direction:

Browser
→ APEX API
→ Database

Do not expose unrestricted database credentials to the browser.

Public frontend environment variables should contain only values safe for public exposure.

---

# 19. Observability

MVP should log at minimum:

- job name
- job start
- job finish
- success or failure
- AI provider
- model
- token or cost data where available
- generation model
- retry count
- publish failure
- analytics import failure

Advanced observability platforms are not required during the first 14 days.

---

# 20. MVP No-Go List

Do not build during the 14-day MVP:

- microservice explosion
- Kubernetes
- complex message broker architecture
- automated video-generation API routing
- autonomous multi-agent system
- full Character Bible database
- full Vehicle asset management platform
- automatic editing system
- automatic subtitle system
- multi-platform publishing
- full P&L accounting engine
- complex permissions system
- 3D world map

All such ideas go to Backlog.

---

# 21. Architecture Decision Rule

A new infrastructure component may be added only when:

1. a current component cannot meet the requirement,

or

2. the operational cost of the current design is clearly higher,

or

3. production data demonstrates a real bottleneck.

Do not add infrastructure for hypothetical scale.

---

# 22. MVP Architecture Lock

Current locked stack:

GitHub

GitHub Codespaces

GitHub Actions

Next.js

Netlify

Railway APEX API

Railway APEX Worker

Railway PostgreSQL

Railway Storage Bucket

Gemini API

OpenAI API

ChatGPT Plus

Kling

Veo

Seedance

即夢

YouTube Shorts

Architecture changes require explicit decision and documentation update.
