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
  isArray,
  validateDirectionShape,
  validateDirectionBatchShape,
  validateOutlineShape,
  validateScriptShape,
  validateScriptBatchShape
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
    if (
      entry.state !== undefined &&
      entry.state !== "PROPOSED_STATE_CHANGE"
    ) {
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
      entry.target_state !== undefined &&
      entry.target_state !== null &&
      !APEX_STATE_ALLOWLIST.includes(entry.target_state)
    ) {
      issues.push(
        issue(
          "CANON",
          "STATE_TRANSITION_INVALID",
          `target_state ${entry.target_state} is not in the APEX state allowlist.`,
          "target_state"
        )
      );
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
    ...validateDirectionShape(direction, {
      expectedType: context.expectedType
    }),
    ...runCanonValidator(direction),
    ...runEvidenceValidator(direction, context),
    ...runIPValidator(direction, context)
  ];

  return finalize(issues);
}

function validateDirectionBatch(directions, context = {}) {
  const batchIssues = validateDirectionBatchShape(directions);

  const perDirection = (directions || []).map(direction => {
    const expectedType = isPlainObject(direction)
      ? direction.direction_type
      : undefined;

    const issues = [
      ...runCanonValidator(direction),
      ...runEvidenceValidator(direction, context),
      ...runIPValidator(direction, context)
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
    ...runIPValidator(outline, context)
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
    ...runIPValidator(script, context)
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
  FORBIDDEN_STATE_LITERAL,
  runCanonValidator,
  runEvidenceValidator,
  runIPValidator,
  collectEvidenceRefs,
  validateDirection,
  validateDirectionBatch,
  validateOutline,
  validateScript,
  validateScriptBatch
};
