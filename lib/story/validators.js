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

function collectStrings(value, acc = []) {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, acc);
    }
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      collectStrings(value[key], acc);
    }
  }

  return acc;
}

function combinedText(payload) {
  return collectStrings(payload).join(" \n ").toLowerCase();
}

// =========================================================
// CANON VALIDATOR
// =========================================================

const TRAFFIC_DECIDES_RESULT_PATTERN =
  /(traffic|views|popularity|subscriber count|viral(ity)?|audience vote)[^.]{0,40}(decide[sd]?|determine[sd]?|award(s|ed)?|crown(s|ed)?|declare[sd]?)[^.]{0,40}(win|winner|result|outcome|race|champion)/i;

const ERA_IX_DEFINITIVE_PATTERN =
  /(era ix|the silence)[^.]{0,80}(is finally|is definitively|is officially|is conclusively|has been (definitively|officially|conclusively) )(revealed|confirmed|solved|resolved)/i;

const DOME_SOLE_RESPONSIBLE_PATTERN =
  /dome authority (is|was) (the sole|solely|the only|definitively) (responsible|to blame|the cause)/i;

const DOME_CONTROLS_RESULTS_PATTERN =
  /dome authority[^.]{0,60}(controls?|decides?|overturns?|determines?)[^.]{0,40}(race result|the winner|the outcome|scoring)/i;

const DOME_NON_EUROPE_SCOPE_PATTERN =
  /dome authority[^.]{0,80}(safety review|infrastructure)[^.]{0,80}(region_(asia|north_america|latin_america|africa|oceania|middle_east)|east asia|southeast asia|north america|latin america|africa|oceania|middle east)/i;

const UNDERGROUND_MANDATORY_PATTERN =
  /underground circuit[s]?[^.]{0,60}(is|are) (required|mandatory|the only way|a required step)/i;

const DISQUALIFIED_SAME_SEASON_COMEBACK_PATTERN =
  /disqualified[^.]{0,120}same season[^.]{0,60}(comeback|reinstated|re-?enter)/i;

const PUBLIC_CHALLENGE_AUTO_STRIP_PATTERN =
  /public challenge[^.]{0,80}(automatically (strips|revokes|removes)|instantly (loses|forfeits) (his|her|their) qualification|incumbent is (automatically )?disqualified)/i;

function collectProposedStateEntries(payload) {
  const entries = [];

  function walk(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
    } else if (isPlainObject(value)) {
      if (
        Object.prototype.hasOwnProperty.call(value, "state") ||
        Object.prototype.hasOwnProperty.call(value, "target_state")
      ) {
        entries.push(value);
      }

      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  }

  walk(payload);

  return entries;
}

function runCanonValidator(payload) {
  const issues = [];
  const text = combinedText(payload);
  const rawText = JSON.stringify(payload || {});

  if (rawText.includes(FORBIDDEN_STATE_LITERAL)) {
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

  if (TRAFFIC_DECIDES_RESULT_PATTERN.test(text)) {
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

  if (DOME_CONTROLS_RESULTS_PATTERN.test(text)) {
    issues.push(
      issue(
        "CANON",
        "DOME_CONTROLS_RESULTS",
        "Dome Authority may hold a Region Europe infrastructure/safety review role in Season 1, but must never control race results or scoring (SEASON_1_GLOBAL_QUALIFIERS.md).",
        "*"
      )
    );
  }

  if (DOME_NON_EUROPE_SCOPE_PATTERN.test(text)) {
    issues.push(
      issue(
        "CANON",
        "DOME_SCOPE_VIOLATION",
        "Season 1 Dome Authority intervention is scoped to REGION_EUROPE infrastructure safety review only.",
        "*"
      )
    );
  }

  if (UNDERGROUND_MANDATORY_PATTERN.test(text)) {
    issues.push(
      issue(
        "CANON",
        "UNDERGROUND_NOT_PARALLEL_PATHWAY",
        "Underground Circuits are a parallel, optional pathway, never a required step of the main hierarchy (APEX_RULES_V1.md §2.5).",
        "*"
      )
    );
  }

  if (DISQUALIFIED_SAME_SEASON_COMEBACK_PATTERN.test(text)) {
    issues.push(
      issue(
        "CANON",
        "DISQUALIFIED_COMEBACK_SAME_SEASON",
        "A DISQUALIFIED entrant may never return via Reserve, Wild Card, or Comeback within the same season (APEX_RULES_V1.md §7).",
        "*"
      )
    );
  }

  if (PUBLIC_CHALLENGE_AUTO_STRIP_PATTERN.test(text)) {
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
    const text = combinedText(payload);

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
  const text = combinedText(payload);

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

  for (const phrase of OFFICIAL_PARTNERSHIP_PHRASES) {
    if (text.includes(phrase)) {
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
    const inheritedRefs = isPlainObject(contribution)
      ? contribution.evidence_refs
      : null;

    if (!hasRealEvidenceOverlap(inheritedRefs, ownRefs)) {
      issues.push(
        issue(
          "STRUCTURE",
          issueCode,
          `This artifact inherited "${layer}" as USED from its selected Direction, but its own evidence_map/shots contain no overlapping evidence reference -- the signal was silently dropped.`,
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
