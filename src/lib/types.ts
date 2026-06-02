export type TrackArtist = {
  id: string;
  name: string;
};

export type NormalizedTrack = {
  id: string;
  uri: string;
  name: string;
  artists: TrackArtist[];
};

export type UserPlaylist = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  trackCount: number;
};

export type PlaylistWithTracks = UserPlaylist & {
  tracks: NormalizedTrack[];
};

export type MusicLibraryPayload = {
  userId: string;
  likedSongs: NormalizedTrack[];
  playlists: PlaylistWithTracks[];
  warnings?: string[];
};

export type AiAssignment = {
  trackId: string;
  trackName: string;
  artistNames: string[];
  targetPlaylistId?: string;
  targetPlaylistName: string;
  reason: string;
  action: "add_to_existing" | "create_new_playlist";
};

export type NewPlaylistSuggestion = {
  name: string;
  description?: string;
  trackIds: string[];
};

export type RefactorSuggestion = {
  trackId: string;
  trackName: string;
  fromPlaylistId: string;
  fromPlaylistName: string;
  toPlaylistId: string;
  toPlaylistName: string;
  reason: string;
};

export type AiSortResponse = {
  summary: string;
  assignments: AiAssignment[];
  newPlaylists: NewPlaylistSuggestion[];
  refactorSuggestions: RefactorSuggestion[];
};
