"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  ContentCandidate,
  ContentDetail,
  createContent,
  deleteContent,
  fetchContent,
  fetchContents,
  updateContent,
  updateContentStatus,
} from "@/lib/api";

const statusStyles: Record<string, string> = {
  DISCOVERED:
    "border-neutral-700 bg-neutral-800 text-neutral-300",
  ANALYZED:
    "border-blue-900 bg-blue-950 text-blue-300",
  RECOMMENDED:
    "border-violet-900 bg-violet-950 text-violet-300",
  CEO_APPROVED:
    "border-amber-900 bg-amber-950 text-amber-300",
  PACK_READY:
    "border-emerald-900 bg-emerald-950 text-emerald-300",
  GENERATING:
    "border-cyan-900 bg-cyan-950 text-cyan-300",
  UPLOADED:
    "border-sky-900 bg-sky-950 text-sky-300",
  QA_APPROVED:
    "border-green-900 bg-green-950 text-green-300",
  SCHEDULED:
    "border-indigo-900 bg-indigo-950 text-indigo-300",
  PUBLISHED:
    "border-fuchsia-900 bg-fuchsia-950 text-fuchsia-300",
  ANALYZING:
    "border-purple-900 bg-purple-950 text-purple-300",
  WINNER:
    "border-yellow-800 bg-yellow-950 text-yellow-300",
  RESERVE_SIGNAL:
    "border-orange-900 bg-orange-950 text-orange-300",
  ARCHIVED:
    "border-neutral-800 bg-neutral-950 text-neutral-500",
};

const allowedTransitions: Record<string, string[]> = {
  DISCOVERED: ["ANALYZED", "ARCHIVED"],
  ANALYZED: ["RECOMMENDED", "ARCHIVED"],
  RECOMMENDED: [
    "CEO_APPROVED",
    "RESERVE_SIGNAL",
    "ARCHIVED",
  ],
  CEO_APPROVED: ["PACK_READY", "ARCHIVED"],
  PACK_READY: ["GENERATING", "ARCHIVED"],
  GENERATING: [
    "UPLOADED",
    "PACK_READY",
    "ARCHIVED",
  ],
  UPLOADED: [
    "QA_APPROVED",
    "GENERATING",
    "ARCHIVED",
  ],
  QA_APPROVED: [
    "SCHEDULED",
    "GENERATING",
    "ARCHIVED",
  ],
  SCHEDULED: ["PUBLISHED", "QA_APPROVED"],
  PUBLISHED: ["ANALYZING"],
  ANALYZING: [
    "WINNER",
    "RESERVE_SIGNAL",
    "ARCHIVED",
  ],
  WINNER: ["ANALYZING"],
  RESERVE_SIGNAL: [
    "RECOMMENDED",
    "ARCHIVED",
  ],
  ARCHIVED: [],
};

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function priorityLabel(priority: number) {
  const labels: Record<number, string> = {
    1: "Critical",
    2: "High",
    3: "Normal",
    4: "Low",
    5: "Backlog",
  };

  return labels[priority] ?? `P${priority}`;
}

function StatusBadge({
  status,
}: {
  status: string;
}) {
  const style =
    statusStyles[status] ??
    "border-neutral-700 bg-neutral-900 text-neutral-300";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 p-6">
      <p className="text-sm text-neutral-400">
        Loading candidates from APEX API...
      </p>

      {[1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="h-12 animate-pulse rounded-lg bg-neutral-800/70"
        />
      ))}
    </div>
  );
}

export function CandidatesTable() {
  const [contents, setContents] = useState<
    ContentCandidate[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [actionMessage, setActionMessage] =
    useState<string | null>(null);

  const [actionError, setActionError] =
    useState<string | null>(null);

  const [reloadKey, setReloadKey] =
    useState(0);

  const [showCreateForm, setShowCreateForm] =
    useState(false);

  const [historyContent, setHistoryContent] =
    useState<ContentDetail | null>(null);

  const [countryCode, setCountryCode] =
    useState("TW");

  const [vehicleCode, setVehicleCode] =
    useState("TTRS");

  const [newTitle, setNewTitle] =
    useState("");

  const [newPriority, setNewPriority] =
    useState(3);

  function reload() {
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadContents() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchContents(
          controller.signal
        );

        setContents(response.data);
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load candidates."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadContents();

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  async function handleCreate(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setActionError(null);
    setActionMessage(null);

    try {
      const created = await createContent({
        country_code: countryCode.trim().toUpperCase(),
        vehicle_code: vehicleCode.trim().toUpperCase(),
        title: newTitle.trim(),
        priority: newPriority,
        notes:
          "Created from APEX OS Candidates Dashboard.",
        changed_by: "dashboard",
      });

      setActionMessage(
        `Created ${created.content_id}`
      );

      setNewTitle("");
      setShowCreateForm(false);

      reload();
    } catch (createError) {
      setActionError(
        createError instanceof Error
          ? createError.message
          : "Create failed."
      );
    }
  }

  async function handleEdit(
    content: ContentCandidate
  ) {
    const title = window.prompt(
      "Edit title:",
      content.title
    );

    if (title === null) {
      return;
    }

    const priorityText = window.prompt(
      "Priority (1-5):",
      String(content.priority)
    );

    if (priorityText === null) {
      return;
    }

    const priority = Number(priorityText);

    setActionError(null);
    setActionMessage(null);

    try {
      await updateContent(
        content.content_id,
        {
          title,
          priority,
        }
      );

      setActionMessage(
        `Updated ${content.content_id}`
      );

      reload();
    } catch (updateError) {
      setActionError(
        updateError instanceof Error
          ? updateError.message
          : "Update failed."
      );
    }
  }

  async function handleMoveStatus(
    content: ContentCandidate
  ) {
    const allowed =
      allowedTransitions[content.status] ?? [];

    const requested = window.prompt(
      [
        `Current status: ${content.status}`,
        "",
        `Allowed transitions: ${
          allowed.length > 0
            ? allowed.join(", ")
            : "none"
        }`,
        "",
        "Enter requested next status:",
        "For illegal-transition testing, you may intentionally enter another valid status.",
      ].join("\n"),
      allowed[0] ?? ""
    );

    if (requested === null || !requested.trim()) {
      return;
    }

    const nextStatus =
      requested.trim().toUpperCase();

    setActionError(null);
    setActionMessage(null);

    try {
      await updateContentStatus(
        content.content_id,
        {
          status: nextStatus,
          changed_by: "dashboard",
          reason:
            "Status changed from Candidates Dashboard",
          metadata: {
            source: "task-2.8-e2e",
          },
        }
      );

      setActionMessage(
        `${content.content_id}: ${content.status} → ${nextStatus}`
      );

      reload();
    } catch (statusError) {
      setActionError(
        statusError instanceof Error
          ? statusError.message
          : "Status change failed."
      );
    }
  }

  async function handleHistory(
    contentId: string
  ) {
    setActionError(null);

    try {
      const detail = await fetchContent(
        contentId
      );

      setHistoryContent(detail);
    } catch (historyError) {
      setActionError(
        historyError instanceof Error
          ? historyError.message
          : "Failed to load history."
      );
    }
  }

  async function handleDelete(
    content: ContentCandidate
  ) {
    const confirmed = window.confirm(
      `Delete ${content.content_id}?\n\n${content.title}`
    );

    if (!confirmed) {
      return;
    }

    setActionError(null);
    setActionMessage(null);

    try {
      await deleteContent(content.content_id);

      setActionMessage(
        `Deleted ${content.content_id}`
      );

      if (
        historyContent?.content_id ===
        content.content_id
      ) {
        setHistoryContent(null);
      }

      reload();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Delete failed."
      );
    }
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-950 bg-red-950/30 p-5">
          <p className="text-sm font-medium text-red-300">
            Failed to load candidates
          </p>

          <p className="mt-2 text-sm text-red-400/80">
            {error}
          </p>

          <button
            type="button"
            onClick={reload}
            className="mt-4 rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-neutral-200">
            Content Candidates
          </p>

          <p className="mt-1 text-xs text-neutral-500">
            Live data from APEX API · {contents.length} records
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              setShowCreateForm((value) => !value)
            }
            className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-neutral-200"
          >
            New Candidate
          </button>

          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="border-b border-emerald-950 bg-emerald-950/20 px-6 py-3 text-sm text-emerald-300">
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div className="border-b border-red-950 bg-red-950/20 px-6 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="grid gap-4 border-b border-neutral-800 bg-neutral-950/50 p-6 md:grid-cols-5"
        >
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Country Code
            </span>

            <input
              value={countryCode}
              onChange={(event) =>
                setCountryCode(event.target.value)
              }
              required
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Vehicle Code
            </span>

            <input
              value={vehicleCode}
              onChange={(event) =>
                setVehicleCode(event.target.value)
              }
              required
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-xs text-neutral-500">
              Title
            </span>

            <input
              value={newTitle}
              onChange={(event) =>
                setNewTitle(event.target.value)
              }
              required
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Priority
            </span>

            <select
              value={newPriority}
              onChange={(event) =>
                setNewPriority(
                  Number(event.target.value)
                )
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            >
              <option value={1}>P1 Critical</option>
              <option value={2}>P2 High</option>
              <option value={3}>P3 Normal</option>
              <option value={4}>P4 Low</option>
              <option value={5}>P5 Backlog</option>
            </select>
          </label>

          <div className="md:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              Create Content Candidate
            </button>
          </div>
        </form>
      )}

      {contents.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-medium text-neutral-300">
            No candidates found.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950/70">
                {[
                  "Content ID",
                  "Country",
                  "Vehicle",
                  "Source Signal",
                  "Status",
                  "Priority",
                  "Created",
                  "Updated",
                  "Actions",
                ].map((label) => (
                  <th
                    key={label}
                    className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {contents.map((content) => (
                <tr
                  key={content.content_id}
                  className="border-b border-neutral-900 transition hover:bg-neutral-900/60"
                >
                  <td className="px-5 py-4 align-top">
                    <p className="font-mono text-sm font-medium text-white">
                      {content.content_id}
                    </p>

                    <p className="mt-1 max-w-60 text-xs text-neutral-500">
                      {content.title}
                    </p>
                  </td>

                  <td className="px-5 py-4 align-top">
                    <p className="text-sm text-neutral-200">
                      {content.country_code ?? "—"}
                    </p>

                    <p className="mt-1 text-xs text-neutral-500">
                      {content.country_name ?? "Unknown"}
                    </p>
                  </td>

                  <td className="px-5 py-4 align-top">
                    <p className="text-sm text-neutral-200">
                      {content.vehicle_code ?? "—"}
                    </p>

                    <p className="mt-1 max-w-48 text-xs text-neutral-500">
                      {content.vehicle_name ?? "Unknown"}
                    </p>
                  </td>

                  <td className="px-5 py-4 align-top">
                    <p className="max-w-72 text-sm leading-5 text-neutral-300">
                      {content.signal_title ??
                        "No source signal"}
                    </p>
                  </td>

                  <td className="px-5 py-4 align-top">
                    <StatusBadge
                      status={content.status}
                    />
                  </td>

                  <td className="px-5 py-4 align-top">
                    <p className="text-sm text-neutral-300">
                      P{content.priority}
                    </p>

                    <p className="mt-1 text-xs text-neutral-500">
                      {priorityLabel(content.priority)}
                    </p>
                  </td>

                  <td className="px-5 py-4 align-top text-sm text-neutral-400">
                    {formatDate(content.created_at)}
                  </td>

                  <td className="px-5 py-4 align-top text-sm text-neutral-400">
                    {formatDate(content.updated_at)}
                  </td>

                  <td className="px-5 py-4 align-top">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleEdit(content)
                        }
                        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleMoveStatus(content)
                        }
                        className="rounded border border-blue-900 px-2 py-1 text-xs text-blue-300"
                      >
                        Move Status
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleHistory(
                            content.content_id
                          )
                        }
                        className="rounded border border-violet-900 px-2 py-1 text-xs text-violet-300"
                      >
                        History
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDelete(content)
                        }
                        className="rounded border border-red-950 px-2 py-1 text-xs text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyContent && (
        <div className="border-t border-neutral-800 bg-neutral-950 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">
                Status History
              </p>

              <p className="mt-1 font-mono text-xs text-neutral-500">
                {historyContent.content_id}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                setHistoryContent(null)
              }
              className="text-xs text-neutral-500"
            >
              Close
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {historyContent.status_history.map(
              (entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3"
                >
                  <span className="text-xs text-neutral-500">
                    {entry.from_status ?? "CREATED"}
                  </span>

                  <span className="text-xs text-neutral-600">
                    →
                  </span>

                  <span className="text-xs font-medium text-neutral-200">
                    {entry.to_status}
                  </span>

                  <span className="ml-auto text-xs text-neutral-500">
                    {entry.changed_by}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
