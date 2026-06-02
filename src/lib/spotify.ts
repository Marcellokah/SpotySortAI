import { MusicLibraryPayload, NormalizedTrack, PlaylistWithTracks, UserPlaylist } from "@/lib/types";

type SpotifyPaging<T> = {
  items: T[];
  next: string | null;
};

type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
};

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
};

type SavedTrackItem = {
  track: SpotifyTrack | null;
};

type PlaylistItem = {
  id: string;
  name: string;
  description: string | null;
  owner: { id: string };
  tracks: { total: number };
};

type PlaylistTrackItem = {
  track: SpotifyTrack | null;
};

async function spotifyApiGet<T>(accessToken: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Spotify API error (${response.status}) for ${url}: ${bodyText}`);
  }

  return response.json() as Promise<T>;
}

async function collectPaginated<T>(accessToken: string, initialUrl: string): Promise<T[]> {
  let nextUrl: string | null = initialUrl;
  const allItems: T[] = [];

  while (nextUrl) {
    const page: SpotifyPaging<T> = await spotifyApiGet<SpotifyPaging<T>>(accessToken, nextUrl);
    allItems.push(...page.items);
    nextUrl = page.next;
  }

  return allItems;
}

export async function getCurrentUserProfile(accessToken: string): Promise<{ id: string }> {
  return spotifyApiGet<{ id: string }>(accessToken, "https://api.spotify.com/v1/me");
}

export async function getAllLikedTracks(accessToken: string): Promise<SpotifyTrack[]> {
  const items = await collectPaginated<SavedTrackItem>(
    accessToken,
    "https://api.spotify.com/v1/me/tracks?limit=50"
  );

  return items.map((item) => item.track).filter((track): track is SpotifyTrack => Boolean(track?.id));
}

export async function getAllUserOwnedPlaylists(
  accessToken: string,
  currentUserId: string
): Promise<UserPlaylist[]> {
  const playlists = await collectPaginated<PlaylistItem>(
    accessToken,
    "https://api.spotify.com/v1/me/playlists?limit=50"
  );

  return playlists
    .filter((playlist) => playlist.owner.id === currentUserId)
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      ownerId: playlist.owner.id,
      trackCount: playlist.tracks?.total ?? 0
    }));
}

export async function getPlaylistTracks(accessToken: string, playlistId: string): Promise<SpotifyTrack[]> {
  const items = await collectPaginated<PlaylistTrackItem>(
    accessToken,
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`
  );

  return items.map((item) => item.track).filter((track): track is SpotifyTrack => Boolean(track?.id));
}

function normalizeTrack(track: SpotifyTrack, artistGenresMap: Map<string, string[]>): NormalizedTrack {
  const artistIds = track.artists.map((artist) => artist.id).filter(Boolean);
  const genres = Array.from(
    new Set(
      artistIds.flatMap((artistId) => artistGenresMap.get(artistId) ?? [])
    )
  );

  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists,
    artistIds,
    genres
  };
}

async function getArtistsByIds(
  accessToken: string,
  artistIds: string[],
  warnings: string[]
): Promise<Map<string, string[]>> {
  const uniqueIds = Array.from(new Set(artistIds.filter(Boolean)));
  const map = new Map<string, string[]>();

  if (uniqueIds.length === 0) {
    return map;
  }

  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    try {
      const data = await spotifyApiGet<{ artists: SpotifyArtist[] }>(
        accessToken,
        `https://api.spotify.com/v1/artists?ids=${chunk.join(",")}`
      );

      data.artists.forEach((artist) => {
        map.set(artist.id, artist.genres || []);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown artist fetch error";
      if (message.includes("Spotify API error (401)") || message.includes("Spotify API error (403)")) {
        warnings.push(`Skipped artist genre lookup for ${chunk.length} artists due to Spotify permissions.`);
        continue;
      }

      throw error;
    }
  }

  return map;
}

export async function buildMusicLibrary(accessToken: string): Promise<MusicLibraryPayload> {
  const profile = await getCurrentUserProfile(accessToken);
  const likedRaw = await getAllLikedTracks(accessToken);
  const userPlaylists = await getAllUserOwnedPlaylists(accessToken, profile.id);

  const warnings: string[] = [];

  const playlistTracksRaw = await Promise.all(
    userPlaylists.map(async (playlist) => {
      try {
        const tracks = await getPlaylistTracks(accessToken, playlist.id);
        return { playlist, tracks };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown playlist fetch error";
        if (message.includes("Spotify API error (403)")) {
          warnings.push(`Skipped inaccessible playlist: ${playlist.name}`);
          return { playlist, tracks: [] as SpotifyTrack[] };
        }

        throw error;
      }
    })
  );

  const allArtistIds = [
    ...likedRaw.flatMap((track) => track.artists.map((artist) => artist.id)),
    ...playlistTracksRaw.flatMap((entry) =>
      entry.tracks.flatMap((track) => track.artists.map((artist) => artist.id))
    )
  ];

  const artistGenresMap = await getArtistsByIds(accessToken, allArtistIds, warnings);

  const likedSongs = likedRaw.map((track) => normalizeTrack(track, artistGenresMap));

  const playlists: PlaylistWithTracks[] = playlistTracksRaw.map((entry) => ({
    ...entry.playlist,
    tracks: entry.tracks.map((track) => normalizeTrack(track, artistGenresMap))
  }));

  return {
    userId: profile.id,
    likedSongs,
    playlists,
    warnings
  };
}

export async function spotifyApiWrite<T>(
  accessToken: string,
  url: string,
  method: "POST" | "DELETE",
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Spotify write API error (${response.status}) for ${url}: ${bodyText}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
