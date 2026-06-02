# Minimum Viable Product (MVP) Scope

For the initial release, the focus is strictly on delivering a stable, bug-free core functionality. Payment gateways and background automation will be deferred to post-MVP phases.

## 1. Authentication & Scopes
* Implement stable Spotify OAuth login using NextAuth.js.
* Required Spotify Scopes: `user-library-read`, `playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-private`, `playlist-modify-public`.

## 2. Data Fetching
* Retrieve the user's "Liked Songs" (handling pagination correctly).
* Retrieve playlists **strictly created by the user** (excluding followed or Spotify-generated playlists).
* Fetch artist metadata to extract accurate `genres` for better AI categorization.

## 3. AI Logic (Google Gemini Integration)
* Send engineered, structured prompts (JSON format) to the Gemini 2.5 Flash / Flash-Lite model.
* **Core Tasks:** 
  * Assign each Liked Song to the most contextually relevant existing user playlist.
  * Suggest a name for a new playlist if a track does not fit into any existing one.

## 4. User Interface (UI)
* Build a clean, fast Dashboard (Next.js App Router + Tailwind CSS).
* Visually display the AI's proposed changes (Track -> Target Playlist).
* Provide a clear "Approve / Execute" button for the user to confirm the changes.

## 5. Execution
* Execute the approved changes via the Spotify API (adding tracks to playlists, removing them from Liked Songs if requested).
* Provide clear success/error UI feedback.