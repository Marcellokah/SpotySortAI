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

type LibraryApiResponse = MusicLibraryPayload;

export function DashboardClient() {
  const { data: session, status } = useSession();
  const CHUNK_SIZE = 50;

  // Manual Step-by-Step State
  const [library, setLibrary] = useState<LibraryApiResponse | null>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [chunkProposal, setChunkProposal] = useState<AiSortResponse | null>(null);

  // Loading States
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [executing, setExecuting] = useState(false);

  // Options & Messaging
  const [removeFromLiked, setRemoveFromLiked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isLoggedIn = Boolean(session?.accessToken);

  const loadLibrary = useCallback(async () => {
    try {
      setLoadingLibrary(true);
      setMessage(null);
      setChunkProposal(null);

      const libraryResponse = await fetch("/api/spotify/library", {
        method: "GET"
      });

      let libraryJson;
      try {
        libraryJson = await libraryResponse.json();
      } catch (e) {
        throw new Error(`Failed to parse library response. Server returned ${libraryResponse.status}`);
      }

      if (!libraryResponse.ok) {
        throw new Error(libraryJson?.error || "Failed to load Spotify library");
      }

      const payload = libraryJson as LibraryApiResponse;
      setLibrary(payload);
      setTotalChunks(Math.ceil(payload.likedSongs.length / CHUNK_SIZE));
      setCurrentChunkIndex(0);

      const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      if (warnings.length > 0) {
        setMessage(`Library loaded with warnings: \n${warnings.join(" \n")}`);
      } else {
        setMessage(`Library loaded successfully. Found ${payload.likedSongs.length} liked songs.`);
      }
    } catch (error) {
      console.error("loadLibrary error:", error);
      setMessage(error instanceof Error ? error.message : "An unexpected error occurred loading the library.");
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  const analyzeCurrentChunk = useCallback(async () => {
    if (!library) return;

    // --- MONETIZATION HOOK ---
    const isProUser = false; // TODO: Replace with actual user subscription check
    if (currentChunkIndex >= 2 && !isProUser) {
      setMessage("You have reached the free tier limit (2 chunks). Upgrade to Pro to process more songs!");
      // TODO: Trigger Paywall Modal
      return;
    }
    // -------------------------

    try {
      setAnalyzing(true);
      setMessage(null);

      const existingPlaylists = library.playlists.map(p => ({
        id: p.id,
        name: p.name,
      }));

      const allLikedMapped = library.likedSongs.map(t => ({
        trackId: t.id,
        title: t.name,
        artistName: t.artists.map((a) => a.name).join(", "),
      }));

      const chunk = allLikedMapped.slice(currentChunkIndex * CHUNK_SIZE, (currentChunkIndex + 1) * CHUNK_SIZE);
      const rawChunkTracks = library.likedSongs.slice(currentChunkIndex * CHUNK_SIZE, (currentChunkIndex + 1) * CHUNK_SIZE);

      const response = await fetch("/api/ai/sort", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ playlists: existingPlaylists, tracksChunk: chunk })
      });

      let json;
      try {
        json = await response.json();
      } catch (e) {
        throw new Error(`The AI sorting process failed. (HTTP ${response.status})`);
      }

      if (!response.ok) {
        throw new Error(json?.error || `Failed to sort chunk (${response.status})`);
      }

      if (!json.data) {
        throw new Error("Invalid response format from AI sort endpoint");
      }

      const sortedChunk = json.data as { trackId: string, targetPlaylistId: string | null, suggestedNewPlaylistName: string | null }[];

      const trackMap = new Map(rawChunkTracks.map((t) => [t.id, t]));
      const playlistMap = new Map(library.playlists.map((p) => [p.id, p]));

      const newProposal: AiSortResponse = {
        summary: `Analyzed chunk ${currentChunkIndex + 1} of ${totalChunks} (Tracks ${currentChunkIndex * CHUNK_SIZE + 1}-${Math.min((currentChunkIndex + 1) * CHUNK_SIZE, library.likedSongs.length)})`,
        assignments: [],
        newPlaylists: [],
        refactorSuggestions: [],
      };
      
      const newPlaylistsMap: Record<string, string[]> = {};

      for (const item of sortedChunk) {
        const track = trackMap.get(item.trackId);
        if (!track) continue;

        if (item.targetPlaylistId) {
          const playlist = playlistMap.get(item.targetPlaylistId);
          if (playlist) {
            newProposal.assignments.push({
              trackId: item.trackId,
              trackName: track.name,
              artistNames: track.artists.map(a => a.name),
              targetPlaylistId: item.targetPlaylistId,
              targetPlaylistName: playlist.name,
              reason: "Matches playlist style",
              action: "add_to_existing",
            });
          }
        } else if (item.suggestedNewPlaylistName) {
          newProposal.assignments.push({
            trackId: item.trackId,
            trackName: track.name,
            artistNames: track.artists.map(a => a.name),
            targetPlaylistName: item.suggestedNewPlaylistName,
            reason: "Fits new suggested playlist",
            action: "create_new_playlist",
          });

          if (!newPlaylistsMap[item.suggestedNewPlaylistName]) {
            newPlaylistsMap[item.suggestedNewPlaylistName] = [];
          }
          newPlaylistsMap[item.suggestedNewPlaylistName].push(item.trackId);
        }
      }

      newProposal.newPlaylists = Object.entries(newPlaylistsMap).map(([name, trackIds]) => ({
        name,
        description: "AI Generated Playlist",
        trackIds,
      }));

      setChunkProposal(newProposal);
    } catch (error) {
      console.error(`Error processing chunk ${currentChunkIndex + 1}:`, error);
      setMessage(error instanceof Error ? error.message : "Unknown error occurred while analyzing.");
    } finally {
      setAnalyzing(false);
    }
  }, [library, currentChunkIndex, totalChunks]);

  const approveAndApplyChunk = useCallback(async () => {
    if (!chunkProposal) return;
    
    try {
      setExecuting(true);
      setMessage(null);

      const response = await fetch("/api/spotify/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assignments: chunkProposal.assignments,
          newPlaylists: chunkProposal.newPlaylists,
          refactorSuggestions: chunkProposal.refactorSuggestions,
          removeFromLiked
        })
      });

      const json = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        throw new Error(json.error || "Failed to apply Spotify changes");
      }

      setMessage(`Chunk ${currentChunkIndex + 1} applied to Spotify successfully!`);
      
      // Step-by-Step Progression: Clear current results and advance the index
      setChunkProposal(null);
      setCurrentChunkIndex(prev => prev + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply Spotify changes");
    } finally {
      setExecuting(false);
    }
  }, [chunkProposal, currentChunkIndex, removeFromLiked]);

  const totalSuggestions = useMemo(() => {
    if (!chunkProposal) return 0;
    return (
      chunkProposal.assignments.length +
      chunkProposal.newPlaylists.length +
      chunkProposal.refactorSuggestions.length
    );
  }, [chunkProposal]);

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
            <p className="mt-1 text-slate-600">Step-by-step library analysis and sorting.</p>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700"
          >
            Sign out
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!library ? (
            <button
              type="button"
              onClick={loadLibrary}
              disabled={loadingLibrary}
              className="rounded-full bg-slate-900 px-5 py-2 font-semibold text-white disabled:opacity-60"
            >
              {loadingLibrary ? "Loading Library..." : "Fetch Spotify Library"}
            </button>
          ) : currentChunkIndex < totalChunks ? (
            !chunkProposal ? (
              <button
                type="button"
                onClick={analyzeCurrentChunk}
                disabled={analyzing || executing}
                className="rounded-full bg-brand-700 px-5 py-2 font-semibold text-white disabled:opacity-60"
              >
                {analyzing 
                  ? `Analyzing chunk ${currentChunkIndex + 1} of ${totalChunks}...` 
                  : `Process Next 50 Songs (Chunk ${currentChunkIndex + 1} of ${totalChunks})`}
              </button>
            ) : (
              <button
                type="button"
                onClick={approveAndApplyChunk}
                disabled={executing || analyzing}
                className="rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white disabled:opacity-60"
              >
                {executing ? "Applying to Spotify..." : "Approve & Apply Current Chunk"}
              </button>
            )
          ) : (
            <div className="rounded-full bg-slate-100 px-5 py-2 font-semibold text-slate-600">
              All chunks processed!
            </div>
          )}

          {library && currentChunkIndex < totalChunks && (
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={removeFromLiked}
                onChange={(event) => setRemoveFromLiked(event.target.checked)}
              />
              Remove approved songs from Liked Songs
            </label>
          )}
        </div>
      </header>

      {message ? <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">{message}</p> : null}

      {chunkProposal ? (
        <section className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <p className="text-sm uppercase tracking-[0.2em] text-brand-700">Chunk {currentChunkIndex + 1} Summary</p>
            <p className="mt-2 text-slate-800">{chunkProposal.summary}</p>
            <p className="mt-2 text-sm text-slate-500">Total suggestions in this chunk: {totalSuggestions}</p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Task A: Liked Song Sorting</h2>
            <div className="mt-4 space-y-3">
              {chunkProposal.assignments.map((item) => (
                <div key={`${item.trackId}-${item.targetPlaylistName}`} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-900">{item.trackName}</p>
                  <p className="text-sm text-slate-600">{item.artistNames.join(", ")}</p>
                  <p className="mt-2 text-sm text-slate-700">
                    Target: <span className="font-semibold">{item.targetPlaylistName}</span>
                  </p>
                  <p className="text-sm text-slate-500">{item.reason}</p>
                </div>
              ))}
              {chunkProposal.assignments.length === 0 ? (
                <p className="text-sm text-slate-500">No sorting suggestions for this chunk.</p>
              ) : null}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Task B: New Playlist Suggestions</h2>
            <div className="mt-4 space-y-3">
              {chunkProposal.newPlaylists.map((item) => (
                <div key={item.name} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-600">{item.description || "No description provided"}</p>
                  <p className="mt-1 text-sm text-slate-500">Tracks: {item.trackIds.length}</p>
                </div>
              ))}
              {chunkProposal.newPlaylists.length === 0 ? (
                <p className="text-sm text-slate-500">No new playlist suggestions for this chunk.</p>
              ) : null}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-slate-900">Task C: Playlist Refactor Suggestions</h2>
            <div className="mt-4 space-y-3">
              {chunkProposal.refactorSuggestions.map((item) => (
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
                </div>
              ))}
              {chunkProposal.refactorSuggestions.length === 0 ? (
                <p className="text-sm text-slate-500">No refactor suggestions for this chunk.</p>
              ) : null}
            </div>
          </article>
        </section>
      ) : library && currentChunkIndex < totalChunks ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow">
          <p className="text-lg font-medium text-slate-700">Ready to analyze chunk {currentChunkIndex + 1} of {totalChunks}.</p>
          <p className="mt-2 text-sm text-slate-500">Click &quot;Process Next 50 Songs&quot; above to continue.</p>
        </section>
      ) : null}
    </div>
  );
}
