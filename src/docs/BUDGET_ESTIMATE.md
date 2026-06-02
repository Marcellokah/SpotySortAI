# Budget Estimate & Operational Costs

Using a modern modern serverless stack allows for near-zero bootstrapping costs. Expenses will only scale alongside user growth and revenue.

## Phase 0: Bootstrapping (0 - 500 users)
* **Hosting (Vercel):** $0 / month (Hobby Tier is sufficient for MVP).
* **Database (Supabase):** $0 / month (Free Tier).
* **LLM API (Google Gemini 2.5 Flash):** $0 / month (The Free Tier allows up to 15 requests per minute and 1M tokens per day, perfect for early testing).
* **Domain Name:** ~$10 - $15 / year.
* **Total Fixed Startup Cost:** ~$15 / year.

## Phase 1: Scaling (Paying Customers)
Exceeding the free tiers indicates market validation and active revenue.
* **Vercel Pro:** $20 / month (Faster build times, higher API execution timeout limits).
* **Supabase Pro:** $25 / month.
* **Gemini API (Pay-as-you-go):** Highly cost-effective. ~$0.075 per 1M input tokens, and ~$0.30 per 1M output tokens. Processing a single user's library will cost fractions of a cent.
* **Payment Gateway (Stripe):** No monthly fee, ~2.9% + $0.30 per successful transaction.
* **Estimated Monthly Baseline (When scaling):** ~$45 - $60 / month + Usage-based API costs.