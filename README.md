# TEDxGUC Cashbook

The team's shared money tracker: cash and bank ledgers by season, curator custody, 14% VAT on bank deposits, sponsors and yearly income, phase budgets, fatora tracking, receipts, activity log, Excel export and an "Ask AI" assistant.

- **Website:** plain HTML/JS, hosted free on GitHub Pages
- **Backend:** Supabase (Postgres database, logins, private receipt storage, live updates)

```
index.html          the app
backend.js          connects the app to Supabase
charts.js           draws the graphs (app, Excel and PDF report)
reports.js          graph panels, branded Excel export and the PDF report
paperwork.js        Paperwork tab: fills the expense approval form + memo as one PDF
assets/             TEDxGUC and GUC logos used in the Excel file and PDF
config.js           your Supabase URL + public key (step 3)
supabase/schema.sql database tables, security rules, receipts bucket, report views
supabase/functions/ask/index.ts   server function for "Ask AI" (optional, uses free Gemini)
```

`seed.sql` (your existing data) is delivered **separately** on purpose. It contains sponsor and bank figures. **Never commit it to GitHub.**

---

## 1. Create the Supabase project (5 min)
1. Sign up at **supabase.com** → **New project**. Pick a region close to Cairo (e.g. Frankfurt). Save the database password somewhere safe.
2. Open **SQL Editor** → **New query**.
3. Open `supabase/schema.sql`, check the email at the bottom is yours (it becomes the first admin), paste everything, **Run**.
4. New query again → paste the whole of `seed.sql` → **Run**. This loads every 2026 entry, the 2027 opening balances and all settings.

## 2. Turn on email + password logins
**Authentication → Sign In / Providers → Email:** make sure Email is enabled and turn **off "Confirm email"**.
(Supabase's built-in mailer only sends a few emails per hour, so confirmation emails are unreliable without your own SMTP. The team list below is what actually controls access.)

## 3. Connect the website
**Project Settings → API**: copy the **Project URL** and the **anon public** key into `config.js`.
The anon key is designed to be public. The security rules in `schema.sql` are what keep the data private.

## 4. Put it on GitHub Pages
1. Create a new repository on GitHub (e.g. `tedxguc-cashbook`).
2. **Add file → Upload files**: upload everything in this folder (`index.html`, `backend.js`, `charts.js`, `reports.js`, `paperwork.js`, `config.js`, `README.md`, the `assets` and `supabase` folders). **Not** `seed.sql`.
3. **Settings → Pages → Build and deployment:** Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)` → Save.
4. After a minute your site is live at `https://<your-username>.github.io/tedxguc-cashbook/`.
5. Back in Supabase, **Authentication → URL Configuration**: set **Site URL** to that address.

## 5. Add the team
Supabase → **Table Editor → team_members → Insert row** for each person:

| email (lowercase) | name | role | is_admin |
|---|---|---|---|
| hamza@… | Hamza El Khobby | Curator | true |
| … | … | L&P Executive | false |

Each person then opens the site, enters their email and a password, and clicks **First time? Create account**. Anyone who signs up but isn't in `team_members` sees a "not on the team list" screen and **no data**.

`is_admin` people can add/remove others in `team_members`. Everyone on the list can add and edit entries.

## 6. "Ask AI" (optional, free)
"Ask AI" and the memo writer in Paperwork use **Google Gemini's free tier**.
1. Go to **aistudio.google.com** → sign in with a Google account → **Get API key** → **Create API key**. No card needed.
2. Install the Supabase CLI, then from this folder:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-ID
   supabase functions deploy ask
   supabase secrets set GEMINI_API_KEY=your-key-here
   ```
The key lives only on Supabase's server and never in the website code. Only signed-in team members can call the function.

Good to know:
- The free tier has a daily limit. If it's busy or used up, the app tries a second Gemini model; if that fails too, wait and try later.
- On the free tier Google may use what you send (the ledger summary, sponsor amounts) to improve its products. Turn on billing in AI Studio if that's a concern.
- To use Claude instead (paid, not used for training): `supabase secrets unset GEMINI_API_KEY` and `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`.

## Reports
Two read-only views are created for you. Try them in the SQL Editor:
```sql
select * from season_summary;                                   -- cash/bank/VAT/sponsors per season
select sponsor, sum(amount) from ledger
 where season = 2026 and category = 'sponsor' group by 1 order by 2 desc;
```

## Day-to-day
- **New season:** Settings (gear) → *Close this season and start the next…* carries the closing cash and bank into the new season.
- **Backups:** Supabase → Database → Backups (daily on paid plans). On the free plan, use the app's **Download as Excel** regularly.
- **Free-plan note:** free Supabase projects pause after about a week with no activity. Open the dashboard and click *Restore* if that happens. No data is lost.
