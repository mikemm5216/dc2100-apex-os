const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadCanonBundle, CanonError } = require("../lib/story/canon");

const {
  validateDirectionShape,
  validateDirectionBatchShape,
  validateOutlineShape,
  validateScriptShape,
  validateScriptBatchShape,
  countEnglishWords,
  computeScriptDuration
} = require("../lib/story/schemas");

const {
  APEX_STATE_ALLOWLIST,
  isLegalStateTransition,
  validateDirectionBatch,
  validateOutline,
  validateScript
} = require("../lib/story/validators");

// ---------------------------------------------------------
// Fixtures: valid canon documents written to a throwaway temp
// directory per case, so canon.js's file-missing / not-approved
// / version-mismatch / conflict branches can be exercised
// without touching the real docs/canon files.
// ---------------------------------------------------------

const CANON_FILENAMES = [
  "DC2100_STORY_BIBLE_V1.md",
  "APEX_RULES_V1.md",
  "SEASON_1_GLOBAL_QUALIFIERS.md",
  "CANON_STATE_MODEL.md"
];

function validCanonFileContent(overrides = {}) {
  const fields = {
    canon_version: "1.0.0",
    document_status: "APPROVED_V1",
    approved_by: "michael",
    approval_effective_on_merge: "true",
    ...overrides
  };

  return `# Canon Doc

\`\`\`
canon_version: ${fields.canon_version}
document_status: ${fields.document_status}
approved_by: ${fields.approved_by}
approval_effective_on_merge: ${fields.approval_effective_on_merge}
\`\`\`

Body content here.
${overrides.extraBody || ""}
`;
}

function writeFixtureCanonDir(perFileOverrides = {}) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "story-canon-fixture-")
  );

  for (const filename of CANON_FILENAMES) {
    fs.writeFileSync(
      path.join(dir, filename),
      validCanonFileContent(perFileOverrides[filename] || {})
    );
  }

  return dir;
}

function run() {
  // -------------------------------------------------------
  // CANON: all four files valid -> loads successfully.
  // -------------------------------------------------------
  {
    const dir = writeFixtureCanonDir();
    const bundle = loadCanonBundle({ canonDir: dir });

    assert.equal(bundle.canon_version, "1.0.0");
    assert.ok(bundle.canon_hash.startsWith("sha256:"));
    assert.ok(bundle.story_bible.length > 0);
    assert.ok(bundle.apex_rules.length > 0);
    assert.ok(bundle.season_outline.length > 0);
    assert.ok(bundle.state_model.length > 0);
  }

  // -------------------------------------------------------
  // CANON_FILE_MISSING
  // -------------------------------------------------------
  {
    const dir = writeFixtureCanonDir();
    fs.unlinkSync(path.join(dir, "APEX_RULES_V1.md"));

    assert.throws(
      () => loadCanonBundle({ canonDir: dir }),
      error => {
        assert.ok(error instanceof CanonError);
        assert.equal(error.code, "CANON_FILE_MISSING");
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // CANON_NOT_APPROVED
  // -------------------------------------------------------
  {
    const dir = writeFixtureCanonDir({
      "APEX_RULES_V1.md": { document_status: "DRAFT_AWAITING_APPROVAL" }
    });

    assert.throws(
      () => loadCanonBundle({ canonDir: dir }),
      error => {
        assert.equal(error.code, "CANON_NOT_APPROVED");
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // CANON_VERSION_MISMATCH
  // -------------------------------------------------------
  {
    const dir = writeFixtureCanonDir({
      "CANON_STATE_MODEL.md": { canon_version: "1.0.1" }
    });

    assert.throws(
      () => loadCanonBundle({ canonDir: dir }),
      error => {
        assert.equal(error.code, "CANON_VERSION_MISMATCH");
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // CANON_CONFLICT (explicit unresolved marker)
  // -------------------------------------------------------
  {
    const dir = writeFixtureCanonDir({
      "DC2100_STORY_BIBLE_V1.md": {
        extraBody: "CANON_CONFLICT_UNRESOLVED: true"
      }
    });

    assert.throws(
      () => loadCanonBundle({ canonDir: dir }),
      error => {
        assert.equal(error.code, "CANON_CONFLICT");
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // Candidate snapshot immutability guarantee: no gate/regen/
  // cancel/resume function may re-query vehicle_fusion_candidates
  // after the run is created -- only buildCandidateSnapshot and
  // createStoryRun (which calls it) are allowed to reference it.
  // -------------------------------------------------------
  {
    const fullEngineSource = fs.readFileSync(
      path.join(__dirname, "..", "lib", "story", "engine.js"),
      "utf8"
    );

    // Skip the file's leading doc-comment block (which
    // mentions the table name in prose) and only scan actual
    // code.
    const engineSource = fullEngineSource.slice(
      fullEngineSource.indexOf("class StoryError")
    );

    const totalOccurrences = (
      engineSource.match(/vehicle_fusion_candidates/g) || []
    ).length;

    const snapshotFnStart = engineSource.indexOf(
      "async function buildCandidateSnapshot"
    );
    const snapshotFnEnd = engineSource.indexOf(
      "\nfunction evidenceIdsFromSnapshot"
    );

    assert.ok(snapshotFnStart > -1 && snapshotFnEnd > snapshotFnStart);

    const snapshotFnBody = engineSource.slice(
      snapshotFnStart,
      snapshotFnEnd
    );

    const createRunFnStart = engineSource.indexOf(
      "async function createStoryRun"
    );
    const createRunFnEnd = engineSource.indexOf(
      "\n// =========================================================\n// GATE 1"
    );

    assert.ok(createRunFnStart > -1 && createRunFnEnd > createRunFnStart);

    const createRunFnBody = engineSource.slice(
      createRunFnStart,
      createRunFnEnd
    );

    const occurrencesInAllowedFns =
      (snapshotFnBody.match(/vehicle_fusion_candidates/g) || []).length +
      (createRunFnBody.match(/vehicle_fusion_candidates/g) || []).length;

    assert.equal(
      occurrencesInAllowedFns,
      totalOccurrences,
      "vehicle_fusion_candidates must only be queried while building the immutable snapshot, never by any gate/regenerate/cancel/resume function."
    );
  }

  // -------------------------------------------------------
  // Directions: exactly one of each of the four types.
  // -------------------------------------------------------
  function makeDirection(type, overrides = {}) {
    return {
      direction_key: `DIRECTION-${type}`,
      direction_type: type,
      title: `Title for ${type}`,
      review_summary: "review",
      hook: "hook",
      logline: "logline",
      core_conflict: "conflict",
      why_now: "why now",
      vehicle_transformation: {
        evidence_vehicle: "Real Car X",
        canon_vehicle_name: "Fictional Vehicle Prime",
        preserved_traits: ["speed"],
        changed_traits: ["color"],
        official_partnership_implied: false
      },
      character_concept: {
        canon_driver_name: "Fictional Driver Name",
        canon_team_name: "Fictional Team Name",
        motivation: "motivation",
        internal_conflict: "internal conflict"
      },
      evidence_refs: ["vehicle:1"],
      canon_connections: [],
      season_function: "season function",
      beat_connection: "beat connection",
      proposed_state_changes: [],
      risk_flags: [],
      ...overrides
    };
  }

  {
    const directions = [
      makeDirection("VEHICLE_POWER"),
      makeDirection("COUNTRY_CONFLICT"),
      makeDirection("PERSON_CULTURE"),
      makeDirection("APEX_PROGRESSION")
    ];

    const issues = validateDirectionBatchShape(directions);
    assert.deepEqual(issues, []);
  }

  // -------------------------------------------------------
  // Duplicate direction type rejected.
  // -------------------------------------------------------
  {
    const directions = [
      makeDirection("VEHICLE_POWER"),
      makeDirection("VEHICLE_POWER"),
      makeDirection("PERSON_CULTURE"),
      makeDirection("APEX_PROGRESSION")
    ];

    const issues = validateDirectionBatchShape(directions);

    assert.ok(
      issues.some(i => i.code === "DIRECTION_TYPE_DUPLICATE")
    );
    assert.ok(
      issues.some(i => i.code === "DIRECTION_TYPE_MISSING")
    );
  }

  // -------------------------------------------------------
  // Outline: missing required sections rejected.
  // -------------------------------------------------------
  function makeOutline(overrides = {}) {
    const longSection = "A".repeat(100);

    return {
      outline_title: "Title",
      review_summary: "summary",
      opening_situation: longSection,
      inciting_incident: longSection,
      vehicle_and_driver_introduction: longSection,
      world_conflict: longSection,
      qualifier_challenge: longSection,
      escalation: longSection,
      choice_or_sacrifice: longSection,
      outcome: longSection,
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "QUALIFIER_ENTERED",
        entity_type: "DRIVER",
        previous_state: "CANDIDATE_APPROVED",
        evidence_refs: ["vehicle:1"],
        reason: "reason"
      },
      next_episode_hook: longSection,
      evidence_map: ["vehicle:1"],
      canon_constraints: [],
      forbidden_elements_respected: [],
      short_structure: {
        hook_seconds: 3,
        estimated_duration_seconds: 35,
        narrative_beats: ["beat1"]
      },
      ...overrides
    };
  }

  {
    const outline = makeOutline();
    delete outline.choice_or_sacrifice;

    const issues = validateOutlineShape(outline);

    assert.ok(
      issues.some(
        i =>
          i.code === "OUTLINE_FIELD_MISSING" &&
          i.path === "choice_or_sacrifice"
      )
    );
  }

  // -------------------------------------------------------
  // Outline: below the 800-char narrative minimum rejected.
  // -------------------------------------------------------
  {
    const outline = makeOutline({
      opening_situation: "short",
      inciting_incident: "short",
      vehicle_and_driver_introduction: "short",
      world_conflict: "short",
      qualifier_challenge: "short",
      escalation: "short",
      choice_or_sacrifice: "short",
      outcome: "short",
      next_episode_hook: "short"
    });

    const issues = validateOutlineShape(outline);

    assert.ok(issues.some(i => i.code === "OUTLINE_TOO_SHORT"));
  }

  // -------------------------------------------------------
  // Scripts: exactly one of each of the three variants.
  // -------------------------------------------------------
  function makeShots(count, { firstShotSeconds = 3, totalSeconds = 35 } = {}) {
    const shots = [];
    const remaining = totalSeconds - firstShotSeconds;
    const trailingCount = count - 1 || 1;
    const perShot = Math.max(1, Math.floor(remaining / trailingCount));
    const distributed = perShot * (trailingCount - 1);
    const lastShotSeconds = Math.max(1, remaining - distributed);

    for (let i = 0; i < count; i += 1) {
      const duration =
        i === 0
          ? firstShotSeconds
          : i === count - 1
          ? lastShotSeconds
          : perShot;

      shots.push({
        shot_no: i + 1,
        duration_seconds: duration,
        visual: `visual ${i + 1}`,
        voiceover: `voiceover ${i + 1}`,
        on_screen_text: "",
        evidence_refs: ["vehicle:1"],
        canon_function: "function"
      });
    }

    return shots;
  }

  function englishWords(count) {
    return new Array(count).fill("word").join(" ");
  }

  function makeScript(variant, overrides = {}) {
    return {
      variant_type: variant,
      title: "Title",
      hook: "hook",
      hook_type: "action",
      vo_text: englishWords(90),
      estimated_duration_seconds: 35,
      shots: makeShots(6),
      ending_hook: "ending hook",
      proposed_state_changes: [],
      evidence_map: ["vehicle:1"],
      canon_constraints: [],
      ip_safety_notes: [],
      risk_flags: [],
      ...overrides
    };
  }

  {
    const scripts = [
      makeScript("VEHICLE_FIRST"),
      makeScript("WORLD_FIRST"),
      makeScript("CHARACTER_FIRST")
    ];

    const issues = validateScriptBatchShape(scripts, { language: "en" });
    assert.deepEqual(issues, []);
  }

  // -------------------------------------------------------
  // Word count boundary tests (69/70/110/111).
  // -------------------------------------------------------
  {
    const script69 = makeScript("VEHICLE_FIRST", {
      vo_text: englishWords(69)
    });
    const issues69 = validateScriptShape(script69, { language: "en" });
    assert.ok(
      issues69.some(i => i.code === "SCRIPT_WORD_COUNT_OUT_OF_RANGE")
    );

    const script70 = makeScript("VEHICLE_FIRST", {
      vo_text: englishWords(70)
    });
    const issues70 = validateScriptShape(script70, { language: "en" });
    assert.ok(
      !issues70.some(i => i.code === "SCRIPT_WORD_COUNT_OUT_OF_RANGE")
    );

    const script110 = makeScript("VEHICLE_FIRST", {
      vo_text: englishWords(110)
    });
    const issues110 = validateScriptShape(script110, { language: "en" });
    assert.ok(
      !issues110.some(i => i.code === "SCRIPT_WORD_COUNT_OUT_OF_RANGE")
    );

    const script111 = makeScript("VEHICLE_FIRST", {
      vo_text: englishWords(111)
    });
    const issues111 = validateScriptShape(script111, { language: "en" });
    assert.ok(
      issues111.some(i => i.code === "SCRIPT_WORD_COUNT_OUT_OF_RANGE")
    );
  }

  // -------------------------------------------------------
  // Shot count boundary tests (4/5/8/9).
  // -------------------------------------------------------
  {
    const script4 = makeScript("VEHICLE_FIRST", { shots: makeShots(4) });
    assert.ok(
      validateScriptShape(script4, { language: "en" }).some(
        i => i.code === "SCRIPT_SHOT_COUNT_INVALID"
      )
    );

    const script5 = makeScript("VEHICLE_FIRST", { shots: makeShots(5) });
    assert.ok(
      !validateScriptShape(script5, { language: "en" }).some(
        i => i.code === "SCRIPT_SHOT_COUNT_INVALID"
      )
    );

    const script8 = makeScript("VEHICLE_FIRST", { shots: makeShots(8) });
    assert.ok(
      !validateScriptShape(script8, { language: "en" }).some(
        i => i.code === "SCRIPT_SHOT_COUNT_INVALID"
      )
    );

    const script9 = makeScript("VEHICLE_FIRST", { shots: makeShots(9) });
    assert.ok(
      validateScriptShape(script9, { language: "en" }).some(
        i => i.code === "SCRIPT_SHOT_COUNT_INVALID"
      )
    );
  }

  // -------------------------------------------------------
  // Duration boundary tests (24/25/45/46).
  // -------------------------------------------------------
  {
    const script24 = makeScript("VEHICLE_FIRST", {
      shots: makeShots(6, { firstShotSeconds: 3, totalSeconds: 24 })
    });
    assert.equal(computeScriptDuration(script24.shots), 24);
    assert.ok(
      validateScriptShape(script24, { language: "en" }).some(
        i => i.code === "SCRIPT_DURATION_OUT_OF_RANGE"
      )
    );

    const script25 = makeScript("VEHICLE_FIRST", {
      shots: makeShots(6, { firstShotSeconds: 3, totalSeconds: 25 })
    });
    assert.equal(computeScriptDuration(script25.shots), 25);
    assert.ok(
      !validateScriptShape(script25, { language: "en" }).some(
        i => i.code === "SCRIPT_DURATION_OUT_OF_RANGE"
      )
    );

    const script45 = makeScript("VEHICLE_FIRST", {
      shots: makeShots(6, { firstShotSeconds: 3, totalSeconds: 45 })
    });
    assert.equal(computeScriptDuration(script45.shots), 45);
    assert.ok(
      !validateScriptShape(script45, { language: "en" }).some(
        i => i.code === "SCRIPT_DURATION_OUT_OF_RANGE"
      )
    );

    const script46 = makeScript("VEHICLE_FIRST", {
      shots: makeShots(6, { firstShotSeconds: 3, totalSeconds: 46 })
    });
    assert.equal(computeScriptDuration(script46.shots), 46);
    assert.ok(
      validateScriptShape(script46, { language: "en" }).some(
        i => i.code === "SCRIPT_DURATION_OUT_OF_RANGE"
      )
    );
  }

  // -------------------------------------------------------
  // CANON_STATE_COMMITTED literal must be rejected.
  // -------------------------------------------------------
  {
    const outline = makeOutline({
      outcome: "The result is CANON_STATE_COMMITTED for this driver."
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(
        i => i.code === "CANON_STATE_COMMITTED_FORBIDDEN"
      )
    );
  }

  // -------------------------------------------------------
  // Illegal state transition rejected (target_state not in
  // the APEX state allowlist).
  // -------------------------------------------------------
  {
    const outline = makeOutline({
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "CHAMPION_CROWNED",
        entity_type: "DRIVER",
        previous_state: "DISCOVERED",
        evidence_refs: ["vehicle:1"],
        reason: "reason"
      }
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "STATE_TRANSITION_INVALID")
    );
  }

  // -------------------------------------------------------
  // Real Canon State Transition Matrix (Section 5 fix):
  // target_state membership in the allowlist is NOT the same
  // as a legal transition. Exercise isLegalStateTransition()
  // directly for the full valid/invalid matrix, then confirm
  // the outline-level validator enforces it end to end.
  // -------------------------------------------------------
  {
    const validTransitions = [
      ["DISCOVERED", "CANDIDATE_APPROVED"],
      ["QUALIFIER_ENTERED", "QUALIFIER_PASSED"],
      ["QUALIFIER_FAILED", "RESERVE"],
      ["COMEBACK_PENDING", "COMEBACK_GRANTED"],
      ["REGION_LOCKED", "REGION_UNLOCKED"],
      ["VEHICLE_DAMAGED", "VEHICLE_REPAIRED"]
    ];

    for (const [previousState, targetState] of validTransitions) {
      assert.equal(
        isLegalStateTransition(previousState, targetState),
        true,
        `${previousState} -> ${targetState} must be legal`
      );
    }

    const invalidTransitions = [
      ["DISCOVERED", "COMEBACK_GRANTED"],
      ["QUALIFIER_PASSED", "RESERVE"],
      ["DISQUALIFIED", "COMEBACK_PENDING"],
      ["REGION_LOCKED", "QUALIFIER_PASSED"],
      ["VEHICLE_DAMAGED", "WILD_CARD_GRANTED"]
    ];

    for (const [previousState, targetState] of invalidTransitions) {
      assert.equal(
        isLegalStateTransition(previousState, targetState),
        false,
        `${previousState} -> ${targetState} must NOT be legal`
      );
    }
  }

  // Illegal transition end-to-end through the outline validator
  // (previous_state -> target_state both real states, but the
  // transition itself is never allowed).
  {
    const outline = makeOutline({
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "RESERVE",
        entity_type: "DRIVER",
        previous_state: "QUALIFIER_PASSED",
        evidence_refs: ["vehicle:1"],
        reason: "reason"
      }
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "STATE_TRANSITION_INVALID")
    );
  }

  // Missing previous_state for a non-initial state rejected.
  {
    const outline = makeOutline({
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "QUALIFIER_PASSED",
        entity_type: "DRIVER",
        previous_state: null,
        evidence_refs: ["vehicle:1"],
        reason: "reason"
      }
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "STATE_TRANSITION_INVALID")
    );
  }

  // Wrong entity_type for the target_state rejected.
  {
    const outline = makeOutline({
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "VEHICLE_DAMAGED",
        entity_type: "DRIVER",
        previous_state: null,
        evidence_refs: ["vehicle:1"],
        reason: "reason"
      }
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "STATE_TRANSITION_INVALID")
    );
  }

  // Unknown target_state (not in the APEX allowlist) rejected --
  // regression guard, already covered above but re-asserted via
  // isLegalStateTransition/APEX_STATE_ALLOWLIST directly too.
  {
    assert.equal(
      APEX_STATE_ALLOWLIST.includes("CHAMPION_CROWNED"),
      false
    );
  }

  // -------------------------------------------------------
  // Traffic deciding the result rejected.
  // -------------------------------------------------------
  {
    const outline = makeOutline({
      outcome:
        "In the end, the sheer viral traffic decided the race winner outright."
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "TRAFFIC_DECIDES_RESULT")
    );
  }

  // -------------------------------------------------------
  // Evidence ref not existing in the snapshot rejected.
  // -------------------------------------------------------
  {
    const outline = makeOutline({
      evidence_map: ["vehicle:1", "country_news:999"]
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "EVIDENCE_REF_NOT_FOUND")
    );
  }

  // -------------------------------------------------------
  // NO_PERSON_SIGNAL is a legal input -- it must not itself
  // produce any validation issue.
  // -------------------------------------------------------
  {
    const outline = makeOutline();

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: true
    });

    assert.equal(result.validation_status, "PASS");
  }

  // -------------------------------------------------------
  // Real person used directly as Canon Driver rejected.
  // -------------------------------------------------------
  {
    const direction = makeDirection("PERSON_CULTURE", {
      character_concept: {
        canon_driver_name: "Real Person Name",
        canon_team_name: "Fictional Team",
        motivation: "motivation",
        internal_conflict: "conflict"
      }
    });

    const result = validateDirectionBatch(
      [
        direction,
        makeDirection("VEHICLE_POWER"),
        makeDirection("COUNTRY_CONFLICT"),
        makeDirection("APEX_PROGRESSION")
      ],
      {
        evidenceIds: new Set(["vehicle:1"]),
        noPersonSignal: false,
        personCanonicalName: "Real Person Name"
      }
    );

    assert.equal(result.perDirection[0].validation_status, "BLOCKED");
    assert.ok(
      result.perDirection[0].issues.some(
        i => i.code === "REAL_PERSON_AS_CANON_DRIVER"
      )
    );
  }

  // -------------------------------------------------------
  // Official brand partnership implied rejected.
  // -------------------------------------------------------
  {
    const direction = makeDirection("VEHICLE_POWER", {
      hook: "Built in official partnership with the manufacturer."
    });

    const result = validateDirectionBatch(
      [
        direction,
        makeDirection("COUNTRY_CONFLICT"),
        makeDirection("PERSON_CULTURE"),
        makeDirection("APEX_PROGRESSION")
      ],
      { evidenceIds: new Set(["vehicle:1"]), noPersonSignal: false }
    );

    assert.equal(result.perDirection[0].validation_status, "BLOCKED");
    assert.ok(
      result.perDirection[0].issues.some(
        i => i.code === "OFFICIAL_PARTNERSHIP_IMPLIED"
      )
    );
  }

  console.log("TASK 3.4E STORY CORE TESTS PASSED");
}

run();
