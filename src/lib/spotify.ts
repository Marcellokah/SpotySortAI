import { MusicLibraryPayload, NormalizedTrack, PlaylistWithTracks, UserPlaylist } from "@/lib/types";

type SpotifyPaging<T> = {
  items: T[];
  next: string | null;
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

type SpotifyApiError = Error & {
  status?: number;
  statusText?: string;
  bodyText?: string;
  url?: string;
};

function createSpotifyHeaders(accessToken: string, extraHeaders?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders
  };
}

async function spotifyApiGet<T>(accessToken: string, url: string, retries = 3): Promise<T> {
  const response = await fetch(url, {
    headers: {
      ...createSpotifyHeaders(accessToken)
    },
    cache: "no-store"
  });

  if (response.status === 429 && retries > 0) {
    const retryAfter = response.headers.get("Retry-After");
    let delayMs = 2000;
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      if (!isNaN(parsed)) {
        delayMs = parsed * 1000;
      }
    }

    if (delayMs > 10000) {
      console.log(`[Spotify API] Rate limited (429) for GET ${url}. Retry-After is too long (${delayMs}ms). Aborting.`);
      const error = new Error(`Spotify API rate limit exceeded. Please try again later.`) as SpotifyApiError;
      error.status = 429;
      error.url = url;
      throw error;
    }

    console.log(`[Spotify API] Rate limited (429) for GET ${url}. Retrying in ${delayMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return spotifyApiGet<T>(accessToken, url, retries - 1);
  }

  if (!response.ok) {
    const bodyText = await response.text();
    console.log(`[Spotify API] GET ${url}`);
    console.log(`[Spotify API] status=${response.status} statusText=${response.statusText}`);
    console.log(`[Spotify API] body=${bodyText}`);

    const error = new Error(`Spotify API error (${response.status}) for ${url}`) as SpotifyApiError;
    error.status = response.status;
    error.statusText = response.statusText;
    error.bodyText = bodyText;
    error.url = url;
    throw error;
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
    `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100`
  );

  return items.map((item) => item.track).filter((track): track is SpotifyTrack => Boolean(track?.id));
}

function normalizeTrack(track: SpotifyTrack): NormalizedTrack {
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists
  };
}

export async function buildMusicLibrary(
  accessToken: string,
  currentUserId?: string
): Promise<MusicLibraryPayload> {
  console.log("Current Access Token:", accessToken);

  const profile = await getCurrentUserProfile(accessToken);
  const likedRaw = await getAllLikedTracks(accessToken);
  const userPlaylists = await getAllUserOwnedPlaylists(accessToken, profile.id);

  const warnings: string[] = [];
  const playlistTracksRaw: { playlist: UserPlaylist; tracks: SpotifyTrack[] }[] = [];

  // Fetch playlist tracks sequentially to avoid massive API bursts that trigger 429
  for (const playlist of userPlaylists) {
    if (currentUserId && playlist.ownerId !== currentUserId) {
      console.log(
        `[Spotify API] Skipping playlist ${playlist.name} (${playlist.id}) because owner ${playlist.ownerId} does not match session user ${currentUserId}`
      );
      playlistTracksRaw.push({ playlist, tracks: [] });
      continue;
    }

    try {
      const tracks = await getPlaylistTracks(accessToken, playlist.id);
      playlistTracksRaw.push({ playlist, tracks });
    } catch (error) {
      const spotifyError = error as SpotifyApiError;

      if (spotifyError.status === 401 || spotifyError.status === 403 || spotifyError.status === 429) {
        console.log(`[Spotify API] Failed playlist fetch for ${playlist.name} (${playlist.id})`);
        console.log(
          `[Spotify API] status=${spotifyError.status} statusText=${spotifyError.statusText ?? ""}`
        );
        console.log(`[Spotify API] body=${spotifyError.bodyText ?? ""}`);
        warnings.push(
          `Spotify playlist fetch failed with ${spotifyError.status ?? "unknown"} ${
            spotifyError.statusText ?? ""
          }`
        );
        playlistTracksRaw.push({ playlist, tracks: [] });
        continue;
      }

      throw error;
    }

    // Small intentional delay between playlists to further reduce rate limit pressure
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const likedSongs = likedRaw.map((track) => normalizeTrack(track));

  const playlists: PlaylistWithTracks[] = playlistTracksRaw.map((entry) => ({
    ...entry.playlist,
    tracks: entry.tracks.map((track) => normalizeTrack(track))
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
  body?: unknown,
  retries = 3
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      ...createSpotifyHeaders(accessToken, {
        "Content-Type": "application/json"
      })
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  if (response.status === 429 && retries > 0) {
    const retryAfter = response.headers.get("Retry-After");
    let delayMs = 2000;
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      if (!isNaN(parsed)) {
        delayMs = parsed * 1000;
      }
    }

    if (delayMs > 10000) {
      console.log(`[Spotify API] Rate limited (429) for ${method} ${url}. Retry-After is too long (${delayMs}ms). Aborting.`);
      const error = new Error(`Spotify API rate limit exceeded. Please try again later.`) as SpotifyApiError;
      error.status = 429;
      error.url = url;
      throw error;
    }

    console.log(`[Spotify API] Rate limited (429) for ${method} ${url}. Retrying in ${delayMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return spotifyApiWrite<T>(accessToken, url, method, body, retries - 1);
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Spotify write API error (${response.status}) for ${url}: ${bodyText}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
