"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type { FormEvent } from "react";

import {
  bulkDeleteSources,
  bulkUpdateSources,
  createSource,
  deleteSource,
  fetchSources,
  updateSource,
} from "@/lib/api";

import type { SourceRecord } from "@/lib/api";

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
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("YouTube");
  const [category, setCategory] = useState("JDM");
  const [countryCode, setCountryCode] = useState("JP");
  const [priority, setPriority] = useState(3);

  // Filters
  const [searchText, setSearchText] = useState("");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPriority, setBulkPriority] = useState(3);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  function reload() {
    setReloadKey((value) => value + 1);
    setSelectedIds(new Set());
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchSources(controller.signal);
        setSources(response.data);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load sources.");
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

  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      if (searchText) {
        const lowerSearch = searchText.toLowerCase();
        if (
          !s.name.toLowerCase().includes(lowerSearch) &&
          !s.url.toLowerCase().includes(lowerSearch) &&
          !s.category.toLowerCase().includes(lowerSearch) &&
          !(s.country_code || "").toLowerCase().includes(lowerSearch)
        ) {
          return false;
        }
      }
      if (platformFilter !== "All" && s.platform !== platformFilter) return false;
      if (categoryFilter !== "All" && s.category !== categoryFilter) return false;
      if (statusFilter === "Enabled" && !s.enabled) return false;
      if (statusFilter === "Disabled" && s.enabled) return false;
      return true;
    });
  }, [sources, searchText, platformFilter, categoryFilter, statusFilter]);

  const allFilteredSelected = filteredSources.length > 0 && filteredSources.every((s) => selectedIds.has(s.id));
  const someFilteredSelected = filteredSources.some((s) => selectedIds.has(s.id));

  function handleSelectAll() {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      for (const s of filteredSources) next.delete(s.id);
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      for (const s of filteredSources) next.add(s.id);
      setSelectedIds(next);
    }
  }

  function toggleSelection(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function handleBulkAction(actionType: "enable" | "disable" | "set_priority" | "delete") {
    if (selectedIds.size === 0) return;
    setIsProcessingBulk(true);
    setError(null);
    setMessage(null);

    const idsArray = Array.from(selectedIds);

    try {
      if (actionType === "delete") {
        if (!window.confirm(`Delete ${idsArray.length} sources?`)) {
          setIsProcessingBulk(false);
          return;
        }
        const res = await bulkDeleteSources(idsArray);
        setMessage(`Deleted ${res.deleted_count} sources`);
      } else {
        const res = await bulkUpdateSources(idsArray, actionType, actionType === "set_priority" ? bulkPriority : undefined);
        setMessage(`Updated ${res.updated_count} sources`);
      }
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Bulk ${actionType} failed.`);
    } finally {
      setIsProcessingBulk(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const created = await createSource({
        name: name.trim(),
        url: url.trim(),
        platform: platform.trim(),
        category: category.trim(),
        country_code: countryCode.trim().toUpperCase() || null,
        priority,
        enabled: true,
      });
      setMessage(`Created ${created.name}`);
      setName("");
      setUrl("");
      setShowCreate(false);
      reload();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create source failed.");
    }
  }

  async function handleEdit(source: SourceRecord) {
    const nextName = window.prompt("Source name:", source.name);
    if (nextName === null) return;
    const nextCategory = window.prompt("Category:", source.category);
    if (nextCategory === null) return;
    const nextPriorityText = window.prompt("Priority (1-5):", String(source.priority));
    if (nextPriorityText === null) return;
    const nextPriority = Number(nextPriorityText);
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
      setError(updateError instanceof Error ? updateError.message : "Update source failed.");
    }
  }

  async function handleToggle(source: SourceRecord) {
    setError(null);
    setMessage(null);
    try {
      const updated = await updateSource(source.id, { enabled: !source.enabled });
      setMessage(`${updated.name} ${updated.enabled ? "enabled" : "disabled"}`);
      reload();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Toggle source failed.");
    }
  }

  async function handleDelete(source: SourceRecord) {
    const confirmed = window.confirm(`Delete source?\n\n${source.name}`);
    if (!confirmed) return;
    setError(null);
    setMessage(null);
    try {
      await deleteSource(source.id);
      setMessage(`Deleted ${source.name}`);
      reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete source failed.");
    }
  }

  const platforms = Array.from(new Set(sources.map((s) => s.platform)));
  const categories = Array.from(new Set(sources.map((s) => s.category)));

  if (isLoading) {
    return <div className="p-6 text-sm text-neutral-400">Loading source watchlist...</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-neutral-200">Source Watchlist</p>
          <p className="mt-1 text-xs text-neutral-500">
            {sources.length} sources · {sources.filter((s) => s.enabled).length} enabled
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
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

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900/30 px-6 py-3">
        <input
          placeholder="Search sources..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        />
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        >
          <option value="All">All Platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        >
          <option value="All">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        >
          <option value="All">All Statuses</option>
          <option value="Enabled">Enabled</option>
          <option value="Disabled">Disabled</option>
        </select>
      </div>

      {/* Bulk Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900/50 px-6 py-3">
        <div className="text-xs font-medium text-neutral-300 min-w-24">
          {selectedIds.size} selected
        </div>
        <button
          disabled={selectedIds.size === 0 || isProcessingBulk}
          onClick={() => handleBulkAction("enable")}
          className="rounded border border-emerald-900 bg-emerald-950/50 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
        >
          Bulk Enable
        </button>
        <button
          disabled={selectedIds.size === 0 || isProcessingBulk}
          onClick={() => handleBulkAction("disable")}
          className="rounded border border-amber-900 bg-amber-950/50 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-50"
        >
          Bulk Disable
        </button>
        
        <div className="flex items-center gap-2 border-l border-neutral-700 pl-3">
          <select
            value={bulkPriority}
            onChange={(e) => setBulkPriority(Number(e.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white"
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>P{p}</option>
            ))}
          </select>
          <button
            disabled={selectedIds.size === 0 || isProcessingBulk}
            onClick={() => handleBulkAction("set_priority")}
            className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 disabled:opacity-50"
          >
            Set Priority
          </button>
        </div>

        <button
          disabled={selectedIds.size === 0 || isProcessingBulk}
          onClick={() => handleBulkAction("delete")}
          className="ml-auto rounded border border-red-950 bg-red-950/50 px-3 py-1.5 text-xs text-red-400 disabled:opacity-50"
        >
          Bulk Delete
        </button>
        <button
          disabled={selectedIds.size === 0}
          onClick={() => setSelectedIds(new Set())}
          className="rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 disabled:opacity-50"
        >
          Clear Selection
        </button>
      </div>

      {message && <div className="border-b border-emerald-950 bg-emerald-950/20 px-6 py-3 text-sm text-emerald-300">{message}</div>}
      {error && <div className="border-b border-red-950 bg-red-950/20 px-6 py-3 text-sm text-red-300">{error}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="grid gap-4 border-b border-neutral-800 bg-neutral-950/50 p-6 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">Source Name</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
          </label>
          <label className="space-y-2 md:col-span-2">
            <span className="text-xs text-neutral-500">URL</span>
            <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
          </label>
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">Platform</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white">
              <option>YouTube</option>
              <option>News</option>
              <option>Social</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">Category</span>
            <input required value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
          </label>
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">Country Code</span>
            <input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
          </label>
          <label className="space-y-2">
            <span className="text-xs text-neutral-500">Priority</span>
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white">
              <option value={1}>P1 Critical</option>
              <option value={2}>P2 High</option>
              <option value={3}>P3 Normal</option>
              <option value={4}>P4 Low</option>
              <option value={5}>P5 Backlog</option>
            </select>
          </label>
          <div className="flex items-end md:col-span-2">
            <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Create Source</button>
          </div>
        </form>
      )}

      {filteredSources.length === 0 ? (
        <div className="p-10 text-center text-sm text-neutral-500">No sources found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950/70">
                <th className="px-5 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = !allFilteredSelected && someFilteredSelected;
                    }}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-blue-600 focus:ring-offset-neutral-950"
                  />
                </th>
                {["Source", "Platform", "Category", "Country", "Priority", "Signals", "Last Scan", "Status", "Actions"].map((label) => (
                  <th key={label} className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSources.map((source) => {
                const isSelected = selectedIds.has(source.id);
                return (
                  <tr key={source.id} className={`border-b border-neutral-900 hover:bg-neutral-900/60 ${isSelected ? "bg-blue-900/10" : ""}`}>
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(source.id)}
                        className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-blue-600 focus:ring-offset-neutral-950"
                      />
                    </td>
                    <td className="px-5 py-4 align-top">
                      <a href={source.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-white hover:underline">{source.name}</a>
                      <p className="mt-1 max-w-72 truncate text-xs text-neutral-500">{source.url}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-neutral-300">{source.platform}</td>
                    <td className="px-5 py-4 text-sm text-neutral-300">{source.category}</td>
                    <td className="px-5 py-4">
                      <p className="text-sm text-neutral-300">{source.country_code ?? "GLOBAL"}</p>
                      <p className="mt-1 text-xs text-neutral-500">{source.country_name ?? "Global"}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-neutral-300">P{source.priority}</td>
                    <td className="px-5 py-4 text-sm text-neutral-300">{source.signal_count}</td>
                    <td className="px-5 py-4 text-sm text-neutral-400">{formatDate(source.last_scan_at)}</td>
                    <td className="px-5 py-4">
                      <span className={source.enabled ? "rounded-full border border-emerald-900 bg-emerald-950 px-2.5 py-1 text-xs text-emerald-300" : "rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-500"}>
                        {source.enabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleEdit(source)} className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300">Edit</button>
                        <button type="button" onClick={() => handleToggle(source)} className="rounded border border-amber-900 px-2 py-1 text-xs text-amber-300">{source.enabled ? "Disable" : "Enable"}</button>
                        <button type="button" onClick={() => handleDelete(source)} className="rounded border border-red-950 px-2 py-1 text-xs text-red-400">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
