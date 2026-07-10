# DC 2100 APEX OS Status Flow

## Purpose

This document defines the canonical workflow state machine for content records.

Every Content record must have exactly one current status.

Status changes must be explicit and auditable.

---

# 1. Canonical Status List

DISCOVERED

ANALYZED

RECOMMENDED

CEO_APPROVED

PACK_READY

GENERATING

UPLOADED

QA_APPROVED

SCHEDULED

PUBLISHED

ANALYZING

WINNER

RESERVE_SIGNAL

ARCHIVED

---

# 2. Standard Happy Path

DISCOVERED
→ ANALYZED
→ RECOMMENDED
→ CEO_APPROVED
→ PACK_READY
→ GENERATING
→ UPLOADED
→ QA_APPROVED
→ SCHEDULED
→ PUBLISHED
→ ANALYZING

After analysis:

ANALYZING
→ WINNER

or

ANALYZING
→ RESERVE_SIGNAL

or

ANALYZING
→ ARCHIVED

---

# 3. Status Definitions

## DISCOVERED

A signal or Candidate has been discovered.

Minimum requirements:

- source reference exists
- discovery timestamp exists
- source platform exists

Next valid status:

ANALYZED

---

## ANALYZED

Signal structure analysis is complete.

Expected analysis fields may include:

- hook_type
- first_frame
- visual_structure
- conflict
- payoff
- loop_method
- emotion_curve
- why_it_works
- story_pattern

Next valid status:

RECOMMENDED

or

ARCHIVED

---

## RECOMMENDED

Candidate has passed automated ranking and transformation.

It is ready for CEO decision.

Next valid status:

CEO_APPROVED

or

ARCHIVED

---

## CEO_APPROVED

CEO has explicitly approved the Candidate.

Approval must record:

- approved time
- approved concept version
- decision context where available

Next valid status:

PACK_READY

---

## PACK_READY

Creative Pack is complete.

Minimum expected assets:

- Script
- Video Prompt
- Negative Prompt
- Camera Direction
- Action Direction
- Reference Requirements
- Recommended Model
- Metadata

Next valid status:

GENERATING

---

## GENERATING

External AI video generation is in progress.

Generation information should record:

- model
- take number
- start time
- credit cost when known

Next valid status:

UPLOADED

PACK_READY may be used as a retry return state when a major prompt revision is required.

---

## UPLOADED

A generated result has been uploaded into APEX OS.

The video is awaiting QA.

Next valid status:

QA_APPROVED

or

GENERATING

Use GENERATING for another take.

---

## QA_APPROVED

Video passed human QA.

Minimum QA checks:

- correct vehicle
- acceptable vehicle consistency
- acceptable motion
- acceptable camera
- acceptable lighting
- no severe AI artifact
- Hook is strong enough
- no unresolved safety issue

Next valid status:

SCHEDULED

---

## SCHEDULED

Video is successfully scheduled for YouTube publication.

Required fields:

- publish date
- publish time
- YouTube association or upload record

Next valid status:

PUBLISHED

---

## PUBLISHED

Video is live.

Required fields:

- published timestamp
- platform post identifier
- public state confirmation

Next valid status:

ANALYZING

---

## ANALYZING

Performance data is being collected and compared.

Expected snapshots:

- 1H
- 6H
- 24H
- 72H
- 7D

Next valid status:

WINNER

RESERVE_SIGNAL

or

ARCHIVED

---

## WINNER

Content has demonstrated meaningful performance and should inform reinforcement.

WINNER does not mean automatic duplication.

System should extract winning variables.

A Winner may generate future Candidates with new Content IDs.

---

## RESERVE_SIGNAL

Content shows secondary value.

Possible future use:

- Underground Circuit
- Regional Qualifier
- Comeback Arc
- Audience-demand retest

Reserve content remains searchable.

---

## ARCHIVED

Content is inactive.

Archiving reasons may include:

- weak signal
- weak Canon fit
- weak production feasibility
- low performance
- policy risk
- duplicate concept
- outdated news signal

Archived records must not be deleted merely because they failed.

Historical data is useful to prevent repeated mistakes.

---

# 4. Retry Rules

A failed generation does not receive a new Content ID.

Retry behavior:

GENERATING
→ UPLOADED
→ GENERATING

Use when the uploaded take fails QA.

For major creative revision:

UPLOADED
→ PACK_READY
→ GENERATING

The system must preserve:

- previous Prompt Version
- previous Script Version
- previous Take Number
- Reject Reason

---

# 5. Reject Reasons

Approved standard reject reasons:

Vehicle Deformation

Wrong Vehicle

Weak Motion

Bad Camera

Bad Lighting

AI Artifact

Weak Hook

Other

Additional reasons may be added later through controlled schema changes.

---

# 6. Publisher Sub-State

The main Content status remains canonical.

Publisher execution may use a separate operational sub-state:

READY

UPLOADING

SCHEDULED

LIVE

FAILED

These are publisher job states.

They do not replace the main Content status model.

Example:

Content Status:

QA_APPROVED

Publisher Job:

READY

Then:

Publisher Job:

UPLOADING

Then:

Publisher Job:

SCHEDULED

Main Content Status becomes:

SCHEDULED

---

# 7. Failure Handling

Upload failure must preserve:

- Content ID
- Metadata
- Video reference
- Retry count
- Failure reason
- Timestamp

A failed upload must not create a duplicate Content record.

---

# 8. Audit Requirements

Every status change should eventually record:

- previous_status
- next_status
- changed_at
- changed_by
- reason when required

MVP may initially store only current status and timestamps.

Full history is preferred when implementation cost permits.

---

# 9. Forbidden Transitions

Examples of forbidden direct jumps:

DISCOVERED
→ PUBLISHED

ANALYZED
→ GENERATING

RECOMMENDED
→ SCHEDULED

PACK_READY
→ PUBLISHED

UPLOADED
→ PUBLISHED

PUBLISHED
→ CEO_APPROVED

These transitions bypass required controls.

---

# 10. CEO Authority

CEO may:

- reject a Candidate
- request regeneration
- change satire intensity
- change vehicle
- change country
- request shorter script
- request stronger Hook

Major concept changes before generation should return the record to:

RECOMMENDED

or

PACK_READY

depending on the scope of revision.

---

# 11. MVP State Principle

Status is operational truth.

UI labels must map to this canonical state machine.

Do not invent page-specific status values without updating this document and the shared schema.

One Content record.

One current canonical status.

One stable Content ID.
