/**
 * Admin-Bereich (MVP).
 *
 * Zwei Sub-Views per Tab: Users (Liste mit Disable-Toggle) und
 * Feedback (Inbox mit Status-Workflow). Stats oben als Strip.
 *
 * Keine Re-Auth in dieser Page — Schutz erfolgt ueber `RequireAdmin`
 * (Frontend) und `current_admin` (Backend); Layered defense.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useApi } from "../api/use-api";
import type {
  AdminFeedback,
  AdminFeedbackStatus,
  AdminStats,
  AdminUser,
} from "../api/client";

type Tab = "users" | "feedback";

export default function Admin() {
  const api = useApi();
  const [tab, setTab] = useState<Tab>("users");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadStats = useCallback(() => {
    api
      .adminStats()
      .then(setStats)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Stats laden fehlgeschlagen"),
      );
  }, [api]);

  useEffect(() => {
    reloadStats();
  }, [reloadStats]);

  return (
    <section
      data-testid="page-admin"
      className="px-8 py-8 max-w-5xl mx-auto text-stone-200"
    >
      <h1 className="text-3xl">Admin</h1>
      <p className="mt-2 text-sm text-stone-500">
        Nutzerverwaltung und Feedback-Inbox. Aenderungen wirken sofort.
      </p>

      {stats && (
        <div
          data-testid="admin-stats"
          className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs"
        >
          <Stat label="Nutzer" value={stats.userCount} />
          <Stat label="Gesperrt" value={stats.userDisabledCount} />
          <Stat label="Presets" value={stats.presetCount} />
          <Stat label="Public" value={stats.presetPublishedCount} />
          <Stat label="Bilder" value={stats.imageCount} />
          <Stat label="Feedback offen" value={stats.feedbackOpenCount} />
          <Stat label="Reports offen" value={stats.reportOpenCount} />
        </div>
      )}

      {error && (
        <div
          data-testid="admin-error"
          className="mt-4 px-3 py-2 bg-red-900/40 border border-red-800 text-red-200 text-sm"
        >
          {error}
        </div>
      )}

      <nav className="mt-6 flex gap-1 border-b border-stone-800">
        <TabButton
          active={tab === "users"}
          onClick={() => setTab("users")}
          testId="admin-tab-users"
        >
          Nutzer
        </TabButton>
        <TabButton
          active={tab === "feedback"}
          onClick={() => setTab("feedback")}
          testId="admin-tab-feedback"
        >
          Feedback
        </TabButton>
      </nav>

      <div className="mt-6">
        {tab === "users" ? (
          <UsersTab onChange={reloadStats} />
        ) : (
          <FeedbackTab onChange={reloadStats} />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-stone-900/70 border border-stone-800 px-3 py-2">
      <div className="text-stone-500 uppercase tracking-[0.2em] text-[10px]">
        {label}
      </div>
      <div className="text-stone-100 tabular-nums text-lg">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`px-4 py-2 text-xs uppercase tracking-[0.2em] border-b-2 ${
        active
          ? "border-amber-300 text-amber-200"
          : "border-transparent text-stone-400 hover:text-stone-200"
      }`}
    >
      {children}
    </button>
  );
}

function UsersTab({ onChange }: { onChange: () => void }) {
  const api = useApi();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminListUsers()
      .then(setUsers)
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : "Laden fehlgeschlagen"),
      );
  }, [api]);

  useEffect(load, [load]);

  const onToggle = async (u: AdminUser) => {
    setBusy(u.id);
    setErr(null);
    try {
      const updated = await api.adminPatchUser(u.id, !u.isDisabled);
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="admin-users">
      {err && (
        <div
          data-testid="admin-users-error"
          className="mb-3 px-3 py-2 bg-red-900/40 border border-red-800 text-red-200 text-sm"
        >
          {err}
        </div>
      )}
      <div className="overflow-x-auto border border-stone-800">
        <table className="w-full text-sm">
          <thead className="bg-stone-900 text-stone-400 text-[11px] uppercase tracking-[0.15em]">
            <tr>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Handle</th>
              <th className="text-right px-3 py-2">Presets</th>
              <th className="text-right px-3 py-2">Public</th>
              <th className="text-right px-3 py-2">Bilder</th>
              <th className="text-right px-3 py-2">Feedback</th>
              <th className="text-left px-3 py-2">Erstellt</th>
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                data-testid={`admin-user-row-${u.id}`}
                className="border-t border-stone-800"
              >
                <td className="px-3 py-2 text-stone-200">{u.email}</td>
                <td className="px-3 py-2 text-stone-400">
                  {u.handle ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {u.presetCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {u.publishedPresetCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {u.imageCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {u.feedbackCount}
                </td>
                <td className="px-3 py-2 text-stone-500">
                  {u.createdAt.slice(0, 10)}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => void onToggle(u)}
                    disabled={busy === u.id}
                    data-testid={`admin-user-toggle-${u.id}`}
                    className={`px-2 py-1 text-[10px] uppercase tracking-[0.2em] border ${
                      u.isDisabled
                        ? "border-red-700 text-red-300 hover:bg-red-900/30"
                        : "border-stone-700 text-stone-400 hover:border-amber-300/50"
                    } disabled:opacity-50`}
                  >
                    {u.isDisabled ? "Gesperrt — Aktivieren" : "Sperren"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-stone-500"
                >
                  Keine Nutzer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FeedbackTab({ onChange }: { onChange: () => void }) {
  const api = useApi();
  const [items, setItems] = useState<AdminFeedback[]>([]);
  const [filter, setFilter] = useState<AdminFeedbackStatus | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api
      .adminListFeedback(filter || undefined)
      .then(setItems)
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : "Laden fehlgeschlagen"),
      );
  }, [api, filter]);

  useEffect(load, [load]);

  const setStatus = async (id: string, status: AdminFeedbackStatus) => {
    setBusy(id);
    setErr(null);
    try {
      const updated = await api.adminPatchFeedback(id, { status });
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  };

  const saveNotes = async (id: string) => {
    const next = editingNotes[id] ?? "";
    setBusy(id);
    setErr(null);
    try {
      const updated = await api.adminPatchFeedback(id, { adminNotes: next });
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      setEditingNotes((m) => {
        const rest = { ...m };
        delete rest[id];
        return rest;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  };

  const filterOptions = useMemo<Array<[string, string]>>(
    () => [
      ["", "Alle"],
      ["new", "Neu"],
      ["triaged", "In Bearbeitung"],
      ["closed", "Erledigt"],
    ],
    [],
  );

  return (
    <div data-testid="admin-feedback">
      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="text-stone-500">Filter:</span>
        {filterOptions.map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => setFilter(value as AdminFeedbackStatus | "")}
            data-testid={`admin-feedback-filter-${value || "all"}`}
            className={`px-2 py-1 uppercase tracking-[0.2em] border ${
              filter === value
                ? "border-amber-300 text-amber-200"
                : "border-stone-700 text-stone-400 hover:border-amber-300/40"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {err && (
        <div
          data-testid="admin-feedback-error"
          className="mb-3 px-3 py-2 bg-red-900/40 border border-red-800 text-red-200 text-sm"
        >
          {err}
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-stone-500 text-sm py-6 text-center">
          Keine Eintraege fuer diesen Filter.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const draft = editingNotes[it.id];
            const showDraft = draft !== undefined;
            return (
              <li
                key={it.id}
                data-testid={`admin-feedback-item-${it.id}`}
                className="bg-stone-900/70 border border-stone-800 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs text-stone-500">
                    <span data-testid={`admin-feedback-kind-${it.id}`}>
                      {kindLabel(it.kind)}
                    </span>
                    {" · "}
                    {it.userEmail ?? "anonym"}
                    {it.page ? ` · ${it.page}` : ""}
                    {" · "}
                    {it.createdAt.slice(0, 16).replace("T", " ")}
                  </div>
                  <div className="flex gap-1">
                    {(["new", "triaged", "closed"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void setStatus(it.id, s)}
                        disabled={busy === it.id || it.status === s}
                        data-testid={`admin-feedback-status-${it.id}-${s}`}
                        className={`px-2 py-1 text-[10px] uppercase tracking-[0.2em] border ${
                          it.status === s
                            ? "border-amber-300 text-amber-200 bg-amber-200/10"
                            : "border-stone-700 text-stone-400 hover:border-amber-300/50"
                        } disabled:opacity-40`}
                      >
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-stone-200 text-sm whitespace-pre-wrap">
                  {it.message}
                </p>
                <div className="mt-3 text-xs">
                  {showDraft ? (
                    <div className="space-y-2">
                      <textarea
                        value={draft}
                        onChange={(e) =>
                          setEditingNotes((m) => ({ ...m, [it.id]: e.target.value }))
                        }
                        rows={2}
                        maxLength={2000}
                        data-testid={`admin-feedback-notes-${it.id}`}
                        className="w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveNotes(it.id)}
                          disabled={busy === it.id}
                          data-testid={`admin-feedback-notes-save-${it.id}`}
                          className="px-2 py-1 uppercase tracking-[0.2em] border border-amber-300 text-amber-200 hover:bg-amber-200/10 disabled:opacity-40"
                        >
                          Speichern
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingNotes((m) => {
                              const rest = { ...m };
                              delete rest[it.id];
                              return rest;
                            })
                          }
                          className="px-2 py-1 uppercase tracking-[0.2em] text-stone-500 hover:text-stone-300"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`admin-feedback-notes-edit-${it.id}`}
                      onClick={() =>
                        setEditingNotes((m) => ({
                          ...m,
                          [it.id]: it.adminNotes ?? "",
                        }))
                      }
                      className="text-stone-500 hover:text-amber-200"
                    >
                      {it.adminNotes
                        ? `Notiz: ${it.adminNotes}`
                        : "+ Notiz hinzufuegen"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function kindLabel(k: AdminFeedback["kind"]): string {
  return k === "bug" ? "Bug" : k === "idea" ? "Idee" : "Sonstiges";
}

function statusLabel(s: AdminFeedbackStatus): string {
  return s === "new" ? "Neu" : s === "triaged" ? "In Bearbeitung" : "Erledigt";
}
