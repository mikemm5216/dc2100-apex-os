"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  SourceRecord,
  createSource,
  deleteSource,
  fetchSources,
  updateSource,
} from "@/lib/api";

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function SourceManager() {
  const [sources, setSources] = useState<
    SourceRecord[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState<string | null>(null);

  const [showCreate, setShowCreate] =
    useState(false);

  const [reloadKey, setReloadKey] =
    useState(0);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [platform, setPlatform] =
    useState("YouTube");

  const [category, setCategory] =
    useState("JDM");

  const [countryCode, setCountryCode] =
    useState("JP");

  const [priority, setPriority] =
    useState(3);

  function reload() {
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchSources(
          controller.signal
        );

        setSources(response.data);
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
            : "Failed to load sources."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  async function handleCreate(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError(null);
    setMessage(null);

    try {
      const created = await createSource({
        name: name.trim(),
        url: url.trim(),
        platform: platform.trim(),
        category: category.trim(),
        country_code:
          countryCode.trim().toUpperCase() || null,
        priority,
        enabled: true,
      });

      setMessage(`Created ${created.name}`);

      setName("");
      setUrl("");
      setShowCreate(false);

      reload();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Create source failed."
      );
    }
  }

  async function handleEdit(
    source: SourceRecord
  ) {
    const nextName = window.prompt(
      "Source name:",
      source.name
    );

    if (nextName === null) {
      return;
    }

    const nextCategory = window.prompt(
      "Category:",
      source.category
    );

    if (nextCategory === null) {
      return;
    }

    const nextPriorityText = window.prompt(
      "Priority (1-5):",
      String(source.priority)
    );

    if (nextPriorityText === null) {
      return;
    }

    const nextPriority =
      Number(nextPriorityText);

    setError(null);
    setMessage(null);

    try {
      await updateSource(source.id, {
        name: nextName,
        category: nextCategory,
        priority: nextPriority,
      });

      setMessage(`Updated ${source.name}`);

      reload();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Update source failed."
      );
    }
  }

  async function handleToggle(
    source: SourceRecord
  ) {
    setError(null);
    setMessage(null);

    try {
      const updated = await updateSource(
        source.id,
        {
          enabled: !source.enabled,
        }
      );

      setMessage(
        `${updated.name} ${
          updated.enabled ? "enabled" : "disabled"
        }`
      );

      reload();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Toggle source failed."
      );
    }
  }

  async function handleDelete(
    source: SourceRecord
  ) {
    const confirmed = window.confirm(
      `Delete source?\n\n${source.name}`
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      await deleteSource(source.id);

      setMessage(`Deleted ${source.name}`);

      reload();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Delete source failed."
      );
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-neutral-400">
        Loading source watchlist...
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-neutral-200">
            Source Watchlist
          </p>

          <p className="mt-1 text-xs text-neutral-500">
            {sources.length} sources ·{" "}
            {
              sources.filter(
                (source) => source.enabled
              ).length
            }{" "}
            enabled
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              setShowCreate((value) => !value)
            }
            className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black"
          >
            New Source
          </button>

          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300"
          >
            Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className="border-b border-emerald-950 bg-emerald-950/20 px-6 py-3 text-sm text-emerald-300">
          {message}
        </div>
      )}

      {error && (
        <div className="border-b border-red-950 bg-red-950/20 px-6 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="grid gap-4 border-b border-neutral-800 bg-neutral-950/50 p-6 md:grid-cols-3"
        >
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Source Name
            </span>

            <input
              required
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-xs text-neutral-500">
              URL
            </span>

            <input
              required
              type="url"
              value={url}
              onChange={(event) =>
                setUrl(event.target.value)
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Platform
            </span>

            <select
              value={platform}
              onChange={(event) =>
                setPlatform(event.target.value)
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            >
              <option>YouTube</option>
              <option>News</option>
              <option>Social</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Category
            </span>

            <input
              required
              value={category}
              onChange={(event) =>
                setCategory(event.target.value)
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Country Code
            </span>

            <input
              value={countryCode}
              onChange={(event) =>
                setCountryCode(event.target.value)
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs text-neutral-500">
              Priority
            </span>

            <select
              value={priority}
              onChange={(event) =>
                setPriority(
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

          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              Create Source
            </button>
          </div>
        </form>
      )}

      {sources.length === 0 ? (
        <div className="p-10 text-center text-sm text-neutral-500">
          No sources found.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950/70">
                {[
                  "Source",
                  "Platform",
                  "Category",
                  "Country",
                  "Priority",
                  "Signals",
                  "Last Scan",
                  "Status",
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
              {sources.map((source) => (
                <tr
                  key={source.id}
                  className="border-b border-neutral-900 hover:bg-neutral-900/60"
                >
                  <td className="px-5 py-4 align-top">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-white hover:underline"
                    >
                      {source.name}
                    </a>

                    <p className="mt-1 max-w-72 truncate text-xs text-neutral-500">
                      {source.url}
                    </p>
                  </td>

                  <td className="px-5 py-4 text-sm text-neutral-300">
                    {source.platform}
                  </td>

                  <td className="px-5 py-4 text-sm text-neutral-300">
                    {source.category}
                  </td>

                  <td className="px-5 py-4">
                    <p className="text-sm text-neutral-300">
                      {source.country_code ?? "GLOBAL"}
                    </p>

                    <p className="mt-1 text-xs text-neutral-500">
                      {source.country_name ?? "Global"}
                    </p>
                  </td>

                  <td className="px-5 py-4 text-sm text-neutral-300">
                    P{source.priority}
                  </td>

                  <td className="px-5 py-4 text-sm text-neutral-300">
                    {source.signal_count}
                  </td>

                  <td className="px-5 py-4 text-sm text-neutral-400">
                    {formatDate(source.last_scan_at)}
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={
                        source.enabled
                          ? "rounded-full border border-emerald-900 bg-emerald-950 px-2.5 py-1 text-xs text-emerald-300"
                          : "rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-500"
                      }
                    >
                      {source.enabled
                        ? "ENABLED"
                        : "DISABLED"}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleEdit(source)
                        }
                        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleToggle(source)
                        }
                        className="rounded border border-amber-900 px-2 py-1 text-xs text-amber-300"
                      >
                        {source.enabled
                          ? "Disable"
                          : "Enable"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDelete(source)
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
    </div>
  );
}
