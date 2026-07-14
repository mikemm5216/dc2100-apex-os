// =========================================================
// STORY PIPELINE FIXED OUTPUT SCHEMAS — Task 3.4E
//
// Explicit JS schema constants and shape-validation functions
// for the three generated artifact types (Directions, Outline,
// Scripts). Structural correctness is never trusted from the
// prompt alone -- every field listed here is checked by code.
// =========================================================

const DIRECTION_TYPES = [
  "VEHICLE_POWER",
  "COUNTRY_CONFLICT",
  "PERSON_CULTURE",
  "APEX_PROGRESSION"
];

const SCRIPT_VARIANT_TYPES = [
  "VEHICLE_FIRST",
  "WORLD_FIRST",
  "CHARACTER_FIRST"
];

const OUTLINE_REQUIRED_STRING_FIELDS = [
  "outline_title",
  "review_summary",
  "opening_situation",
  "inciting_incident",
  "vehicle_and_driver_introduction",
  "world_conflict",
  "qualifier_challenge",
  "escalation",
  "choice_or_sacrifice",
  "outcome",
  "next_episode_hook"
];

const OUTLINE_NARRATIVE_FIELDS = [
  "opening_situation",
  "inciting_incident",
  "vehicle_and_driver_introduction",
  "world_conflict",
  "qualifier_challenge",
  "escalation",
  "choice_or_sacrifice",
  "outcome",
  "next_episode_hook"
];

const OUTLINE_MIN_NARRATIVE_CHARS = 800;

const SCRIPT_WORD_COUNT_MIN = 70;
const SCRIPT_WORD_COUNT_MAX = 110;
const SCRIPT_DURATION_MIN_SECONDS = 25;
const SCRIPT_DURATION_MAX_SECONDS = 45;
const SCRIPT_SHOT_COUNT_MIN = 5;
const SCRIPT_SHOT_COUNT_MAX = 8;
const SCRIPT_HOOK_WINDOW_SECONDS = 3;

function issue(validator, code, message, path) {
  return { validator, code, message, path };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isArray(value) {
  return Array.isArray(value);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function countEnglishWords(text) {
  if (typeof text !== "string") {
    return 0;
  }

  const matches = text.trim().match(/[A-Za-z0-9''-]+/g);

  return matches ? matches.length : 0;
}

function computeScriptDuration(shots) {
  if (!Array.isArray(shots)) {
    return 0;
  }

  return shots.reduce((total, shot) => {
    const duration = Number(shot && shot.duration_seconds);
    return total + (Number.isFinite(duration) ? duration : 0);
  }, 0);
}

// =========================================================
// PROPOSED STATE CHANGE SHAPE (shared by Directions, Outline,
// Scripts)
//
// Every Proposed State Change Object -- direction/script
// proposed_state_changes[] entries and outline.canon_state_impact
// -- must carry the same fixed set of fields. This validator
// only checks Object Shape (field presence / basic type); Canon
// Vocabulary, Transition Matrix, and Entity Compatibility are
// the Canon Validator's job (runCanonValidator in validators.js).
// =========================================================

function validateProposedStateChangeShape(change, path) {
  if (!isPlainObject(change)) {
    return [
      issue(
        "STRUCTURE",
        "STATE_CHANGE_NOT_OBJECT",
        `${path} must be an object.`,
        path
      )
    ];
  }

  const issues = [];

  if (change.state !== "PROPOSED_STATE_CHANGE") {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.state must be exactly "PROPOSED_STATE_CHANGE".`,
        `${path}.state`
      )
    );
  }

  // previous_state must be present as a property (string or
  // null) -- whether null is actually legal for this
  // target_state is decided later by the Canon Validator's
  // INITIAL_EVENT_STATES check, never here.
  if (!Object.prototype.hasOwnProperty.call(change, "previous_state")) {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.previous_state is required (string or null).`,
        `${path}.previous_state`
      )
    );
  } else if (
    change.previous_state !== null &&
    !isNonEmptyString(change.previous_state)
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.previous_state must be a non-empty string or null.`,
        `${path}.previous_state`
      )
    );
  }

  if (!isNonEmptyString(change.target_state)) {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.target_state is required.`,
        `${path}.target_state`
      )
    );
  }

  if (!isNonEmptyString(change.entity_type)) {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.entity_type is required.`,
        `${path}.entity_type`
      )
    );
  }

  if (!isNonEmptyString(change.reason)) {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.reason is required.`,
        `${path}.reason`
      )
    );
  }

  if (!isArray(change.evidence_refs)) {
    issues.push(
      issue(
        "STRUCTURE",
        "STATE_CHANGE_FIELD_MISSING",
        `${path}.evidence_refs must be an array.`,
        `${path}.evidence_refs`
      )
    );
  } else {
    change.evidence_refs.forEach((ref, index) => {
      if (!isNonEmptyString(ref)) {
        issues.push(
          issue(
            "STRUCTURE",
            "STATE_CHANGE_FIELD_MISSING",
            `${path}.evidence_refs[${index}] must be a non-empty string.`,
            `${path}.evidence_refs[${index}]`
          )
        );
      }
    });
  }

  return issues;
}

// =========================================================
// DIRECTION SHAPE
// =========================================================

function validateDirectionShape(direction, { expectedType } = {}) {
  const issues = [];

  if (!isPlainObject(direction)) {
    return [
      issue(
        "STRUCTURE",
        "DIRECTION_NOT_OBJECT",
        "Direction payload must be a JSON object.",
        "direction"
      )
    ];
  }

  const requiredStrings = [
    "direction_key",
    "direction_type",
    "title",
    "review_summary",
    "hook",
    "logline",
    "core_conflict",
    "why_now",
    "season_function",
    "beat_connection"
  ];

  for (const field of requiredStrings) {
    if (!isNonEmptyString(direction[field])) {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_FIELD_MISSING",
          `Direction is missing required string field: ${field}`,
          field
        )
      );
    }
  }

  if (!DIRECTION_TYPES.includes(direction.direction_type)) {
    issues.push(
      issue(
        "STRUCTURE",
        "DIRECTION_TYPE_INVALID",
        `direction_type must be one of ${DIRECTION_TYPES.join(", ")}.`,
        "direction_type"
      )
    );
  }

  if (
    expectedType &&
    direction.direction_type &&
    direction.direction_type !== expectedType
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "DIRECTION_TYPE_MISMATCH",
        `Expected direction_type ${expectedType}, got ${direction.direction_type}.`,
        "direction_type"
      )
    );
  }

  if (!isPlainObject(direction.vehicle_transformation)) {
    issues.push(
      issue(
        "STRUCTURE",
        "DIRECTION_FIELD_MISSING",
        "Direction is missing vehicle_transformation object.",
        "vehicle_transformation"
      )
    );
  } else {
    const vt = direction.vehicle_transformation;

    for (const field of ["evidence_vehicle", "canon_vehicle_name"]) {
      if (!isNonEmptyString(vt[field])) {
        issues.push(
          issue(
            "STRUCTURE",
            "DIRECTION_FIELD_MISSING",
            `vehicle_transformation.${field} is required.`,
            `vehicle_transformation.${field}`
          )
        );
      }
    }

    if (!isArray(vt.preserved_traits)) {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_FIELD_MISSING",
          "vehicle_transformation.preserved_traits must be an array.",
          "vehicle_transformation.preserved_traits"
        )
      );
    }

    if (!isArray(vt.changed_traits)) {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_FIELD_MISSING",
          "vehicle_transformation.changed_traits must be an array.",
          "vehicle_transformation.changed_traits"
        )
      );
    }

    if (typeof vt.official_partnership_implied !== "boolean") {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_FIELD_MISSING",
          "vehicle_transformation.official_partnership_implied must be a boolean.",
          "vehicle_transformation.official_partnership_implied"
        )
      );
    }
  }

  if (!isPlainObject(direction.character_concept)) {
    issues.push(
      issue(
        "STRUCTURE",
        "DIRECTION_FIELD_MISSING",
        "Direction is missing character_concept object.",
        "character_concept"
      )
    );
  } else {
    const cc = direction.character_concept;

    for (const field of [
      "canon_driver_name",
      "canon_team_name",
      "motivation",
      "internal_conflict"
    ]) {
      if (!isNonEmptyString(cc[field])) {
        issues.push(
          issue(
            "STRUCTURE",
            "DIRECTION_FIELD_MISSING",
            `character_concept.${field} is required.`,
            `character_concept.${field}`
          )
        );
      }
    }
  }

  for (const field of ["evidence_refs", "canon_connections", "risk_flags"]) {
    if (!isArray(direction[field])) {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_FIELD_MISSING",
          `Direction field ${field} must be an array.`,
          field
        )
      );
    }
  }

  if (!isArray(direction.proposed_state_changes)) {
    issues.push(
      issue(
        "STRUCTURE",
        "DIRECTION_FIELD_MISSING",
        "Direction field proposed_state_changes must be an array.",
        "proposed_state_changes"
      )
    );
  } else {
    direction.proposed_state_changes.forEach((change, index) => {
      issues.push(
        ...validateProposedStateChangeShape(
          change,
          `proposed_state_changes[${index}]`
        )
      );
    });
  }

  return issues;
}

function validateDirectionBatchShape(directions) {
  const issues = [];

  if (!Array.isArray(directions) || directions.length !== 4) {
    return [
      issue(
        "STRUCTURE",
        "DIRECTION_COUNT_INVALID",
        "Exactly four directions are required per batch.",
        "directions"
      )
    ];
  }

  const seenTypes = new Set();

  for (const direction of directions) {
    const type = isPlainObject(direction)
      ? direction.direction_type
      : null;

    if (type && seenTypes.has(type)) {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_TYPE_DUPLICATE",
          `direction_type ${type} appears more than once in the batch.`,
          "directions"
        )
      );
    }

    if (type) {
      seenTypes.add(type);
    }

    issues.push(...validateDirectionShape(direction));
  }

  for (const requiredType of DIRECTION_TYPES) {
    if (!seenTypes.has(requiredType)) {
      issues.push(
        issue(
          "STRUCTURE",
          "DIRECTION_TYPE_MISSING",
          `Required direction_type ${requiredType} is missing from the batch.`,
          "directions"
        )
      );
    }
  }

  return issues;
}

// =========================================================
// OUTLINE SHAPE
// =========================================================

function validateOutlineShape(outline) {
  const issues = [];

  if (!isPlainObject(outline)) {
    return [
      issue(
        "STRUCTURE",
        "OUTLINE_NOT_OBJECT",
        "Outline payload must be a JSON object.",
        "outline"
      )
    ];
  }

  for (const field of OUTLINE_REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(outline[field])) {
      issues.push(
        issue(
          "STRUCTURE",
          "OUTLINE_FIELD_MISSING",
          `Outline is missing required string field: ${field}`,
          field
        )
      );
    }
  }

  if (!isPlainObject(outline.canon_state_impact)) {
    issues.push(
      issue(
        "STRUCTURE",
        "OUTLINE_FIELD_MISSING",
        "Outline is missing canon_state_impact object.",
        "canon_state_impact"
      )
    );
  } else {
    issues.push(
      ...validateProposedStateChangeShape(
        outline.canon_state_impact,
        "canon_state_impact"
      )
    );
  }

  for (const field of [
    "evidence_map",
    "canon_constraints",
    "forbidden_elements_respected"
  ]) {
    if (!isArray(outline[field])) {
      issues.push(
        issue(
          "STRUCTURE",
          "OUTLINE_FIELD_MISSING",
          `Outline field ${field} must be an array.`,
          field
        )
      );
    }
  }

  if (!isPlainObject(outline.short_structure)) {
    issues.push(
      issue(
        "STRUCTURE",
        "OUTLINE_FIELD_MISSING",
        "Outline is missing short_structure object.",
        "short_structure"
      )
    );
  } else {
    const structure = outline.short_structure;

    if (!Number.isFinite(Number(structure.hook_seconds))) {
      issues.push(
        issue(
          "STRUCTURE",
          "OUTLINE_FIELD_MISSING",
          "short_structure.hook_seconds must be a number.",
          "short_structure.hook_seconds"
        )
      );
    }

    if (
      !Number.isFinite(Number(structure.estimated_duration_seconds))
    ) {
      issues.push(
        issue(
          "STRUCTURE",
          "OUTLINE_FIELD_MISSING",
          "short_structure.estimated_duration_seconds must be a number.",
          "short_structure.estimated_duration_seconds"
        )
      );
    }

    if (!isArray(structure.narrative_beats)) {
      issues.push(
        issue(
          "STRUCTURE",
          "OUTLINE_FIELD_MISSING",
          "short_structure.narrative_beats must be an array.",
          "short_structure.narrative_beats"
        )
      );
    }
  }

  const narrativeLength = OUTLINE_NARRATIVE_FIELDS
    .map(field =>
      isNonEmptyString(outline[field])
        ? outline[field].trim().replace(/\s+/g, "")
        : ""
    )
    .join("").length;

  if (narrativeLength < OUTLINE_MIN_NARRATIVE_CHARS) {
    issues.push(
      issue(
        "STRUCTURE",
        "OUTLINE_TOO_SHORT",
        `Outline narrative sections total ${narrativeLength} non-whitespace characters, below the required minimum of ${OUTLINE_MIN_NARRATIVE_CHARS}.`,
        "outline"
      )
    );
  }

  return issues;
}

// =========================================================
// SCRIPT SHAPE
// =========================================================

function validateShotShape(shot, index) {
  const issues = [];
  const path = `shots[${index}]`;

  if (!isPlainObject(shot)) {
    return [
      issue(
        "STRUCTURE",
        "SCRIPT_SHOT_NOT_OBJECT",
        `Shot at index ${index} must be an object.`,
        path
      )
    ];
  }

  if (!Number.isFinite(Number(shot.shot_no))) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_SHOT_FIELD_MISSING",
        `${path}.shot_no must be a number.`,
        `${path}.shot_no`
      )
    );
  }

  if (!Number.isFinite(Number(shot.duration_seconds))) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_SHOT_FIELD_MISSING",
        `${path}.duration_seconds must be a number.`,
        `${path}.duration_seconds`
      )
    );
  }

  if (!isNonEmptyString(shot.visual)) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_SHOT_FIELD_MISSING",
        `${path}.visual is required.`,
        `${path}.visual`
      )
    );
  }

  if (typeof shot.voiceover !== "string") {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_SHOT_FIELD_MISSING",
        `${path}.voiceover must be a string.`,
        `${path}.voiceover`
      )
    );
  }

  if (!isArray(shot.evidence_refs)) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_SHOT_FIELD_MISSING",
        `${path}.evidence_refs must be an array.`,
        `${path}.evidence_refs`
      )
    );
  }

  return issues;
}

function validateScriptShape(script, { expectedVariant, language } = {}) {
  const issues = [];

  if (!isPlainObject(script)) {
    return [
      issue(
        "STRUCTURE",
        "SCRIPT_NOT_OBJECT",
        "Script payload must be a JSON object.",
        "script"
      )
    ];
  }

  if (!SCRIPT_VARIANT_TYPES.includes(script.variant_type)) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_VARIANT_INVALID",
        `variant_type must be one of ${SCRIPT_VARIANT_TYPES.join(", ")}.`,
        "variant_type"
      )
    );
  }

  if (
    expectedVariant &&
    script.variant_type &&
    script.variant_type !== expectedVariant
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_VARIANT_MISMATCH",
        `Expected variant_type ${expectedVariant}, got ${script.variant_type}.`,
        "variant_type"
      )
    );
  }

  for (const field of [
    "title",
    "hook",
    "hook_type",
    "vo_text",
    "ending_hook"
  ]) {
    if (!isNonEmptyString(script[field])) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_FIELD_MISSING",
          `Script is missing required string field: ${field}`,
          field
        )
      );
    }
  }

  if (
    !Number.isFinite(Number(script.estimated_duration_seconds))
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_FIELD_MISSING",
        "estimated_duration_seconds must be a number.",
        "estimated_duration_seconds"
      )
    );
  }

  if (!isArray(script.shots)) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_FIELD_MISSING",
        "shots must be an array.",
        "shots"
      )
    );
  } else {
    if (
      script.shots.length < SCRIPT_SHOT_COUNT_MIN ||
      script.shots.length > SCRIPT_SHOT_COUNT_MAX
    ) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_SHOT_COUNT_INVALID",
          `shots must contain between ${SCRIPT_SHOT_COUNT_MIN} and ${SCRIPT_SHOT_COUNT_MAX} entries, got ${script.shots.length}.`,
          "shots"
        )
      );
    }

    script.shots.forEach((shot, index) => {
      issues.push(...validateShotShape(shot, index));
    });

    const firstShotDuration = Number(
      script.shots[0] && script.shots[0].duration_seconds
    );

    if (
      Number.isFinite(firstShotDuration) &&
      firstShotDuration > SCRIPT_HOOK_WINDOW_SECONDS
    ) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_HOOK_NOT_IN_WINDOW",
          `The first shot must resolve within ${SCRIPT_HOOK_WINDOW_SECONDS} seconds to keep the hook in the opening window.`,
          "shots[0].duration_seconds"
        )
      );
    }
  }

  for (const field of [
    "evidence_map",
    "canon_constraints",
    "ip_safety_notes",
    "risk_flags"
  ]) {
    if (!isArray(script[field])) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_FIELD_MISSING",
          `Script field ${field} must be an array.`,
          field
        )
      );
    }
  }

  if (!isArray(script.proposed_state_changes)) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_FIELD_MISSING",
        "Script field proposed_state_changes must be an array.",
        "proposed_state_changes"
      )
    );
  } else {
    script.proposed_state_changes.forEach((change, index) => {
      issues.push(
        ...validateProposedStateChangeShape(
          change,
          `proposed_state_changes[${index}]`
        )
      );
    });
  }

  const duration = computeScriptDuration(script.shots);

  if (
    duration < SCRIPT_DURATION_MIN_SECONDS ||
    duration > SCRIPT_DURATION_MAX_SECONDS
  ) {
    issues.push(
      issue(
        "STRUCTURE",
        "SCRIPT_DURATION_OUT_OF_RANGE",
        `Recomputed script duration ${duration}s must be between ${SCRIPT_DURATION_MIN_SECONDS} and ${SCRIPT_DURATION_MAX_SECONDS}.`,
        "shots"
      )
    );
  }

  if ((language || "en") === "en") {
    const wordCount = countEnglishWords(script.vo_text);

    if (
      wordCount < SCRIPT_WORD_COUNT_MIN ||
      wordCount > SCRIPT_WORD_COUNT_MAX
    ) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_WORD_COUNT_OUT_OF_RANGE",
          `vo_text has ${wordCount} words; English scripts require ${SCRIPT_WORD_COUNT_MIN}-${SCRIPT_WORD_COUNT_MAX}.`,
          "vo_text"
        )
      );
    }
  }

  return issues;
}

function validateScriptBatchShape(scripts, { language } = {}) {
  const issues = [];

  if (!Array.isArray(scripts) || scripts.length !== 3) {
    return [
      issue(
        "STRUCTURE",
        "SCRIPT_COUNT_INVALID",
        "Exactly three script variants are required per batch.",
        "scripts"
      )
    ];
  }

  const seenVariants = new Set();

  for (const script of scripts) {
    const variant = isPlainObject(script)
      ? script.variant_type
      : null;

    if (variant && seenVariants.has(variant)) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_VARIANT_DUPLICATE",
          `variant_type ${variant} appears more than once in the batch.`,
          "scripts"
        )
      );
    }

    if (variant) {
      seenVariants.add(variant);
    }

    issues.push(...validateScriptShape(script, { language }));
  }

  for (const requiredVariant of SCRIPT_VARIANT_TYPES) {
    if (!seenVariants.has(requiredVariant)) {
      issues.push(
        issue(
          "STRUCTURE",
          "SCRIPT_VARIANT_MISSING",
          `Required variant_type ${requiredVariant} is missing from the batch.`,
          "scripts"
        )
      );
    }
  }

  return issues;
}

// =========================================================
// GEMINI-COMPATIBLE JSON SCHEMAS — Task 3.4E structured-output
// hotfix.
//
// These constants mirror the shape checks above field-for-field
// so Gemini's responseJsonSchema constrains generation up front,
// instead of the model only being told "return valid JSON" and
// finding out it was structurally wrong after the fact. They
// intentionally encode ONLY object/array/type/enum shape --
// never Canon Vocabulary, Transition Matrix, Evidence, or IP
// checks, which stay exclusively in validators.js (runCanonValidator
// / runEvidenceValidator / runIPValidator) since those require
// contextual data (the candidate snapshot, evidence id set) that
// has no place in a request-time JSON Schema.
// =========================================================

const PROPOSED_STATE_CHANGE_JSON_SCHEMA = {
  type: "object",
  description:
    "A single proposed (never committed) Canon state change.",
  properties: {
    state: {
      type: "string",
      enum: ["PROPOSED_STATE_CHANGE"]
    },
    previous_state: {
      description: "The prior APEX state, or null if this is a legal initial event.",
      anyOf: [{ type: "string" }, { type: "null" }]
    },
    target_state: { type: "string" },
    entity_type: { type: "string" },
    reason: { type: "string" },
    evidence_refs: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "state",
    "previous_state",
    "target_state",
    "entity_type",
    "reason",
    "evidence_refs"
  ],
  additionalProperties: false
};

const VEHICLE_TRANSFORMATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    evidence_vehicle: { type: "string" },
    canon_vehicle_name: { type: "string" },
    preserved_traits: { type: "array", items: { type: "string" } },
    changed_traits: { type: "array", items: { type: "string" } },
    official_partnership_implied: { type: "boolean" }
  },
  required: [
    "evidence_vehicle",
    "canon_vehicle_name",
    "preserved_traits",
    "changed_traits",
    "official_partnership_implied"
  ],
  additionalProperties: false
};

const CHARACTER_CONCEPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    canon_driver_name: { type: "string" },
    canon_team_name: { type: "string" },
    motivation: { type: "string" },
    internal_conflict: { type: "string" }
  },
  required: [
    "canon_driver_name",
    "canon_team_name",
    "motivation",
    "internal_conflict"
  ],
  additionalProperties: false
};

const DIRECTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    direction_key: { type: "string" },
    direction_type: { type: "string", enum: DIRECTION_TYPES },
    title: { type: "string" },
    review_summary: { type: "string" },
    hook: { type: "string" },
    logline: { type: "string" },
    core_conflict: { type: "string" },
    why_now: { type: "string" },
    season_function: { type: "string" },
    beat_connection: { type: "string" },
    vehicle_transformation: VEHICLE_TRANSFORMATION_JSON_SCHEMA,
    character_concept: CHARACTER_CONCEPT_JSON_SCHEMA,
    evidence_refs: { type: "array", items: { type: "string" } },
    canon_connections: { type: "array", items: { type: "string" } },
    risk_flags: { type: "array", items: { type: "string" } },
    proposed_state_changes: {
      type: "array",
      items: PROPOSED_STATE_CHANGE_JSON_SCHEMA
    }
  },
  required: [
    "direction_key",
    "direction_type",
    "title",
    "review_summary",
    "hook",
    "logline",
    "core_conflict",
    "why_now",
    "season_function",
    "beat_connection",
    "vehicle_transformation",
    "character_concept",
    "evidence_refs",
    "canon_connections",
    "risk_flags",
    "proposed_state_changes"
  ],
  additionalProperties: false
};

const STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA = {
  type: "object",
  description: "Exactly four Story Directions, one per required direction_type.",
  properties: {
    directions: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: DIRECTION_JSON_SCHEMA
    }
  },
  required: ["directions"],
  additionalProperties: false
};

const SHORT_STRUCTURE_JSON_SCHEMA = {
  type: "object",
  properties: {
    hook_seconds: { type: "number" },
    estimated_duration_seconds: { type: "number" },
    narrative_beats: { type: "array", items: { type: "string" } }
  },
  required: [
    "hook_seconds",
    "estimated_duration_seconds",
    "narrative_beats"
  ],
  additionalProperties: false
};

const OUTLINE_JSON_SCHEMA = {
  type: "object",
  properties: {
    outline_title: { type: "string" },
    review_summary: { type: "string" },
    opening_situation: { type: "string" },
    inciting_incident: { type: "string" },
    vehicle_and_driver_introduction: { type: "string" },
    world_conflict: { type: "string" },
    qualifier_challenge: { type: "string" },
    escalation: { type: "string" },
    choice_or_sacrifice: { type: "string" },
    outcome: { type: "string" },
    next_episode_hook: { type: "string" },
    canon_state_impact: PROPOSED_STATE_CHANGE_JSON_SCHEMA,
    evidence_map: { type: "array", items: { type: "string" } },
    canon_constraints: { type: "array", items: { type: "string" } },
    forbidden_elements_respected: {
      type: "array",
      items: { type: "string" }
    },
    short_structure: SHORT_STRUCTURE_JSON_SCHEMA
  },
  required: [
    ...OUTLINE_REQUIRED_STRING_FIELDS,
    "canon_state_impact",
    "evidence_map",
    "canon_constraints",
    "forbidden_elements_respected",
    "short_structure"
  ],
  additionalProperties: false
};

const STORY_OUTLINE_RESPONSE_JSON_SCHEMA = OUTLINE_JSON_SCHEMA;

const SHOT_JSON_SCHEMA = {
  type: "object",
  properties: {
    shot_no: { type: "number" },
    duration_seconds: { type: "number" },
    visual: { type: "string" },
    voiceover: { type: "string" },
    on_screen_text: { type: "string" },
    evidence_refs: { type: "array", items: { type: "string" } },
    canon_function: { type: "string" }
  },
  required: [
    "shot_no",
    "duration_seconds",
    "visual",
    "voiceover",
    "evidence_refs"
  ],
  additionalProperties: false
};

const SCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    variant_type: { type: "string", enum: SCRIPT_VARIANT_TYPES },
    title: { type: "string" },
    hook: { type: "string" },
    hook_type: { type: "string" },
    vo_text: { type: "string" },
    ending_hook: { type: "string" },
    estimated_duration_seconds: { type: "number" },
    shots: {
      type: "array",
      minItems: SCRIPT_SHOT_COUNT_MIN,
      maxItems: SCRIPT_SHOT_COUNT_MAX,
      items: SHOT_JSON_SCHEMA
    },
    evidence_map: { type: "array", items: { type: "string" } },
    canon_constraints: { type: "array", items: { type: "string" } },
    ip_safety_notes: { type: "array", items: { type: "string" } },
    risk_flags: { type: "array", items: { type: "string" } },
    proposed_state_changes: {
      type: "array",
      items: PROPOSED_STATE_CHANGE_JSON_SCHEMA
    }
  },
  required: [
    "variant_type",
    "title",
    "hook",
    "hook_type",
    "vo_text",
    "ending_hook",
    "estimated_duration_seconds",
    "shots",
    "evidence_map",
    "canon_constraints",
    "ip_safety_notes",
    "risk_flags",
    "proposed_state_changes"
  ],
  additionalProperties: false
};

const STORY_SCRIPTS_RESPONSE_JSON_SCHEMA = {
  type: "object",
  description: "Exactly three Script variants, one per required variant_type.",
  properties: {
    scripts: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: SCRIPT_JSON_SCHEMA
    }
  },
  required: ["scripts"],
  additionalProperties: false
};

module.exports = {
  DIRECTION_TYPES,
  SCRIPT_VARIANT_TYPES,
  OUTLINE_REQUIRED_STRING_FIELDS,
  OUTLINE_NARRATIVE_FIELDS,
  OUTLINE_MIN_NARRATIVE_CHARS,
  SCRIPT_WORD_COUNT_MIN,
  SCRIPT_WORD_COUNT_MAX,
  SCRIPT_DURATION_MIN_SECONDS,
  SCRIPT_DURATION_MAX_SECONDS,
  SCRIPT_SHOT_COUNT_MIN,
  SCRIPT_SHOT_COUNT_MAX,
  SCRIPT_HOOK_WINDOW_SECONDS,
  countEnglishWords,
  computeScriptDuration,
  issue,
  isPlainObject,
  isNonEmptyString,
  isArray,
  validateProposedStateChangeShape,
  validateDirectionShape,
  validateDirectionBatchShape,
  validateOutlineShape,
  validateScriptShape,
  validateScriptBatchShape,
  PROPOSED_STATE_CHANGE_JSON_SCHEMA,
  VEHICLE_TRANSFORMATION_JSON_SCHEMA,
  CHARACTER_CONCEPT_JSON_SCHEMA,
  DIRECTION_JSON_SCHEMA,
  STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA,
  SHORT_STRUCTURE_JSON_SCHEMA,
  OUTLINE_JSON_SCHEMA,
  STORY_OUTLINE_RESPONSE_JSON_SCHEMA,
  SHOT_JSON_SCHEMA,
  SCRIPT_JSON_SCHEMA,
  STORY_SCRIPTS_RESPONSE_JSON_SCHEMA
};
