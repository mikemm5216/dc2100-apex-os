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
