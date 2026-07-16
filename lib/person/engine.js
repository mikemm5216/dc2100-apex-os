// =========================================================
// PERSON RADAR ENGINE — Task 3.3E
//
// Claims queued person-radar runs, selects active vehicle
// anchors from recent Shorts, resolves catalog public
// people linked to those vehicles, fetches person-centric
// news feed metadata, and persists per-person traffic
// evidence.
//
// Vehicle attention uses REAL Short views; news coverage
// is a PROXY. A person with no vehicle anchor can never
// enter the radar, no matter how hot the news is.
// =========================================================

const { createHash } = require("node:crypto");

const {
  CATALOG_VERSION,
  PERSON_CATALOG,
  RESONANCE_CATALOG_VERSION
} = require("./person-catalog");

const {
  RELATIONSHIP_SCOPES,
  RESONANCE_VERSION,
  calculateLinkHistoricalResonance,
  calculatePersonHistoricalResonance,
  classifyHistoricalResonanceTier
} = require("./resonance");

const {
  PERSON_RESOLVER_VERSION,
  resolvePersonMentionEvidence,
  resolvePersonsForVehicleSignal
} = require("./resolver");

const {
  buildPersonQueries,
  normalizePersonRunPayload
} = require("./query-builder");

const {
  normalizeHeadline
} = require("../news/normalization");

const {
  calculatePersonTrafficScore,
  calculatePersonTransformationPotential,
  calculateVehicleAttentionScore,
  classifyPersonTrafficTier,
  derivePersonNewsEvidence,
  extractAttentionArchetypes
} = require("./metrics");

const defaultProvider = require(
  "../news/providers/google-news-rss"
);

const NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR =
  "NO_ACTIVE_VEHICLE_LINKED_PEOPLE";

// Safety cap on how many recent Shorts feed the resolver.
const MAX_ANCHOR_SIGNALS = 500;

// Vehicle titles kept per person for archetype evidence.
const MAX_VEHICLE_TITLES_PER_PERSON = 10;

function sha256(value) {
  return createHash("sha256")
    .update(String(value))
    .digest("hex");
}

// Person-neutral article identity: the SAME article keeps
// the same external key for two different people, and the
// (person_id, external_key) unique constraint keeps each
// person's mentions idempotent.
function buildPersonExternalKey(item) {
  const identity = item.guid || item.url;

  return `gnews:person:${sha256(identity)}`;
}

// =========================================================
// RUN QUEUE
// =========================================================

async function claimNextPersonRun(pool, workerId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queuedResult = await client.query(
      `
        SELECT
          id,
          request_payload
        FROM person_radar_runs
        WHERE status = 'QUEUED'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `
    );

    if (queuedResult.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }

    const run = queuedResult.rows[0];

    await client.query(
      `
        UPDATE person_radar_runs
        SET
          status = 'RUNNING',
          locked_by = $1,
          locked_at = NOW(),
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
        WHERE id = $2
      `,
      [workerId, run.id]
    );

    await client.query("COMMIT");

    return run;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

// =========================================================
// ACTIVE VEHICLE ANCHORS
// =========================================================

async function selectActiveVehicleAnchors(
  pool,
  { vehicleWindowDays }
) {
  const result = await pool.query(
    `
      SELECT
        sig.id,
        sig.title,
        sig.channel_title,
        sig.views,
        sig.qualified,
        sig.vehicle_brand,
        sig.vehicle_series,
        sig.vehicle_model,
        sig.vehicle_action,
        sig.resolved_vehicle_id,
        c.code AS vehicle_country_code

      FROM signals sig

      LEFT JOIN countries c
        ON c.id = sig.resolved_country_id

      WHERE sig.is_short = TRUE
        AND sig.vehicle_brand IS NOT NULL
        AND sig.entity_resolution_status IN (
          'RESOLVED',
          'BRAND_ONLY'
        )
        AND sig.published_at >=
          NOW() - make_interval(days => $1::int)

      ORDER BY sig.views DESC, sig.id DESC

      LIMIT $2
    `,
    [vehicleWindowDays, MAX_ANCHOR_SIGNALS]
  );

  return result.rows;
}

// Pure aggregation: resolves catalog people against each
// anchor Short and accumulates per-person vehicle
// attention evidence plus link candidates.
function aggregateLinkedPeople(
  anchors,
  { catalog = PERSON_CATALOG } = {}
) {
  const bySlug = new Map();

  for (const anchor of anchors) {
    const matches = resolvePersonsForVehicleSignal({
      title: anchor.title,
      channelTitle: anchor.channel_title,
      vehicleBrand: anchor.vehicle_brand,
      vehicleSeries: anchor.vehicle_series,
      vehicleModel: anchor.vehicle_model,
      resolvedVehicleId: anchor.resolved_vehicle_id,
      vehicleAction: anchor.vehicle_action,
      vehicleCountryCode: anchor.vehicle_country_code,
      catalog
    });

    for (const match of matches) {
      const slug = match.person.slug;

      let summary = bySlug.get(slug);

      if (!summary) {
        summary = {
          slug,
          canonical_name:
            match.person.canonicalName,
          role_category: match.person.roleCategory,
          country_code: match.person.countryCode,
          aliases: match.person.aliases,
          priority: match.person.priority,

          vehicle_signal_count: 0,
          qualified_vehicle_signal_count: 0,
          direct_vehicle_mention_count: 0,
          vehicle_views_total: 0,
          vehicle_views_max: 0,

          linked_brands: new Set(),
          linked_series: new Set(),
          linked_models: new Set(),
          relation_types: new Set(),

          best_link_confidence: 0,
          best_link_method: null,
          has_direct_mention: false,
          has_model_association: false,
          has_brand_association: false,

          vehicle_titles: [],
          vehicle_actions: new Set(),

          links: new Map()
        };

        bySlug.set(slug, summary);
      }

      const views = Number(anchor.views) || 0;

      summary.vehicle_signal_count += 1;
      summary.vehicle_views_total += views;
      summary.vehicle_views_max = Math.max(
        summary.vehicle_views_max,
        views
      );

      if (anchor.qualified) {
        summary.qualified_vehicle_signal_count += 1;
      }

      if (match.directMention) {
        summary.direct_vehicle_mention_count += 1;
        summary.has_direct_mention = true;
      } else if (
        match.linkMethod === "MODEL_ASSOCIATION"
      ) {
        summary.has_model_association = true;
      } else if (
        match.linkMethod === "BRAND_ASSOCIATION"
      ) {
        summary.has_brand_association = true;
      }

      if (anchor.vehicle_brand) {
        summary.linked_brands.add(
          anchor.vehicle_brand
        );
      }

      if (anchor.vehicle_series) {
        summary.linked_series.add(
          anchor.vehicle_series
        );
      }

      if (anchor.vehicle_model) {
        summary.linked_models.add(
          anchor.vehicle_model
        );
      }

      for (const relation of match.relationTypes) {
        summary.relation_types.add(relation);
      }

      if (
        match.linkConfidence >
        summary.best_link_confidence
      ) {
        summary.best_link_confidence =
          match.linkConfidence;
        summary.best_link_method = match.linkMethod;
      }

      if (
        summary.vehicle_titles.length <
          MAX_VEHICLE_TITLES_PER_PERSON &&
        anchor.title
      ) {
        summary.vehicle_titles.push(anchor.title);
      }

      if (anchor.vehicle_action) {
        summary.vehicle_actions.add(
          anchor.vehicle_action
        );
      }

      for (const linked of match.linkedVehicles) {
        const relation = match.relationTypes[0];

        const key = [
          linked.brand || "",
          linked.series || "",
          linked.model || "",
          relation
        ].join("::");

        const existing = summary.links.get(key);

        if (
          !existing ||
          match.linkConfidence >
            existing.link_confidence
        ) {
          summary.links.set(key, {
            vehicle_brand: linked.brand,
            vehicle_series: linked.series,
            vehicle_model: linked.model,
            vehicle_id:
              linked.resolvedVehicleId || null,
            relation_type: relation,
            link_confidence: match.linkConfidence,
            link_method: match.linkMethod,
            link_evidence: match.evidence
          });
        }
      }
    }
  }

  const people = [...bySlug.values()];

  // Person priority: real vehicle views first, then direct
  // mentions, then qualified breadth, then name.
  people.sort(
    (a, b) =>
      b.vehicle_views_total -
        a.vehicle_views_total ||
      b.direct_vehicle_mention_count -
        a.direct_vehicle_mention_count ||
      b.qualified_vehicle_signal_count -
        a.qualified_vehicle_signal_count ||
      a.canonical_name.localeCompare(b.canonical_name)
  );

  return people;
}

// =========================================================
// PEOPLE + LINK PERSISTENCE
// =========================================================

async function loadCountryIds(pool) {
  const result = await pool.query(
    `
      SELECT id, code
      FROM countries
    `
  );

  const byCode = new Map();

  for (const row of result.rows) {
    byCode.set(row.code, row.id);
  }

  return byCode;
}

async function upsertPersonCatalog(
  pool,
  { catalog = PERSON_CATALOG } = {}
) {
  const countryIds = await loadCountryIds(pool);
  const idsBySlug = new Map();

  for (const person of catalog) {
    const result = await pool.query(
      `
        INSERT INTO people (
          slug,
          canonical_name,
          country_id,
          role_category,
          aliases,
          metadata,
          catalog_version,
          life_status,
          life_status_verified_at,
          life_status_source
        )
        VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7,
          $8, CASE WHEN $8 = 'UNKNOWN' THEN NULL ELSE NOW() END, $9
        )
        ON CONFLICT (slug)
        DO UPDATE
        SET
          canonical_name = EXCLUDED.canonical_name,
          country_id = EXCLUDED.country_id,
          role_category = EXCLUDED.role_category,
          aliases = EXCLUDED.aliases,
          catalog_version = EXCLUDED.catalog_version,
          life_status = EXCLUDED.life_status,
          life_status_verified_at = EXCLUDED.life_status_verified_at,
          life_status_source = EXCLUDED.life_status_source,
          updated_at = NOW()
        RETURNING id, slug, active
      `,
      [
        person.slug,
        person.canonicalName,
        countryIds.get(person.countryCode) ?? null,
        person.roleCategory,
        JSON.stringify(person.aliases),
        JSON.stringify({
          priority: person.priority
        }),
        CATALOG_VERSION,
        person.lifeStatus || "UNKNOWN",
        person.lifeStatusSource || null
      ]
    );

    const row = result.rows[0];

    idsBySlug.set(row.slug, {
      id: row.id,
      active: row.active !== false
    });
  }

  return idsBySlug;
}

async function persistVehiclePersonLinks(
  pool,
  personId,
  personSummary
) {
  for (const link of personSummary.links.values()) {
    // Locked links are protected by the WHERE clause: a
    // scanner rerun can never overwrite a manual lock.
    await pool.query(
      `
        INSERT INTO vehicle_person_links (
          person_id,
          vehicle_id,
          vehicle_brand,
          vehicle_series,
          vehicle_model,
          relation_type,
          link_confidence,
          link_method,
          link_evidence
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
        )
        ON CONFLICT (
          person_id,
          COALESCE(vehicle_brand, ''),
          COALESCE(vehicle_series, ''),
          COALESCE(vehicle_model, ''),
          relation_type
        )
        DO UPDATE
        SET
          vehicle_id = COALESCE(
            EXCLUDED.vehicle_id,
            vehicle_person_links.vehicle_id
          ),
          link_confidence = GREATEST(
            COALESCE(
              vehicle_person_links.link_confidence,
              0
            ),
            COALESCE(EXCLUDED.link_confidence, 0)
          ),
          link_method = EXCLUDED.link_method,
          link_evidence = EXCLUDED.link_evidence,
          updated_at = NOW()
        WHERE vehicle_person_links.locked = FALSE
      `,
      [
        personId,
        link.vehicle_id,
        link.vehicle_brand,
        link.vehicle_series,
        link.vehicle_model,
        link.relation_type,
        link.link_confidence,
        link.link_method,
        JSON.stringify(link.link_evidence || {})
      ]
    );
  }
}

// =========================================================
// HISTORICAL RESONANCE (Task 3.3E.1)
//
// Catalog-based relationship knowledge only. Nothing in
// this section may read vehicle views, news mentions,
// publisher counts, traffic scores, or nationality.
// =========================================================

function normalizeResonanceValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Matches ONE persisted link row back to the catalog
// association that carries its resonance evidence.
// Brand must match; a same-relation match beats a
// different-relation match, then vehicle specificity,
// then recognition weight.
function findCatalogAssociationForLink(
  catalogPerson,
  link
) {
  const linkBrand = normalizeResonanceValue(
    link.vehicle_brand
  );
  const linkSeries = normalizeResonanceValue(
    link.vehicle_series
  );
  const linkModel = normalizeResonanceValue(
    link.vehicle_model
  );

  let best = null;

  for (const association of catalogPerson.associations) {
    if (
      normalizeResonanceValue(association.brand) !==
      linkBrand
    ) {
      continue;
    }

    const associationModel = normalizeResonanceValue(
      association.model
    );
    const associationSeries = normalizeResonanceValue(
      association.series
    );

    const specificity =
      associationModel && associationModel === linkModel
        ? 3
        : associationSeries &&
            associationSeries === linkSeries
          ? 2
          : 1;

    const relationMatch =
      association.relationType === link.relation_type
        ? 1
        : 0;

    const candidate = {
      association,
      specificity,
      relationMatch
    };

    if (
      !best ||
      candidate.relationMatch > best.relationMatch ||
      (candidate.relationMatch === best.relationMatch &&
        candidate.specificity > best.specificity) ||
      (candidate.relationMatch === best.relationMatch &&
        candidate.specificity === best.specificity &&
        Number(association.recognitionWeight) >
          Number(best.association.recognitionWeight))
    ) {
      best = candidate;
    }
  }

  return best ? best.association : null;
}

function associationIdentity(association) {
  return {
    brand: association.brand ?? null,
    series: association.series ?? null,
    model: association.model ?? null,
    relation_type: association.relationType,
    evidence_horizon: association.evidenceHorizon,
    iconic_association: Boolean(
      association.iconicAssociation
    ),
    legacy_association: Boolean(
      association.legacyAssociation
    ),
    recognition_weight: Number(
      association.recognitionWeight
    ),
    resonance_label: association.resonanceLabel
  };
}

// Persists link-level resonance and per-scope person
// resonance for ONE person. Links with resonance_locked
// are never overwritten; a locked (identity) link still
// accepts resonance updates because only resonance
// columns are written here.
async function persistPersonResonance(
  pool,
  personId,
  catalogPerson
) {
  const linksResult = await pool.query(
    `
      SELECT
        id,
        vehicle_brand,
        vehicle_series,
        vehicle_model,
        relation_type,
        locked,
        resonance_locked
      FROM vehicle_person_links
      WHERE person_id = $1
      ORDER BY id ASC
    `,
    [personId]
  );

  const linkScores = new Map();

  for (const link of linksResult.rows) {
    const association = findCatalogAssociationForLink(
      catalogPerson,
      link
    );

    if (!association) {
      continue;
    }

    const { score, breakdown } =
      calculateLinkHistoricalResonance(association);

    const tier = classifyHistoricalResonanceTier({
      score,
      hasIconicEvidence:
        Boolean(association.iconicAssociation) ||
        Boolean(association.legacyAssociation)
    });

    linkScores.set(link.id, { association, score });

    await pool.query(
      `
        UPDATE vehicle_person_links
        SET
          evidence_horizon = $2,
          iconic_association = $3,
          legacy_association = $4,
          recognition_weight = $5,
          association_start_year = $6,
          association_end_year = $7,
          historical_resonance_score = $8,
          historical_resonance_tier = $9,
          resonance_evidence = $10::jsonb,
          resonance_version = $11,
          updated_at = NOW()
        WHERE id = $1
          AND resonance_locked = FALSE
      `,
      [
        link.id,
        association.evidenceHorizon,
        Boolean(association.iconicAssociation),
        Boolean(association.legacyAssociation),
        Number(association.recognitionWeight),
        association.associationStartYear ?? null,
        association.associationEndYear ?? null,
        score,
        tier,
        JSON.stringify({
          resonance_label: association.resonanceLabel,
          evidence_horizon:
            association.evidenceHorizon,
          score_breakdown: breakdown,
          matched_association: {
            brand: association.brand ?? null,
            series: association.series ?? null,
            model: association.model ?? null,
            relation_type: association.relationType
          }
        }),
        RESONANCE_VERSION
      ]
    );
  }

  // Per-scope person resonance from ALL catalog
  // associations — the cumulative scopes are computed
  // even when no vehicle Short touched an association
  // this run.
  const scopeResults = {};
  const scores = {};
  const tiers = {};
  const evidenceScopes = {};

  for (const scope of RELATIONSHIP_SCOPES) {
    const result = calculatePersonHistoricalResonance(
      catalogPerson.associations,
      scope
    );

    scopeResults[scope] = result;

    if (result.score !== null) {
      scores[scope] = result.score;
      tiers[scope] = result.tier;
    }

    evidenceScopes[scope] = {
      score: result.score,
      tier: result.tier,
      eligible_link_count: result.eligibleLinkCount,
      strong_link_count: result.strongLinkCount,
      breadth_bonus: result.breadthBonus,
      primary_association: result.primaryAssociation
        ? associationIdentity(
            result.primaryAssociation
          )
        : null,
      score_breakdown: result.primaryBreakdown
    };
  }

  // Primary link id: the persisted link backed by the
  // ALL_TIME primary association, best score first.
  const allTime = scopeResults.ALL_TIME;
  let primaryResonanceLinkId = null;

  if (allTime.primaryAssociation) {
    let bestScore = -1;

    for (const [linkId, entry] of linkScores) {
      if (
        entry.association ===
          allTime.primaryAssociation &&
        entry.score > bestScore
      ) {
        bestScore = entry.score;
        primaryResonanceLinkId = linkId;
      }
    }
  }

  await pool.query(
    `
      UPDATE person_traffic_signals
      SET
        historical_resonance_scores = $2::jsonb,
        historical_resonance_tiers = $3::jsonb,
        historical_resonance_score = $4,
        historical_resonance_tier = $5,
        primary_resonance_link_id = $6,
        resonance_version = $7,
        resonance_evidence = $8::jsonb,
        updated_at = NOW()
      WHERE person_id = $1
    `,
    [
      personId,
      JSON.stringify(scores),
      JSON.stringify(tiers),
      allTime.score,
      allTime.tier,
      primaryResonanceLinkId,
      RESONANCE_VERSION,
      JSON.stringify({
        resonance_version: RESONANCE_VERSION,
        resonance_catalog_version:
          RESONANCE_CATALOG_VERSION,
        primary_resonance_link_id:
          primaryResonanceLinkId,
        scopes: evidenceScopes
      })
    ]
  );

  return scopeResults;
}

// =========================================================
// MENTIONS
// =========================================================

function isExpired(item, maxAgeHours, now) {
  if (!item.publishedAt) {
    return false;
  }

  const publishedTime = new Date(
    item.publishedAt
  ).getTime();

  if (Number.isNaN(publishedTime)) {
    return false;
  }

  const ageMs = now.getTime() - publishedTime;

  return ageMs < 0 || ageMs > maxAgeHours * 3600000;
}

// Deduplicates raw feed items into unique person mentions
// and verifies person evidence on each one.
function buildPersonMentionCandidates(
  personSummary,
  items,
  { maxAgeHours, now }
) {
  const byExternalKey = new Map();
  const byUrl = new Map();
  const byTitleAndPublisher = new Map();

  let expiredCount = 0;

  for (const item of items) {
    if (isExpired(item, maxAgeHours, now)) {
      expiredCount += 1;
      continue;
    }

    const normalizedTitle = normalizeHeadline(
      item.title,
      item.sourceName
    );

    if (!normalizedTitle) {
      continue;
    }

    const externalKey = buildPersonExternalKey(item);

    const titleKey = `${normalizedTitle}::${
      item.publisherDomain || ""
    }`;

    const existing =
      byExternalKey.get(externalKey) ||
      byUrl.get(item.url) ||
      byTitleAndPublisher.get(titleKey);

    if (existing) {
      if (item.queryKey) {
        existing.queryKeys.add(item.queryKey);
      }

      if (
        Number.isFinite(item.feedRank) &&
        (existing.feedRank === null ||
          item.feedRank < existing.feedRank)
      ) {
        existing.feedRank = item.feedRank;
      }

      continue;
    }

    const personEvidence =
      resolvePersonMentionEvidence({
        title: item.title,
        snippet: item.snippet,
        aliases: personSummary.aliases
      });

    const mention = {
      externalKey,
      queryKeys: new Set(
        item.queryKey ? [item.queryKey] : []
      ),
      queryKey: item.queryKey || "PERSON",
      queryText: item.queryText || "",
      feedRank: Number.isFinite(item.feedRank)
        ? item.feedRank
        : null,
      title: item.title,
      normalizedTitle,
      url: item.url,
      guid: item.guid,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      publisherDomain: item.publisherDomain,
      publishedAt: item.publishedAt,
      snippet: item.snippet,
      personMatchMethod: personEvidence.matchMethod,
      personConfidence: personEvidence.confidence,
      personEvidence: personEvidence.evidence
    };

    byExternalKey.set(externalKey, mention);
    byUrl.set(item.url, mention);
    byTitleAndPublisher.set(titleKey, mention);
  }

  return {
    mentions: [...byExternalKey.values()],
    expiredCount
  };
}

async function upsertPersonSignalShell(
  pool,
  { personId, provider }
) {
  const result = await pool.query(
    `
      INSERT INTO person_traffic_signals (
        person_id,
        provider,
        resolver_version
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (person_id)
      DO UPDATE
      SET
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        (xmax = 0) AS inserted
    `,
    [personId, provider, PERSON_RESOLVER_VERSION]
  );

  return result.rows[0];
}

async function upsertPersonMention(
  pool,
  { personTrafficSignalId, personId, mention }
) {
  const queryKeys = [...mention.queryKeys].sort();

  const result = await pool.query(
    `
      INSERT INTO person_traffic_mentions (
        person_traffic_signal_id,
        person_id,
        external_key,
        query_key,
        query_text,
        feed_rank,
        title,
        normalized_title,
        url,
        guid,
        source_name,
        source_url,
        publisher_domain,
        published_at,
        snippet,
        person_match_method,
        person_confidence,
        raw_metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17,
        $18::jsonb
      )
      ON CONFLICT (person_id, external_key)
      DO UPDATE
      SET
        feed_rank = LEAST(
          person_traffic_mentions.feed_rank,
          EXCLUDED.feed_rank
        ),
        title = EXCLUDED.title,
        normalized_title = EXCLUDED.normalized_title,
        snippet = EXCLUDED.snippet,
        person_match_method =
          EXCLUDED.person_match_method,
        person_confidence = GREATEST(
          COALESCE(
            person_traffic_mentions.person_confidence,
            0
          ),
          COALESCE(EXCLUDED.person_confidence, 0)
        ),
        raw_metadata = EXCLUDED.raw_metadata,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        (xmax = 0) AS inserted
    `,
    [
      personTrafficSignalId,
      personId,
      mention.externalKey,
      mention.queryKey,
      mention.queryText,
      mention.feedRank,
      mention.title,
      mention.normalizedTitle,
      mention.url,
      mention.guid,
      mention.sourceName,
      mention.sourceUrl,
      mention.publisherDomain,
      mention.publishedAt,
      mention.snippet,
      mention.personMatchMethod,
      mention.personConfidence,
      JSON.stringify({
        query_keys: queryKeys,
        person_evidence: mention.personEvidence
      })
    ]
  );

  return result.rows[0];
}

async function loadPersonMentions(
  pool,
  personTrafficSignalId
) {
  const result = await pool.query(
    `
      SELECT
        external_key,
        query_key,
        feed_rank,
        title,
        url,
        source_name,
        publisher_domain,
        published_at,
        snippet,
        person_match_method,
        person_confidence,
        raw_metadata
      FROM person_traffic_mentions
      WHERE person_traffic_signal_id = $1
      ORDER BY published_at DESC NULLS LAST, id ASC
    `,
    [personTrafficSignalId]
  );

  return result.rows.map(row => ({
    externalKey: row.external_key,
    queryKey: row.query_key,
    queryKeys: Array.isArray(
      row.raw_metadata?.query_keys
    )
      ? row.raw_metadata.query_keys
      : [row.query_key],
    feedRank: row.feed_rank,
    title: row.title,
    url: row.url,
    sourceName: row.source_name,
    publisherDomain: row.publisher_domain,
    publishedAt: row.published_at,
    snippet: row.snippet,
    personMatchMethod: row.person_match_method,
    personConfidence: row.person_confidence
  }));
}

// Weak query-context mentions can never dominate the
// representative headline: only alias-verified mentions
// are eligible. With no verified mention the headline is
// null and the person stays vehicle-evidence-only.
function pickRepresentativeMention(mentions) {
  const verified = mentions.filter(
    mention =>
      mention.personMatchMethod === "TITLE_ALIAS" ||
      mention.personMatchMethod === "SNIPPET_ALIAS"
  );

  if (verified.length === 0) {
    return null;
  }

  return [...verified].sort((a, b) => {
    const confidenceA =
      Number(a.personConfidence) || 0;
    const confidenceB =
      Number(b.personConfidence) || 0;

    if (confidenceA !== confidenceB) {
      return confidenceB - confidenceA;
    }

    const timeA = a.publishedAt
      ? new Date(a.publishedAt).getTime()
      : 0;

    const timeB = b.publishedAt
      ? new Date(b.publishedAt).getTime()
      : 0;

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    const rankA =
      a.feedRank ?? Number.MAX_SAFE_INTEGER;
    const rankB =
      b.feedRank ?? Number.MAX_SAFE_INTEGER;

    return rankA - rankB;
  })[0];
}

async function finalizePersonSignal(
  pool,
  {
    personTrafficSignalId,
    personSummary,
    now
  }
) {
  const mentions = await loadPersonMentions(
    pool,
    personTrafficSignalId
  );

  const newsEvidence = derivePersonNewsEvidence(
    mentions,
    { now }
  );

  const vehicleAttentionScore =
    calculateVehicleAttentionScore({
      vehicleViewsTotal:
        personSummary.vehicle_views_total,
      qualifiedVehicleSignalCount:
        personSummary.qualified_vehicle_signal_count,
      directVehicleMentionCount:
        personSummary.direct_vehicle_mention_count,
      vehicleSignalCount:
        personSummary.vehicle_signal_count
    });

  const trafficScore = calculatePersonTrafficScore({
    vehicleAttentionScore,
    newsCoverageScore:
      newsEvidence.newsCoverageScore
  });

  const trafficTier = classifyPersonTrafficTier({
    trafficScore,
    vehicleViewsTotal:
      personSummary.vehicle_views_total,
    publisherCount: newsEvidence.publisherCount
  });

  const archetypeInfo = extractAttentionArchetypes({
    vehicleTitles: personSummary.vehicle_titles,
    vehicleActions: [
      ...personSummary.vehicle_actions
    ],
    headlines: mentions.map(
      mention => mention.title
    ),
    snippets: mentions.map(
      mention => mention.snippet
    )
  });

  const transformation =
    calculatePersonTransformationPotential({
      trafficScore,
      linkConfidence:
        personSummary.best_link_confidence,
      directMention:
        personSummary.direct_vehicle_mention_count >
        0,
      attentionArchetypes: archetypeInfo.archetypes
    });

  const representative =
    pickRepresentativeMention(mentions);

  await pool.query(
    `
      UPDATE person_traffic_signals
      SET
        traffic_tier = $1,
        traffic_score = $2,

        vehicle_attention_score = $3,
        news_coverage_score = $4,

        vehicle_signal_count = $5,
        qualified_vehicle_signal_count = $6,
        direct_vehicle_mention_count = $7,
        vehicle_views_total = $8,
        vehicle_views_max = $9,

        news_mention_count = $10,
        publisher_count = $11,
        query_count = $12,
        feed_rank_score = $13,
        age_hours = $14,

        attention_archetypes = $15::jsonb,
        transformation_tier = $16,
        transformation_potential = $17,

        representative_headline = $18,
        representative_url = $19,
        representative_source = $20,
        representative_domain = $21,

        last_seen_at = NOW(),
        provider = $22,
        resolver_version = $23,
        raw_metadata = $24::jsonb,
        updated_at = NOW()
      WHERE id = $25
    `,
    [
      trafficTier,
      trafficScore,

      vehicleAttentionScore,
      newsEvidence.newsCoverageScore,

      personSummary.vehicle_signal_count,
      personSummary.qualified_vehicle_signal_count,
      personSummary.direct_vehicle_mention_count,
      personSummary.vehicle_views_total,
      personSummary.vehicle_views_max,

      newsEvidence.newsMentionCount,
      newsEvidence.publisherCount,
      newsEvidence.queryCount,
      newsEvidence.feedRankScore,
      newsEvidence.ageHours,

      JSON.stringify(archetypeInfo.archetypes),
      transformation.transformationTier,
      transformation.transformationPotential,

      representative ? representative.title : null,
      representative ? representative.url : null,
      representative
        ? representative.sourceName
        : null,
      representative
        ? representative.publisherDomain
        : null,

      defaultProvider.PROVIDER_ID,
      PERSON_RESOLVER_VERSION,
      JSON.stringify({
        best_link_method:
          personSummary.best_link_method,
        best_link_confidence:
          personSummary.best_link_confidence,
        best_feed_rank: newsEvidence.bestFeedRank,
        archetype_evidence: archetypeInfo.evidence,
        vehicle_actions: [
          ...personSummary.vehicle_actions
        ].sort()
      }),

      personTrafficSignalId
    ]
  );

  return {
    trafficTier,
    trafficScore,
    transformationTier:
      transformation.transformationTier
  };
}

// =========================================================
// RUN EXECUTION
// =========================================================

function createRunState(options) {
  return {
    personCount: 0,
    completedPersonCount: 0,
    failedPersonCount: 0,
    queryCount: 0,
    succeededQueryCount: 0,
    itemCount: 0,
    mentionInsertedCount: 0,
    mentionUpdatedCount: 0,
    signalInsertedCount: 0,
    signalUpdatedCount: 0,

    breakoutCount: 0,
    activeCount: 0,
    watchCount: 0,
    lowSignalCount: 0,

    highTransformationCount: 0,
    mediumTransformationCount: 0,
    lowTransformationCount: 0,

    directMentionPersonCount: 0,
    brandAssociationPersonCount: 0,
    modelAssociationPersonCount: 0,

    resonanceScoredCount: 0,
    resonanceUnscoredCount: 0,

    resonanceCounters: {
      one_year_iconic_count: 0,
      one_year_established_count: 0,
      one_year_recognizable_count: 0,
      one_year_niche_count: 0,

      ten_year_iconic_count: 0,
      ten_year_established_count: 0,
      ten_year_recognizable_count: 0,
      ten_year_niche_count: 0,

      all_time_iconic_count: 0,
      all_time_established_count: 0,
      all_time_recognizable_count: 0,
      all_time_niche_count: 0
    },

    selectedPeople: [],
    personResults: [],
    errors: [],

    options
  };
}

function buildRunSummary(state) {
  return {
    selected_people: state.selectedPeople,
    person_results: state.personResults,
    errors: state.errors,

    breakout_count: state.breakoutCount,
    active_count: state.activeCount,
    watch_count: state.watchCount,
    low_signal_count: state.lowSignalCount,

    high_transformation_count:
      state.highTransformationCount,
    medium_transformation_count:
      state.mediumTransformationCount,
    low_transformation_count:
      state.lowTransformationCount,

    direct_mention_person_count:
      state.directMentionPersonCount,
    brand_association_person_count:
      state.brandAssociationPersonCount,
    model_association_person_count:
      state.modelAssociationPersonCount,

    resonance_scored_count:
      state.resonanceScoredCount,
    resonance_unscored_count:
      state.resonanceUnscoredCount,
    ...state.resonanceCounters,

    provider: defaultProvider.PROVIDER_ID,
    resolver_version: PERSON_RESOLVER_VERSION,
    catalog_version: CATALOG_VERSION,
    resonance_version: RESONANCE_VERSION,
    resonance_catalog_version:
      RESONANCE_CATALOG_VERSION,
    vehicle_window_days:
      state.options.vehicleWindowDays,
    max_age_hours: state.options.maxAgeHours,
    max_queries_per_person:
      state.options.maxQueriesPerPerson,
    max_items_per_query:
      state.options.maxItemsPerQuery
  };
}

async function updateRunProgress(pool, runId, state) {
  await pool.query(
    `
      UPDATE person_radar_runs
      SET
        person_count = $1,
        completed_person_count = $2,
        failed_person_count = $3,
        query_count = $4,
        succeeded_query_count = $5,
        item_count = $6,
        mention_inserted_count = $7,
        mention_updated_count = $8,
        signal_inserted_count = $9,
        signal_updated_count = $10,
        summary = $11::jsonb,
        updated_at = NOW()
      WHERE id = $12
    `,
    [
      state.personCount,
      state.completedPersonCount,
      state.failedPersonCount,
      state.queryCount,
      state.succeededQueryCount,
      state.itemCount,
      state.mentionInsertedCount,
      state.mentionUpdatedCount,
      state.signalInsertedCount,
      state.signalUpdatedCount,
      JSON.stringify(buildRunSummary(state)),
      runId
    ]
  );
}

async function finalizeRun(pool, runId, state) {
  const completed = state.completedPersonCount > 0;

  const status = completed ? "COMPLETED" : "FAILED";

  const errorMessage = completed
    ? null
    : (
        state.errors
          .slice(0, 3)
          .map(item =>
            `${item.person_slug || item.scope}: ${item.message}`
          )
          .join(" | ") ||
        "No people were processed successfully."
      );

  await pool.query(
    `
      UPDATE person_radar_runs
      SET
        status = $1,
        person_count = $2,
        completed_person_count = $3,
        failed_person_count = $4,
        query_count = $5,
        succeeded_query_count = $6,
        item_count = $7,
        mention_inserted_count = $8,
        mention_updated_count = $9,
        signal_inserted_count = $10,
        signal_updated_count = $11,
        summary = $12::jsonb,
        error_message = $13,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $14
    `,
    [
      status,
      state.personCount,
      state.completedPersonCount,
      state.failedPersonCount,
      state.queryCount,
      state.succeededQueryCount,
      state.itemCount,
      state.mentionInsertedCount,
      state.mentionUpdatedCount,
      state.signalInsertedCount,
      state.signalUpdatedCount,
      JSON.stringify(buildRunSummary(state)),
      errorMessage,
      runId
    ]
  );

  return {
    runId: String(runId),
    status,
    ...state
  };
}

async function failPersonRun(pool, runId, error) {
  await pool.query(
    `
      UPDATE person_radar_runs
      SET
        status = 'FAILED',
        error_message = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `,
    [
      String(
        error?.message ||
        "Unknown person radar failure"
      ).slice(0, 2000),
      runId
    ]
  );
}

const SCOPE_COUNTER_PREFIXES = {
  ONE_YEAR: "one_year",
  TEN_YEARS: "ten_year",
  ALL_TIME: "all_time"
};

function recordResonanceOutcome(state, scopeResults) {
  if (
    !scopeResults ||
    scopeResults.ALL_TIME?.score === null ||
    scopeResults.ALL_TIME?.score === undefined
  ) {
    state.resonanceUnscoredCount += 1;
    return;
  }

  state.resonanceScoredCount += 1;

  for (const [scope, prefix] of Object.entries(
    SCOPE_COUNTER_PREFIXES
  )) {
    const tier = scopeResults[scope]?.tier;

    if (!tier) {
      continue;
    }

    const key = `${prefix}_${tier.toLowerCase()}_count`;

    if (key in state.resonanceCounters) {
      state.resonanceCounters[key] += 1;
    }
  }
}

async function processPerson(
  pool,
  personId,
  personSummary,
  state,
  { provider, now, catalog = PERSON_CATALOG }
) {
  const options = state.options;

  const queries = buildPersonQueries(
    {
      canonical_name: personSummary.canonical_name,
      linked_brands: [
        ...personSummary.linked_brands
      ],
      linked_series: [
        ...personSummary.linked_series
      ],
      linked_models: [
        ...personSummary.linked_models
      ]
    },
    {
      maxQueriesPerPerson:
        options.maxQueriesPerPerson
    }
  );

  state.queryCount += queries.length;

  const items = [];
  let succeededQueries = 0;

  const results = await provider.mapWithConcurrency(
    queries,
    defaultProvider.PROVIDER_LIMITS.CONCURRENCY,
    query =>
      provider.fetchQuery({
        queryKey: query.queryKey,
        queryText: query.queryText,
        maxItems: options.maxItemsPerQuery
      })
  );

  results.forEach((result, index) => {
    if (result.ok) {
      succeededQueries += 1;
      items.push(...result.value.items);
      return;
    }

    state.errors.push({
      scope: "query",
      person_slug: personSummary.slug,
      query_key: queries[index].queryKey,
      code: result.error?.code || null,
      message: String(
        result.error?.message ||
        "Unknown query failure"
      ).slice(0, 500)
    });
  });

  state.succeededQueryCount += succeededQueries;

  if (queries.length > 0 && succeededQueries === 0) {
    throw new Error(
      `All ${queries.length} person news queries failed for ${personSummary.slug}.`
    );
  }

  state.itemCount += items.length;

  const { mentions } = buildPersonMentionCandidates(
    personSummary,
    items,
    {
      maxAgeHours: options.maxAgeHours,
      now
    }
  );

  const shell = await upsertPersonSignalShell(pool, {
    personId,
    provider: defaultProvider.PROVIDER_ID
  });

  if (shell.inserted) {
    state.signalInsertedCount += 1;
  } else {
    state.signalUpdatedCount += 1;
  }

  for (const mention of mentions) {
    const saved = await upsertPersonMention(pool, {
      personTrafficSignalId: shell.id,
      personId,
      mention
    });

    if (saved.inserted) {
      state.mentionInsertedCount += 1;
    } else {
      state.mentionUpdatedCount += 1;
    }
  }

  const outcome = await finalizePersonSignal(pool, {
    personTrafficSignalId: shell.id,
    personSummary,
    now
  });

  // Historical Resonance runs AFTER the unchanged current
  // traffic pipeline: a parallel catalog-based layer that
  // never feeds the traffic score.
  const catalogPerson = catalog.find(
    person => person.slug === personSummary.slug
  );

  const scopeResults = catalogPerson
    ? await persistPersonResonance(
        pool,
        personId,
        catalogPerson
      )
    : null;

  recordResonanceOutcome(state, scopeResults);

  if (outcome.trafficTier === "BREAKOUT") {
    state.breakoutCount += 1;
  } else if (outcome.trafficTier === "ACTIVE") {
    state.activeCount += 1;
  } else if (outcome.trafficTier === "WATCH") {
    state.watchCount += 1;
  } else {
    state.lowSignalCount += 1;
  }

  if (outcome.transformationTier === "HIGH") {
    state.highTransformationCount += 1;
  } else if (
    outcome.transformationTier === "MEDIUM"
  ) {
    state.mediumTransformationCount += 1;
  } else {
    state.lowTransformationCount += 1;
  }

  state.personResults.push({
    person_slug: personSummary.slug,
    query_count: queries.length,
    succeeded_query_count: succeededQueries,
    item_count: items.length,
    mention_count: mentions.length,
    traffic_tier: outcome.trafficTier,
    transformation_tier:
      outcome.transformationTier,
    status: "COMPLETED"
  });
}

async function executePersonRun(
  pool,
  run,
  {
    provider = defaultProvider,
    now = new Date(),
    catalog = PERSON_CATALOG,
    onPersonCompleted = null
  } = {}
) {
  const options = normalizePersonRunPayload(
    run.request_payload
  );

  const state = createRunState(options);

  const anchors = await selectActiveVehicleAnchors(
    pool,
    options
  );

  let people = aggregateLinkedPeople(anchors, {
    catalog
  });

  if (options.personSlugs) {
    const allowed = new Set(options.personSlugs);

    people = people.filter(person =>
      allowed.has(person.slug)
    );
  }

  if (people.length === 0) {
    const error = new Error(
      NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR
    );

    error.code =
      NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR;

    await failPersonRun(pool, run.id, error);

    return {
      runId: String(run.id),
      status: "FAILED",
      errorCode:
        NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR,
      ...state
    };
  }

  // Upsert the full catalog so the people registry stays
  // complete, then resolve database ids for selection.
  const idsBySlug = await upsertPersonCatalog(pool, {
    catalog
  });

  people = people.filter(person => {
    const record = idsBySlug.get(person.slug);

    if (!record || record.active === false) {
      return false;
    }

    if (
      options.personIds &&
      !options.personIds.includes(String(record.id))
    ) {
      return false;
    }

    return true;
  });

  people = people.slice(0, options.maxPeople);

  if (people.length === 0) {
    const error = new Error(
      NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR
    );

    error.code =
      NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR;

    await failPersonRun(pool, run.id, error);

    return {
      runId: String(run.id),
      status: "FAILED",
      errorCode:
        NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR,
      ...state
    };
  }

  state.personCount = people.length;

  state.directMentionPersonCount = people.filter(
    person => person.has_direct_mention
  ).length;

  state.modelAssociationPersonCount = people.filter(
    person => person.has_model_association
  ).length;

  state.brandAssociationPersonCount = people.filter(
    person => person.has_brand_association
  ).length;

  state.selectedPeople = people.map(person => ({
    person_id: String(
      idsBySlug.get(person.slug).id
    ),
    person_slug: person.slug,
    canonical_name: person.canonical_name,
    role_category: person.role_category,
    linked_brands: [...person.linked_brands].sort(),
    linked_series: [...person.linked_series].sort(),
    linked_models: [...person.linked_models].sort(),
    relation_types: [
      ...person.relation_types
    ].sort(),
    vehicle_signal_count:
      person.vehicle_signal_count,
    qualified_vehicle_signal_count:
      person.qualified_vehicle_signal_count,
    direct_vehicle_mention_count:
      person.direct_vehicle_mention_count,
    vehicle_views_total: String(
      person.vehicle_views_total
    ),
    vehicle_views_max: String(
      person.vehicle_views_max
    )
  }));

  await updateRunProgress(pool, run.id, state);

  for (const person of people) {
    const personId = idsBySlug.get(person.slug).id;

    try {
      await persistVehiclePersonLinks(
        pool,
        personId,
        person
      );

      await processPerson(
        pool,
        personId,
        person,
        state,
        { provider, now, catalog }
      );

      state.completedPersonCount += 1;

      if (onPersonCompleted) {
        onPersonCompleted(person, state);
      }
    } catch (error) {
      state.failedPersonCount += 1;

      state.personResults.push({
        person_slug: person.slug,
        status: "FAILED",
        message: String(
          error?.message ||
          "Unknown person failure"
        ).slice(0, 500)
      });

      state.errors.push({
        scope: "person",
        person_slug: person.slug,
        code: error?.code || null,
        message: String(
          error?.message ||
          "Unknown person failure"
        ).slice(0, 500)
      });
    }

    await updateRunProgress(pool, run.id, state);
  }

  return finalizeRun(pool, run.id, state);
}

async function processNextPersonRadarRun(
  pool,
  {
    workerId,
    provider = defaultProvider,
    now = new Date(),
    catalog = PERSON_CATALOG,
    onRunStarted = null,
    onPersonCompleted = null
  } = {}
) {
  const run = await claimNextPersonRun(
    pool,
    workerId
  );

  if (!run) {
    return null;
  }

  if (onRunStarted) {
    onRunStarted(run);
  }

  try {
    return await executePersonRun(pool, run, {
      provider,
      now,
      catalog,
      onPersonCompleted
    });
  } catch (error) {
    await failPersonRun(pool, run.id, error);
    throw error;
  }
}

module.exports = {
  NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR,
  aggregateLinkedPeople,
  buildPersonExternalKey,
  buildPersonMentionCandidates,
  claimNextPersonRun,
  executePersonRun,
  findCatalogAssociationForLink,
  persistPersonResonance,
  pickRepresentativeMention,
  processNextPersonRadarRun,
  selectActiveVehicleAnchors,
  upsertPersonCatalog
};
