import { authOptions } from "@/lib/auth";
import { getCurrentUserProfile, spotifyApiWrite } from "@/lib/spotify";
import { AiAssignment, NewPlaylistSuggestion, RefactorSuggestion } from "@/lib/types";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

type ExecuteBody = {
  assignments?: AiAssignment[];
  newPlaylists?: NewPlaylistSuggestion[];
  refactorSuggestions?: RefactorSuggestion[];
  removeFromLiked?: boolean;
};

function toTrackUris(trackIds: string[]) {
  return trackIds.map((id) => `spotify:track:${id}`);
}

async function addTracksInChunks(
  accessToken: string,
  playlistId: string,
  trackIds: string[]
): Promise<void> {
  const uniqueTrackIds = Array.from(new Set(trackIds.filter(Boolean)));

  for (let i = 0; i < uniqueTrackIds.length; i += 100) {
    const chunk = uniqueTrackIds.slice(i, i + 100);
    await spotifyApiWrite(
      accessToken,
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
      "POST",
      { uris: toTrackUris(chunk) }
    );
  }
}

async function removeLikedTracks(accessToken: string, trackIds: string[]): Promise<void> {
  const uniqueTrackIds = Array.from(new Set(trackIds.filter(Boolean)));

  for (let i = 0; i < uniqueTrackIds.length; i += 50) {
    const chunk = uniqueTrackIds.slice(i, i + 50);
    await spotifyApiWrite(accessToken, "https://api.spotify.com/v1/me/tracks", "DELETE", {
      ids: chunk
    });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ExecuteBody;
    const assignments = body.assignments ?? [];
    const newPlaylists = body.newPlaylists ?? [];
    const refactorSuggestions = body.refactorSuggestions ?? [];

    const profile = await getCurrentUserProfile(session.accessToken);

    const createdPlaylistIdsByName = new Map<string, string>();

    for (const playlist of newPlaylists) {
      if (!playlist.name) continue;

      const created = await spotifyApiWrite<{ id: string }>(
        session.accessToken,
        `https://api.spotify.com/v1/users/${profile.id}/playlists`,
        "POST",
        {
          name: playlist.name,
          description: playlist.description || "Created by Spotify Sorter",
          public: false
        }
      );

      createdPlaylistIdsByName.set(playlist.name, created.id);

      if (playlist.trackIds.length > 0) {
        await addTracksInChunks(session.accessToken, created.id, playlist.trackIds);
      }
    }

    const tracksByPlaylist = new Map<string, string[]>();

    for (const assignment of assignments) {
      const playlistId =
        assignment.action === "add_to_existing"
          ? assignment.targetPlaylistId
          : createdPlaylistIdsByName.get(assignment.targetPlaylistName);

      if (!playlistId) continue;

      const current = tracksByPlaylist.get(playlistId) ?? [];
      current.push(assignment.trackId);
      tracksByPlaylist.set(playlistId, current);
    }

    for (const suggestion of refactorSuggestions) {
      const current = tracksByPlaylist.get(suggestion.toPlaylistId) ?? [];
      current.push(suggestion.trackId);
      tracksByPlaylist.set(suggestion.toPlaylistId, current);
    }

    for (const [playlistId, trackIds] of tracksByPlaylist.entries()) {
      await addTracksInChunks(session.accessToken, playlistId, trackIds);
    }

    if (body.removeFromLiked) {
      const movedFromLikedIds = assignments.map((item) => item.trackId);
      await removeLikedTracks(session.accessToken, movedFromLikedIds);
    }

    return NextResponse.json({
      ok: true,
      createdPlaylists: Array.from(createdPlaylistIdsByName.entries()).map(([name, id]) => ({
        name,
        id
      })),
      playlistsUpdated: tracksByPlaylist.size
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute Spotify actions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
