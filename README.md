# Spotify Sorter

A Next.js App Router application that connects to Spotify, analyzes your liked songs and user-owned playlists, and uses Google Gemini to propose sorting/refactoring actions.

## Project Documentation
* [MVP Scope & Features](./src/docs/MVP_SCOPE.md)
* [Business Models](./src/docs/BUSINESS_MODELS.md)
* [Production Requirements](./src/docs/PRODUCTION_REQUIREMENTS.md)
* [Budget Estimate](./src/docs/BUDGET_ESTIMATE.md)

## Stack

- Next.js (App Router)
- Tailwind CSS
- NextAuth.js (Spotify OAuth)
- Spotify Web API
- Google Gemini API (`gemini-2.5-flash`)

## Environment variables

Copy `.env.example` to `.env.local` and fill values:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `GEMINI_API_KEY`

## Run

```bash
npm install
npm run dev
```

## Implemented routes

- `GET /api/spotify/library`: fetches liked songs + user-owned playlists + playlist tracks + artist genres mapping
- `POST /api/ai/sort`: sends normalized library data to Gemini and returns structured JSON suggestions
- `POST /api/spotify/execute`: applies approved actions (create playlists, add tracks, optional remove from liked songs)
