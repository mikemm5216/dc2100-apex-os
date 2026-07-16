const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { validateRoster } = require("./validate-locked-canon-roster");

const root = path.join(__dirname, "..");
const read = name => JSON.parse(fs.readFileSync(path.join(root, "config", name), "utf8"));

function validateCanonMainline() {
  const mainline = read("canon-mainline-v1.json");
  const episode = read("canon-episode-0-v1.json");
  const season = read("canon-season-1-beat-map-v1.json");
  const evidence = read("canon-source-evidence-map-v1.json");
  const guests = read("station-guest-reserved-source-pool-v1.json");
  const roster = read("locked-canon-roster-15-v1.json");
  const matrix = read("locked-canon-news-candidate-matrix-v1.json");
  const errors = [];
  const reviews = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };

  // 1-2: source and EP0 structure.
  check(mainline.source.document === "Gemini.docx", "source document must be Gemini.docx");
  check(episode.source_document === "Gemini.docx" && season.source_document === "Gemini.docx" && evidence.source.document === "Gemini.docx", "all Mainline artifacts must reference Gemini.docx");
  check(Array.isArray(episode.acts) && episode.acts.length === 4, "EP0 must contain exactly four acts");
  const expectedActs = ["ACT-1-2100-WORLD-REVEAL", "ACT-2-APEX-RULES-AND-PHILOSOPHY", "ACT-3-GODS-OF-FIFTEEN-ASSEMBLE", "ACT-4-SIGNAL-FLARE-AKINA-QUALIFIER"];
  check(expectedActs.every((id, i) => episode.acts[i]?.act_id === id), "EP0 acts are missing or out of order");

  // 3-9: one Akina qualifier, 15 locked slots, no parallel worlds.
  const beatIds = season.beats.map(beat => beat.beat_id);
  const requiredBeats = ["SEASON-START", "EP0-WORLD-REVEAL", "EP0-APEX-INTRODUCTION", "EP0-ROSTER-ASSEMBLY", "AKINA-QUALIFIER-START", "AKINA-QUALIFIER-RESULT", "NEXT-STATION-TRANSITION"];
  check(requiredBeats.every(id => beatIds.includes(id)), "Season 1 required Mainline beats are incomplete");
  const slotBeats = season.beats.filter(beat => beat.beat_type === "QUALIFIER_SLOT");
  check(slotBeats.length === 15, `expected 15 Akina slot beats, received ${slotBeats.length}`);
  check(new Set(slotBeats.map(beat => beat.slot_id)).size === 15, "Akina slot IDs must be unique");
  check(slotBeats.every(beat => beat.event_id === "AKINA-QUALIFIER-01"), "all slots must belong to the same Akina qualifier");
  check(season.shared_event.single_timeline === true && season.shared_event.parallel_stories === false && mainline.continuity_invariants.parallel_worlds === false, "parallel worlds/stories are forbidden");
  check(!beatIds.includes("AKINA-SLOT-16") && !slotBeats.some(beat => /_16$/.test(beat.slot_id || "")), "a sixteenth original slot is forbidden");

  const rosterResult = validateRoster(roster);
  check(rosterResult.valid, `locked roster failed: ${rosterResult.errors.join("; ")}`);
  reviews.push(...rosterResult.reviews);
  const rosterById = new Map(roster.slots.map(slot => [slot.slot_id, slot]));
  const matrixById = new Map(matrix.slots.map(slot => [slot.slot_id, slot]));
  for (const beat of slotBeats) {
    const slot = rosterById.get(beat.slot_id);
    const news = matrixById.get(beat.slot_id);
    check(Boolean(slot), `${beat.beat_id}: missing locked roster slot`);
    if (!slot) continue;
    check(beat.canon_vehicle_name === slot.canon_vehicle_name, `${beat.beat_id}: locked vehicle changed`);
    check(beat.canon_country_code === slot.canon_country_code, `${beat.beat_id}: beat country does not match canon_country_code`);
    check(news?.canon_country_code === slot.canon_country_code, `${beat.beat_id}: News Matrix country binding is wrong`);
    check(beat.country_news_conflict?.binding === "canon_country_code", `${beat.beat_id}: News binding must use canon_country_code`);
    check(beat.country_news_conflict?.matrix_slot_id === beat.slot_id, `${beat.beat_id}: wrong News Matrix slot attached`);
    const expectedNewsStatus = news?.news_status === "READY" ? "READY" : "NO_NEWS_MATCH";
    check(beat.country_news_conflict?.status === expectedNewsStatus, `${beat.beat_id}: News status does not preserve READY/NO_NEWS_MATCH`);
    const expectedCandidateIds = (news?.candidates || []).map(item => String(item.country_news_signal_id));
    check(JSON.stringify(beat.country_news_conflict?.candidate_ids || []) === JSON.stringify(expectedCandidateIds), `${beat.beat_id}: News candidate IDs do not match matrix`);
    for (const field of ["previous_canon_state", "country_news_conflict", "driver_decision", "vehicle_modification", "apex_trial", "qualifier_result", "updated_canon_state"]) {
      check(beat[field] && typeof beat[field] === "object", `${beat.beat_id}: missing ${field}`);
    }
  }

  // 10-14: locked evidence separation and Guest Pool isolation.
  const bigChief = evidence.restricted_locked_canon_evidence.find(item => item.evidence_id === "SOURCE-EVIDENCE-BIG-CHIEF");
  const liao = evidence.restricted_locked_canon_evidence.find(item => item.evidence_id === "SOURCE-EVIDENCE-LIAO");
  check(bigChief?.usage_scope === "LOCKED_CANON_ONLY" && bigChief?.assigned_slot === "CANDIDATE_SLOT_01" && bigChief?.assigned_vehicle === "Pontiac GTO", "Big Chief evidence must bind only to the Pontiac GTO slot");
  check(liao?.usage_scope === "LOCKED_CANON_ONLY" && liao?.assigned_slot === "CANDIDATE_SLOT_04" && liao?.assigned_vehicle === "Audi TT RS", "Liao evidence must bind only to the Audi TT RS slot");
  check(bigChief?.assigned_slot !== liao?.assigned_slot && bigChief?.evidence_id !== liao?.evidence_id && bigChief?.merged_with_other_evidence === false && liao?.merged_with_other_evidence === false, "Big Chief and Liao evidence must remain separate");
  const guestNames = guests.sources.map(item => item.canonical_name);
  check(!guestNames.includes("Big Chief") && !guestNames.includes("廖老大"), "Big Chief/Liao must not enter the Guest Pool");
  check(guests.usage_scope === "STATION_GUEST_ONLY" && guests.sources.length === 10, "Guest Pool must contain exactly ten STATION_GUEST_ONLY sources");
  const rosterText = JSON.stringify(roster).toLowerCase();
  const reservedAliases = [...guestNames, "雷總", "豐田章男", "土屋圭市"].map(value => value.toLowerCase());
  check(!reservedAliases.some(name => rosterText.includes(name)), "Reserved Guest Source found in Locked Canon roster");

  // 15-19: public projection safety and complete Draft adaptation records.
  const publicText = JSON.stringify([mainline, episode, season]).toLowerCase();
  check(!publicText.includes("doc brown"), "Public Canon contains Doc Brown");
  check(!publicText.includes("delorean") && !publicText.includes("dmc-12"), "Public Canon contains DeLorean identity/trade dress");
  const existingIpNames = ["mf ghost", "片桐夏向", "緒方", "kanata katagiri"];
  check(!existingIpNames.some(name => publicText.includes(name.toLowerCase())), "Public Canon contains an MF Ghost identity");
  const publicRealNames = [...guestNames, "Big Chief", "廖老大", "雷總"];
  check(!publicRealNames.some(name => publicText.includes(name.toLowerCase())), "Public Canon contains a real person name or alias");
  const rosterDrivers = roster.slots.map(slot => slot.canon_driver_name).filter(Boolean).join(" ").toLowerCase();
  check(!publicRealNames.some(name => rosterDrivers.includes(name.toLowerCase())), "Public driver field contains a reserved real person");
  const requiredRiskFields = ["original_function", "risk_type", "preserve_story_function", "required_adaptation", "replacement_required", "public_canon_replacement_status", "unresolved_fields"];
  for (const risk of evidence.risk_registry) {
    check(risk.status === "DRAFT_NEEDS_LEGAL_SAFE_ADAPTATION", `${risk.risk_id}: wrong risk status`);
    check(requiredRiskFields.every(field => Object.prototype.hasOwnProperty.call(risk, field) && risk[field] !== ""), `${risk.risk_id}: incomplete required adaptation record`);
  }

  // 20-27: explicit review/generation/execution/export invariants.
  const slot15 = rosterById.get("CANDIDATE_SLOT_15");
  check(slot15?.canon_driver_name === null && slot15?.review_flags?.includes("CANON_FIELD_REVIEW_REQUIRED:canon_driver_name"), "Slot 15 must remain CANON_FIELD_REVIEW_REQUIRED with null driver");
  const slot15Beat = slotBeats.find(beat => beat.slot_id === "CANDIDATE_SLOT_15");
  check(slot15Beat?.identity_status === "CANON_FIELD_REVIEW_REQUIRED", "Slot 15 beat must preserve review status");
  check(mainline.generation_state.outline_generated === false && episode.generation_state.outline_generated === false && season.generation_state.outline_generated === false, "Outline generated must be NO");
  check(mainline.generation_state.script_generated === false && episode.generation_state.script_generated === false && season.generation_state.script_generated === false, "Script generated must be NO");
  for (const [field, label] of [["youtube_calls", "YouTube calls"], ["pair_runs", "Pair runs"], ["fusion_runs", "Fusion runs"], ["gemini_calls", "Gemini calls"]]) {
    check(mainline.generation_state[field] === 0, `${label} must be zero`);
  }
  try {
    const trackedExports = execFileSync("git", ["ls-files", "exports"], { cwd: root, encoding: "utf8" }).trim();
    check(trackedExports === "", "exports/ must not be tracked by Git");
  } catch (error) {
    errors.push(`unable to verify exports Git state: ${error.message}`);
  }

  const ready = slotBeats.filter(beat => beat.country_news_conflict.status === "READY").length;
  const noNews = slotBeats.filter(beat => beat.country_news_conflict.status === "NO_NEWS_MATCH").length;
  return {
    valid: errors.length === 0,
    status: errors.length ? "FAILED" : reviews.length ? "PASS_WITH_CANON_FIELD_REVIEW_REQUIRED" : "PASS",
    metrics: {
      ep0_acts: episode.acts.length,
      season_beats: season.beats.length,
      akina_slot_beats: slotBeats.length,
      locked_roster_slots_attached: new Set(slotBeats.map(beat => beat.slot_id)).size,
      ready_news_rows: ready,
      no_news_match_rows: noNews,
      wrong_country_bindings: errors.filter(item => /country|News Matrix/.test(item)).length,
      parallel_stories: season.shared_event.parallel_stories,
      reserved_guest_sources: guests.sources.length
    },
    reviews: [...new Set(reviews)],
    errors
  };
}

if (require.main === module) {
  const result = validateCanonMainline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

module.exports = { validateCanonMainline };
