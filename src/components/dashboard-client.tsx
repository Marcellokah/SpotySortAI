"use client";

import {
  AiAssignment,
  AiSortResponse,
  MusicLibraryPayload,
  NewPlaylistSuggestion,
  RefactorSuggestion
} from "@/lib/types";
import { signIn, signOut, useSession } from "next-auth/react";
import { useCallback, useMemo, useState } from "react";

type SortApiResponse = {
  library: MusicLibraryPayload;
  proposal: AiSortResponse;
};

type LibraryApiResponse = MusicLibraryPayload;

export function DashboardClient() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<SortApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [removeFromLiked, setRemoveFromLiked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isLoggedIn = Boolean(session?.accessToken);

  const fetchProposal = useCallback(async () => {
    try {
      setLoading(true);
      setMessage(null);

      const libraryResponse = await fetch("/api/spotify/library", {
        method: "GET"
      });

      const libraryJson = (await libraryResponse.json()) as LibraryApiResponse | { error: string };

      if (!libraryResponse.ok) {
        throw new Error("error" in libraryJson ? libraryJson.error : "Failed to load Spotify library");
      }

      const response = await fetch("/api/ai/sort", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ library: libraryJson as LibraryApiResponse })
      });

      const json = (await response.json()) as SortApiResponse | { error: string };

      if (!response.ok) {
        throw new Error("error" in json ? json.error : "Failed to load sorting proposal");
      }

      setData(json as SortApiResponse);

      const warnings = Array.isArray((libraryJson as MusicLibraryPayload).warnings)
        ? (libraryJson as MusicLibraryPayload).warnings
        : [];

      if (warnings.length > 0) {
        setMessage(warnings.join(" \n"));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load sorting proposal");
    } finally {
      setLoading(false);
    }
  }, []);

  const executeChanges = useCallback(
    async (payload: {
      assignments?: AiAssignment[];
      newPlaylists?: NewPlaylistSuggestion[];
      refactorSuggestions?: RefactorSuggestion[];
    }) => {
      try {
        setExecuting(true);
        setMessage(null);

        const response = await fetch("/api/spotify/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...payload,
            removeFromLiked
          })
        });

        const json = (await response.json()) as { ok?: boolean; error?: string };

        if (!response.ok) {
          throw new Error(json.error || "Failed to apply Spotify changes");
        }

        setMessage("Spotify actions executed successfully.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to apply Spotify changes");
      } finally {
        setExecuting(false);
      }
    },
    [removeFromLiked]
  );

  const totalSuggestions = useMemo(() => {
    if (!data) return 0;
    return (
      data.proposal.assignments.length +
      data.proposal.newPlaylists.length +
      data.proposal.refactorSuggestions.length
    );
  }, [data]);

  if (status === "loading") {
    return <p className="text-slate-700">Loading session...</p>;
  }

  if (!isLoggedIn) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-slate-700">Sign in with Spotify to use the dashboard.</p>
        <button
          type="button"
          onClick={() => signIn("spotify")}
          className="mt-4 rounded-full bg-brand-700 px-5 py-2 text-white"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="mt-1 text-slate-600">Analyze library, review Gemini suggestions, and approve actions.</p>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700"
          >
            Sign out
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={fetchProposal}
            disabled={loading || executing}
            className="rounded-full bg-brand-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Analyzing..." : "Analyze Library"}
          </button>
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={removeFromLiked}
              onChange={(event) => setRemoveFromLiked(event.target.checked)}
            />
            Remove songs from Liked Songs after sorting
          </label>
        </div>
      </header>

      {message ? <p className="rounded-xl bg-white p-4 text-sm text-slate-700 shadow">{message}</p> : null}

      {data ? (
        <section className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <p className="text-sm uppercase tracking-[0.2em] text-brand-700">Summary</p>
            <p className="mt-2 text-slate-800">{data.proposal.summary}</p>
            <p className="mt-2 text-sm text-slate-500">Total suggestions: {totalSuggestions}</p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Task A: Liked Song Sorting</h2>
            <div className="mt-4 space-y-3">
              {data.proposal.assignments.map((item) => (
                <div key={`${item.trackId}-${item.targetPlaylistName}`} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-900">{item.trackName}</p>
                  <p className="text-sm text-slate-600">{item.artistNames.join(", ")}</p>
                  <p className="mt-2 text-sm text-slate-700">
                    Target: <span className="font-semibold">{item.targetPlaylistName}</span>
                  </p>
                  <p className="text-sm text-slate-500">{item.reason}</p>
                  <button
                    type="button"
                    onClick={() => executeChanges({ assignments: [item] })}
                    disabled={executing}
                    className="mt-3 rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Approve
                  </button>
                </div>
              ))}
              {data.proposal.assignments.length === 0 ? (
                <p className="text-sm text-slate-500">No sorting suggestions generated.</p>
              ) : null}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Task B: New Playlist Suggestions</h2>
            <div className="mt-4 space-y-3">
              {data.proposal.newPlaylists.map((item) => (
                <div key={item.name} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-600">{item.description || "No description provided"}</p>
                  <p className="mt-1 text-sm text-slate-500">Tracks: {item.trackIds.length}</p>
                  <button
                    type="button"
                    onClick={() => executeChanges({ newPlaylists: [item] })}
                    disabled={executing}
                    className="mt-3 rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Approve
                  </button>
                </div>
              ))}
              {data.proposal.newPlaylists.length === 0 ? (
                <p className="text-sm text-slate-500">No new playlist suggestions generated.</p>
              ) : null}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Task C: Playlist Refactor Suggestions</h2>
            <div className="mt-4 space-y-3">
              {data.proposal.refactorSuggestions.map((item) => (
                <div
                  key={`${item.trackId}-${item.fromPlaylistId}-${item.toPlaylistId}`}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <p className="font-semibold text-slate-900">{item.trackName}</p>
                  <p className="text-sm text-slate-700">
                    Move from <span className="font-semibold">{item.fromPlaylistName}</span> to{" "}
                    <span className="font-semibold">{item.toPlaylistName}</span>
                  </p>
                  <p className="text-sm text-slate-500">{item.reason}</p>
                  <button
                    type="button"
                    onClick={() => executeChanges({ refactorSuggestions: [item] })}
                    disabled={executing}
                    className="mt-3 rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Approve
                  </button>
                </div>
              ))}
              {data.proposal.refactorSuggestions.length === 0 ? (
                <p className="text-sm text-slate-500">No refactor suggestions generated.</p>
              ) : null}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Approve All</h2>
            <p className="mt-1 text-sm text-slate-600">
              This applies all generated suggestions in one request.
            </p>
            <button
              type="button"
              onClick={() =>
                executeChanges({
                  assignments: data.proposal.assignments,
                  newPlaylists: data.proposal.newPlaylists,
                  refactorSuggestions: data.proposal.refactorSuggestions
                })
              }
              disabled={executing}
              className="mt-4 rounded-full bg-slate-900 px-5 py-2 font-semibold text-white disabled:opacity-60"
            >
              {executing ? "Applying..." : "Approve All Suggestions"}
            </button>
          </article>
        </section>
      ) : null}
    </div>
  );
}
