import { authOptions } from "@/lib/auth";
import { getCurrentUserProfile, spotifyApiWrite } from "@/lib/spotify";
import { AiAssignment, NewPlaylistSuggestion, RefactorSuggestion } from "@/lib/types";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type ExecuteBody = {
  assignments?: AiAssignment[];
  newPlaylists?: NewPlaylistSuggestion[];
  refactorSuggestions?: RefactorSuggestion[];
  removeFromLiked?: boolean;
};

function toTrackUris(trackIds: string[]) {
  return trackIds.map((id) => {
    const cleanId = id.replace(/^spotify:track:/, "");
    return `spotify:track:${cleanId}`;
  });
}

async function addTracksInChunks(
  accessToken: string,
  playlistId: string,
  trackIds: string[]
): Promise<void> {
  const uniqueTrackIds = Array.from(new Set(trackIds.filter(Boolean)));

  for (let i = 0; i < uniqueTrackIds.length; i += 100) {
    const chunk = uniqueTrackIds.slice(i, i + 100);
    const uris = toTrackUris(chunk);
    const payload = JSON.stringify({ uris });
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;

    console.log(`[Spotify API] POST ${url}`);
    console.log(`[Spotify API] Payload: ${payload}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: payload
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Spotify API Error] POST ${url} | Status: ${response.status} | Response: ${errorText}`);
      throw new Error(`Failed to add tracks: ${response.status} ${errorText}`);
    }
  }
}

async function removeLikedTracks(accessToken: string, trackIds: string[]): Promise<void> {
  const cleanedIds = trackIds.map((id) => id.replace(/^spotify:track:/, ""));
  const uniqueTrackIds = Array.from(new Set(cleanedIds.filter(Boolean)));

  for (let i = 0; i < uniqueTrackIds.length; i += 50) {
    const chunk = uniqueTrackIds.slice(i, i + 50);
    const payload = JSON.stringify({ ids: chunk });
    const url = "https://api.spotify.com/v1/me/tracks";

    console.log(`[Spotify API] DELETE ${url}`);
    console.log(`[Spotify API] Payload: ${payload}`);

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: payload
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Spotify API Error] DELETE ${url} | Status: ${response.status} | Response: ${errorText}`);
      throw new Error(`Failed to remove liked tracks: ${response.status} ${errorText}`);
    }
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
        try {
          await addTracksInChunks(session.accessToken, created.id, playlist.trackIds);
        } catch (error) {
          console.error(`[Execution] Failed to add tracks to new playlist ${playlist.name}:`, error);
          throw error;
        }
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

    try {
      for (const [playlistId, trackIds] of tracksByPlaylist.entries()) {
        await addTracksInChunks(session.accessToken, playlistId, trackIds);
      }
    } catch (error) {
      console.error("[Execution] Playlist POST error:", error);
      throw error;
    }

    if (body.removeFromLiked) {
      try {
        const movedFromLikedIds = assignments.map((item) => item.trackId);
        await removeLikedTracks(session.accessToken, movedFromLikedIds);
      } catch (error) {
        console.error("[Execution] Liked Songs DELETE error:", error);
        throw error;
      }
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
