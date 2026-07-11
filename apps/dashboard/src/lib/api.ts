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
  | "rank_score"
  | "views"
  | "views_per_day"
  | "growth_velocity"
  | "recency";

export type SignalDurationBucket =
  | "ALL"
  | "UNDER_10"
  | "10_TO_20"
  | "20_TO_40"
  | "OVER_40";

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
  age_hours: string | null;
  growth_velocity: string | null;

  qualified: boolean;
  rank_score: string | null;

  raw_metrics: {
    likes?: number;
    comments?: number;
    source_name?: string;
    duration_iso?: string;
    duration_bucket?: SignalDurationBucket | "UNKNOWN";
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

export type ScannerRun = {
  id: string;
  status: ScannerRunStatus;

  request_payload: {
    source_ids: string[] | null;
    max_results_per_source: number;
    max_age_days: 3 | 7 | 14 | 30;
    force_refresh_channels: boolean;
  };

  summary: {
    errors?: Array<{
      source_id?: string;
      source_name?: string;
      message?: string;
    }>;

    max_age_days?: number;
    max_results_per_source?: number;
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
