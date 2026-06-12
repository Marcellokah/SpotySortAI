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

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = session.accessToken;

  try {
    const body = (await request.json()) as ExecuteBody;
    const assignments = body.assignments ?? [];
    const newPlaylists = body.newPlaylists ?? [];
    const refactorSuggestions = body.refactorSuggestions ?? [];
    const removeFromLiked = body.removeFromLiked ?? false;

    const profile = await getCurrentUserProfile(token);

    // 1. Parse and Group Correctly:
    // Extract `assignments` from `req.body`.
    // Group the `trackId`s by `targetPlaylistId` (only for `action === 'add_to_existing'`).
    const groupMap = new Map<string, Array<{ trackId: string }>>();

    for (const assignment of assignments) {
      if (assignment.action === "add_to_existing" && assignment.targetPlaylistId) {
        const group = groupMap.get(assignment.targetPlaylistId) ?? [];
        group.push({ trackId: assignment.trackId.replace(/^spotify:track:/, "") });
        groupMap.set(assignment.targetPlaylistId, group);
      }
    }

    // Handle newPlaylists and refactorSuggestions
    const createdPlaylistIdsByName = new Map<string, string>();

    for (const playlist of newPlaylists) {
      if (!playlist.name) continue;

      const created = await spotifyApiWrite<{ id: string }>(
        token,
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
        const group = groupMap.get(created.id) ?? [];
        for (const trackId of playlist.trackIds) {
          group.push({ trackId: trackId.replace(/^spotify:track:/, "") });
        }
        groupMap.set(created.id, group);
      }
    }

    for (const assignment of assignments) {
      if (assignment.action === "create_new" && assignment.targetPlaylistName) {
        const playlistId = createdPlaylistIdsByName.get(assignment.targetPlaylistName);
        if (playlistId) {
          const group = groupMap.get(playlistId) ?? [];
          group.push({ trackId: assignment.trackId.replace(/^spotify:track:/, "") });
          groupMap.set(playlistId, group);
        }
      }
    }

    for (const suggestion of refactorSuggestions) {
      if (suggestion.toPlaylistId) {
        const group = groupMap.get(suggestion.toPlaylistId) ?? [];
        group.push({ trackId: suggestion.trackId.replace(/^spotify:track:/, "") });
        groupMap.set(suggestion.toPlaylistId, group);
      }
    }

    // Playlist POST(s)
    try {
      for (const [targetPlaylistId, group] of groupMap.entries()) {
        const uniqueGroup = Array.from(new Map(group.map(t => [t.trackId, t])).values());
        
        // 1. Pre-flight Check (Fetch existing tracks)
        let existingUris = new Set<string>();
        try {
          const getRes = await fetch(`https://api.spotify.com/v1/playlists/${targetPlaylistId}/tracks?fields=items(track(uri))`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store'
          });
          
          if (!getRes.ok) {
             console.warn(`Pre-flight check failed, proceeding without deduplication. Status: ${getRes.status}`);
          } else {
            const currentTracks = await getRes.json();
            existingUris = new Set(currentTracks.items?.map((item: any) => item.track?.uri) || []);
          }
        } catch (error) {
          console.warn("Pre-flight check failed, proceeding without deduplication:", error);
        }

        for (let i = 0; i < uniqueGroup.length; i += 100) {
          const chunk = uniqueGroup.slice(i, i + 100);
          
          // 2. Strict Spotify URI Formatting & Deduplication
          const uris = chunk.map((t) => "spotify:track:" + t.trackId);
          const uniqueIncomingUris = [...new Set(uris)];
          const urisToInsert = uniqueIncomingUris.filter(uri => !existingUris.has(uri));

          if (urisToInsert.length === 0) {
            console.log(`Skipping playlist ${targetPlaylistId}, chunk ${i / 100 + 1}, all tracks already exist.`);
            continue;
          }

          // 4. Console Validation
          console.log("SENDING TO SPOTIFY Playlist:", targetPlaylistId, "Payload:", JSON.stringify({ uris: urisToInsert }));

          // 3. The Fetch Call
          const res = await fetch("https://api.spotify.com/v1/playlists/" + targetPlaylistId + "/items", {
            method: 'POST',
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ uris: urisToInsert })
          });

          if (!res.ok) {
            const errorText = await res.text();
            console.error(`[Spotify API Error] POST https://api.spotify.com/v1/playlists/${targetPlaylistId}/items | Status: ${res.status} | Response: ${errorText}`);
            throw new Error(`Failed to add tracks: ${res.status} ${errorText}`);
          }
        }
      }
    } catch (error) {
      console.error("[Execution] Playlist POST error:", error);
      throw error;
    }

    // Liked Songs DELETE
    if (removeFromLiked && assignments.length > 0) {
      try {
        const movedFromLikedIds = Array.from(
          new Set(assignments.map((item) => item.trackId.replace(/^spotify:track:/, "")))
        );

        for (let i = 0; i < movedFromLikedIds.length; i += 50) {
          const chunk = movedFromLikedIds.slice(i, i + 50);

          const urisParam = chunk.map(id => 'spotify:track:' + id).join(',');
          console.log("SENDING DELETE TO SPOTIFY URL:", `https://api.spotify.com/v1/me/library?uris=${urisParam}`);

          const response = await fetch(`https://api.spotify.com/v1/me/library?uris=${urisParam}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`
            }
          });

          if (!response.ok) {
            throw new Error(`Spotify DELETE Error: ${response.status} - ${await response.text()}`);
          }
        }
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
      playlistsUpdated: groupMap.size
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to execute Spotify actions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
