// =========================================================
// STORY PIPELINE VALIDATORS — Task 3.4E
//
// Four independent, deterministic (non-LLM) validators run
// over every generated artifact before it is shown to a Human
// Gate: Structure, Canon, Evidence, and IP. Each returns an
// issues[] array; the aggregate validation_status is BLOCKED
// if any validator produced an issue, PASS otherwise.
// =========================================================

const {
  issue,
  isPlainObject,
  isNonEmptyString,
  isArray,
  validateDirectionShape,
  validateDirectionBatchShape,
  validateOutlineShape,
  validateScriptShape,
  validateScriptBatchShape,
  SIGNAL_FIELD_MIN_CHARS
} = require("./schemas");

// =========================================================
// STATE VOCABULARY (APEX_RULES_V1.md §7-11, CANON_STATE_MODEL.md §2)
// =========================================================

const APEX_STATE_ALLOWLIST = [
  "DISCOVERED",
  "CANDIDATE_APPROVED",
  "QUALIFIER_ENTERED",
  "QUALIFIER_PASSED",
  "QUALIFIER_FAILED",
  "RESERVE",
  "WILD_CARD_ELIGIBLE",
  "WILD_CARD_GRANTED",
  "COMEBACK_PENDING",
  "COMEBACK_GRANTED",
  "RIVALRY_CREATED",
  "ALLIANCE_CREATED",
  "ALLIANCE_BROKEN",
  "RESOURCE_ACQUIRED",
  "RESOURCE_LOST",
  "VEHICLE_DAMAGED",
  "VEHICLE_REPAIRED",
  "TEAM_CHANGED",
  "REGION_LOCKED",
  "REGION_UNLOCKED",
  "DISQUALIFIED",
  "WITHDRAWN"
];

// Real previous_state -> target_state transition matrix
// (APEX_RULES_V1.md §7-11). Checking target_state membership
// in APEX_STATE_ALLOWLIST alone is not the same as checking
// the transition is legal -- e.g. QUALIFIER_PASSED -> RESERVE
// or DISQUALIFIED -> COMEBACK_PENDING must never be allowed
// even though every individual state is a real state.
const CANON_STATE_TRANSITIONS = {
  DISCOVERED: ["CANDIDATE_APPROVED"],
  CANDIDATE_APPROVED: ["QUALIFIER_ENTERED"],
  QUALIFIER_ENTERED: [
    "QUALIFIER_PASSED",
    "QUALIFIER_FAILED",
    "DISQUALIFIED",
    "WITHDRAWN"
  ],
  QUALIFIER_PASSED: [],
  QUALIFIER_FAILED: [
    "RESERVE",
    "WILD_CARD_ELIGIBLE",
    "COMEBACK_PENDING"
  ],
  RESERVE: [
    "QUALIFIER_ENTERED",
    "WILD_CARD_ELIGIBLE",
    "DISQUALIFIED",
    "WITHDRAWN"
  ],
  WILD_CARD_ELIGIBLE: [
    "WILD_CARD_GRANTED",
    "DISQUALIFIED",
    "WITHDRAWN"
  ],
  WILD_CARD_GRANTED: ["QUALIFIER_ENTERED"],
  COMEBACK_PENDING: ["COMEBACK_GRANTED", "DISQUALIFIED"],
  COMEBACK_GRANTED: ["QUALIFIER_ENTERED"],
  DISQUALIFIED: [],
  WITHDRAWN: [],
  REGION_LOCKED: ["REGION_UNLOCKED"],
  REGION_UNLOCKED: [],
  ALLIANCE_CREATED: ["ALLIANCE_BROKEN"],
  ALLIANCE_BROKEN: [],
  RESOURCE_ACQUIRED: ["RESOURCE_LOST"],
  RESOURCE_LOST: ["RESOURCE_ACQUIRED"],
  VEHICLE_DAMAGED: ["VEHICLE_REPAIRED"],
  VEHICLE_REPAIRED: ["VEHICLE_DAMAGED"],
  RIVALRY_CREATED: [],
  // Append-only event: TEAM_CHANGED is never a "from" state in
  // this matrix (a change event doesn't itself get superseded
  // by the matrix below) -- it is reachable from any state,
  // handled as a special case in the transition check.
  TEAM_CHANGED: []
};

// States that are legal as the FIRST recorded event for their
// entity (previous_state may be null). Every other state
// requires an explicit, legal previous_state -- this set is
// deliberately narrow, never "anything without a previous
// state is fine".
const INITIAL_EVENT_STATES = new Set([
  "DISCOVERED",
  "RIVALRY_CREATED",
  "ALLIANCE_CREATED",
  "RESOURCE_ACQUIRED",
  "VEHICLE_DAMAGED",
  "REGION_LOCKED",
  "TEAM_CHANGED"
]);

// Entity-group compatibility: which entity_type value(s) a
// given target_state may legally apply to.
const STATE_ENTITY_TYPE_GROUPS = {
  DISCOVERED: ["DRIVER", "TEAM"],
  CANDIDATE_APPROVED: ["DRIVER", "TEAM"],
  QUALIFIER_ENTERED: ["DRIVER", "TEAM"],
  QUALIFIER_PASSED: ["DRIVER", "TEAM"],
  QUALIFIER_FAILED: ["DRIVER", "TEAM"],
  RESERVE: ["DRIVER", "TEAM"],
  WILD_CARD_ELIGIBLE: ["DRIVER", "TEAM"],
  WILD_CARD_GRANTED: ["DRIVER", "TEAM"],
  COMEBACK_PENDING: ["DRIVER", "TEAM"],
  COMEBACK_GRANTED: ["DRIVER", "TEAM"],
  DISQUALIFIED: ["DRIVER", "TEAM"],
  WITHDRAWN: ["DRIVER", "TEAM"],
  TEAM_CHANGED: ["TEAM", "DRIVER"],
  RIVALRY_CREATED: ["RELATIONSHIP"],
  ALLIANCE_CREATED: ["RELATIONSHIP"],
  ALLIANCE_BROKEN: ["RELATIONSHIP"],
  RESOURCE_ACQUIRED: ["RESOURCE"],
  RESOURCE_LOST: ["RESOURCE"],
  VEHICLE_DAMAGED: ["VEHICLE"],
  VEHICLE_REPAIRED: ["VEHICLE"],
  REGION_LOCKED: ["REGION"],
  REGION_UNLOCKED: ["REGION"]
};

function isLegalStateTransition(previousState, targetState) {
  if (targetState === "TEAM_CHANGED") {
    // Append-only event log entry: always reachable, never
    // superseded by a fixed predecessor requirement.
    return true;
  }

  const allowedNext = CANON_STATE_TRANSITIONS[previousState];

  return Array.isArray(allowedNext) && allowedNext.includes(targetState);
}

const FORBIDDEN_STATE_LITERAL = "CANON_STATE_COMMITTED";

// Small, deliberately conservative blocklist of real-world
// vehicle brands and well-known fictional characters. This is
// a heuristic safety net, not a substitute for human IP review
// -- it exists to catch obvious, mechanical violations only.
const REAL_VEHICLE_BRAND_BLOCKLIST = [
  "toyota", "honda", "ford", "ferrari", "lamborghini", "porsche",
  "bmw", "mercedes", "nissan", "tesla", "chevrolet", "dodge",
  "mazda", "subaru", "audi", "volkswagen", "hyundai", "kia",
  "mitsubishi", "mclaren", "bugatti", "aston martin", "jaguar"
];

const COPYRIGHTED_CHARACTER_BLOCKLIST = [
  "batman", "superman", "spider-man", "spiderman", "goku",
  "naruto", "luffy", "iron man", "darth vader", "pikachu",
  "mario", "sonic the hedgehog", "james bond", "wolverine"
];

const OFFICIAL_PARTNERSHIP_PHRASES = [
  "official partnership",
  "officially sponsored by",
  "in partnership with",
  "endorsed by the manufacturer",
  "licensed by"
];

// Fields that only ever contain compliance/audit REPORTING about the
// generated content (e.g. "No official partnership is implied.") --
// never the actual narrative. Canon/IP phrase detection must never
// scan these: a negated compliance sentence here would otherwise
// trigger the exact violation it is reporting the absence of, and
// since retry_feedback echoes a prior attempt's own validator
// messages back into the next prompt, scanning it risks the
// validator self-triggering on its own words. Excluded by key name
// at any depth, since these are self-report containers wherever they
// appear, not just at the payload's top level.
const COMPLIANCE_REPORTING_FIELDS = new Set([
  "canon_constraints",
  "forbidden_elements_respected",
  "ip_safety_notes",
  "risk_flags",
  "validation_issues",
  "retry_feedback"
]);

function collectNarrativeStrings(value, acc = []) {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectNarrativeStrings(item, acc);
    }
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (COMPLIANCE_REPORTING_FIELDS.has(key)) {
        continue;
      }
      collectNarrativeStrings(value[key], acc);
    }
  }

  return acc;
}

// Used by every Canon/IP phrase detector below -- evidence collection,
// schema validation, and structured boolean checks (e.g.
// vehicle_transformation.official_partnership_implied) never go
// through this and are unaffected by the exclusion above.
function narrativeText(payload) {
  return collectNarrativeStrings(payload).join(" \n ").toLowerCase();
}

// A phrase match alone is not a violation -- "No official partnership
// is implied" and "Traffic does not decide the race result" contain
// the same trigger words as a real violation, just negated. A
// sentence boundary alone is too coarse: "The car is not damaged, and
// the team has an official partnership with Toyota." is ONE sentence
// but TWO independent claims, and the first claim's negation must
// never excuse the second's real violation. Split into CLAUSES (not
// just sentences) as an AUXILIARY narrowing step, then check EVERY
// occurrence of a phrase/claim within each clause independently --
// but clause membership alone is never sufficient proof of negation
// (see isOfficialPartnershipOccurrenceNegated / findSubjectVerbObjectClaims
// below): "The car is not damaged, the team has an official
// partnership with Toyota." never splits on its plain comma, yet
// still must BLOCK, because negation is decided from a small BOUNDED
// window directly adjacent to the specific occurrence, never from
// "does any negation cue appear anywhere earlier in this clause".

// Sentence terminators/newlines always end a clause. A comma only
// ends a clause when followed by a coordinating conjunction that
// commonly joins two independent claims (but/however/yet/and) --
// a plain comma ("Without an official partnership, the team competes
// independently.") does not split, since that is still one claim.
// This is an auxiliary narrowing only -- see the per-occurrence
// bounded-window checks below, which are correct even when a comma
// (or a bare "and" with no comma) leaves two claims in one clause.
const CLAUSE_BOUNDARY_PATTERN = /[.!?;:\n]+|,\s*(?:but|however|yet|and)\b\s*/gi;

function splitIntoClauses(text) {
  return text
    .split(CLAUSE_BOUNDARY_PATTERN)
    .map(clause => clause.trim())
    .filter(Boolean);
}

function findAllOccurrences(haystack, needle) {
  const indices = [];
  let fromIndex = 0;

  while (true) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) break;
    indices.push(index);
    fromIndex = index + needle.length;
  }

  return indices;
}

// How far to look immediately before/after a specific occurrence for
// a negation cue that grammatically binds to THAT occurrence. Small
// and fixed on purpose: it must never be large enough to reach across
// an unrelated earlier claim (e.g. "not damaged" ... "official
// partnership" 30+ characters later), which is exactly the bug this
// replaces ("any negation cue anywhere in the clause/prefix").
const CLAIM_NEGATION_WINDOW = 40;

// Negation forms that bind DIRECTLY to an official-partnership-style
// phrase occurrence, immediately before it ("no official partnership",
// "without an official partnership", "not officially sponsored by",
// "not in partnership with", "never officially sponsored by") --
// anchored with $ so the cue must be the last thing before the
// phrase, not merely present somewhere in a wider prefix.
const PARTNERSHIP_PRE_NEGATION_PATTERN =
  /\b(?:no|not|never|without(?:\s+an?)?)\s*$/i;

// Negation forms that bind DIRECTLY after the phrase ("an official
// partnership is not implied", "... was not formed") -- anchored with
// ^ so the cue must immediately follow the phrase, not merely appear
// somewhere later in the clause.
const PARTNERSHIP_POST_NEGATION_PATTERN =
  /^\s*(?:is|was|are|were)\s+not\s+(?:implied|formed|in\s+place|established)\b/i;

// Decides negation for ONE occurrence of an official-partnership-style
// phrase using only a small bounded window immediately adjacent to
// that occurrence -- never the whole clause/segment. This is what
// stops unrelated earlier negations (e.g. "not damaged") from
// laundering a real, later affirmative partnership claim, even when
// clause splitting leaves both claims in the same clause (plain comma,
// bare "and").
function isOfficialPartnershipOccurrenceNegated(clause, occurrenceStart, occurrenceEnd) {
  const localPrefix = clause.slice(
    Math.max(0, occurrenceStart - CLAIM_NEGATION_WINDOW),
    occurrenceStart
  );
  const localSuffix = clause.slice(
    occurrenceEnd,
    occurrenceEnd + CLAIM_NEGATION_WINDOW
  );

  return (
    PARTNERSHIP_PRE_NEGATION_PATTERN.test(localPrefix) ||
    PARTNERSHIP_POST_NEGATION_PATTERN.test(localSuffix)
  );
}

// Checks every occurrence of `phrase` within one clause independently,
// each judged purely on its own adjacent context -- one negated
// occurrence can never excuse a later (or earlier) affirmative one.
function clauseHasUnnegatedOfficialPartnershipPhrase(clause, phrase) {
  for (const occurrenceStart of findAllOccurrences(clause, phrase)) {
    const occurrenceEnd = occurrenceStart + phrase.length;

    if (!isOfficialPartnershipOccurrenceNegated(clause, occurrenceStart, occurrenceEnd)) {
      return true;
    }
  }

  return false;
}

// =========================================================
// GENERIC SUBJECT -> VERB -> OBJECT CLAIM ENGINE
//
// Every "X does/controls/decides Y" affirmative-narrative violation
// below (Traffic, Dome Controls Results, Dome Non-Europe Scope) is
// the SAME shape: a SUBJECT, a decisive VERB, and an OBJECT it acts
// on. A single big regex spanning all three with wide inter-token
// gaps (the pre-hardening implementation) can bind a subject to a
// verb that actually belongs to a LATER, different subject -- e.g.
// "Traffic is not a concern and popularity determines the winner."
// would match subject="traffic" .. verb="determines" across the
// unrelated "popularity" clause, and then find "not" inside that huge
// span and wrongly call the whole thing negated. This engine instead
// finds every subject occurrence independently and bounds its verb/
// object search to the window BEFORE the next subject occurrence, so
// a verb belonging to a later subject can never be borrowed, and the
// subject-to-verb gap used for negation can never reach across into
// another subject's own clause either. One reusable engine instead of
// one bespoke regex per rule.
// =========================================================

// Negation forms that bind DIRECTLY to a decision verb, anchored to
// the END of the subject-to-verb gap -- unlike a plain "does this
// gap contain any negation word" scan, this must never match a
// negation cue sitting earlier in the gap that doesn't directly
// modify the verb itself (e.g. "is not a concern and decides" must
// NOT read as negating "decides" -- "and" breaks the direct bind).
const DIRECT_VERB_NEGATION_PATTERN =
  /\b(does\s+not|doesn't|do\s+not|don't|did\s+not|didn't|never|cannot|can't|could\s+not|couldn't|would\s+not|wouldn't|should\s+not|shouldn't|must\s+not|mustn't|will\s+not|won't|no)\s*$/i;

function isDirectVerbNegated(subjectToVerbGap) {
  return DIRECT_VERB_NEGATION_PATTERN.test(subjectToVerbGap);
}

// Finds every SUBJECT -> VERB -> OBJECT claim in a clause using the
// bounded-window discipline described above. `verbPattern` and
// `objectPattern` are plain (non-global) regexes tested fresh against
// each subject's own bounded window/tail, so no shared lastIndex
// state ever leaks between subjects or between calls.
function findSubjectVerbObjectClaims(clause, subjectPattern, verbPattern, objectPattern, isVerbNegated) {
  const claims = [];
  const subjectMatches = [...clause.matchAll(subjectPattern)];

  for (let i = 0; i < subjectMatches.length; i++) {
    const subjectMatch = subjectMatches[i];
    const subjectEnd = subjectMatch.index + subjectMatch[0].length;
    const nextSubjectStart =
      i + 1 < subjectMatches.length ? subjectMatches[i + 1].index : clause.length;

    const window = clause.slice(subjectEnd, nextSubjectStart);

    const verbMatch = verbPattern.exec(window);
    if (!verbMatch) {
      continue;
    }

    const afterVerb = window.slice(verbMatch.index + verbMatch[0].length);
    if (!objectPattern.test(afterVerb)) {
      continue;
    }

    // Only the gap directly between THIS subject and THIS verb can
    // negate this claim -- never anything before the subject or past
    // the verb.
    const subjectToVerbGap = window.slice(0, verbMatch.index);

    claims.push({ negated: isVerbNegated(subjectToVerbGap) });
  }

  return claims;
}

function violatesAsClaims(text, subjectPattern, verbPattern, objectPattern, isVerbNegated) {
  return splitIntoClauses(text).some(clause =>
    findSubjectVerbObjectClaims(clause, subjectPattern, verbPattern, objectPattern, isVerbNegated).some(
      claim => !claim.negated
    )
  );
}

// ---- Traffic Decides Result ----

const TRAFFIC_SUBJECT_PATTERN =
  /(traffic|views|popularity|subscriber count|viral(?:ity)?|audience votes?)/gi;

// Full inflection coverage (base/3rd-person/past) for every decision
// verb, word-boundary anchored.
const TRAFFIC_VERB_PATTERN =
  /\b(decides?|decided|determines?|determined|awards?|awarded|crowns?|crowned|declares?|declared)\b/i;

const TRAFFIC_OBJECT_PATTERN = /(win|winner|result|outcome|race|champion)/i;

function isTrafficDecisionVerbNegated(subjectToVerbGap) {
  return DIRECT_VERB_NEGATION_PATTERN.test(subjectToVerbGap);
}

function findTrafficClaims(clause) {
  return findSubjectVerbObjectClaims(
    clause,
    TRAFFIC_SUBJECT_PATTERN,
    TRAFFIC_VERB_PATTERN,
    TRAFFIC_OBJECT_PATTERN,
    isTrafficDecisionVerbNegated
  );
}

// ---- Dome Authority Controls Results ----

const DOME_AUTHORITY_SUBJECT_PATTERN = /(dome authority)/gi;

const DOME_CONTROLS_VERB_PATTERN =
  /\b(controls?|controlled|decides?|decided|determines?|determined|overturns?|overturned)\b/i;

const DOME_CONTROLS_OBJECT_PATTERN = /(race result|winner|outcome|scoring)/i;

// ---- Dome Authority Non-Europe Scope ----
//
// Deliberately narrow verb list: "has no safety-review role" and "is
// its only scope" never contain any of these verbs, so those SAFE
// constructions are excluded by simply never forming a claim at all
// -- no separate allowlist of safe phrasings is needed.
const DOME_SCOPE_VERB_PATTERN =
  /\b(conducts?|conducted|controls?|controlled|manages?|managed|extends?|extended|intervenes?|intervened)\b/i;

const DOME_SCOPE_REGION_OBJECT_PATTERN =
  /(region[\s_](?:asia|north[\s_]america|latin[\s_]america|africa|oceania|middle[\s_]east)|east[\s_]asia|southeast[\s_]asia|north[\s_]america|latin[\s_]america|africa|oceania|middle[\s_]east)/i;

// =========================================================
// CANON VALIDATOR
// =========================================================

// Audited against explicit PASS/BLOCK examples (see probe run in the
// hardening commit): both patterns already reject negated phrasing
// correctly (their fixed literal wording simply never occurs inside
// a negated sentence -- "is NOT definitively resolved" never
// contains the literal substring "is definitively"), but auditing
// surfaced two real WORDING bugs, unrelated to negation, that made
// them silently miss natural affirmative phrasing entirely:
//   1. ERA_IX_DEFINITIVE_PATTERN required "is definitively" to be
//      followed IMMEDIATELY (no space) by "resolved" etc. -- real
//      text always has a space ("is definitively resolved"), so the
//      original never matched this branch at all. Fixed with an
//      explicit \s+ between the modal phrase and the participle.
//   2. DOME_SOLE_RESPONSIBLE_PATTERN required the object alternative
//      "the cause" to include its own "the", but "the sole"/"the
//      only" already consume the article ("is the sole cause" has
//      only one "the" total) -- the original could never match this
//      combination. Fixed by making the object's "the" optional.
const ERA_IX_DEFINITIVE_PATTERN =
  /(era ix|the silence)[^.]{0,80}(is finally|is definitively|is officially|is conclusively|has been (?:definitively|officially|conclusively))\s+(revealed|confirmed|solved|resolved)/i;

const DOME_SOLE_RESPONSIBLE_PATTERN =
  /dome authority (is|was) (the sole|solely|the only|definitively) (responsible|to blame|(?:the\s+)?cause)/i;

// ---- Underground Circuit Mandatory ----
//
// Two independent affirmative-claim shapes mean the same real
// violation ("Underground Circuits are a parallel, optional pathway,
// never a required step"): the circuit ITSELF described as required
// ("Underground Circuits are required") -- circuit-first -- or
// someone/something described as obligated to use it ("Every entrant
// must complete an Underground Circuit") -- obligation-first. The
// original single regex only covered the circuit-first shape and,
// because it matched in one fixed left-to-right order, silently
// missed the obligation-first shape entirely (a real false negative,
// not just a false positive).
const UNDERGROUND_CIRCUIT_IS_MANDATORY_PATTERN =
  /underground circuit[s]?[^.]{0,60}(is|are)\s+(required|mandatory|the only way|a required step)/i;

const UNDERGROUND_OBLIGATION_PATTERN =
  /\b(must|is|are|was|were)\s+(required\s+to\s+)?(complete|use|enter|pass|take)\b[^.]{0,60}underground circuit[s]?/i;

// Negation forms that bind directly to the obligation itself --
// "must not", "is/are/was/were not required", "never required", or
// the "no <subject> is/are required" idiom -- must never be swallowed
// by the broader obligation pattern above.
const UNDERGROUND_OBLIGATION_SAFE_PATTERN =
  /\b(must\s+not|(?:is|are|was|were)\s+not\s+required|never\s+required|no\s+\w+(?:\s+\w+){0,3}\s+(?:is|are)\s+required)\b/i;

function isUndergroundMandatoryViolated(clause) {
  if (UNDERGROUND_CIRCUIT_IS_MANDATORY_PATTERN.test(clause)) {
    return true;
  }

  return (
    UNDERGROUND_OBLIGATION_PATTERN.test(clause) &&
    !UNDERGROUND_OBLIGATION_SAFE_PATTERN.test(clause)
  );
}

// ---- Disqualified Same-Season Comeback ----
//
// The original regex required "disqualified ... same season ...
// comeback/reinstated/re-enter" in that EXACT left-to-right order.
// Natural phrasing almost always puts the return word BEFORE "same
// season" ("reinstated in the same season", "re-enter in the same
// season"), so the fixed order silently missed nearly every real
// phrasing -- a false negative, not a false positive. Rebuilt as: all
// three concepts (disqualification, same-season, a return action)
// present anywhere in the clause, with the return action itself
// checked for a directly-adjacent negation (before OR after,
// covering "cannot re-enter" and "... comeback is forbidden").
const DISQUALIFIED_MENTION_PATTERN = /disqualifi(?:ed|cation)/i;
const SAME_SEASON_MENTION_PATTERN = /same[\s-]season/i;

const RETURN_ACTION_PATTERN =
  /\b(re-?enters?|re-?entered|reinstates?|reinstated|comeback|returns?|returned)\b/gi;

const RETURN_ACTION_PRE_NEGATION_PATTERN =
  /\b(cannot|can't|never|does\s+not|doesn't|do\s+not|don't|is\s+not|are\s+not|was\s+not|were\s+not|no)\b(?:\s+\w+){0,2}\s*$/i;

const RETURN_ACTION_POST_NEGATION_PATTERN =
  /^\s*(?:route\s+)?(?:is|was|are|were)?\s*forbidden\b/i;

function isDisqualifiedComebackViolatedInClause(clause) {
  if (
    !DISQUALIFIED_MENTION_PATTERN.test(clause) ||
    !SAME_SEASON_MENTION_PATTERN.test(clause)
  ) {
    return false;
  }

  for (const match of clause.matchAll(RETURN_ACTION_PATTERN)) {
    const prefix = clause.slice(
      Math.max(0, match.index - CLAIM_NEGATION_WINDOW),
      match.index
    );
    const suffix = clause.slice(
      match.index + match[0].length,
      match.index + match[0].length + CLAIM_NEGATION_WINDOW
    );

    const negated =
      RETURN_ACTION_PRE_NEGATION_PATTERN.test(prefix) ||
      RETURN_ACTION_POST_NEGATION_PATTERN.test(suffix);

    if (!negated) {
      return true;
    }
  }

  return false;
}

// ---- Public Challenge Auto-Strip ----
//
// The original regex required the literal phrase "public challenge"
// to appear BEFORE the auto-consequence phrase, in that order. Real
// phrasing frequently drops "public challenge" entirely in favor of
// "winning"/"victory", or states the consequence FIRST ("The
// incumbent is automatically disqualified after a public challenge")
// -- both silently missed by the original (false negatives). Rebuilt
// as a direct scan for the auto-consequence VERB PHRASE itself
// (this rule is inherently about "automatic"/"instant" phrasing, so
// requiring that adverb already scopes it precisely), each occurrence
// checked against a small bounded prefix window for a directly
// adjacent negation cue.
const AUTO_STRIP_CONSEQUENCE_STEM =
  "(?:strips?|stripped|revokes?|revoked|removes?|removed|disqualifies|disqualified|loses|lost|forfeits?|forfeited)";

const AUTO_STRIP_CONSEQUENCE_PATTERN = new RegExp(
  `\\b(?:automatically|instantly)\\s+${AUTO_STRIP_CONSEQUENCE_STEM}\\b|\\b(?:is|was)\\s+(?:automatically\\s+)?disqualified\\b`,
  "gi"
);

function isPublicChallengeAutoStripViolatedInClause(clause) {
  for (const match of clause.matchAll(AUTO_STRIP_CONSEQUENCE_PATTERN)) {
    const prefix = clause.slice(
      Math.max(0, match.index - CLAIM_NEGATION_WINDOW),
      match.index
    );

    if (!DIRECT_VERB_NEGATION_PATTERN.test(prefix)) {
      return true;
    }
  }

  return false;
}

// =========================================================
// PROPOSED STATE CHANGE DISCOVERY
//
// Restricted to the exact formal containers the schema defines for
// each artifact type (schemas.js: direction/script.proposed_state_
// changes[], outline.canon_state_impact) -- never a recursive walk of
// the whole payload. A recursive "any object with a `state` or
// `target_state` property" walk would misread unrelated narrative or
// evidence metadata that merely happens to reuse those key names
// (e.g. an emotional-state field `{ state: "tense" }`, or an evidence
// citation `{ target_state: "external_reference" }`) as a real Canon
// state transition to validate.
// =========================================================

function collectProposedStateEntries(payload) {
  if (!isPlainObject(payload)) {
    return [];
  }

  const entries = [];

  if (isPlainObject(payload.canon_state_impact)) {
    entries.push(payload.canon_state_impact);
  }

  if (isArray(payload.proposed_state_changes)) {
    for (const entry of payload.proposed_state_changes) {
      if (isPlainObject(entry)) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

function runCanonValidator(payload) {
  const issues = [];
  const text = narrativeText(payload);

  // Mention-only: the literal string itself is the violation, in
  // narrative OR structured field values alike ("the Story Pipeline
  // only ever proposes state" -- there is no legitimate way to say
  // this literal that isn't itself the forbidden thing, so it is
  // never negation-checked). What it must NOT scan is compliance-
  // reporting fields (canon_constraints, retry_feedback, etc.)
  // restating the rule itself ("must never contain
  // CANON_STATE_COMMITTED") -- narrativeText already excludes those
  // fields by key name at any depth, the same exclusion every other
  // detector below relies on, instead of the previous raw
  // JSON.stringify(payload) scan that had no such exclusion at all.
  if (text.includes(FORBIDDEN_STATE_LITERAL.toLowerCase())) {
    issues.push(
      issue(
        "CANON",
        "CANON_STATE_COMMITTED_FORBIDDEN",
        "Generated content must never contain CANON_STATE_COMMITTED -- the Story Pipeline only ever proposes state.",
        "*"
      )
    );
  }

  for (const entry of collectProposedStateEntries(payload)) {
    const hasStateProp = Object.prototype.hasOwnProperty.call(entry, "state");
    const hasTargetStateProp = Object.prototype.hasOwnProperty.call(
      entry,
      "target_state"
    );
    const hasEntityTypeProp = Object.prototype.hasOwnProperty.call(
      entry,
      "entity_type"
    );
    const hasPreviousStateProp = Object.prototype.hasOwnProperty.call(
      entry,
      "previous_state"
    );

    // Fail closed: a missing field is never silently skipped --
    // it always produces its own STATE_CHANGE_FIELD_MISSING
    // issue here, on top of whatever the Structure Validator
    // (schemas.js) already reported for the same named field.
    if (!hasStateProp) {
      issues.push(
        issue(
          "CANON",
          "STATE_CHANGE_FIELD_MISSING",
          "Proposed state change entry is missing required field: state.",
          "state"
        )
      );
    } else if (entry.state !== "PROPOSED_STATE_CHANGE") {
      issues.push(
        issue(
          "CANON",
          "STATE_TRANSITION_INVALID",
          `state must be PROPOSED_STATE_CHANGE, got ${entry.state}.`,
          "state"
        )
      );
    }

    if (
      !hasTargetStateProp ||
      entry.target_state === undefined ||
      entry.target_state === null
    ) {
      issues.push(
        issue(
          "CANON",
          "STATE_CHANGE_FIELD_MISSING",
          "Proposed state change entry is missing required field: target_state.",
          "target_state"
        )
      );
      continue;
    }

    const targetState = entry.target_state;

    if (!APEX_STATE_ALLOWLIST.includes(targetState)) {
      issues.push(
        issue(
          "CANON",
          "STATE_TRANSITION_INVALID",
          `target_state ${targetState} is not in the APEX state allowlist.`,
          "target_state"
        )
      );

      continue;
    }

    if (
      !hasEntityTypeProp ||
      entry.entity_type === undefined ||
      entry.entity_type === null
    ) {
      issues.push(
        issue(
          "CANON",
          "STATE_CHANGE_FIELD_MISSING",
          "Proposed state change entry is missing required field: entity_type.",
          "entity_type"
        )
      );
    } else if (
      !(STATE_ENTITY_TYPE_GROUPS[targetState] || []).includes(
        entry.entity_type
      )
    ) {
      issues.push(
        issue(
          "CANON",
          "STATE_TRANSITION_INVALID",
          `target_state ${targetState} is not valid for entity_type ${entry.entity_type}.`,
          "entity_type"
        )
      );
    }

    if (!hasPreviousStateProp) {
      issues.push(
        issue(
          "CANON",
          "STATE_CHANGE_FIELD_MISSING",
          "Proposed state change entry is missing required field: previous_state.",
          "previous_state"
        )
      );
    } else {
      const previousState = entry.previous_state;

      if (previousState === null) {
        if (!INITIAL_EVENT_STATES.has(targetState)) {
          issues.push(
            issue(
              "CANON",
              "STATE_TRANSITION_INVALID",
              `target_state ${targetState} requires a previous_state -- it is not a legal initial event.`,
              "previous_state"
            )
          );
        }
      } else if (!APEX_STATE_ALLOWLIST.includes(previousState)) {
        issues.push(
          issue(
            "CANON",
            "STATE_TRANSITION_INVALID",
            `previous_state ${previousState} is not in the APEX state allowlist.`,
            "previous_state"
          )
        );
      } else if (!isLegalStateTransition(previousState, targetState)) {
        issues.push(
          issue(
            "CANON",
            "STATE_TRANSITION_INVALID",
            `${previousState} -> ${targetState} is not a legal Canon state transition.`,
            "target_state"
          )
        );
      }
    }
  }

  // Every clause is checked for every independent subject/verb/object
  // claim -- a negated claim for one subject (e.g. "traffic") must
  // never excuse a real affirmative claim for a different subject
  // (e.g. "popularity") appearing later in the same clause/sentence.
  const trafficDecidesResultViolated = splitIntoClauses(text).some(clause =>
    findTrafficClaims(clause).some(claim => !claim.negated)
  );

  if (trafficDecidesResultViolated) {
    issues.push(
      issue(
        "CANON",
        "TRAFFIC_DECIDES_RESULT",
        "Traffic/popularity must never be described as deciding a race result or winner (APEX_RULES_V1.md §12).",
        "*"
      )
    );
  }

  if (
    ERA_IX_DEFINITIVE_PATTERN.test(text) ||
    DOME_SOLE_RESPONSIBLE_PATTERN.test(text)
  ) {
    issues.push(
      issue(
        "CANON",
        "ERA_IX_PREMATURE_RESOLUTION",
        "Era IX (\"The Silence\") must remain ambiguous and may not be definitively resolved by a single artifact (DC2100_STORY_BIBLE_V1.md §13.1).",
        "*"
      )
    );
  }

  // Independent subject/verb/object claim scan, same engine and same
  // discipline as Traffic above: a negated claim never excuses an
  // unrelated affirmative one later in the same clause (e.g. "The
  // Dome Authority is not trusted and controls the outcome.").
  if (
    violatesAsClaims(
      text,
      DOME_AUTHORITY_SUBJECT_PATTERN,
      DOME_CONTROLS_VERB_PATTERN,
      DOME_CONTROLS_OBJECT_PATTERN,
      isDirectVerbNegated
    )
  ) {
    issues.push(
      issue(
        "CANON",
        "DOME_CONTROLS_RESULTS",
        "Dome Authority may hold a Region Europe infrastructure/safety review role in Season 1, but must never control race results or scoring (SEASON_1_GLOBAL_QUALIFIERS.md).",
        "*"
      )
    );
  }

  // Deliberately narrow verb list (see DOME_SCOPE_VERB_PATTERN) means
  // safe constructions like "has no safety-review role" or "is its
  // only scope" never form a claim at all, while affirmative
  // intervention/extension claims are still caught regardless of
  // unrelated earlier negation (e.g. "is not popular but manages
  // African infrastructure").
  if (
    violatesAsClaims(
      text,
      DOME_AUTHORITY_SUBJECT_PATTERN,
      DOME_SCOPE_VERB_PATTERN,
      DOME_SCOPE_REGION_OBJECT_PATTERN,
      isDirectVerbNegated
    )
  ) {
    issues.push(
      issue(
        "CANON",
        "DOME_SCOPE_VIOLATION",
        "Season 1 Dome Authority intervention is scoped to REGION_EUROPE infrastructure safety review only.",
        "*"
      )
    );
  }

  if (splitIntoClauses(text).some(isUndergroundMandatoryViolated)) {
    issues.push(
      issue(
        "CANON",
        "UNDERGROUND_NOT_PARALLEL_PATHWAY",
        "Underground Circuits are a parallel, optional pathway, never a required step of the main hierarchy (APEX_RULES_V1.md §2.5).",
        "*"
      )
    );
  }

  if (splitIntoClauses(text).some(isDisqualifiedComebackViolatedInClause)) {
    issues.push(
      issue(
        "CANON",
        "DISQUALIFIED_COMEBACK_SAME_SEASON",
        "A DISQUALIFIED entrant may never return via Reserve, Wild Card, or Comeback within the same season (APEX_RULES_V1.md §7).",
        "*"
      )
    );
  }

  if (splitIntoClauses(text).some(isPublicChallengeAutoStripViolatedInClause)) {
    issues.push(
      issue(
        "CANON",
        "PUBLIC_CHALLENGE_AUTO_STRIPS_INCUMBENT",
        "A public challenge victory never automatically strips the incumbent's existing qualification (APEX_RULES_V1.md §10).",
        "*"
      )
    );
  }

  return issues;
}

// =========================================================
// EVIDENCE VALIDATOR
// =========================================================

function collectEvidenceRefs(payload) {
  const refs = [];

  function walk(value, path) {
    if (Array.isArray(value)) {
      if (
        path.endsWith("evidence_refs") ||
        path.endsWith("evidence_map")
      ) {
        for (const item of value) {
          if (typeof item === "string") {
            refs.push(item);
          } else if (isPlainObject(item) && typeof item.ref === "string") {
            refs.push(item.ref);
          } else if (
            isPlainObject(item) &&
            typeof item.evidence_ref === "string"
          ) {
            refs.push(item.evidence_ref);
          }
        }
      }

      value.forEach((item, index) =>
        walk(item, `${path}[${index}]`)
      );
    } else if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        walk(value[key], path ? `${path}.${key}` : key);
      }
    }
  }

  walk(payload, "");

  return [...new Set(refs)];
}

function runEvidenceValidator(payload, context = {}) {
  const issues = [];
  const evidenceIds = context.evidenceIds || new Set();
  const noPersonSignal = Boolean(context.noPersonSignal);

  const refs = collectEvidenceRefs(payload);

  for (const ref of refs) {
    if (!evidenceIds.has(ref)) {
      issues.push(
        issue(
          "EVIDENCE",
          "EVIDENCE_REF_NOT_FOUND",
          `Evidence reference "${ref}" does not exist in the immutable candidate snapshot.`,
          "evidence_refs"
        )
      );
    }
  }

  if (noPersonSignal) {
    // Mention-only, same as CANON_STATE_COMMITTED and the
    // copyrighted-character check below -- these phrases are never
    // legitimately negated in valid output, so the fix here is only
    // the field-scoping bug: this used to scan the WHOLE payload
    // (including compliance-reporting fields like retry_feedback),
    // risking the same self-poisoning class of bug already fixed for
    // Canon/IP -- a prior attempt's own FABRICATED_PERSON_EVIDENCE
    // validator message, echoed back via retry_feedback, could in
    // principle match its own trigger phrase. narrativeText excludes
    // those fields the same way every other detector here does.
    const text = narrativeText(payload);

    const fabricatedPersonPattern =
      /(the driver'?s real name is|the actual person behind this is|in real life,? (he|she|they) (is|was))/i;

    if (fabricatedPersonPattern.test(text)) {
      issues.push(
        issue(
          "EVIDENCE",
          "FABRICATED_PERSON_EVIDENCE",
          "This candidate has NO_PERSON_SIGNAL -- no real-person evidence exists to fabricate a person claim from.",
          "*"
        )
      );
    }
  }

  return issues;
}

// =========================================================
// IP VALIDATOR
// =========================================================

function runIPValidator(payload, context = {}) {
  const issues = [];
  const text = narrativeText(payload);

  for (const brand of REAL_VEHICLE_BRAND_BLOCKLIST) {
    const nameFields = [
      payload && payload.vehicle_transformation &&
        payload.vehicle_transformation.canon_vehicle_name,
      payload && payload.character_concept &&
        payload.character_concept.canon_team_name
    ].filter(Boolean);

    for (const name of nameFields) {
      if (String(name).toLowerCase().includes(brand)) {
        issues.push(
          issue(
            "IP",
            "CANON_NAME_NOT_ORIGINAL",
            `"${name}" references the real vehicle brand "${brand}" -- Canon vehicle/team names must be original.`,
            "vehicle_transformation.canon_vehicle_name"
          )
        );
      }
    }
  }

  for (const character of COPYRIGHTED_CHARACTER_BLOCKLIST) {
    if (text.includes(character)) {
      issues.push(
        issue(
          "IP",
          "COPYRIGHTED_CHARACTER_REFERENCE",
          `Content references the copyrighted character "${character}".`,
          "*"
        )
      );
    }
  }

  // Every clause is checked for every occurrence of every phrase
  // independently, each judged by its own small bounded local context
  // -- "No official partnership existed before, but now the team has
  // an official partnership with Toyota." must still BLOCK on its
  // second, affirmative occurrence even though the first occurrence's
  // "no" negates only itself.
  const clauses = splitIntoClauses(text);

  for (const phrase of OFFICIAL_PARTNERSHIP_PHRASES) {
    const violated = clauses.some(clause =>
      clauseHasUnnegatedOfficialPartnershipPhrase(clause, phrase)
    );

    if (violated) {
      issues.push(
        issue(
          "IP",
          "OFFICIAL_PARTNERSHIP_IMPLIED",
          `Content implies an official brand partnership ("${phrase}"), which is never permitted.`,
          "*"
        )
      );
    }
  }

  // Anaphoric establishment: "No official partnership existed before,
  // but now one is established." never repeats the literal phrase in
  // its second, affirmative clause -- "one" refers back to it. The
  // per-occurrence phrase scan above cannot see this (there is no
  // second phrase occurrence to check), so it is caught separately:
  // an earlier "official partnership" mention (negated or not)
  // followed anywhere later by an explicit establishment claim about
  // "it"/"one" is itself an unnegated affirmative claim.
  const PARTNERSHIP_ANAPHORA_ESTABLISHMENT_PATTERN =
    /\b(?:one|it)\s+(?:is|was|has\s+been)\s+(?:now\s+)?established\b/i;

  if (
    /\bofficial partnership\b/i.test(text) &&
    PARTNERSHIP_ANAPHORA_ESTABLISHMENT_PATTERN.test(text)
  ) {
    issues.push(
      issue(
        "IP",
        "OFFICIAL_PARTNERSHIP_IMPLIED",
        "Content states a partnership is now established, referring back to an earlier official-partnership mention -- which is never permitted.",
        "*"
      )
    );
  }

  if (
    payload &&
    isPlainObject(payload.vehicle_transformation) &&
    payload.vehicle_transformation.official_partnership_implied === true
  ) {
    issues.push(
      issue(
        "IP",
        "OFFICIAL_PARTNERSHIP_IMPLIED",
        "vehicle_transformation.official_partnership_implied must be false.",
        "vehicle_transformation.official_partnership_implied"
      )
    );
  }

  const personCanonicalName = context.personCanonicalName
    ? String(context.personCanonicalName).toLowerCase().trim()
    : null;

  if (
    personCanonicalName &&
    payload &&
    isPlainObject(payload.character_concept) &&
    typeof payload.character_concept.canon_driver_name === "string"
  ) {
    const driverName = payload.character_concept.canon_driver_name
      .toLowerCase()
      .trim();

    if (driverName && driverName === personCanonicalName) {
      issues.push(
        issue(
          "IP",
          "REAL_PERSON_AS_CANON_DRIVER",
          "A real person's name cannot be used directly as the Canon Driver name -- it must be an original, fictionalized identity.",
          "character_concept.canon_driver_name"
        )
      );
    }
  }

  const vt = payload && payload.vehicle_transformation;

  if (
    isPlainObject(vt) &&
    typeof vt.canon_vehicle_name === "string" &&
    typeof vt.evidence_vehicle === "string" &&
    vt.canon_vehicle_name.trim().length > 0 &&
    vt.canon_vehicle_name.trim().toLowerCase() ===
      vt.evidence_vehicle.trim().toLowerCase()
  ) {
    issues.push(
      issue(
        "IP",
        "CANON_NAME_NOT_ORIGINAL",
        "canon_vehicle_name must not be identical to the real evidence_vehicle name -- it must be a fictionalized transformation.",
        "vehicle_transformation.canon_vehicle_name"
      )
    );
  }

  return issues;
}

// Word-token overlap check: a real person's exact full name being
// reused (REAL_PERSON_AS_CANON_DRIVER above) is not the only way
// to hallucinate a real identity -- reusing just their surname or
// given name (e.g. "Hiroshi Tsuchiya" for real person "Keiichi
// Tsuchiya") reads as the same real person with a new first name,
// which is exactly the "change one or two characters" pattern
// Task 3.5E's Person Signal rule forbids. This is a heuristic
// safety net (word-level, case-insensitive), not full identity
// resolution -- it exists to catch the mechanical case an exact
// full-name match misses.
function runPersonFictionalizationValidator(payload, context = {}) {
  const issues = [];

  const personCanonicalName = context.personCanonicalName
    ? String(context.personCanonicalName).toLowerCase().trim()
    : null;

  if (
    !personCanonicalName ||
    !isPlainObject(payload) ||
    !isPlainObject(payload.character_concept) ||
    typeof payload.character_concept.canon_driver_name !== "string"
  ) {
    return issues;
  }

  const driverName = payload.character_concept.canon_driver_name
    .toLowerCase()
    .trim();

  if (!driverName) {
    return issues;
  }

  const STOPWORDS = new Set(["the", "of", "de", "van", "der", "san"]);

  const personTokens = personCanonicalName
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOPWORDS.has(token));

  const driverTokens = new Set(
    driverName.split(/\s+/).filter(token => token.length > 1)
  );

  const sharedTokens = personTokens.filter(token => driverTokens.has(token));

  if (sharedTokens.length > 0) {
    issues.push(
      issue(
        "IP",
        "REAL_PERSON_FICTIONALIZATION_SAFE",
        `character_concept.canon_driver_name ("${payload.character_concept.canon_driver_name}") shares name element(s) [${sharedTokens.join(", ")}] with the real person this candidate's evidence is drawn from -- the Canon Driver identity must be a wholly original fictionalization, not the real name with a word changed.`,
        "character_concept.canon_driver_name"
      )
    );
  }

  return issues;
}

// =========================================================
// INTEGRATED SIGNAL COVERAGE VALIDATOR (Task 3.5E)
//
// Every Direction must be one causal story fusing ALL evidence
// layers that actually exist for this candidate -- never four
// directions that each use only one layer. This validator needs
// run-context (which evidence categories genuinely exist, the
// locked beat_id) that has no place in schemas.js's structure-only
// checks, so it lives here alongside Canon/Evidence/IP.
// =========================================================

function hasRealEvidenceOverlap(refs, evidenceIds) {
  return (
    isArray(refs) &&
    refs.length > 0 &&
    refs.some(ref => evidenceIds.has(ref))
  );
}

function isSubstantiveText(value, minChars = SIGNAL_FIELD_MIN_CHARS) {
  return isNonEmptyString(value) && value.trim().length >= minChars;
}

function runIntegratedCoverageValidator(payload, context = {}) {
  const issues = [];

  if (!isPlainObject(payload)) {
    return issues;
  }

  const evidenceIds = context.evidenceIds || new Set();
  const hasCountrySignal = Boolean(context.hasCountrySignal);
  const noPersonSignal = Boolean(context.noPersonSignal);
  const lockedBeatId = context.lockedBeatId || null;

  const sc = isPlainObject(payload.signal_contributions)
    ? payload.signal_contributions
    : {};
  const coverage = isPlainObject(payload.coverage_status)
    ? payload.coverage_status
    : {};

  // --- INTEGRATED_VEHICLE_SIGNAL_USED ---
  // Vehicle evidence always exists for every candidate.
  if (
    coverage.vehicle_signal !== "USED" ||
    !hasRealEvidenceOverlap(sc.vehicle && sc.vehicle.evidence_refs, evidenceIds)
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "INTEGRATED_VEHICLE_SIGNAL_USED",
        "The direction must use real vehicle evidence from this candidate's snapshot, not a fabricated or omitted vehicle signal.",
        "signal_contributions.vehicle"
      )
    );
  }

  // --- INTEGRATED_COUNTRY_SIGNAL_USED ---
  if (hasCountrySignal) {
    if (
      coverage.country_signal !== "USED" ||
      !hasRealEvidenceOverlap(sc.country && sc.country.evidence_refs, evidenceIds)
    ) {
      issues.push(
        issue(
          "STRUCTURE",
          "INTEGRATED_COUNTRY_SIGNAL_USED",
          "This candidate has country news evidence -- the direction must use it with real evidence_refs, not mark it NOT_AVAILABLE or fabricate a country event.",
          "signal_contributions.country"
        )
      );
    }
  } else if (coverage.country_signal !== "NOT_AVAILABLE") {
    issues.push(
      issue(
        "STRUCTURE",
        "INTEGRATED_COUNTRY_SIGNAL_USED",
        "This candidate has no country news evidence -- coverage_status.country_signal must be NOT_AVAILABLE, never a fabricated country event.",
        "signal_contributions.country"
      )
    );
  }

  // --- INTEGRATED_PERSON_SIGNAL_USED ---
  if (!noPersonSignal) {
    if (
      coverage.person_signal !== "USED" ||
      !hasRealEvidenceOverlap(sc.person && sc.person.evidence_refs, evidenceIds)
    ) {
      issues.push(
        issue(
          "STRUCTURE",
          "INTEGRATED_PERSON_SIGNAL_USED",
          "This candidate has person/historical resonance evidence -- the direction must use it with real evidence_refs, not mark it NOT_AVAILABLE or invent a person.",
          "signal_contributions.person"
        )
      );
    }
  } else if (
    coverage.person_signal !== "NOT_AVAILABLE" ||
    coverage.historical_resonance !== "NOT_AVAILABLE"
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "INTEGRATED_PERSON_SIGNAL_USED",
        "This candidate is NO_PERSON_SIGNAL -- coverage_status.person_signal and historical_resonance must both be NOT_AVAILABLE, never a fabricated real-person evidence.",
        "signal_contributions.person"
      )
    );
  }

  // --- INTEGRATED_APEX_RULE_USED / APEX_RULE_CREATES_REAL_CONSTRAINT ---
  const apex = isPlainObject(sc.apex) ? sc.apex : {};

  if (
    coverage.apex_rules !== "USED" ||
    !isSubstantiveText(apex.rule_used) ||
    !isSubstantiveText(apex.qualification_objective)
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "INTEGRATED_APEX_RULE_USED",
        "The direction must apply a real, specific APEX rule -- not a token reference to \"passing the qualifier\" in the closing line.",
        "signal_contributions.apex"
      )
    );
  }

  if (!isSubstantiveText(apex.failure_condition)) {
    issues.push(
      issue(
        "STRUCTURE",
        "APEX_RULE_CREATES_REAL_CONSTRAINT",
        "signal_contributions.apex.failure_condition must describe a real losing condition, not be a placeholder.",
        "signal_contributions.apex.failure_condition"
      )
    );
  }

  // --- LOCKED_BEAT_MATCHED ---
  if (
    lockedBeatId &&
    (apex.beat_id !== lockedBeatId || coverage.locked_beat !== "MATCH")
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "LOCKED_BEAT_MATCHED",
        `signal_contributions.apex.beat_id must equal the candidate's locked beat_id "${lockedBeatId}" -- a direction may never change the beat to fit its story; it must be rejected instead.`,
        "signal_contributions.apex.beat_id"
      )
    );
  }

  // --- CAUSAL_CHAIN_COMPLETE ---
  const causalChain = isArray(payload.causal_chain) ? payload.causal_chain : [];
  const substantiveSteps = causalChain.filter(step =>
    isSubstantiveText(step, 12)
  );

  if (substantiveSteps.length < 5) {
    issues.push(
      issue(
        "STRUCTURE",
        "CAUSAL_CHAIN_COMPLETE",
        "causal_chain must contain at least 5 real, descriptive steps connecting Country -> Vehicle -> Driver -> APEX -> Outcome, not a restatement of the four evidence categories.",
        "causal_chain"
      )
    );
  }

  // --- COUNTRY_SIGNAL_HAS_DIRECT_EFFECT ---
  if (
    coverage.country_signal === "USED" &&
    !isSubstantiveText(sc.country && sc.country.direct_effect_on_story)
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "COUNTRY_SIGNAL_HAS_DIRECT_EFFECT",
        "signal_contributions.country.direct_effect_on_story must describe a concrete effect on the story's conditions, not just background context.",
        "signal_contributions.country.direct_effect_on_story"
      )
    );
  }

  // --- PERSON_SIGNAL_HAS_CHARACTER_EFFECT ---
  if (
    coverage.person_signal === "USED" &&
    !isSubstantiveText(
      payload.character_concept && payload.character_concept.person_signal_influence
    )
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "PERSON_SIGNAL_HAS_CHARACTER_EFFECT",
        "character_concept.person_signal_influence must describe how the Person/Historical signal actually shaped this character, not just supply a name.",
        "character_concept.person_signal_influence"
      )
    );
  }

  // --- DRIVER_CHOICE_HAS_TWO_VALID_OPTIONS ---
  const driverChoice = isPlainObject(payload.driver_choice)
    ? payload.driver_choice
    : {};

  if (
    !isSubstantiveText(driverChoice.option_a, 8) ||
    !isSubstantiveText(driverChoice.option_b, 8) ||
    !isSubstantiveText(driverChoice.immediate_consequence, 8) ||
    !isSubstantiveText(driverChoice.long_term_cost, 8) ||
    (isNonEmptyString(driverChoice.option_a) &&
      isNonEmptyString(driverChoice.option_b) &&
      driverChoice.option_a.trim().toLowerCase() ===
        driverChoice.option_b.trim().toLowerCase())
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "DRIVER_CHOICE_HAS_TWO_VALID_OPTIONS",
        "driver_choice must present two genuinely different, substantive options with real consequences.",
        "driver_choice"
      )
    );
  }

  if (issues.length > 0) {
    issues.push(
      issue(
        "STRUCTURE",
        "SIGNAL_COVERAGE_INCOMPLETE",
        "One or more required evidence signals were not genuinely integrated into this direction.",
        "*"
      )
    );
  }

  return issues;
}

// =========================================================
// OUTLINE / SCRIPT COVERAGE CONTINUITY VALIDATOR (Task 3.6)
//
// signal_contributions / coverage_status are never re-generated by
// Gemini for Outline or Scripts -- they are inherited deterministically
// from the selected Direction(s) (see lib/story/engine.js,
// computeCoverageStatusFromSnapshot / mergeSignalContributions). What
// still needs checking is whether this artifact's OWN narrative
// (evidence_map / shots) stays faithful to every evidence layer the
// inherited coverage_status marked USED -- an artifact that silently
// drops a signal it inherited as USED has broken continuity, exactly
// the failure mode runIntegratedCoverageValidator already guards
// against one stage earlier.
// =========================================================

// apex_rules is deliberately excluded: signal_contributions.apex is
// identified by beat_id, not by evidence_refs (see
// APEX_SIGNAL_CONTRIBUTION_JSON_SCHEMA in schemas.js), so an
// evidence-overlap check does not apply to it -- its continuity is
// already covered by locked_beat_id persistence instead.
const COVERAGE_CONTINUITY_LAYERS = [
  "vehicle_signal",
  "country_signal",
  "person_signal",
  "historical_resonance"
];

const COVERAGE_LAYER_TO_SIGNAL_CONTRIBUTION_KEY = {
  vehicle_signal: "vehicle",
  country_signal: "country",
  person_signal: "person",
  historical_resonance: "person"
};

// person_signal and historical_resonance both live under the same
// signal_contributions.person.evidence_refs array (mergeSignalContributions
// in engine.js combines person:* and historical_resonance:* refs into one
// list -- see makeIntegratedDirection's signal_contributions.person fixture),
// so checking raw overlap against that combined array lets a lone person:*
// ref satisfy the historical_resonance layer (or vice versa) even though
// the two are independent evidence categories. Each layer must therefore
// only look at inherited refs bearing ITS OWN id prefix before checking
// overlap against the artifact's own refs.
const COVERAGE_LAYER_REF_PREFIX = {
  vehicle_signal: "vehicle:",
  country_signal: "country_news:",
  person_signal: "person:",
  historical_resonance: "historical_resonance:"
};

function runCoverageContinuityValidator(payload, context, issueCode) {
  const issues = [];

  const inheritedCoverageStatus = isPlainObject(context.inheritedCoverageStatus)
    ? context.inheritedCoverageStatus
    : null;
  const inheritedSignalContributions = isPlainObject(
    context.inheritedSignalContributions
  )
    ? context.inheritedSignalContributions
    : null;

  if (!inheritedCoverageStatus || !inheritedSignalContributions) {
    // Legacy row (pre-Task-3.6, no inherited coverage data available)
    // -- there is nothing to check continuity against.
    return issues;
  }

  const ownRefs = new Set(collectEvidenceRefs(payload));

  for (const layer of COVERAGE_CONTINUITY_LAYERS) {
    if (inheritedCoverageStatus[layer] !== "USED") {
      continue;
    }

    const contributionKey = COVERAGE_LAYER_TO_SIGNAL_CONTRIBUTION_KEY[layer];
    const contribution = inheritedSignalContributions[contributionKey];
    const combinedInheritedRefs = isPlainObject(contribution) && isArray(
      contribution.evidence_refs
    )
      ? contribution.evidence_refs
      : [];

    const prefix = COVERAGE_LAYER_REF_PREFIX[layer];
    const layerInheritedRefs = combinedInheritedRefs.filter(
      ref => typeof ref === "string" && ref.startsWith(prefix)
    );

    if (!hasRealEvidenceOverlap(layerInheritedRefs, ownRefs)) {
      issues.push(
        issue(
          "STRUCTURE",
          issueCode,
          `This artifact inherited "${layer}" as USED from its selected Direction, but its own evidence_map/shots contain no overlapping "${prefix}*" evidence reference -- the ${layer} signal was silently dropped. A reference from a different layer (e.g. under signal_contributions.${contributionKey}) does not satisfy this independently-tracked layer.`,
          "evidence_map"
        )
      );
    }
  }

  return issues;
}

function runOutlineCoverageContinuityValidator(payload, context = {}) {
  return runCoverageContinuityValidator(
    payload,
    context,
    "OUTLINE_COVERAGE_DROPPED"
  );
}

function runScriptCoverageContinuityValidator(payload, context = {}) {
  return runCoverageContinuityValidator(
    payload,
    context,
    "SCRIPT_COVERAGE_DROPPED"
  );
}

// =========================================================
// AGGREGATE ENTRY POINTS
// =========================================================

function finalize(issues) {
  return {
    validation_status: issues.length > 0 ? "BLOCKED" : "PASS",
    issues
  };
}

function validateDirection(direction, context = {}) {
  const issues = [
    ...validateDirectionShape(direction),
    ...runCanonValidator(direction),
    ...runEvidenceValidator(direction, context),
    ...runIPValidator(direction, context),
    ...runPersonFictionalizationValidator(direction, context),
    ...runIntegratedCoverageValidator(direction, context)
  ];

  return finalize(issues);
}

function validateDirectionBatch(directions, context = {}) {
  const batchIssues = validateDirectionBatchShape(directions);

  const perDirection = (directions || []).map(direction => {
    const issues = [
      ...validateDirectionShape(direction),
      ...runCanonValidator(direction),
      ...runEvidenceValidator(direction, context),
      ...runIPValidator(direction, context),
      ...runPersonFictionalizationValidator(direction, context),
      ...runIntegratedCoverageValidator(direction, context)
    ];

    return finalize(issues);
  });

  return {
    batch: finalize(batchIssues),
    perDirection
  };
}

function validateOutline(outline, context = {}) {
  const issues = [
    ...validateOutlineShape(outline),
    ...runCanonValidator(outline),
    ...runEvidenceValidator(outline, context),
    ...runIPValidator(outline, context),
    ...runOutlineCoverageContinuityValidator(outline, context)
  ];

  // "at most one major proposed Canon State change"
  const stateEntries = collectProposedStateEntries(outline).filter(
    entry => entry.state === "PROPOSED_STATE_CHANGE"
  );

  if (stateEntries.length > 1) {
    issues.push(
      issue(
        "STRUCTURE",
        "MULTIPLE_MAJOR_STATE_CHANGES",
        "Outline must propose at most one major Canon State change.",
        "canon_state_impact"
      )
    );
  }

  return finalize(issues);
}

function validateScript(script, context = {}) {
  const issues = [
    ...validateScriptShape(script, {
      expectedVariant: context.expectedVariant,
      language: context.language
    }),
    ...runCanonValidator(script),
    ...runEvidenceValidator(script, context),
    ...runIPValidator(script, context),
    ...runScriptCoverageContinuityValidator(script, context)
  ];

  const stateEntries = collectProposedStateEntries(script).filter(
    entry => entry.state === "PROPOSED_STATE_CHANGE"
  );

  if (stateEntries.length > 1) {
    issues.push(
      issue(
        "STRUCTURE",
        "MULTIPLE_MAJOR_STATE_CHANGES",
        "Script must propose at most one major Canon State change.",
        "proposed_state_changes"
      )
    );
  }

  return finalize(issues);
}

function validateScriptBatch(scripts, context = {}) {
  const batchIssues = validateScriptBatchShape(scripts, {
    language: context.language
  });

  const perScript = (scripts || []).map(script =>
    validateScript(script, {
      ...context,
      expectedVariant: isPlainObject(script)
        ? script.variant_type
        : undefined
    })
  );

  return {
    batch: finalize(batchIssues),
    perScript
  };
}

module.exports = {
  APEX_STATE_ALLOWLIST,
  CANON_STATE_TRANSITIONS,
  INITIAL_EVENT_STATES,
  STATE_ENTITY_TYPE_GROUPS,
  isLegalStateTransition,
  FORBIDDEN_STATE_LITERAL,
  runCanonValidator,
  runEvidenceValidator,
  runIPValidator,
  runPersonFictionalizationValidator,
  runIntegratedCoverageValidator,
  runOutlineCoverageContinuityValidator,
  runScriptCoverageContinuityValidator,
  collectEvidenceRefs,
  validateDirection,
  validateDirectionBatch,
  validateOutline,
  validateScript,
  validateScriptBatch
};
