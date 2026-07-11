# DC 2100 APEX OS
# 10-Day Accelerated MVP Launch Roadmap

## Mission

Launch the APEX OS Short Engine MVP within an accelerated 10-day execution window.

Day 1 and Day 2 foundations were completed ahead of the original schedule.

The remaining execution plan intentionally combines tightly coupled workflow stages without reducing MVP scope.

The system must support the following operating loop:

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
→ YOUTUBE PUBLISH
→ ANALYTICS RETURN
→ WINNER REINFORCEMENT
→ YPP PROGRESS TRACKING

---

## Accelerated Execution Rule

The 10-day schedule combines tightly coupled implementation stages without removing acceptance criteria, automated testing, production verification, or operational safeguards.

Timeline compression must never bypass:

- database migration control
- workflow transition validation
- automated API tests
- Dashboard production verification
- YouTube publishing verification
- analytics return verification

Day or Task numbering changes must be reflected in this Roadmap before implementation continues.

---

## Fixed MVP Architecture

### Frontend
Next.js

### Frontend Hosting
Netlify

### Database
Railway PostgreSQL

### File Storage
Railway Storage Bucket

### Authentication
Application authentication is handled through the APEX API architecture.

The exact authentication library may be selected during implementation without changing the platform architecture.

### Backend Services
Railway APEX API

Railway APEX Worker

Railway Cron Jobs

### Version Control
GitHub

### Automated AI

Gemini API

Primary responsibilities:

- large-volume signal analysis
- viral structure analysis
- first-pass classification
- batch news analysis
- first-pass DC 2100 transformation
- high-volume filtering

OpenAI API

Primary responsibilities:

- high-value candidate reasoning
- DC 2100 transformation QA
- script generation
- Hook variants
- political satire calibration
- prompt QA
- structured Creative Pack generation

### High-Value Manual AI
ChatGPT Plus

Primary manual use cases:

- CEO decision analysis
- candidate evaluation
- canon review
- political satire calibration
- script QA
- prompt QA
- visual reference development
- daily analytics interpretation

### Video Generation
Manual model pool during MVP:

- Kling
- Veo
- Seedance
- 即夢

MVP does not implement automatic video generation APIs.

### Primary Distribution
YouTube Shorts

Other platforms are Phase 2.

---

# DAY 1
## Foundation + Channel Setup

**Status:** COMPLETE

### Task 1.1
Create GitHub repository and project structure.

Required structure:

apps/dashboard

functions/scanner

functions/analyzer

functions/transformer

functions/publisher

prompts/analyzer

prompts/transformer

prompts/script

prompts/video

docs

schemas

### Task 1.2
Create development rules:

README.md

ROADMAP.md

CANON.md

P0_RULES.md

STATUS_FLOW.md

### Task 1.3
Create Railway foundation.

Create:

- Railway Project
- PostgreSQL service
- APEX API service
- APEX Worker service
- Storage Bucket
- environment variable structure

Do not create unnecessary microservices during MVP.

### Task 1.4
Create Next.js Dashboard skeleton and prepare Netlify deployment.

Pages:

- Dashboard
- Signals
- Candidates
- Creative Packs
- Generation Queue
- Publish Queue
- Analytics

Empty shells are acceptable on Day 1.

Connect the GitHub repository to Netlify after the Dashboard skeleton runs successfully.

### Task 1.5
Create and configure YouTube Channel.

Complete:

- Channel name
- Avatar
- Banner
- About
- Channel language
- Country settings
- Basic branding

### Task 1.6
Complete YouTube verification checks.

Verify:

- Phone Verification
- Feature Eligibility
- Advanced Feature status

### Day 1 Deliverable

- GitHub push works.
- Netlify deployment path is ready.
- Railway backend foundation is ready.
- PostgreSQL connectivity path is ready.
- YouTube channel setup is complete.

---

# DAY 2
## Database + Workflow State

**Status:** COMPLETE

Day 2 establishes the minimum relational data and workflow foundation required for the APEX OS Content Candidate loop.

The Day 2 implementation boundary is:

SOURCE
→ SIGNAL
→ CONTENT
→ STATUS HISTORY
→ CONTENT CRUD API
→ CANDIDATES DASHBOARD
→ END-TO-END VERIFICATION

Do not prematurely design downstream tables before their owning workflow stage is implemented.

### Task 2.0 — Repository Verification

Verify:

- clean Git working tree
- current branch is `main`
- local HEAD matches expected remote state
- Day 1 Dashboard and infrastructure changes are committed and pushed

### Task 2.1 — Inspect Existing API Structure

Inspect:

- API entrypoint
- PostgreSQL client
- connection pattern
- Worker connection pattern
- existing migration tooling

Confirmed MVP implementation:

- Node.js `node:http`
- `pg` PostgreSQL client
- `pg.Pool`
- no ORM
- raw SQL migrations

Do not introduce Prisma, Drizzle, Knex, or another ORM during Day 2 unless a blocker requires architecture review.

### Task 2.2 — Core Schema Design

Design the minimum relational model required to support:

SOURCE
→ SIGNAL
→ CONTENT
→ STATUS

Core relationships:

- one Source has many Signals
- one Signal may produce multiple Contents
- one Country may be associated with many Contents
- one Vehicle may be associated with many Contents
- one Content has many Status History records

Use:

- internal database identity IDs for relational references
- human-readable `content_id` for operational workflow

Content ID format:

P0-{COUNTRY}-{CAR}-{NUMBER}

Example:

P0-JP-RX7-001

### Task 2.3 — Migration System

Create:

db/migrations/

Implement a migration runner that:

- discovers SQL migration files
- executes only pending migrations
- records completed migrations
- uses database transactions
- prevents duplicate migration execution

Migration history table:

schema_migrations

Do not manually create production tables outside the migration system.

### Task 2.4 — Core PostgreSQL Schema

Create the Day 2 core tables:

- countries
- vehicles
- sources
- signals
- contents
- content_status_history

The purpose of the Day 2 schema is to validate the complete Content Candidate workflow.

The following downstream tables are intentionally deferred until their owning workflow stages:

Day 5:
- creative_packs

Day 5:
- videos

Day 6:
- posts

Day 6:
- metric_snapshots

This prevents premature schema design and keeps database development aligned with actual workflow implementation.

Implement workflow statuses defined in STATUS_FLOW.md.

Current workflow statuses:

- DISCOVERED
- ANALYZED
- RECOMMENDED
- CEO_APPROVED
- PACK_READY
- GENERATING
- UPLOADED
- QA_APPROVED
- SCHEDULED
- PUBLISHED
- ANALYZING
- WINNER
- RESERVE_SIGNAL
- ARCHIVED

Store:

- current state in `contents.status`
- transition history in `content_status_history`

Status history must support future measurement of:

- analysis lead time
- CEO approval time
- generation cycle time
- QA retry cycles
- publishing latency
- analytics classification time

### Task 2.5 — Seed Data

Create development seed data:

- at least 5 sources
- at least 10 signals
- at least 5 content candidates
- representative countries
- representative vehicles
- initial status history records

Seed data must:

- be clearly marked as synthetic development data
- use meaningful DC 2100-aligned examples
- cover multiple workflow statuses
- not pretend to be real Scanner output

### Task 2.6 — Content CRUD API

Implement:

GET /contents

GET /contents/:id

POST /contents

PATCH /contents/:id

DELETE /contents/:id

PATCH /contents/:id/status

Required API behavior:

- list Content Candidates
- retrieve single Content details
- create Content
- generate or validate Content ID
- update editable Content fields
- delete Content
- validate status transitions
- reject illegal workflow jumps
- automatically write status history
- return structured error responses
- support browser access from the Netlify Dashboard

Validate the CRUD API through an automated test covering:

CREATE
→ READ
→ UPDATE
→ VALID STATUS TRANSITION
→ INVALID STATUS TRANSITION REJECTION
→ DELETE
→ DELETE CONFIRMATION

### Task 2.7 — Candidates Dashboard Connection

Connect the static Netlify Dashboard to the Railway APEX API.

Architecture:

Browser
→ Railway APEX API
→ PostgreSQL

The Candidates page must display:

- Content ID
- Country
- Vehicle
- Source Signal
- Status
- Priority
- Created Date
- Updated Date

Required UI states:

- loading
- success
- empty
- error
- retry / refresh

Because the Dashboard uses Next.js static export, dynamic Content data must be fetched by the browser from the Railway API.

Do not move PostgreSQL access into the static Dashboard.

### Task 2.8 — End-to-End Workflow Verification

Verify the complete Day 2 path:

Netlify Dashboard
→ Browser Fetch
→ Railway APEX API
→ PostgreSQL
→ API Response
→ Dashboard Render

Then verify interactive Content operations:

CREATE CONTENT
→ READ CONTENT
→ UPDATE CONTENT
→ CHANGE STATUS
→ VERIFY STATUS HISTORY
→ DELETE TEST CONTENT

At minimum, verify one legal workflow sequence:

DISCOVERED
→ ANALYZED
→ RECOMMENDED
→ CEO_APPROVED

Also verify that an illegal transition is rejected.

### Day 2 Deliverable

Day 2 is complete only when:

- PostgreSQL core schema is migration-controlled.
- Core seed data exists.
- Production API can read and write Content records.
- Dashboard displays live Content data from PostgreSQL.
- Dashboard can create, read, update, and delete Content records.
- Status changes work correctly.
- Illegal status transitions are blocked.
- Status history is preserved.
- Netlify Dashboard → Railway API → PostgreSQL is verified end to end.

---

# DAY 3
## Sources + Viral Scanner

**Status:** IN PROGRESS — Task 3.1 and Task 3.1.1A complete; Task 3.1.1B active

### Accelerated Day 3 Task Plan

- Task 3.1 — Source Management Stack ✅ COMPLETE
- Task 3.1.1A — Source + Candidate Bulk APIs and Automated Tests ✅ COMPLETE
- Task 3.1.1B — Source + Candidate Multi-Select and Bulk Dashboard UX 🔄 ACTIVE
- Task 3.2 — Real Watchlist Bootstrap
- Task 3.3 — Viral Scanner Engine
- Task 3.4 — Signals Dashboard and Day 3 End-to-End Verification

Task 3.1.1 is a scalability requirement and must be completed before loading the real watchlist.

### Source Watchlist

Car source categories:

- JDM
- Muscle
- Supercar
- Rally
- Drag Racing
- Restoration
- Barn Find
- Movie Cars
- Weird Cars
- EV
- Classic Racing
- Street Culture

News categories:

- War
- Energy
- Chips
- AI
- Rare Earths
- Battery
- Shipping
- Trade
- Tariffs
- Sanctions
- Water
- Food
- Space Resources

Build Source Management page.

Fields:

- Source Name
- URL
- Platform
- Category
- Country
- Priority
- Enabled
- Last Scan Time

Initial target:

- 30–50 Car Sources
- 15–30 News Sources

Do not attempt to build a 200-source database during MVP.

### Viral Scanner

Fetch YouTube candidate metadata:

- Video ID
- Channel
- Title
- Published Date
- Views
- Duration

Calculate:

- Views
- Views per Day
- Age in Hours
- Growth Velocity

Filters:

Age windows:

- 3 Days
- 7 Days
- 14 Days
- 30 Days

Duration buckets:

- Under 10 sec
- 10–20 sec
- 20–40 sec
- Over 40 sec

Ranking dimensions:

- Views
- Views per Day
- Growth Velocity
- Recency

Scanner dashboard outputs:

- Top 100 Signals
- Qualified Signals
- Top 30 Candidates

---

# DAY 4
## Structure Analyzer + DC 2100 Transformer

**Status:** PLANNED

### Structure Analyzer

Analyzer JSON schema must include:

- hook_type
- first_frame
- visual_structure
- conflict
- payoff
- loop_method
- emotion_curve
- why_it_works
- story_pattern

Gemini analyzes the Top 10–30 signals.

Dashboard displays Structure Cards.

Daily ChatGPT QA sample:

5 signals.

Purpose:

Compare automated Gemini analysis against high-value manual judgment.

### DC 2100 Transformer

Transformer always reads:

- DC 2100 world canon
- P0 Global Qualifiers
- APEX World Tour
- Underground Circuits
- Regional Qualifiers
- Resource Conflict Rules
- Political Satire Rules

Transformer output:

- content_role
- country
- vehicle
- resource
- conflict
- satire_angle
- story_function
- short_concept
- long_term_potential

Allowed story roles:

- P0 GLOBAL QUALIFIER
- UNDERGROUND CIRCUIT
- REGIONAL QUALIFIER
- WORLD TOUR
- RESOURCE CONFLICT
- DRIVER INTRODUCTION
- PROPAGANDA
- COMEBACK

News transformation pipeline:

REAL EVENT
→ CORE CONFLICT
→ RESOURCE CONFLICT
→ COUNTRY BLOCS
→ DC 2100 TRANSLATION
→ SATIRE ANGLE

---

# DAY 5
## Creative Pack Factory + Generation Queue

**Status:** PLANNED

### Creative Pack Factory

Script Generator output:

- Hook A
- Hook B
- Hook C
- Final Hook
- Full Short Script

Video Prompt Generator output:

- Main Prompt
- Negative Prompt
- Camera Direction
- Action Direction
- Reference Requirements
- Recommended Model

Metadata Generator output:

- 3 Titles
- Description
- Hashtags
- YouTube Caption

CEO Controls:

- APPROVE
- REJECT
- REGENERATE
- MORE SATIRE
- LESS SATIRE
- CHANGE CAR
- CHANGE COUNTRY
- SHORTER
- STRONGER HOOK

Version tracking:

- Prompt Version
- Script Version
- Created Time
- Approved Version

### Generation Queue

Queue fields:

- Content ID
- Script
- Prompt
- Negative Prompt
- Reference Assets
- Recommended Model
- Priority
- Status

Functions:

- COPY VIDEO PROMPT
- Select External Model
- Upload Result
- QA Review

External models:

- Kling
- Veo
- Seedance
- 即夢
- Other

Generation result fields:

- Model
- Take Number
- Generation Time
- Credit Cost
- Video File
- Notes

QA actions:

- APPROVE
- REJECT
- RETRY

Reject reasons:

- Vehicle Deformation
- Wrong Vehicle
- Weak Motion
- Bad Camera
- Bad Lighting
- AI Artifact
- Weak Hook
- Other

---

# DAY 6
## YouTube Publisher + Analytics + YPP Mission Control

**Status:** PLANNED

### YouTube Publisher

Implement:

- YouTube OAuth
- Video upload
- Metadata upload
- Visibility controls
- Scheduling
- Retry logic

Publish Queue statuses:

- READY
- UPLOADING
- SCHEDULED
- LIVE
- FAILED

On failure preserve:

- Content ID
- Metadata
- Video association

### Analytics + YPP Mission Control

Import at minimum:

- Views
- Likes
- Comments
- Subscribers Gained
- Watch Time
- Country Data

Retention is optional during MVP if API access is unavailable.

Metric snapshots:

- 1H
- 6H
- 24H
- 72H
- 7D

Leaderboards:

- VEHICLE SIGNAL
- COUNTRY SIGNAL
- HOOK SIGNAL
- CONFLICT SIGNAL

YPP Mission Control displays:

- Subscribers Current
- Subscribers Target
- 90-Day Shorts Views
- Expanded YPP Progress
- Full Monetization Progress
- Daily View Velocity
- Required Daily Velocity
- Gap to Target

---

# DAY 7
## Full End-to-End Test

**Status:** PLANNED

Run 3 real videos through:

SCAN
→ ANALYZE
→ TRANSFORM
→ CREATIVE PACK
→ CEO APPROVE
→ PROMPT COPY
→ VIDEO GENERATE
→ UPLOAD
→ YOUTUBE SCHEDULE

Bug severity:

- BLOCKER
- HIGH
- MEDIUM
- LOW

Only Blockers must be fixed immediately.

No new features.

---

# DAY 8
## Pilot Day 1

**Status:** PLANNED

Publish 3–5 Shorts.

Mix:

- Car Probe
- Country Topic
- Resource Conflict
- Satire

Record manual time:

- Research Time
- Approval Time
- Generation Time
- Upload Time

Model Matrix:

- Success Rate
- Retry Count
- Vehicle Consistency
- Motion Quality
- Time Cost
- Credit Cost

Measure:

- 1H
- 6H
- 24H

---

# DAY 9
## Pilot Day 2 + Fix + P0 Preparation

**Status:** PLANNED

Publish another 3–5 Shorts.

Adjust:

- Hook
- Model
- Prompt
- Video Length

Select:

- PRIMARY MODEL
- SECONDARY MODEL
- BACKUP MODEL

Do not keep using four models equally.

Prepare P0 Global Qualifier configuration:

- Duration: 7 Days
- Daily Target: 8–10 Shorts
- Country Diversity: High
- Vehicle Diversity: High
- News Reactive Content: 20%
- Experimental Content: 10%

Prepare Day 1 candidate pool:

15–20 Candidates.

CEO selects:

8–10.

Channel warm-up check:

- Channel normal
- Upload normal
- Analytics normal
- Feature Eligibility normal
- No unresolved Copyright or Policy issues

---

# DAY 10
## P0 Global Qualifiers Go Live

**Status:** PLANNED

Launch:

P0 GLOBAL QUALIFIERS

Daily operating loop:

06:00

- Source Watch
- Viral Scan
- News Scan

07:00

- Filter
- Rank
- Analyze
- Transform

Output:

15 Recommendations.

08:00

CEO Decision:

- Approve 8–10
- Reject
- Replace
- Change Satire Level

08:30

Generate Creative Packs.

09:00–13:00

Manual external video generation.

13:00–14:00

- Metadata
- QA Queue
- Schedule Queue

Afternoon and evening:

YouTube scheduled publishing.

Following day:

Analytics return and leaderboards update.
---

# MVP Success Criteria

## KPI 1 — Discovery
The system automatically finds candidate viral signals.

## KPI 2 — Transformation
The system transforms signals into DC 2100-compatible concepts.

## KPI 3 — Creative Pack
The system quickly generates:

- Script
- Prompt
- Metadata

## KPI 4 — Human Generation Loop
CEO can quickly:

- Copy Prompt
- Generate Externally
- Upload
- Approve

## KPI 5 — Distribution Loop
The system can:

- Schedule
- Publish
- Import Analytics

## KPI 6 — YPP Growth Engine
Dashboard continuously displays:

- Current Subscribers
- 90-Day Shorts Views
- YPP Progress
- Daily Velocity
- Gap to Target

---

# Forbidden During 10-Day MVP

Do not build:

- Complete World Map
- 3D Globe
- Full P&L System
- Automatic Video Generation API
- Automatic Editing
- Automatic Subtitle System
- Instagram API
- Facebook API
- Threads API
- X API
- Full Character Bible System
- Full Vehicle Asset Management
- Long-form Production System
- Multi-user Permissions
- Agent Chat Room
- Automatic Take Selection
- Complex Model Router
- VPN System

All new ideas go to Backlog.

They do not enter MVP scope.

---

# Development Priority

## P0 — BLOCKER

- Scanner
- Analyzer
- Transformer
- Creative Pack
- Generation Queue
- YouTube Publisher
- Analytics

## P1 — IMPORTANT

- CEO Candidate Review
- YPP Mission Control
- Model Performance Log
- Prompt Versioning

## P2 — AFTER LAUNCH

- Multi-platform Distribution
- Advanced P&L
- Long-form Assembly
- Automated Video Generation
- Full Character Database
- Regional Qualifier Management

---

# Launch Sequence

DAY 1–2

Foundation + Database + Workflow State

DAY 3

Sources + Scanner

DAY 4

Analyzer + Transformer

DAY 5

Creative Pack + Generation Queue

DAY 6

Publishing + Analytics + YPP Mission Control

DAY 7

Full End-to-End Test

DAY 8–9

Pilot + Fix + P0 Preparation

DAY 10

P0 GLOBAL QUALIFIERS GO LIVE
