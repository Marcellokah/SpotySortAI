# Production Requirements

Before launching the MVP to the public, the following technical and administrative steps must be completed.

## 1. Infrastructure & Hosting
* **Frontend / API Backend:** Vercel (excellent Next.js support, edge functions, auto-scaling).
* **Database:** Supabase (PostgreSQL) - Required later for user sessions, credit tracking, and auto-sync worker logs.

## 2. API & Authentication
* **Spotify Quota Extension:** The Spotify App must be transitioned from "Development Mode" to "Extended Quota Mode" on the Spotify Developer Dashboard. Otherwise, it will only work for manually whitelisted user accounts.
* Ensure all environment variables (`.env`) are securely set up in Vercel, and update `NEXTAUTH_URL` to the production domain.

## 3. Security & Stability
* **Rate Limiting:** Protect our API routes to prevent spam and avoid unexpected LLM billing spikes.
* **Graceful Error Handling:** Implement retry logic for Spotify API calls to handle `429 Too Many Requests` responses properly.

## 4. Legal & Administrative
* **Custom Domain:** Acquire a branded domain (e.g., `playlistai.io`).
* **Compliance:** Publish a clear Terms of Service (ToS) and Privacy Policy page. (This is a hard requirement for Spotify's app review process).