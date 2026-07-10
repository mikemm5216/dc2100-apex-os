export const APEX_API_URL =
  process.env.NEXT_PUBLIC_APEX_API_URL ??
  "https://dc2100-apex-os-production.up.railway.app";

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

export type ContentsResponse = {
  data: ContentCandidate[];
  count: number;
};

export async function fetchContents(
  signal?: AbortSignal
): Promise<ContentsResponse> {
  const response = await fetch(
    `${APEX_API_URL}/contents`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(
      `APEX API returned HTTP ${response.status}`
    );
  }

  const payload: unknown = await response.json();

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray(payload.data) ||
    !("count" in payload) ||
    typeof payload.count !== "number"
  ) {
    throw new Error(
      "APEX API returned an unexpected response format."
    );
  }

  return payload as ContentsResponse;
}
