export const APEX_API_URL =
  process.env.NEXT_PUBLIC_APEX_API_URL ??
  "https://dc2100-apex-os-production.up.railway.app";

export type StatusHistoryEntry = {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  changed_at: string;
};

export type ContentCandidate = {
  id: string;
  content_id: string;
  title: string;
  status: string;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;

  country_code: string | null;
  country_name: string | null;

  vehicle_code: string | null;
  vehicle_name: string | null;

  signal_id: string | null;
  signal_title: string | null;
  signal_url: string | null;
};

export type ContentDetail =
  ContentCandidate & {
    status_history: StatusHistoryEntry[];
  };

export type ContentsResponse = {
  data: ContentCandidate[];
  count: number;
};

export type CreateContentInput = {
  country_code: string;
  vehicle_code: string;
  title: string;
  priority: number;
  notes?: string;
  changed_by?: string;
};

export type UpdateContentInput = {
  title?: string;
  priority?: number;
  notes?: string | null;
  signal_id?: string | number | null;
};

export type UpdateStatusInput = {
  status: string;
  changed_by?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

type DataResponse<T> = {
  data: T;
};

async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `${APEX_API_URL}${path}`,
    {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      cache: "no-store",
    }
  );

  const text = await response.text();

  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `APEX API returned invalid JSON. HTTP ${response.status}`
      );
    }
  }

  if (!response.ok) {
    let message =
      `APEX API returned HTTP ${response.status}`;

    if (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
    ) {
      message = payload.message;
    }

    throw new Error(message);
  }

  return payload as T;
}

export async function fetchContents(
  signal?: AbortSignal
): Promise<ContentsResponse> {
  return requestJson<ContentsResponse>(
    "/contents",
    {
      method: "GET",
      signal,
    }
  );
}

export async function fetchContent(
  contentId: string
): Promise<ContentDetail> {
  const response =
    await requestJson<DataResponse<ContentDetail>>(
      `/contents/${encodeURIComponent(contentId)}`
    );

  return response.data;
}

export async function createContent(
  input: CreateContentInput
): Promise<ContentDetail> {
  const response =
    await requestJson<DataResponse<ContentDetail>>(
      "/contents",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function updateContent(
  contentId: string,
  input: UpdateContentInput
): Promise<ContentDetail> {
  const response =
    await requestJson<DataResponse<ContentDetail>>(
      `/contents/${encodeURIComponent(contentId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function updateContentStatus(
  contentId: string,
  input: UpdateStatusInput
): Promise<ContentDetail> {
  const response =
    await requestJson<DataResponse<ContentDetail>>(
      `/contents/${encodeURIComponent(contentId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function deleteContent(
  contentId: string
): Promise<void> {
  await requestJson(
    `/contents/${encodeURIComponent(contentId)}`,
    {
      method: "DELETE",
    }
  );
}

export type SourceRecord = {
  id: string;
  name: string;
  url: string;
  platform: string;
  category: string;
  priority: number;
  enabled: boolean;
  last_scan_at: string | null;
  created_at: string;
  updated_at: string;

  country_code: string | null;
  country_name: string | null;

  signal_count: number;
};

export type SourcesResponse = {
  data: SourceRecord[];
  count: number;
};

export type CreateSourceInput = {
  name: string;
  url: string;
  platform: string;
  category: string;
  country_code?: string | null;
  priority: number;
  enabled?: boolean;
};

export type UpdateSourceInput = {
  name?: string;
  url?: string;
  platform?: string;
  category?: string;
  country_code?: string | null;
  priority?: number;
  enabled?: boolean;
};

export async function fetchSources(
  signal?: AbortSignal
): Promise<SourcesResponse> {
  return requestJson<SourcesResponse>(
    "/sources",
    {
      method: "GET",
      signal,
    }
  );
}

export async function createSource(
  input: CreateSourceInput
): Promise<SourceRecord> {
  const response =
    await requestJson<DataResponse<SourceRecord>>(
      "/sources",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function updateSource(
  sourceId: string,
  input: UpdateSourceInput
): Promise<SourceRecord> {
  const response =
    await requestJson<DataResponse<SourceRecord>>(
      `/sources/${encodeURIComponent(sourceId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function deleteSource(
  sourceId: string
): Promise<void> {
  await requestJson(
    `/sources/${encodeURIComponent(sourceId)}`,
    {
      method: "DELETE",
    }
  );
}

export async function bulkUpdateSources(
  ids: string[],
  action: "enable" | "disable" | "set_priority",
  priority?: number
): Promise<{ updated_count: number }> {
  const response = await requestJson<{ data: { updated_count: number } }>(
    "/sources/bulk",
    {
      method: "PATCH",
      body: JSON.stringify({ ids, action, priority }),
    }
  );
  return response.data;
}

export async function bulkDeleteSources(
  ids: string[]
): Promise<{ deleted_count: number }> {
  const response = await requestJson<{ data: { deleted_count: number } }>(
    "/sources/bulk",
    {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }
  );
  return response.data;
}

export async function bulkUpdateContents(
  content_ids: string[],
  priority: number
): Promise<{ updated_count: number }> {
  const response = await requestJson<{ data: { updated_count: number } }>(
    "/contents/bulk",
    {
      method: "PATCH",
      body: JSON.stringify({ content_ids, priority }),
    }
  );
  return response.data;
}

export async function bulkUpdateContentStatuses(
  content_ids: string[],
  status: string,
  changed_by?: string,
  reason?: string,
  metadata?: Record<string, unknown>
): Promise<{ updated_count: number; target_status: string }> {
  const response = await requestJson<{ data: { updated_count: number; target_status: string } }>(
    "/contents/bulk/status",
    {
      method: "PATCH",
      body: JSON.stringify({ content_ids, status, changed_by, reason, metadata }),
    }
  );
  return response.data;
}

export async function bulkDeleteContents(
  content_ids: string[]
): Promise<{ deleted_count: number }> {
  const response = await requestJson<{ data: { deleted_count: number } }>(
    "/contents/bulk",
    {
      method: "DELETE",
      body: JSON.stringify({ content_ids }),
    }
  );
  return response.data;
}

export type SignalView =
  | "top100"
  | "qualified"
  | "top30";

export type SignalSort =
  | "views"
  | "views_per_day"
  | "views_per_hour"
  | "growth_velocity"
  | "recency"
  | "rank_score";

export type SignalDurationBucket =
  | "ALL"
  | "UNDER_10"
  | "10_TO_20"
  | "20_TO_40"
  | "41_TO_60"
  | "61_TO_180";

export type SignalShortFormat =
  | "CLASSIC_SHORT"
  | "EXTENDED_SHORT"
  | "NOT_SHORT";

export type SignalViralTier =
  | "PROVEN"
  | "RISING"
  | "WATCH"
  | "UNQUALIFIED";

export type SignalShortRejectionReason =
  | "MISSING_DURATION"
  | "ZERO_DURATION"
  | "OVER_180_SECONDS";

export type SignalEntityResolutionStatus =
  | "RESOLVED"
  | "BRAND_ONLY"
  | "AMBIGUOUS"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

export type SignalEntityMatchMethod =
  | "MODEL_ALIAS"
  | "SERIES_ALIAS"
  | "BRAND_ALIAS"
  | "UNIQUE_MODEL_ALIAS"
  | "SOURCE_PRIOR"
  | "MANUAL"
  | "NONE";

export type SignalVehicleType =
  | "HYPERCAR"
  | "SUPERCAR"
  | "SPORTS_CAR"
  | "MUSCLE_CAR"
  | "RALLY_CAR"
  | "DRAG_CAR"
  | "SEDAN"
  | "COUPE"
  | "HATCHBACK"
  | "WAGON"
  | "SUV"
  | "TRUCK"
  | "OFF_ROAD"
  | "EV"
  | "CLASSIC"
  | "OTHER"
  | "UNKNOWN";

export type SignalVehicleAction =
  | "RACING"
  | "DRIFTING"
  | "DRAG_RACING"
  | "ACCELERATION"
  | "LAUNCH"
  | "BURNOUT"
  | "CRASH"
  | "JUMP"
  | "OFF_ROAD"
  | "RESTORATION"
  | "BUILD"
  | "REVEAL"
  | "COMPARISON"
  | "TESTING"
  | "REVIEW"
  | "CHASE"
  | "OTHER"
  | "UNKNOWN";

export type SignalEntityEvidence = {
  matched_aliases?: Array<{
    alias?: string;
    level?: string;
    field?: string;
    brand?: string;
  }>;
  candidates?: Array<{
    level?: string;
    brand?: string | null;
    series?: string | null;
    model?: string | null;
    score?: number;
  }>;
  action_phrase?: string | null;
  conflict_terms_raw?: string[];
  title_excerpt?: string;
  country_lookup_failed?: boolean;
  ambiguous_between?: string[];
  reason?: string;
  [key: string]: unknown;
};

export type SignalRecord = {
  id: string;
  source_id: string | null;
  external_id: string | null;

  title: string;
  url: string;

  channel_id: string | null;
  channel_title: string | null;
  thumbnail_url: string | null;

  published_at: string | null;
  duration_seconds: number | null;

  views: string;
  views_per_day: string | null;
  views_per_hour: string | null;
  age_hours: string | null;
  growth_velocity: string | null;

  is_short: boolean;
  short_format: SignalShortFormat;
  short_rejection_reason:
    SignalShortRejectionReason | null;
  viral_tier: SignalViralTier;

  qualified: boolean;
  rank_score: string | null;

  vehicle_brand: string | null;
  vehicle_series: string | null;
  vehicle_model: string | null;
  vehicle_type: SignalVehicleType | null;
  vehicle_action: SignalVehicleAction | null;
  conflict_keywords: string[];

  entity_resolution_status: SignalEntityResolutionStatus;
  entity_confidence: string | null;
  entity_match_method: SignalEntityMatchMethod | null;
  entity_resolver_version: string | null;
  entity_locked: boolean;

  resolved_vehicle_id: string | null;
  resolved_vehicle_code: string | null;
  resolved_vehicle_name: string | null;

  resolved_country_id: string | null;
  resolved_country_code: string | null;
  resolved_country_name: string | null;

  raw_metrics: {
    likes?: number;
    comments?: number;
    source_name?: string;
    duration_iso?: string;
    duration_bucket?: string;
    short_format?: SignalShortFormat;
    viral_tier?: SignalViralTier;
    privacy_status?: string;
    scanner_run_id?: string;
    live_broadcast_content?: string;
    [key: string]: unknown;
  };

  last_scanned_at: string | null;

  source_name: string | null;
  source_priority: number | null;
  source_country_code: string | null;
};

export type SignalFilters = {
  view: SignalView;
  window_days: 3 | 7 | 14 | 30;
  duration_bucket: SignalDurationBucket;
  shorts_only: boolean;
  viral_tier: SignalViralTier | "ALL";
  short_format: SignalShortFormat | "ALL";
  entity_status: SignalEntityResolutionStatus | "ALL";
  vehicle_type: SignalVehicleType | "ALL";
  vehicle_action: SignalVehicleAction | "ALL";
  has_vehicle: "ALL" | "TRUE" | "FALSE";
  vehicle_brand: string;
  country_code: string;
  sort: SignalSort;
  source_id: string | null;
  q: string;
  limit: number;
  offset: number;
};

export type SignalsResponse = {
  data: SignalRecord[];
  count: number;
  total_count: number;
  filters: SignalFilters;
};

export type FetchSignalsInput = {
  view?: SignalView;
  window_days?: 3 | 7 | 14 | 30;
  duration_bucket?: SignalDurationBucket;
  shorts_only?: boolean;
  viral_tier?: SignalViralTier | "ALL";
  short_format?: SignalShortFormat | "ALL";
  entity_status?: SignalEntityResolutionStatus | "ALL";
  vehicle_type?: SignalVehicleType | "ALL";
  vehicle_action?: SignalVehicleAction | "ALL";
  has_vehicle?: "ALL" | "TRUE" | "FALSE";
  vehicle_brand?: string;
  country_code?: string;
  sort?: SignalSort;
  source_id?: string | null;
  q?: string;
  limit?: number;
  offset?: number;
};

export type ScannerRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ScannerScanMode = "CURRENT" | "HISTORICAL";

export type ScannerRun = {
  id: string;
  status: ScannerRunStatus;

  request_payload: {
    source_ids: string[] | null;
    max_results_per_source: number;
    max_age_days: 3 | 7 | 14 | 30;
    force_refresh_channels: boolean;
    scan_mode?: ScannerScanMode;
    max_pages_per_source?: number;
  };

  summary: {
    errors?: Array<{
      source_id?: string;
      source_name?: string;
      message?: string;
    }>;

    scan_mode?: ScannerScanMode;
    max_age_days?: number;
    max_results_per_source?: number;

    shorts_accepted?: number;
    long_videos_rejected?: number;
    proven_count?: number;
    rising_count?: number;
    watch_count?: number;
    unqualified_count?: number;
    qualified_count?: number;

    entity_resolved_count?: number;
    entity_brand_only_count?: number;
    entity_ambiguous_count?: number;
    entity_unresolved_count?: number;
    entity_not_applicable_count?: number;
    country_resolved_count?: number;
    vehicle_record_linked_count?: number;

    history_scope?: "ALL_TIME";
    pages_scanned?: number;
    videos_discovered?: number;
    videos_processed?: number;
    history_complete?: boolean;
    truncated_sources?: string[];
    oldest_video_published_at?: string | null;
    newest_video_published_at?: string | null;
  };

  source_count: number;
  resolved_source_count: number;
  failed_source_count: number;

  video_count: number;
  inserted_count: number;
  updated_count: number;
  qualified_count: number;

  quota_units_estimated: number;

  error_message: string | null;

  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QueueScannerRunInput = {
  source_ids?: Array<string | number>;
  max_results_per_source?: number;
  max_age_days?: 3 | 7 | 14 | 30;
  force_refresh_channels?: boolean;
  scan_mode?: ScannerScanMode;
  max_pages_per_source?: number;
};

export async function fetchSignals(
  input: FetchSignalsInput = {},
  signal?: AbortSignal
): Promise<SignalsResponse> {
  const query = new URLSearchParams();

  if (input.view) {
    query.set("view", input.view);
  }

  if (input.window_days) {
    query.set(
      "window_days",
      String(input.window_days)
    );
  }

  if (input.duration_bucket) {
    query.set(
      "duration_bucket",
      input.duration_bucket
    );
  }

  if (input.shorts_only !== undefined) {
    query.set(
      "shorts_only",
      String(input.shorts_only)
    );
  }

  if (input.viral_tier) {
    query.set(
      "viral_tier",
      input.viral_tier
    );
  }

  if (input.short_format) {
    query.set(
      "short_format",
      input.short_format
    );
  }

  if (input.entity_status) {
    query.set(
      "entity_status",
      input.entity_status
    );
  }

  if (input.vehicle_type) {
    query.set(
      "vehicle_type",
      input.vehicle_type
    );
  }

  if (input.vehicle_action) {
    query.set(
      "vehicle_action",
      input.vehicle_action
    );
  }

  if (
    input.has_vehicle &&
    input.has_vehicle !== "ALL"
  ) {
    query.set(
      "has_vehicle",
      input.has_vehicle
    );
  }

  if (input.vehicle_brand?.trim()) {
    query.set(
      "vehicle_brand",
      input.vehicle_brand.trim()
    );
  }

  if (input.country_code?.trim()) {
    query.set(
      "country_code",
      input.country_code.trim()
    );
  }

  if (input.sort) {
    query.set("sort", input.sort);
  }

  if (input.source_id) {
    query.set(
      "source_id",
      input.source_id
    );
  }

  if (input.q?.trim()) {
    query.set(
      "q",
      input.q.trim()
    );
  }

  if (input.limit !== undefined) {
    query.set(
      "limit",
      String(input.limit)
    );
  }

  if (input.offset !== undefined) {
    query.set(
      "offset",
      String(input.offset)
    );
  }

  const queryString = query.toString();

  return requestJson<SignalsResponse>(
    `/signals${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      signal,
    }
  );
}

export type CountryNewsTrafficTier =
  | "BREAKOUT"
  | "ACTIVE"
  | "WATCH"
  | "LOW_SIGNAL";

export type CountryNewsTransformationTier =
  | "HIGH"
  | "MEDIUM"
  | "LOW";

export type CountryNewsCategory =
  | "POLITICS_POLICY"
  | "ENERGY"
  | "WAR_SECURITY"
  | "SANCTIONS_TRADE"
  | "RESOURCES"
  | "SEMICONDUCTORS_AI"
  | "ECONOMY"
  | "DISASTER_CLIMATE"
  | "INFRASTRUCTURE"
  | "INTERNATIONAL_RELATIONS"
  | "CULTURE_SOCIETY"
  | "OTHER";

export type CountryNewsConflictArchetype =
  | "RESOURCE_SCARCITY"
  | "SUPPLY_CHAIN_DISRUPTION"
  | "POWER_STRUGGLE"
  | "TECHNOLOGY_RACE"
  | "SANCTIONS_BLOCKADE"
  | "INFRASTRUCTURE_FAILURE"
  | "DISASTER_SURVIVAL"
  | "ECONOMIC_PRESSURE"
  | "BORDER_SECURITY"
  | "PROPAGANDA_CULTURE";

export type CountryNewsMatchMethod =
  | "TITLE_ALIAS"
  | "SNIPPET_ALIAS"
  | "QUERY_CONTEXT";

export type CountryNewsSort =
  | "traffic_score"
  | "recency"
  | "publisher_count"
  | "mention_count"
  | "transformation_potential";

export type CountryNewsWindowHours = 24 | 72 | 168;

export type CountryNewsRecord = {
  id: string;
  country_id: string;
  country_code: string;
  country_name: string;

  title: string;
  representative_url: string;
  representative_source: string | null;
  representative_domain: string | null;

  category: CountryNewsCategory;
  category_confidence: string | null;

  country_match_method: CountryNewsMatchMethod;
  country_confidence: string | null;

  traffic_tier: CountryNewsTrafficTier;
  traffic_score: string;
  mention_count: number;
  publisher_count: number;
  query_count: number;
  feed_rank_score: string | null;
  age_hours: string | null;

  transformation_tier: CountryNewsTransformationTier;
  transformation_potential: string;

  conflict_archetypes: CountryNewsConflictArchetype[];
  keywords: string[];

  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;

  provider: string;
  resolver_version: string;

  vehicle_signal_count: number;
  qualified_vehicle_signal_count: number;
  vehicle_views_total: string;
  vehicle_views_max: string;
};

export type CountryNewsMention = {
  id: string;
  external_key: string;
  query_key: string;
  query_text: string;
  feed_rank: number | null;

  title: string;
  normalized_title: string;
  url: string;
  guid: string | null;

  source_name: string | null;
  source_url: string | null;
  publisher_domain: string | null;

  published_at: string | null;
  snippet: string | null;

  raw_metadata: {
    query_keys?: string[];
    [key: string]: unknown;
  };

  first_seen_at: string;
  last_seen_at: string;
};

export type CountryNewsDetail =
  CountryNewsRecord & {
    story_hash: string;
    canonical_title: string;
    category_evidence: Record<string, unknown>;
    country_evidence: Record<string, unknown>;
    raw_metadata: Record<string, unknown>;
    mentions: CountryNewsMention[];
  };

export type CountryNewsSummary = {
  total_count?: number;
  breakout_count?: number;
  active_count?: number;
  watch_count?: number;
  low_signal_count?: number;
  high_transformation_count?: number;
  medium_transformation_count?: number;
  low_transformation_count?: number;
  active_country_count?: number;
  vehicle_anchor_count?: number;
  vehicle_views_total?: string;
};

export type CountryNewsFilters = {
  window_hours: CountryNewsWindowHours;
  country_code: string;
  category: CountryNewsCategory | "ALL";
  traffic_tier: CountryNewsTrafficTier | "ALL";
  transformation_tier:
    | CountryNewsTransformationTier
    | "ALL";
  conflict_archetype:
    | CountryNewsConflictArchetype
    | "ALL";
  sort: CountryNewsSort;
  q: string;
  limit: number;
  offset: number;
};

export type CountryNewsResponse = {
  data: CountryNewsRecord[];
  count: number;
  total_count: number;
  summary: CountryNewsSummary;
  filters: CountryNewsFilters;
};

export type FetchCountryNewsInput = {
  window_hours?: CountryNewsWindowHours;
  country_code?: string;
  category?: CountryNewsCategory | "ALL";
  traffic_tier?: CountryNewsTrafficTier | "ALL";
  transformation_tier?:
    | CountryNewsTransformationTier
    | "ALL";
  conflict_archetype?:
    | CountryNewsConflictArchetype
    | "ALL";
  sort?: CountryNewsSort;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CountryNewsRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type CountryNewsRunCountrySummary = {
  country_id?: string;
  country_code?: string;
  country_name?: string;
  vehicle_signal_count?: number;
  qualified_vehicle_signal_count?: number;
  vehicle_views_total?: string;
  vehicle_views_max?: string;
  brands?: string[];
  models?: string[];
};

export type CountryNewsRun = {
  id: string;
  status: CountryNewsRunStatus;

  request_payload: {
    max_countries?: number;
    max_queries_per_country?: number;
    max_items_per_query?: number;
    max_age_hours?: CountryNewsWindowHours;
    country_codes?: string[] | null;
  };

  summary: {
    selected_countries?: CountryNewsRunCountrySummary[];
    country_results?: Array<{
      country_code?: string;
      status?: string;
      query_count?: number;
      succeeded_query_count?: number;
      item_count?: number;
      mention_count?: number;
      cluster_count?: number;
      message?: string;
    }>;
    errors?: Array<{
      scope?: string;
      country_code?: string;
      query_key?: string;
      code?: string | null;
      message?: string;
    }>;

    breakout_count?: number;
    active_count?: number;
    watch_count?: number;
    low_signal_count?: number;

    high_transformation_count?: number;
    medium_transformation_count?: number;
    low_transformation_count?: number;

    provider?: string;
    resolver_version?: string;
    max_age_hours?: number;
    max_items_per_query?: number;
    max_queries_per_country?: number;
  };

  country_count: number;
  completed_country_count: number;
  failed_country_count: number;

  query_count: number;
  succeeded_query_count: number;

  item_count: number;
  mention_inserted_count: number;
  mention_updated_count: number;
  cluster_inserted_count: number;
  cluster_updated_count: number;

  error_message: string | null;

  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QueueCountryNewsRunInput = {
  max_countries?: number;
  max_queries_per_country?: number;
  max_items_per_query?: number;
  max_age_hours?: CountryNewsWindowHours;
  country_codes?: string[] | null;
};

export async function fetchCountryNews(
  input: FetchCountryNewsInput = {},
  signal?: AbortSignal
): Promise<CountryNewsResponse> {
  const query = new URLSearchParams();

  if (input.window_hours) {
    query.set(
      "window_hours",
      String(input.window_hours)
    );
  }

  if (input.country_code?.trim()) {
    query.set(
      "country_code",
      input.country_code.trim()
    );
  }

  if (input.category) {
    query.set("category", input.category);
  }

  if (input.traffic_tier) {
    query.set("traffic_tier", input.traffic_tier);
  }

  if (input.transformation_tier) {
    query.set(
      "transformation_tier",
      input.transformation_tier
    );
  }

  if (
    input.conflict_archetype &&
    input.conflict_archetype !== "ALL"
  ) {
    query.set(
      "conflict_archetype",
      input.conflict_archetype
    );
  }

  if (input.sort) {
    query.set("sort", input.sort);
  }

  if (input.q?.trim()) {
    query.set("q", input.q.trim());
  }

  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }

  if (input.offset !== undefined) {
    query.set("offset", String(input.offset));
  }

  const queryString = query.toString();

  return requestJson<CountryNewsResponse>(
    `/country-news${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      signal,
    }
  );
}

export async function fetchCountryNewsDetail(
  newsId: string,
  signal?: AbortSignal
): Promise<CountryNewsDetail> {
  const response =
    await requestJson<DataResponse<CountryNewsDetail>>(
      `/country-news/${encodeURIComponent(newsId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}

export async function queueCountryNewsRun(
  input: QueueCountryNewsRunInput = {}
): Promise<CountryNewsRun> {
  const response =
    await requestJson<DataResponse<CountryNewsRun>>(
      "/country-news/run",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function fetchCountryNewsRun(
  runId: string,
  signal?: AbortSignal
): Promise<CountryNewsRun> {
  const response =
    await requestJson<DataResponse<CountryNewsRun>>(
      `/country-news/runs/${encodeURIComponent(runId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}

export type PersonRoleCategory =
  | "FOUNDER_EXECUTIVE"
  | "DRIVER_RACER"
  | "ENGINEER_DESIGNER"
  | "BUILDER_TUNER"
  | "CREATOR_MEDIA"
  | "COLLECTOR_OWNER"
  | "HISTORICAL_FIGURE"
  | "OTHER";

export type PersonRelationType =
  | "FOUNDER"
  | "EXECUTIVE"
  | "DRIVER"
  | "RACING_DRIVER"
  | "DESIGNER"
  | "ENGINEER"
  | "BUILDER"
  | "TUNER"
  | "CREATOR"
  | "OWNER"
  | "HISTORICAL"
  | "OTHER";

export type PersonTrafficTier =
  | "BREAKOUT"
  | "ACTIVE"
  | "WATCH"
  | "LOW_SIGNAL";

export type PersonTransformationTier =
  | "HIGH"
  | "MEDIUM"
  | "LOW";

export type PersonAttentionArchetype =
  | "LEADERSHIP_POWER"
  | "PERFORMANCE_RIVALRY"
  | "TECHNOLOGY_VISION"
  | "LEGAL_REGULATORY"
  | "ACCIDENT_SAFETY"
  | "RECORD_ACHIEVEMENT"
  | "OWNERSHIP_LUXURY"
  | "CULTURE_FANDOM"
  | "CONTROVERSY"
  | "OTHER";

export type PersonLinkMethod =
  | "CATALOG"
  | "DIRECT_MENTION"
  | "MODEL_ASSOCIATION"
  | "BRAND_ASSOCIATION"
  | "MANUAL";

export type PersonMentionMatchMethod =
  | "TITLE_ALIAS"
  | "SNIPPET_ALIAS"
  | "QUERY_CONTEXT";

export type PersonRelationshipScope =
  | "ONE_YEAR"
  | "TEN_YEARS"
  | "ALL_TIME";

export type PersonHistoricalResonanceTier =
  | "ICONIC"
  | "ESTABLISHED"
  | "RECOGNIZABLE"
  | "NICHE";

export type PersonHistoricalResonanceScores = Partial<
  Record<PersonRelationshipScope, number>
>;

export type PersonHistoricalResonanceTiers = Partial<
  Record<
    PersonRelationshipScope,
    PersonHistoricalResonanceTier
  >
>;

export type PersonResonanceScopeEvidence = {
  score?: number | null;
  tier?: PersonHistoricalResonanceTier | null;
  eligible_link_count?: number;
  strong_link_count?: number;
  breadth_bonus?: number;
  primary_association?: Record<string, unknown> | null;
  score_breakdown?: Record<string, number> | null;
};

export type PersonResonanceEvidence = {
  resonance_version?: string;
  resonance_catalog_version?: string;
  primary_resonance_link_id?: string | number | null;
  scopes?: Partial<
    Record<
      PersonRelationshipScope,
      PersonResonanceScopeEvidence
    >
  >;
  [key: string]: unknown;
};

export type PersonRadarSort =
  | "traffic_score"
  | "vehicle_views"
  | "news_coverage"
  | "recency"
  | "publisher_count"
  | "transformation_potential"
  | "historical_resonance";

export type PersonRadarWindowHours =
  | 24
  | 72
  | 168
  | 720;

export type PersonNewsAgeHours = 24 | 72 | 168;

export type PersonVehicleWindowDays =
  | 3
  | 7
  | 14
  | 30;

export type PersonTrafficRecord = {
  id: string;
  person_id: string;
  person_slug: string;
  canonical_name: string;
  role_category: PersonRoleCategory;
  person_country_code: string | null;
  person_country_name: string | null;

  linked_brands: string[];
  linked_series: string[];
  linked_models: string[];
  relation_types: PersonRelationType[];
  link_confidence: string | null;

  traffic_tier: PersonTrafficTier;
  traffic_score: string;

  vehicle_attention_score: string;
  news_coverage_score: string;

  vehicle_signal_count: number;
  qualified_vehicle_signal_count: number;
  direct_vehicle_mention_count: number;
  vehicle_views_total: string;
  vehicle_views_max: string;

  news_mention_count: number;
  publisher_count: number;
  query_count: number;
  feed_rank_score: string | null;
  age_hours: string | null;

  attention_archetypes: PersonAttentionArchetype[];
  transformation_tier: PersonTransformationTier;
  transformation_potential: string;

  representative_headline: string | null;
  representative_url: string | null;
  representative_source: string | null;
  representative_domain: string | null;

  relationship_scope: PersonRelationshipScope;
  historical_resonance_score: string | null;
  historical_resonance_tier:
    | PersonHistoricalResonanceTier
    | null;
  historical_resonance_scores: PersonHistoricalResonanceScores;
  historical_resonance_tiers: PersonHistoricalResonanceTiers;
  primary_resonance_link_id: string | null;
  resonance_version: string | null;
  resonance_evidence: PersonResonanceEvidence;

  traffic_observed_since: string | null;
  historical_traffic_claimed: boolean;

  first_seen_at: string;
  last_seen_at: string;

  provider: string;
  resolver_version: string;
};

export type PersonVehicleLink = {
  id: string;
  vehicle_id: string | null;
  vehicle_brand: string | null;
  vehicle_series: string | null;
  vehicle_model: string | null;
  relation_type: PersonRelationType;
  link_confidence: string | null;
  link_method: PersonLinkMethod;
  link_evidence: Record<string, unknown>;
  locked: boolean;

  evidence_horizon: PersonRelationshipScope | null;
  iconic_association: boolean;
  legacy_association: boolean;
  recognition_weight: string | null;
  association_start_year: number | null;
  association_end_year: number | null;
  historical_resonance_score: string | null;
  historical_resonance_tier:
    | PersonHistoricalResonanceTier
    | null;
  resonance_evidence: Record<string, unknown>;
  resonance_version: string | null;
  resonance_locked: boolean;

  created_at: string;
  updated_at: string;
};

export type PersonTrafficMention = {
  id: string;
  external_key: string;
  query_key: string;
  query_text: string;
  feed_rank: number | null;

  title: string;
  normalized_title: string;
  url: string;
  guid: string | null;

  source_name: string | null;
  source_url: string | null;
  publisher_domain: string | null;

  published_at: string | null;
  snippet: string | null;

  person_match_method: PersonMentionMatchMethod;
  person_confidence: string | null;

  raw_metadata: {
    query_keys?: string[];
    [key: string]: unknown;
  };

  first_seen_at: string;
  last_seen_at: string;
};

export type PersonRadarDetail =
  PersonTrafficRecord & {
    person_aliases: string[];
    person_metadata: Record<string, unknown>;
    catalog_version: string | null;
    person_active: boolean;
    raw_metadata: Record<string, unknown>;
    vehicle_links: PersonVehicleLink[];
    mentions: PersonTrafficMention[];
  };

export type PersonRadarSummary = {
  visible_people?: number;
  breakout?: number;
  active?: number;
  watch?: number;
  low_signal?: number;

  high_potential?: number;
  medium_potential?: number;
  low_potential?: number;

  total_vehicle_views?: string;
  total_vehicle_signals?: number;
  direct_mention_people?: number;
  active_brands?: number;
  active_models?: number;
  news_publishers?: number;

  iconic?: number;
  established?: number;
  recognizable?: number;
  niche?: number;
  unscored?: number;
  average_historical_resonance?: string | null;
};

export type PersonRadarFilters = {
  window_hours: PersonRadarWindowHours;
  role_category: PersonRoleCategory | "ALL";
  relation_type: PersonRelationType | "ALL";
  vehicle_brand: string;
  vehicle_model: string;
  country_code: string;
  traffic_tier: PersonTrafficTier | "ALL";
  transformation_tier:
    | PersonTransformationTier
    | "ALL";
  attention_archetype:
    | PersonAttentionArchetype
    | "ALL";
  relationship_scope: PersonRelationshipScope;
  historical_resonance_tier:
    | PersonHistoricalResonanceTier
    | "ALL";
  sort: PersonRadarSort;
  q: string;
  limit: number;
  offset: number;
};

export type PersonRadarResponse = {
  data: PersonTrafficRecord[];
  count: number;
  total_count: number;
  summary: PersonRadarSummary;
  filters: PersonRadarFilters;
};

export type FetchPersonRadarInput = {
  window_hours?: PersonRadarWindowHours;
  role_category?: PersonRoleCategory | "ALL";
  relation_type?: PersonRelationType | "ALL";
  vehicle_brand?: string;
  vehicle_model?: string;
  country_code?: string;
  traffic_tier?: PersonTrafficTier | "ALL";
  transformation_tier?:
    | PersonTransformationTier
    | "ALL";
  attention_archetype?:
    | PersonAttentionArchetype
    | "ALL";
  relationship_scope?: PersonRelationshipScope;
  historical_resonance_tier?:
    | PersonHistoricalResonanceTier
    | "ALL";
  sort?: PersonRadarSort;
  q?: string;
  limit?: number;
  offset?: number;
};

export type PersonRadarRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type PersonRadarRunPersonSummary = {
  person_id?: string;
  person_slug?: string;
  canonical_name?: string;
  role_category?: PersonRoleCategory;
  linked_brands?: string[];
  linked_series?: string[];
  linked_models?: string[];
  relation_types?: PersonRelationType[];
  vehicle_signal_count?: number;
  qualified_vehicle_signal_count?: number;
  direct_vehicle_mention_count?: number;
  vehicle_views_total?: string;
  vehicle_views_max?: string;
};

export type PersonRadarRun = {
  id: string;
  status: PersonRadarRunStatus;

  request_payload: {
    max_people?: number;
    vehicle_window_days?: PersonVehicleWindowDays;
    max_queries_per_person?: number;
    max_items_per_query?: number;
    max_age_hours?: PersonNewsAgeHours;
    person_ids?: string[] | null;
    person_slugs?: string[] | null;
  };

  summary: {
    selected_people?: PersonRadarRunPersonSummary[];
    person_results?: Array<{
      person_slug?: string;
      status?: string;
      query_count?: number;
      succeeded_query_count?: number;
      item_count?: number;
      mention_count?: number;
      traffic_tier?: PersonTrafficTier;
      transformation_tier?: PersonTransformationTier;
      message?: string;
    }>;
    errors?: Array<{
      scope?: string;
      person_slug?: string;
      query_key?: string;
      code?: string | null;
      message?: string;
    }>;

    breakout_count?: number;
    active_count?: number;
    watch_count?: number;
    low_signal_count?: number;

    high_transformation_count?: number;
    medium_transformation_count?: number;
    low_transformation_count?: number;

    direct_mention_person_count?: number;
    brand_association_person_count?: number;
    model_association_person_count?: number;

    resonance_scored_count?: number;
    resonance_unscored_count?: number;

    one_year_iconic_count?: number;
    one_year_established_count?: number;
    one_year_recognizable_count?: number;
    one_year_niche_count?: number;

    ten_year_iconic_count?: number;
    ten_year_established_count?: number;
    ten_year_recognizable_count?: number;
    ten_year_niche_count?: number;

    all_time_iconic_count?: number;
    all_time_established_count?: number;
    all_time_recognizable_count?: number;
    all_time_niche_count?: number;

    provider?: string;
    resolver_version?: string;
    catalog_version?: string;
    resonance_version?: string;
    resonance_catalog_version?: string;
    vehicle_window_days?: number;
    max_age_hours?: number;
    max_queries_per_person?: number;
    max_items_per_query?: number;
  };

  person_count: number;
  completed_person_count: number;
  failed_person_count: number;

  query_count: number;
  succeeded_query_count: number;
  item_count: number;

  mention_inserted_count: number;
  mention_updated_count: number;
  signal_inserted_count: number;
  signal_updated_count: number;

  error_message: string | null;

  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QueuePersonRadarRunInput = {
  max_people?: number;
  vehicle_window_days?: PersonVehicleWindowDays;
  max_queries_per_person?: number;
  max_items_per_query?: number;
  max_age_hours?: PersonNewsAgeHours;
  person_ids?: string[] | null;
  person_slugs?: string[] | null;
};

export async function fetchPersonRadar(
  input: FetchPersonRadarInput = {},
  signal?: AbortSignal
): Promise<PersonRadarResponse> {
  const query = new URLSearchParams();

  if (input.window_hours) {
    query.set(
      "window_hours",
      String(input.window_hours)
    );
  }

  if (input.role_category) {
    query.set(
      "role_category",
      input.role_category
    );
  }

  if (input.relation_type) {
    query.set(
      "relation_type",
      input.relation_type
    );
  }

  if (input.vehicle_brand?.trim()) {
    query.set(
      "vehicle_brand",
      input.vehicle_brand.trim()
    );
  }

  if (input.vehicle_model?.trim()) {
    query.set(
      "vehicle_model",
      input.vehicle_model.trim()
    );
  }

  if (input.country_code?.trim()) {
    query.set(
      "country_code",
      input.country_code.trim()
    );
  }

  if (input.traffic_tier) {
    query.set("traffic_tier", input.traffic_tier);
  }

  if (input.transformation_tier) {
    query.set(
      "transformation_tier",
      input.transformation_tier
    );
  }

  if (
    input.attention_archetype &&
    input.attention_archetype !== "ALL"
  ) {
    query.set(
      "attention_archetype",
      input.attention_archetype
    );
  }

  if (input.relationship_scope) {
    query.set(
      "relationship_scope",
      input.relationship_scope
    );
  }

  if (input.historical_resonance_tier) {
    query.set(
      "historical_resonance_tier",
      input.historical_resonance_tier
    );
  }

  if (input.sort) {
    query.set("sort", input.sort);
  }

  if (input.q?.trim()) {
    query.set("q", input.q.trim());
  }

  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }

  if (input.offset !== undefined) {
    query.set("offset", String(input.offset));
  }

  const queryString = query.toString();

  return requestJson<PersonRadarResponse>(
    `/person-radar${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      signal,
    }
  );
}

export async function fetchPersonRadarDetail(
  signalId: string,
  signal?: AbortSignal
): Promise<PersonRadarDetail> {
  const response =
    await requestJson<DataResponse<PersonRadarDetail>>(
      `/person-radar/${encodeURIComponent(signalId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}

export async function queuePersonRadarRun(
  input: QueuePersonRadarRunInput = {}
): Promise<PersonRadarRun> {
  const response =
    await requestJson<DataResponse<PersonRadarRun>>(
      "/person-radar/run",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function fetchPersonRadarRun(
  runId: string,
  signal?: AbortSignal
): Promise<PersonRadarRun> {
  const response =
    await requestJson<DataResponse<PersonRadarRun>>(
      `/person-radar/runs/${encodeURIComponent(runId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}

export async function queueScannerRun(
  input: QueueScannerRunInput = {}
): Promise<ScannerRun> {
  const response =
    await requestJson<DataResponse<ScannerRun>>(
      "/scanner/run",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function fetchScannerRun(
  runId: string,
  signal?: AbortSignal
): Promise<ScannerRun> {
  const response =
    await requestJson<DataResponse<ScannerRun>>(
      `/scanner/runs/${encodeURIComponent(runId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}

// =========================================================
// VEHICLE HISTORICAL TOP 10
// =========================================================

export type VehicleHistoryScope =
  | "ONE_YEAR"
  | "TEN_YEARS"
  | "ALL_TIME";

export type VehicleHistoricalFormat = "SHORTS" | "ALL";

export type VehicleHistoricalScanSummary = {
  history_complete: boolean;
  pages_scanned: number | null;
  truncated_sources: string[];
  oldest_video_published_at: string | null;
  newest_video_published_at: string | null;
  scan_completed_at: string | null;
};

export type VehicleHistoricalEntityEvidence =
  Record<string, unknown>;

// Each row is ONE video -- the single highest-viewed eligible
// video for its distinct resolved vehicle. Never a per-vehicle
// SUM of views.
export type VehicleHistoricalRecord = {
  rank: number;

  signal_id: string;
  external_video_id: string | null;
  video_title: string;
  video_url: string;
  thumbnail_url: string | null;
  video_views: string;
  published_at: string | null;
  channel_title: string | null;

  source_id: string | null;
  source_name: string | null;

  vehicle_id: string;
  vehicle_code: string;
  vehicle_name: string;
  manufacturer: string | null;

  // Reference only -- how many eligible videos this vehicle
  // has in scope. Never used to rank the Top 10.
  vehicle_signal_count: number;

  entity_evidence: VehicleHistoricalEntityEvidence | null;
  entity_match_method: string | null;

  history_scope: VehicleHistoryScope;
  format: VehicleHistoricalFormat;
  history_complete: boolean;
};

export type VehicleHistoricalFilters = {
  history_scope: VehicleHistoryScope;
  format: VehicleHistoricalFormat;
  limit: number;
  offset: number;
};

export type VehicleHistoricalResponse = {
  data: VehicleHistoricalRecord[];
  count: number;
  total_count: number;
  history_scope: VehicleHistoryScope;
  format: VehicleHistoricalFormat;
  history_complete: boolean;
  scan_summary: VehicleHistoricalScanSummary;
  filters: VehicleHistoricalFilters;
};

export type FetchVehicleHistoricalRankingInput = {
  history_scope?: VehicleHistoryScope;
  format?: VehicleHistoricalFormat;
  limit?: number;
  offset?: number;
};

export type VehicleHistoricalTopVideo = {
  signal_id: string;
  external_video_id: string | null;
  video_title: string;
  video_url: string;
  thumbnail_url: string | null;
  video_views: string;
  published_at: string | null;
  is_short: boolean;
  short_format: SignalShortFormat;
  channel_title: string | null;
  source_name: string | null;
  entity_evidence: VehicleHistoricalEntityEvidence | null;
  entity_match_method: string | null;
};

export type VehicleHistoricalDetail = {
  vehicle_id: string;
  vehicle_code: string;
  vehicle_name: string;
  manufacturer: string | null;
  history_scope: VehicleHistoryScope;
  format: VehicleHistoricalFormat;
  history_complete: boolean;
  vehicle_signal_count: number;
  scan_summary: VehicleHistoricalScanSummary;
  top_video: VehicleHistoricalTopVideo | null;
};

export async function fetchVehicleHistoricalRanking(
  input: FetchVehicleHistoricalRankingInput = {},
  signal?: AbortSignal
): Promise<VehicleHistoricalResponse> {
  const query = new URLSearchParams();

  if (input.history_scope) {
    query.set("history_scope", input.history_scope);
  }

  if (input.format) {
    query.set("format", input.format);
  }

  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }

  if (input.offset !== undefined) {
    query.set("offset", String(input.offset));
  }

  const queryString = query.toString();

  return requestJson<VehicleHistoricalResponse>(
    `/vehicle-historical-ranking${
      queryString ? `?${queryString}` : ""
    }`,
    {
      method: "GET",
      signal,
    }
  );
}

export async function fetchVehicleHistoricalDetail(
  vehicleId: string,
  input: FetchVehicleHistoricalRankingInput = {},
  signal?: AbortSignal
): Promise<VehicleHistoricalDetail> {
  const query = new URLSearchParams();

  if (input.history_scope) {
    query.set("history_scope", input.history_scope);
  }

  if (input.format) {
    query.set("format", input.format);
  }

  const queryString = query.toString();

  const response = await requestJson<
    DataResponse<VehicleHistoricalDetail>
  >(
    `/vehicle-historical-ranking/${encodeURIComponent(
      vehicleId
    )}${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      signal,
    }
  );

  return response.data;
}

// =========================================================
// FUSION (Task 3.3F)
// =========================================================

export type FusionRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type FusionPersonLinkTier =
  | "EXACT_VEHICLE"
  | "SAME_SERIES"
  | "SAME_BRAND";

export type FusionMissingSignal =
  | "NO_PERSON_SIGNAL"
  | "NO_HISTORICAL_RESONANCE";

export type FusionRun = {
  id: string;
  status: FusionRunStatus;

  request_payload: {
    max_vehicles?: number;
    vehicle_window_days?: 3 | 7 | 14 | 30;
    news_window_hours?: 24 | 72 | 168;
    max_news_per_vehicle?: number;
    max_people_per_vehicle?: number;
    vehicle_ids?: string[] | null;
  };

  summary: {
    vehicle_results?: Array<{
      vehicle_code?: string;
      status?: string;
      code?: string;
      message?: string;
      country_news_count?: number;
      person_link_count?: number;
      candidate_count?: number;
    }>;
    errors?: Array<{
      scope?: string;
      vehicle_code?: string;
      code?: string | null;
      message?: string;
    }>;

    complete_candidate_count?: number;
    incomplete_candidate_count?: number;

    exact_vehicle_tier_count?: number;
    same_series_tier_count?: number;
    same_brand_tier_count?: number;
    no_person_signal_count?: number;

    fusion_version?: string;
    vehicle_window_days?: number;
    news_window_hours?: number;
    max_vehicles?: number;
    max_news_per_vehicle?: number;
    max_people_per_vehicle?: number;
  };

  vehicle_count: number;
  completed_vehicle_count: number;
  skipped_vehicle_count: number;
  candidate_count: number;
  candidate_inserted_count: number;
  candidate_updated_count: number;

  error_message: string | null;

  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QueueFusionRunInput = {
  max_vehicles?: number;
  vehicle_window_days?: 3 | 7 | 14 | 30;
  news_window_hours?: 24 | 72 | 168;
  max_news_per_vehicle?: number;
  max_people_per_vehicle?: number;
  vehicle_ids?: Array<string | number> | null;
};

export type FusionCandidate = {
  id: string;
  run_id: string;

  vehicle_id: string;
  vehicle_code: string;
  vehicle_name: string;

  country_id: string;
  country_code: string | null;
  country_name: string | null;

  country_news_signal_id: string;
  country_news_title: string | null;
  country_news_url: string | null;

  person_id: string | null;
  person_slug: string | null;
  person_canonical_name: string | null;
  vehicle_person_link_id: string | null;
  person_link_tier: FusionPersonLinkTier | null;

  qualified_vehicle_signal_count: number;
  vehicle_views_total: string;
  vehicle_views_max: string;
  vehicle_viral_tier: SignalViralTier | null;
  vehicle_traffic_score: string;

  country_news_category: CountryNewsCategory;
  country_news_conflict_archetypes: CountryNewsConflictArchetype[];
  country_news_traffic_proxy_score: string;

  person_current_traffic_score: string | null;

  person_historical_resonance_score: string | null;
  person_historical_resonance_tier:
    | PersonHistoricalResonanceTier
    | null;
  relationship_scope: PersonRelationshipScope | null;
  vehicle_person_link_confidence_score: string | null;

  transformation_potential_score: string;

  fusion_score: string;
  fusion_version: string;
  missing_signals: FusionMissingSignal[];
  is_complete: boolean;

  created_at: string;
  updated_at: string;
};

export type FusionCandidateDetail = FusionCandidate & {
  fusion_evidence: {
    fusion_version?: string;
    vehicle?: Record<string, unknown>;
    country_news?: Record<string, unknown>;
    person_current?: Record<string, unknown> | null;
    historical_relationship?: Record<string, unknown> | null;
    transformation?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

export type FusionCandidateSort =
  | "fusion_score"
  | "vehicle_views"
  | "transformation_potential"
  | "recency";

export type FusionCandidatesSummary = {
  candidate_count?: number;
  distinct_vehicle_count?: number;
  complete_count?: number;
  incomplete_count?: number;
  exact_vehicle_count?: number;
  same_series_count?: number;
  same_brand_count?: number;
  no_person_signal_count?: number;
  average_fusion_score?: string | null;
};

export type FusionCandidatesFilters = {
  run_id: string | null;
  vehicle_id: string | null;
  country_code: string;
  person_link_tier: FusionPersonLinkTier | "ALL" | "NO_PERSON_SIGNAL";
  is_complete: "ALL" | "TRUE" | "FALSE";
  sort: FusionCandidateSort;
  q: string;
  limit: number;
  offset: number;
};

export type FusionCandidatesResponse = {
  data: FusionCandidate[];
  count: number;
  total_count: number;
  summary: FusionCandidatesSummary;
  filters: FusionCandidatesFilters;
};

export type FetchFusionCandidatesInput = {
  run_id?: string | null;
  vehicle_id?: string | null;
  country_code?: string;
  person_link_tier?:
    | FusionPersonLinkTier
    | "ALL"
    | "NO_PERSON_SIGNAL";
  is_complete?: "ALL" | "TRUE" | "FALSE";
  sort?: FusionCandidateSort;
  q?: string;
  limit?: number;
  offset?: number;
};

export async function fetchFusionCandidates(
  input: FetchFusionCandidatesInput = {},
  signal?: AbortSignal
): Promise<FusionCandidatesResponse> {
  const query = new URLSearchParams();

  if (input.run_id) query.set("run_id", input.run_id);
  if (input.vehicle_id) query.set("vehicle_id", input.vehicle_id);
  if (input.country_code?.trim())
    query.set("country_code", input.country_code.trim());
  if (input.person_link_tier)
    query.set("person_link_tier", input.person_link_tier);
  if (input.is_complete) query.set("is_complete", input.is_complete);
  if (input.sort) query.set("sort", input.sort);
  if (input.q?.trim()) query.set("q", input.q.trim());
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.offset !== undefined) query.set("offset", String(input.offset));

  const queryString = query.toString();

  return requestJson<FusionCandidatesResponse>(
    `/fusion/candidates${queryString ? `?${queryString}` : ""}`,
    {
      method: "GET",
      signal,
    }
  );
}

export async function fetchFusionCandidateDetail(
  candidateId: string,
  signal?: AbortSignal
): Promise<FusionCandidateDetail> {
  const response =
    await requestJson<DataResponse<FusionCandidateDetail>>(
      `/fusion/candidates/${encodeURIComponent(candidateId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}

export async function queueFusionRun(
  input: QueueFusionRunInput = {}
): Promise<FusionRun> {
  const response =
    await requestJson<DataResponse<FusionRun>>(
      "/fusion/run",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );

  return response.data;
}

export async function fetchFusionRun(
  runId: string,
  signal?: AbortSignal
): Promise<FusionRun> {
  const response =
    await requestJson<DataResponse<FusionRun>>(
      `/fusion/runs/${encodeURIComponent(runId)}`,
      {
        method: "GET",
        signal,
      }
    );

  return response.data;
}
