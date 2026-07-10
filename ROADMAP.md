# DC 2100 APEX OS
# 14-Day MVP Launch Roadmap

## Mission

Launch the APEX OS Short Engine MVP within 14 days.

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

## Fixed MVP Architecture

### Frontend
Next.js

### Hosting
Firebase App Hosting

### Database
Cloud Firestore

### File Storage
Firebase Storage

Google Cloud Storage may be used only when needed.

### Authentication
Firebase Authentication

### Backend Jobs
Cloud Functions

Cloud Run may be introduced only when Cloud Functions are insufficient.

### Version Control
GitHub

### Automated AI
Gemini API

Primary automated use cases:

- viral structure analysis
- signal classification
- DC 2100 transformation
- script generation
- prompt generation
- metadata generation

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
Create Firebase project.

Enable:

- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase App Hosting

### Task 1.4
Create Dashboard skeleton.

Pages:

- Dashboard
- Signals
- Candidates
- Creative Packs
- Generation Queue
- Publish Queue
- Analytics

Empty shells are acceptable on Day 1.

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

- Website can authenticate.
- GitHub push works.
- Firebase deployment path is ready.
- YouTube channel setup is complete.

---

# DAY 2
## Database + Workflow State

Create Firestore collections:

- sources
- signals
- contents
- creative_packs
- videos
- posts
- metric_snapshots
- vehicles
- countries

Define Content ID format:

P0-{COUNTRY}-{CAR}-{NUMBER}

Example:

P0-JP-RX7-001

Implement workflow statuses defined in STATUS_FLOW.md.

Create Dashboard Content Table.

Required columns:

- Content ID
- Country
- Vehicle
- Source Signal
- Status
- Priority
- Created Date
- Updated Date

Create test data:

- at least 5 sources
- at least 10 signals
- at least 5 content candidates

### Day 2 Deliverable

Dashboard can create, read, update, and delete Content records.

Status changes work correctly.

---

# DAY 3
## Source Watchlist

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

---

# DAY 4
## Viral Scanner

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

# DAY 5
## Structure Analyzer

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

---

# DAY 6
## DC 2100 Transformer

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

# DAY 7
## Creative Pack Factory

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

---

# DAY 8
## Generation Queue

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

# DAY 9
## YouTube Publisher

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

---

# DAY 10
## Analytics + YPP Mission Control

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

# DAY 11
## Full End-to-End Test

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

# DAY 12
## Pilot Day 1

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

# DAY 13
## Pilot Day 2 + P0 Preparation

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

# DAY 14
## GO LIVE

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

# Forbidden During 14-Day MVP

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

DAY 1–3

Infrastructure + Sources

DAY 4–7

Intelligence + Creative Pipeline

DAY 8–10

Generation + Publishing + Analytics

DAY 11

Full Test

DAY 12–13

Pilot + Fix

DAY 14

P0 GLOBAL QUALIFIERS GO LIVE
