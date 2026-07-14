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
  validateDirection,
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

  // =========================================================
  // Task 3.5E: Integrated Story Directions -- Vehicle / Country /
  // Person / APEX are evidence LAYERS every direction must fuse,
  // never four mutually-exclusive topics. This fixture and the
  // tests below use the regression candidate from production
  // (vehicle:9 / country_news:413 / person:13 /
  // historical_resonance:13 / BEAT-04).
  // =========================================================

  const REGRESSION_EVIDENCE_IDS = new Set([
    "vehicle:9",
    "country_news:413",
    "person:13",
    "historical_resonance:13"
  ]);
  const REGRESSION_LOCKED_BEAT_ID = "BEAT-04";
  const REGRESSION_PERSON_CANONICAL_NAME = "Keiichi Tsuchiya";

  function makeIntegratedDirection(emphasis, overrides = {}) {
    return {
      direction_id: `DIR-${emphasis}`,
      direction_type: "INTEGRATED_STORY",
      narrative_emphasis: emphasis,
      title: `Title for ${emphasis}`,
      review_summary: "review",
      hook: "hook",
      logline: "logline",
      core_conflict: "conflict",
      why_now: "why now",
      signal_contributions: {
        vehicle: {
          evidence_refs: ["vehicle:9"],
          story_function: "grounds the technical stakes",
          preserved_traits: ["speed"],
          transformed_traits: ["color"]
        },
        country: {
          evidence_refs: ["country_news:413"],
          story_function: "raises the external pressure",
          dc2100_pressure: "new intelligence agency scrutiny",
          direct_effect_on_story:
            "the agency's monitoring forces a change to the qualifying route and inspection schedule"
        },
        person: {
          evidence_refs: ["person:13", "historical_resonance:13"],
          story_function: "shapes the driver's instinct",
          fictionalized_trait:
            "an old-school drift lineage that distrusts full AI automation",
          historical_resonance_used: "historical_resonance:13"
        },
        apex: {
          beat_id: REGRESSION_LOCKED_BEAT_ID,
          stage: "GLOBAL_QUALIFIERS",
          rule_used: "manual override qualification rule",
          qualification_objective:
            "finish the qualifying stage within the time limit",
          failure_condition:
            "running out of reserved energy before the finish disqualifies the entrant",
          resource_or_scoring_constraint: "battery reserve budget"
        }
      },
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
        internal_conflict: "internal conflict",
        person_signal_influence:
          "draws his refusal to fully trust AI steering from the historical drift lineage"
      },
      causal_chain: [
        "the intelligence agency tightens surveillance on manual overrides across the qualifiers",
        "this forces the team to hide the drift-lock override from routine inspection",
        "the vehicle's technical limit means the override can only be used once per stage",
        "the driver draws on his heritage drift instinct to decide when to risk it",
        "this produces a concrete APEX qualifying choice under the resource constraint",
        "the qualifier result and a Canon state change follow from that choice"
      ],
      driver_choice: {
        option_a: "burn the override now to win the heat outright",
        option_b: "conserve the battery reserve for the next circuit",
        immediate_consequence: "wins now but is flagged by surveillance",
        long_term_cost: "risks disqualification at the next stage"
      },
      season_function: "season function",
      proposed_state_changes: [],
      next_episode_hook: "hook",
      risk_flags: [],
      canon_connections: [],
      coverage_status: {
        vehicle_signal: "USED",
        country_signal: "USED",
        person_signal: "USED",
        historical_resonance: "USED",
        apex_rules: "USED",
        locked_beat: "MATCH"
      },
      ...overrides
    };
  }

  const REGRESSION_CONTEXT = {
    evidenceIds: REGRESSION_EVIDENCE_IDS,
    hasCountrySignal: true,
    noPersonSignal: false,
    personCanonicalName: REGRESSION_PERSON_CANONICAL_NAME,
    lockedBeatId: REGRESSION_LOCKED_BEAT_ID
  };

  {
    const directions = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("SURVEILLANCE_TRAP"),
      makeIntegratedDirection("CULTURAL_LEGACY"),
      makeIntegratedDirection("RESOURCE_GAMBLE")
    ];

    const issues = validateDirectionBatchShape(directions);
    assert.deepEqual(issues, []);

    const { batch, perDirection } = validateDirectionBatch(
      directions,
      REGRESSION_CONTEXT
    );
    assert.equal(batch.validation_status, "PASS");
    for (const result of perDirection) {
      assert.equal(result.validation_status, "PASS");
    }
  }

  // -------------------------------------------------------
  // Batch size: 3 is valid, 2 and 5 are rejected.
  // -------------------------------------------------------
  {
    const threeDirections = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("SURVEILLANCE_TRAP"),
      makeIntegratedDirection("CULTURAL_LEGACY")
    ];
    assert.deepEqual(validateDirectionBatchShape(threeDirections), []);

    const twoDirections = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("SURVEILLANCE_TRAP")
    ];
    assert.ok(
      validateDirectionBatchShape(twoDirections).some(
        i => i.code === "DIRECTION_COUNT_INVALID"
      )
    );

    const fiveDirections = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("SURVEILLANCE_TRAP"),
      makeIntegratedDirection("CULTURAL_LEGACY"),
      makeIntegratedDirection("RESOURCE_GAMBLE"),
      makeIntegratedDirection("IDENTITY_CONFLICT")
    ];
    assert.ok(
      validateDirectionBatchShape(fiveDirections).some(
        i => i.code === "DIRECTION_COUNT_INVALID"
      )
    );
  }

  // -------------------------------------------------------
  // Duplicate narrative_emphasis rejected.
  // -------------------------------------------------------
  {
    const directions = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("CULTURAL_LEGACY")
    ];

    const issues = validateDirectionBatchShape(directions);

    assert.ok(
      issues.some(i => i.code === "NARRATIVE_EMPHASIS_DUPLICATE")
    );
  }

  // -------------------------------------------------------
  // Legacy direction_type value rejected by the shape validator --
  // the four old topic-based values are never valid on a new
  // direction.
  // -------------------------------------------------------
  {
    const legacyStyle = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      direction_type: "VEHICLE_POWER"
    });

    const issues = validateDirectionShape(legacyStyle);
    assert.ok(issues.some(i => i.code === "DIRECTION_TYPE_INVALID"));
  }

  // =========================================================
  // Task 3.5E Unit Tests (per the Integrated Story fix spec)
  // =========================================================

  // 1. All available signals appear in every direction (already
  // exercised by the PASS case above); a direction that drops the
  // Country signal while it genuinely exists is BLOCKED.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      signal_contributions: {
        ...makeIntegratedDirection("TECHNICAL_SACRIFICE").signal_contributions,
        country: { country_signal: "NOT_AVAILABLE" }
      },
      coverage_status: {
        ...makeIntegratedDirection("TECHNICAL_SACRIFICE").coverage_status,
        country_signal: "NOT_AVAILABLE"
      }
    });

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "INTEGRATED_COUNTRY_SIGNAL_USED")
    );
    assert.ok(
      result.issues.some(i => i.code === "SIGNAL_COVERAGE_INCOMPLETE")
    );
  }

  // 2. locked_beat_id cannot be overwritten by the model.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE");
    direction.signal_contributions.apex.beat_id = "BEAT-05";

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(result.issues.some(i => i.code === "LOCKED_BEAT_MATCHED"));
  }

  // 3. Country Signal must have a direct effect on the story
  // conditions, not just background color.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE");
    direction.signal_contributions.country.direct_effect_on_story = "news happened";

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "COUNTRY_SIGNAL_HAS_DIRECT_EFFECT")
    );
  }

  // 4. Person Signal must influence motivation/technical/cultural
  // conflict, not just supply a name.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE");
    direction.character_concept.person_signal_influence = "his name";

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "PERSON_SIGNAL_HAS_CHARACTER_EFFECT")
    );
  }

  // 5. APEX Rule must create a real win/lose constraint, not just a
  // closing "so they passed the qualifier" line.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE");
    direction.signal_contributions.apex.failure_condition = "fails";

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "APEX_RULE_CREATES_REAL_CONSTRAINT")
    );
  }

  // 6. Evidence refs must come from the real input -- an invented
  // evidence id is rejected even alongside real ones.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE");
    direction.signal_contributions.country.evidence_refs.push(
      "country_news:999999"
    );

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(result.issues.some(i => i.code === "EVIDENCE_REF_NOT_FOUND"));
  }

  // 7. A real person's name reused (even a single shared name
  // element, not just an exact full-name match) is rejected.
  {
    const direction = makeIntegratedDirection("CULTURAL_LEGACY");
    direction.character_concept.canon_driver_name = "Hiroshi Tsuchiya";

    const result = validateDirection(direction, REGRESSION_CONTEXT);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "REAL_PERSON_FICTIONALIZATION_SAFE")
    );
  }

  // 8. NO_PERSON_SIGNAL must never produce hallucinated person
  // evidence -- coverage/signal_contributions must both say
  // NOT_AVAILABLE, and using a real evidence_refs shape is rejected
  // even if noPersonSignal claims are set correctly.
  {
    const noPersonContext = {
      ...REGRESSION_CONTEXT,
      noPersonSignal: true,
      personCanonicalName: null
    };

    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE");
    // Candidate has NO_PERSON_SIGNAL, but this direction still
    // claims to use one.
    const result = validateDirection(direction, noPersonContext);
    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(
      result.issues.some(i => i.code === "INTEGRATED_PERSON_SIGNAL_USED")
    );

    // The correct NOT_AVAILABLE shape must PASS the coverage check.
    const correctDirection = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      signal_contributions: {
        ...makeIntegratedDirection("TECHNICAL_SACRIFICE").signal_contributions,
        person: { person_signal: "NOT_AVAILABLE", historical_resonance: "NOT_AVAILABLE" }
      },
      coverage_status: {
        ...makeIntegratedDirection("TECHNICAL_SACRIFICE").coverage_status,
        person_signal: "NOT_AVAILABLE",
        historical_resonance: "NOT_AVAILABLE"
      }
    });
    const correctResult = validateDirection(correctDirection, noPersonContext);
    assert.equal(correctResult.validation_status, "PASS");
  }

  // -------------------------------------------------------
  // REGRESSION FIXTURE: the exact production candidate
  // (vehicle:9 / country_news:413 / person:13 /
  // historical_resonance:13 / BEAT-04) must never again produce
  // four directions that each use only one evidence category.
  // -------------------------------------------------------
  {
    // The OLD (buggy) shape: one direction per evidence category.
    const legacyStyleBatch = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE", {
        signal_contributions: {
          vehicle: makeIntegratedDirection("TECHNICAL_SACRIFICE").signal_contributions.vehicle,
          country: { country_signal: "NOT_AVAILABLE" },
          person: { person_signal: "NOT_AVAILABLE", historical_resonance: "NOT_AVAILABLE" },
          apex: makeIntegratedDirection("TECHNICAL_SACRIFICE").signal_contributions.apex
        },
        coverage_status: {
          vehicle_signal: "USED",
          country_signal: "NOT_AVAILABLE",
          person_signal: "NOT_AVAILABLE",
          historical_resonance: "NOT_AVAILABLE",
          apex_rules: "USED",
          locked_beat: "MATCH"
        }
      }),
      makeIntegratedDirection("SURVEILLANCE_TRAP", {
        signal_contributions: {
          vehicle: { evidence_refs: ["vehicle:9"], story_function: "-", preserved_traits: [], transformed_traits: [] },
          country: makeIntegratedDirection("SURVEILLANCE_TRAP").signal_contributions.country,
          person: { person_signal: "NOT_AVAILABLE", historical_resonance: "NOT_AVAILABLE" },
          apex: makeIntegratedDirection("SURVEILLANCE_TRAP").signal_contributions.apex
        }
      }),
      makeIntegratedDirection("CULTURAL_LEGACY", {
        signal_contributions: {
          vehicle: { evidence_refs: ["vehicle:9"], story_function: "-", preserved_traits: [], transformed_traits: [] },
          country: { country_signal: "NOT_AVAILABLE" },
          person: makeIntegratedDirection("CULTURAL_LEGACY").signal_contributions.person,
          apex: makeIntegratedDirection("CULTURAL_LEGACY").signal_contributions.apex
        }
      })
    ];

    const { perDirection } = validateDirectionBatch(
      legacyStyleBatch,
      REGRESSION_CONTEXT
    );

    // Every single-signal-style direction must be BLOCKED -- this
    // candidate's real evidence (country_news:413, person:13,
    // historical_resonance:13) genuinely exists, so silently
    // dropping it to NOT_AVAILABLE is never legal.
    for (const result of perDirection) {
      assert.equal(
        result.validation_status,
        "BLOCKED",
        "a direction using only one evidence category must never PASS for this candidate"
      );
    }

    // The fully-integrated batch (built earlier in this file) is the
    // only shape that legitimately passes for this candidate.
    const integratedBatch = [
      makeIntegratedDirection("TECHNICAL_SACRIFICE"),
      makeIntegratedDirection("SURVEILLANCE_TRAP"),
      makeIntegratedDirection("CULTURAL_LEGACY"),
      makeIntegratedDirection("RESOURCE_GAMBLE")
    ];
    const integratedResult = validateDirectionBatch(
      integratedBatch,
      REGRESSION_CONTEXT
    );
    assert.equal(integratedResult.batch.validation_status, "PASS");
    for (const result of integratedResult.perDirection) {
      assert.equal(result.validation_status, "PASS");
    }
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
  // Real person used directly as Canon Driver rejected (exact
  // full-name match -- REAL_PERSON_FICTIONALIZATION_SAFE above
  // covers the partial/surname-reuse case).
  // -------------------------------------------------------
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      character_concept: {
        canon_driver_name: "Real Person Name",
        canon_team_name: "Fictional Team",
        motivation: "motivation",
        internal_conflict: "conflict",
        person_signal_influence:
          "draws his refusal to trust AI steering from the historical drift lineage"
      }
    });

    const result = validateDirectionBatch(
      [
        direction,
        makeIntegratedDirection("SURVEILLANCE_TRAP"),
        makeIntegratedDirection("CULTURAL_LEGACY")
      ],
      {
        ...REGRESSION_CONTEXT,
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
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      hook: "Built in official partnership with the manufacturer."
    });

    const result = validateDirectionBatch(
      [
        direction,
        makeIntegratedDirection("SURVEILLANCE_TRAP"),
        makeIntegratedDirection("CULTURAL_LEGACY")
      ],
      REGRESSION_CONTEXT
    );

    assert.equal(result.perDirection[0].validation_status, "BLOCKED");
    assert.ok(
      result.perDirection[0].issues.some(
        i => i.code === "OFFICIAL_PARTNERSHIP_IMPLIED"
      )
    );
  }

  // =========================================================
  // Production Hardening (PR #9 final round): Proposed State
  // Change fixed schema, enforced by validateProposedStateChangeShape
  // and applied to direction.proposed_state_changes[],
  // outline.canon_state_impact, and script.proposed_state_changes[].
  // =========================================================

  const REQUIRED_STATE_CHANGE_FIELDS = [
    "previous_state",
    "target_state",
    "entity_type",
    "reason",
    "evidence_refs"
  ];

  function fullStateChange(overrides = {}) {
    return {
      state: "PROPOSED_STATE_CHANGE",
      previous_state: "DISCOVERED",
      target_state: "CANDIDATE_APPROVED",
      entity_type: "DRIVER",
      reason: "reason",
      evidence_refs: ["vehicle:1"],
      ...overrides
    };
  }

  // -------------------------------------------------------
  // Direction BLOCKED: a proposed_state_changes entry with only
  // `state` is missing every other required field.
  // -------------------------------------------------------
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      proposed_state_changes: [{ state: "PROPOSED_STATE_CHANGE" }]
    });

    const issues = validateDirectionShape(direction);

    for (const field of REQUIRED_STATE_CHANGE_FIELDS) {
      assert.ok(
        issues.some(
          i =>
            i.code === "STATE_CHANGE_FIELD_MISSING" &&
            i.path === `proposed_state_changes[0].${field}`
        ),
        `Direction shape must flag missing ${field}`
      );
    }

    // The same malformed entry also fails the Canon Validator
    // independently (it is what actually blocks the per-direction
    // validation_status persisted for Gate 2 selection).
    const batchResult = validateDirectionBatch(
      [
        direction,
        makeIntegratedDirection("SURVEILLANCE_TRAP"),
        makeIntegratedDirection("CULTURAL_LEGACY")
      ],
      REGRESSION_CONTEXT
    );

    assert.equal(batchResult.perDirection[0].validation_status, "BLOCKED");
  }

  // Direction BLOCKED: each single missing field, one at a time.
  for (const field of REQUIRED_STATE_CHANGE_FIELDS) {
    const change = fullStateChange();
    delete change[field];

    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      proposed_state_changes: [change]
    });

    const issues = validateDirectionShape(direction);

    assert.ok(
      issues.some(
        i =>
          i.code === "STATE_CHANGE_FIELD_MISSING" &&
          i.path === `proposed_state_changes[0].${field}`
      ),
      `Direction shape must flag missing ${field} alone`
    );
  }

  // Direction BLOCKED: evidence_refs present but not an array.
  {
    const direction = makeIntegratedDirection("TECHNICAL_SACRIFICE", {
      proposed_state_changes: [
        fullStateChange({ evidence_refs: "not-an-array" })
      ]
    });

    const issues = validateDirectionShape(direction);

    assert.ok(
      issues.some(
        i =>
          i.code === "STATE_CHANGE_FIELD_MISSING" &&
          i.path === "proposed_state_changes[0].evidence_refs"
      )
    );
  }

  // -------------------------------------------------------
  // Script BLOCKED: mirror every Direction case above via
  // validateScriptShape.
  // -------------------------------------------------------
  {
    const script = makeScript("VEHICLE_FIRST", {
      proposed_state_changes: [{ state: "PROPOSED_STATE_CHANGE" }]
    });

    const issues = validateScriptShape(script);

    for (const field of REQUIRED_STATE_CHANGE_FIELDS) {
      assert.ok(
        issues.some(
          i =>
            i.code === "STATE_CHANGE_FIELD_MISSING" &&
            i.path === `proposed_state_changes[0].${field}`
        ),
        `Script shape must flag missing ${field}`
      );
    }

    const result = validateScript(script, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
  }

  for (const field of REQUIRED_STATE_CHANGE_FIELDS) {
    const change = fullStateChange();
    delete change[field];

    const script = makeScript("VEHICLE_FIRST", {
      proposed_state_changes: [change]
    });

    const issues = validateScriptShape(script);

    assert.ok(
      issues.some(
        i =>
          i.code === "STATE_CHANGE_FIELD_MISSING" &&
          i.path === `proposed_state_changes[0].${field}`
      ),
      `Script shape must flag missing ${field} alone`
    );
  }

  {
    const script = makeScript("VEHICLE_FIRST", {
      proposed_state_changes: [
        fullStateChange({ evidence_refs: "not-an-array" })
      ]
    });

    const issues = validateScriptShape(script);

    assert.ok(
      issues.some(
        i =>
          i.code === "STATE_CHANGE_FIELD_MISSING" &&
          i.path === "proposed_state_changes[0].evidence_refs"
      )
    );
  }

  // -------------------------------------------------------
  // Outline BLOCKED: canon_state_impact missing the
  // previous_state property entirely (distinct from previous_state
  // being explicitly null, which is a Canon Vocabulary question).
  // -------------------------------------------------------
  {
    const outline = makeOutline({
      canon_state_impact: fullStateChange()
    });
    delete outline.canon_state_impact.previous_state;

    const issues = validateOutlineShape(outline);

    assert.ok(
      issues.some(
        i =>
          i.code === "STATE_CHANGE_FIELD_MISSING" &&
          i.path === "canon_state_impact.previous_state"
      )
    );
  }

  // Outline BLOCKED: entity_type incompatible with target_state.
  {
    const outline = makeOutline({
      canon_state_impact: fullStateChange({
        target_state: "RESOURCE_ACQUIRED",
        entity_type: "DRIVER",
        previous_state: null
      })
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(result.issues.some(i => i.code === "STATE_TRANSITION_INVALID"));
  }

  // Outline BLOCKED: illegal transition (DISQUALIFIED is terminal
  // -- it can never move to COMEBACK_PENDING).
  {
    const outline = makeOutline({
      canon_state_impact: fullStateChange({
        target_state: "COMEBACK_PENDING",
        entity_type: "DRIVER",
        previous_state: "DISQUALIFIED"
      })
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(result.issues.some(i => i.code === "STATE_TRANSITION_INVALID"));
  }

  // -------------------------------------------------------
  // Valid Proposed State Change transitions must PASS end to
  // end (Structure Validator + Canon Validator combined).
  // -------------------------------------------------------
  const validStateChangeCases = [
    {
      previous_state: "DISCOVERED",
      target_state: "CANDIDATE_APPROVED",
      entity_type: "DRIVER"
    },
    {
      previous_state: "QUALIFIER_ENTERED",
      target_state: "QUALIFIER_PASSED",
      entity_type: "DRIVER"
    },
    {
      previous_state: null,
      target_state: "RESOURCE_ACQUIRED",
      entity_type: "RESOURCE"
    },
    {
      previous_state: null,
      target_state: "TEAM_CHANGED",
      entity_type: "TEAM"
    }
  ];

  for (const testCase of validStateChangeCases) {
    const outline = makeOutline({
      canon_state_impact: fullStateChange(testCase)
    });

    const result = validateOutline(outline, {
      evidenceIds: new Set(["vehicle:1"]),
      noPersonSignal: false
    });

    assert.equal(
      result.validation_status,
      "PASS",
      `${testCase.previous_state} -> ${testCase.target_state} (${testCase.entity_type}) must PASS: ${JSON.stringify(result.issues)}`
    );
  }

  console.log("TASK 3.4E STORY CORE TESTS PASSED");
}

run();
