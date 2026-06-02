# Business Models & Monetization Strategy

The core objective of this project is to use AI (Google Gemini) to organize the chaos of a user's Spotify "Liked Songs" by intelligently distributing them into their existing, self-created playlists. 

**Note on Spotify ToS:** According to Spotify's Developer Terms of Service, we cannot charge money directly for Spotify's data or playback functionality. Our monetization strategy strictly relies on charging for the AI processing power, automation logic, and the convenience provided by our application.

## 1. Freemium Model (SaaS)
Goal: Rapid user acquisition and Proof of Concept (PoC).
* **Free Tier:** Users can sort a limited number of tracks (e.g., 50-100) per month for free. This provides an "aha-moment" while keeping LLM API costs near zero.
* **Pro Tier (~$3-5/month):**
  * Unlimited track sorting.
  * **Auto-Sync:** A background worker (cron job) that continuously monitors new "Liked Songs" and automatically categorizes them into the appropriate playlists without manual intervention.
  * **Playlist Refactoring:** AI-driven optimization of existing playlists to remove duplicates or re-categorize misplaced tracks.

## 2. Credit-Based System (One-Time "Deep Clean")
Goal: Target users who suffer from subscription fatigue but want to organize a massive library built up over several years.
* **Offer:** A pay-as-you-go package (e.g., $5 for processing up to 2,000 Liked Songs).
* **Advantage:** Immediate revenue generation that directly covers the LLM API execution costs.

## 3. B2B / Power User Dashboard (Future Phase)
Goal: Serve professional music curators, wedding DJs, gym owners, and influencers.
* Features: Bulk playlist cloning, AI-driven genre mixing, and advanced filtering for a premium monthly fee (e.g., $10-15/month).