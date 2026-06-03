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
type ItemState = "pending" | "approved" | "rejected";

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export function DashboardClient() {
  const { data: session, status } = useSession();
  const CHUNK_SIZE = 50;

  // Manual Step-by-Step State
  const [library, setLibrary] = useState<LibraryApiResponse | null>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [chunkProposal, setChunkProposal] = useState<AiSortResponse | null>(null);

  // Granular Item State
  const [itemStatus, setItemStatus] = useState<Record<string, ItemState>>({});

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

      // Initialize all new items as 'pending'
      const initialStatus: Record<string, ItemState> = {};
      newProposal.assignments.forEach(a => initialStatus[`assignment-${a.trackId}`] = 'pending');
      newProposal.newPlaylists.forEach(p => initialStatus[`newPlaylist-${p.name}`] = 'pending');
      newProposal.refactorSuggestions.forEach(r => initialStatus[`refactor-${r.trackId}`] = 'pending');
      setItemStatus(initialStatus);

      setChunkProposal(newProposal);
    } catch (error) {
      console.error(`Error processing chunk ${currentChunkIndex + 1}:`, error);
      setMessage(error instanceof Error ? error.message : "Unknown error occurred while analyzing.");
    } finally {
      setAnalyzing(false);
    }
  }, [library, currentChunkIndex, totalChunks]);

  const executeApprovedActions = useCallback(async () => {
    if (!chunkProposal) return;
    
    // Filter out only the explicitly 'approved' items
    const approvedAssignments = chunkProposal.assignments.filter(a => itemStatus[`assignment-${a.trackId}`] === 'approved');
    const approvedNewPlaylists = chunkProposal.newPlaylists.filter(p => itemStatus[`newPlaylist-${p.name}`] === 'approved');
    const approvedRefactors = chunkProposal.refactorSuggestions.filter(r => itemStatus[`refactor-${r.trackId}`] === 'approved');

    if (approvedAssignments.length === 0 && approvedNewPlaylists.length === 0 && approvedRefactors.length === 0) {
      // Nothing approved, just skip execution but filter the lists anyway
      filterExecutedItems();
      return;
    }

    try {
      setExecuting(true);
      setMessage(null);

      const response = await fetch("/api/spotify/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assignments: approvedAssignments,
          newPlaylists: approvedNewPlaylists,
          refactorSuggestions: approvedRefactors,
          removeFromLiked
        })
      });

      const json = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok) {
        throw new Error(json.error || "Failed to apply Spotify changes");
      }

      setMessage(`Approved actions applied to Spotify successfully!`);
      
      // Step-by-Step Progression: Filter executed/skipped items from view
      filterExecutedItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to apply Spotify changes");
    } finally {
      setExecuting(false);
    }
  }, [chunkProposal, itemStatus, removeFromLiked]);

  // Helper to remove approved and rejected items from the list, leaving only pending
  const filterExecutedItems = () => {
    setChunkProposal(prev => {
      if (!prev) return null;
      
      const newAssignments = prev.assignments.filter(a => itemStatus[`assignment-${a.trackId}`] === 'pending');
      const newPlaylistsList = prev.newPlaylists.filter(p => itemStatus[`newPlaylist-${p.name}`] === 'pending');
      const newRefactors = prev.refactorSuggestions.filter(r => itemStatus[`refactor-${r.trackId}`] === 'pending');

      const totalPending = newAssignments.length + newPlaylistsList.length + newRefactors.length;

      if (totalPending === 0) {
        // If everything is handled, clear proposal and advance to next chunk
        setCurrentChunkIndex(idx => idx + 1);
        return null;
      }

      return {
        ...prev,
        assignments: newAssignments,
        newPlaylists: newPlaylistsList,
        refactorSuggestions: newRefactors,
      };
    });
  };

  const { approvedCount, rejectedCount, pendingCount } = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    
    // Only count items that are actually currently in the proposal
    if (chunkProposal) {
      chunkProposal.assignments.forEach(a => {
        const status = itemStatus[`assignment-${a.trackId}`];
        if (status === 'approved') approved++;
        else if (status === 'rejected') rejected++;
        else pending++;
      });
      chunkProposal.newPlaylists.forEach(p => {
        const status = itemStatus[`newPlaylist-${p.name}`];
        if (status === 'approved') approved++;
        else if (status === 'rejected') rejected++;
        else pending++;
      });
      chunkProposal.refactorSuggestions.forEach(r => {
        const status = itemStatus[`refactor-${r.trackId}`];
        if (status === 'approved') approved++;
        else if (status === 'rejected') rejected++;
        else pending++;
      });
    }

    return { approvedCount: approved, rejectedCount: rejected, pendingCount: pending };
  }, [itemStatus, chunkProposal]);

  if (status === "loading") {
    return <div className="min-h-screen bg-[#121212] flex items-center justify-center text-zinc-400">Loading session...</div>;
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#121212] p-6 flex items-center justify-center">
        <div className="rounded-2xl border border-zinc-800 bg-[#181818] p-8 text-center max-w-md w-full shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-4">Spotify AI Sorter</h2>
          <p className="text-zinc-400 mb-8">Sign in with your Spotify account to analyze and organize your liked songs.</p>
          <button
            type="button"
            onClick={() => signIn("spotify")}
            className="w-full rounded-full bg-[#1DB954] hover:bg-[#1ed760] px-6 py-3 font-bold text-black transition-colors"
          >
            Sign in with Spotify
          </button>
        </div>
      </div>
    );
  }

  const processedCount = Math.min(currentChunkIndex * CHUNK_SIZE, library?.likedSongs.length || 0);
  const totalSongsCount = library?.likedSongs.length || 0;

  return (
    <div className="min-h-screen bg-[#121212] text-white p-4 md:p-6 font-sans">
      <div className="max-w-5xl mx-auto space-y-6 md:space-y-8">
        
        {/* Header */}
        <header className="rounded-2xl border border-zinc-800 bg-[#181818] p-5 md:p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Dashboard</h1>
              <p className="mt-1 text-sm md:text-base text-zinc-400">Step-by-step AI sorting with granular control.</p>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-full border border-zinc-700 hover:border-zinc-500 px-4 py-2 text-sm md:text-base font-semibold text-zinc-300 transition-colors"
            >
              Sign out
            </button>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4">
            {!library ? (
              <button
                type="button"
                onClick={loadLibrary}
                disabled={loadingLibrary}
                className="w-full sm:w-auto rounded-full bg-white hover:bg-zinc-200 px-6 py-3 font-bold text-black disabled:opacity-60 transition-colors"
              >
                {loadingLibrary ? "Loading Library..." : "Fetch Spotify Library"}
              </button>
            ) : currentChunkIndex < totalChunks ? (
              !chunkProposal ? (
                <button
                  type="button"
                  onClick={analyzeCurrentChunk}
                  disabled={analyzing || executing}
                  className="w-full sm:w-auto rounded-full bg-white hover:bg-zinc-200 px-6 py-3 font-bold text-black disabled:opacity-60 transition-colors shadow-lg"
                >
                  {analyzing 
                    ? `Analyzing chunk ${currentChunkIndex + 1} of ${totalChunks}...` 
                    : `Process Next 50 Songs (Chunk ${currentChunkIndex + 1} of ${totalChunks})`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={executeApprovedActions}
                  disabled={executing || analyzing}
                  className="w-full sm:w-auto rounded-full bg-[#1DB954] hover:bg-[#1ed760] px-6 py-3 font-bold text-black disabled:opacity-60 transition-colors shadow-lg shadow-[#1DB954]/20"
                >
                  {executing ? "Applying to Spotify..." : "Execute Approved Actions"}
                </button>
              )
            ) : (
              <div className="w-full sm:w-auto text-center rounded-full bg-zinc-800 px-6 py-3 font-bold text-zinc-300 border border-zinc-700">
                All chunks processed!
              </div>
            )}

            {library && currentChunkIndex < totalChunks && chunkProposal && (
              <label className="flex-1 sm:flex-none inline-flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/50 px-5 py-3 text-sm font-medium text-zinc-300 cursor-pointer hover:bg-zinc-800 transition-colors">
                <input
                  type="checkbox"
                  checked={removeFromLiked}
                  onChange={(event) => setRemoveFromLiked(event.target.checked)}
                  className="accent-[#1DB954] w-5 h-5 cursor-pointer rounded bg-zinc-800 border-zinc-700 flex-shrink-0"
                />
                <span className="leading-tight">Remove approved songs from Liked Songs</span>
              </label>
            )}
          </div>
        </header>

        {/* Global Progress Bar */}
        {library && (
          <section className="rounded-2xl border border-zinc-800 bg-[#181818] p-5 md:p-6 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:justify-between text-sm font-medium mb-3 gap-1">
              <span className="text-zinc-300 tracking-wide uppercase text-xs sm:text-sm">Global Progress</span>
              <span className="text-zinc-400">Processed: <span className="text-white">{processedCount}</span> / {totalSongsCount} Liked Songs</span>
            </div>
            <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#1DB954] transition-all duration-700 ease-out"
                style={{ width: `${totalSongsCount > 0 ? (processedCount / totalSongsCount) * 100 : 0}%` }}
              />
            </div>
          </section>
        )}

        {message ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-800 p-4 text-sm text-zinc-200 shadow-lg break-words">
            {message}
          </div>
        ) : null}

        {chunkProposal ? (
          <section className="space-y-6 pb-20">
            <article className="rounded-2xl border border-zinc-800 bg-[#181818] p-5 md:p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1DB954]">Chunk {currentChunkIndex + 1} Summary</p>
                  <p className="mt-2 text-zinc-200">{chunkProposal.summary}</p>
                </div>
                <div className="flex gap-3 sm:gap-4 text-xs sm:text-sm font-medium text-zinc-400 bg-zinc-900/50 p-3 rounded-xl border border-zinc-800 w-full sm:w-auto justify-center">
                  <div className="flex flex-col items-center"><span className="text-[#1DB954] text-base sm:text-lg">{approvedCount}</span> Approved</div>
                  <div className="flex flex-col items-center"><span className="text-red-400 text-base sm:text-lg">{rejectedCount}</span> Skipped</div>
                  <div className="flex flex-col items-center"><span className="text-zinc-300 text-base sm:text-lg">{pendingCount}</span> Pending</div>
                </div>
              </div>
            </article>

            {/* Task A: Assignments */}
            {chunkProposal.assignments.length > 0 && (
              <article>
                <h2 className="text-lg md:text-xl font-bold text-white mb-4 px-2">Task A: Liked Song Sorting</h2>
                <div className="space-y-3">
                  {chunkProposal.assignments.map((item) => {
                    const id = `assignment-${item.trackId}`;
                    const state = itemStatus[id];
                    return (
                      <div 
                        key={id} 
                        className={`flex flex-col md:flex-row items-stretch md:items-center justify-between rounded-xl border p-4 transition-all duration-300 gap-4 md:gap-0 ${
                          state === 'approved' ? 'border-[#1DB954] bg-[#1DB954]/10 shadow-lg shadow-[#1DB954]/5' : 
                          state === 'rejected' ? 'border-zinc-800 bg-zinc-900/30 opacity-50 grayscale' : 
                          'border-zinc-800 bg-[#181818] hover:bg-[#202020]'
                        }`}
                      >
                        <div className="flex-1 md:pr-4">
                          <p className="font-bold text-white text-base leading-tight">{item.trackName}</p>
                          <p className="text-sm text-zinc-400 mt-1">{item.artistNames.join(", ")}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Target Playlist:</span>
                            <span className="text-sm font-bold text-[#1DB954] bg-[#1DB954]/10 px-3 py-1 rounded-full">{item.targetPlaylistName}</span>
                          </div>
                          <p className="text-xs text-zinc-500 mt-2 italic">{item.reason}</p>
                        </div>
                        <div className="flex flex-row md:flex-col gap-3 md:gap-2 md:border-l border-zinc-800 md:pl-4 pt-3 md:pt-0 border-t md:border-t-0 justify-end">
                          <button
                            onClick={() => setItemStatus(prev => ({ ...prev, [id]: 'approved' }))}
                            className={`flex items-center justify-center h-12 w-12 md:h-10 md:w-10 rounded-full transition-all duration-200 ${state === 'approved' ? 'bg-[#1DB954] text-black shadow-md md:scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                            title="Approve"
                          >
                            <CheckIcon />
                          </button>
                          <button
                            onClick={() => setItemStatus(prev => ({ ...prev, [id]: 'rejected' }))}
                            className={`flex items-center justify-center h-12 w-12 md:h-10 md:w-10 rounded-full transition-all duration-200 ${state === 'rejected' ? 'bg-red-500 text-white shadow-md md:scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                            title="Skip / Reject"
                          >
                            <XIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}

            {/* Task B: New Playlists */}
            {chunkProposal.newPlaylists.length > 0 && (
              <article>
                <h2 className="text-lg md:text-xl font-bold text-white mb-4 px-2 mt-8">Task B: New Playlist Suggestions</h2>
                <div className="space-y-3">
                  {chunkProposal.newPlaylists.map((item) => {
                    const id = `newPlaylist-${item.name}`;
                    const state = itemStatus[id];
                    return (
                      <div 
                        key={id} 
                        className={`flex flex-col md:flex-row items-stretch md:items-center justify-between rounded-xl border p-4 transition-all duration-300 gap-4 md:gap-0 ${
                          state === 'approved' ? 'border-[#1DB954] bg-[#1DB954]/10 shadow-lg shadow-[#1DB954]/5' : 
                          state === 'rejected' ? 'border-zinc-800 bg-zinc-900/30 opacity-50 grayscale' : 
                          'border-zinc-800 bg-[#181818] hover:bg-[#202020]'
                        }`}
                      >
                        <div className="flex-1 md:pr-4">
                          <p className="font-bold text-white text-base leading-tight">{item.name}</p>
                          <p className="text-sm text-zinc-400 mt-1">{item.description || "No description provided"}</p>
                          <p className="mt-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                            Contains <span className="text-white bg-zinc-800 px-2 py-0.5 rounded ml-1">{item.trackIds.length}</span> Tracks
                          </p>
                        </div>
                        <div className="flex flex-row md:flex-col gap-3 md:gap-2 md:border-l border-zinc-800 md:pl-4 pt-3 md:pt-0 border-t md:border-t-0 justify-end">
                          <button
                            onClick={() => setItemStatus(prev => ({ ...prev, [id]: 'approved' }))}
                            className={`flex items-center justify-center h-12 w-12 md:h-10 md:w-10 rounded-full transition-all duration-200 ${state === 'approved' ? 'bg-[#1DB954] text-black shadow-md md:scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                            title="Approve"
                          >
                            <CheckIcon />
                          </button>
                          <button
                            onClick={() => setItemStatus(prev => ({ ...prev, [id]: 'rejected' }))}
                            className={`flex items-center justify-center h-12 w-12 md:h-10 md:w-10 rounded-full transition-all duration-200 ${state === 'rejected' ? 'bg-red-500 text-white shadow-md md:scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                            title="Skip / Reject"
                          >
                            <XIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}

            {/* Task C: Refactors */}
            {chunkProposal.refactorSuggestions.length > 0 && (
              <article>
                <h2 className="text-lg md:text-xl font-bold text-white mb-4 px-2 mt-8">Task C: Playlist Refactor Suggestions</h2>
                <div className="space-y-3">
                  {chunkProposal.refactorSuggestions.map((item) => {
                    const id = `refactor-${item.trackId}`;
                    const state = itemStatus[id];
                    return (
                      <div 
                        key={id} 
                        className={`flex flex-col md:flex-row items-stretch md:items-center justify-between rounded-xl border p-4 transition-all duration-300 gap-4 md:gap-0 ${
                          state === 'approved' ? 'border-[#1DB954] bg-[#1DB954]/10 shadow-lg shadow-[#1DB954]/5' : 
                          state === 'rejected' ? 'border-zinc-800 bg-zinc-900/30 opacity-50 grayscale' : 
                          'border-zinc-800 bg-[#181818] hover:bg-[#202020]'
                        }`}
                      >
                        <div className="flex-1 md:pr-4">
                          <p className="font-bold text-white text-base leading-tight">{item.trackName}</p>
                          <p className="mt-2 text-sm text-zinc-400">
                            Move from <span className="font-semibold text-zinc-200">{item.fromPlaylistName}</span> to{" "}
                            <span className="font-semibold text-[#1DB954] bg-[#1DB954]/10 px-2 py-0.5 rounded-md">{item.toPlaylistName}</span>
                          </p>
                          <p className="text-xs text-zinc-500 mt-2 italic">{item.reason}</p>
                        </div>
                        <div className="flex flex-row md:flex-col gap-3 md:gap-2 md:border-l border-zinc-800 md:pl-4 pt-3 md:pt-0 border-t md:border-t-0 justify-end">
                          <button
                            onClick={() => setItemStatus(prev => ({ ...prev, [id]: 'approved' }))}
                            className={`flex items-center justify-center h-12 w-12 md:h-10 md:w-10 rounded-full transition-all duration-200 ${state === 'approved' ? 'bg-[#1DB954] text-black shadow-md md:scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                            title="Approve"
                          >
                            <CheckIcon />
                          </button>
                          <button
                            onClick={() => setItemStatus(prev => ({ ...prev, [id]: 'rejected' }))}
                            className={`flex items-center justify-center h-12 w-12 md:h-10 md:w-10 rounded-full transition-all duration-200 ${state === 'rejected' ? 'bg-red-500 text-white shadow-md md:scale-110' : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
                            title="Skip / Reject"
                          >
                            <XIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}
            
          </section>
        ) : library && currentChunkIndex < totalChunks ? (
          <section className="rounded-2xl border border-zinc-800 bg-[#181818] p-8 md:p-12 text-center shadow-xl">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#1DB954]/20 text-[#1DB954] mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
            <p className="text-lg md:text-xl font-bold text-white">Ready to analyze chunk {currentChunkIndex + 1} of {totalChunks}.</p>
            <p className="mt-2 text-sm text-zinc-400">Click &quot;Process Next 50 Songs&quot; above to generate AI suggestions.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
