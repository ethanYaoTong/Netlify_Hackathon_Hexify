# Subscription Graveyard 🪦

Build plan for the AI agent. Read this whole file before writing code. Follow the build order exactly and keep the site deployable after every step.

---

## 1. Context

- **Event:** Halloween hackathon (Netlify x AI Society UNSW). **Build time: 2 hours.**
- **Theme: Trick, Treat, Transform.** Take an ordinary, boring real-world problem and transform it, with a **trick** (an unexpected twist) and a **treat** (a satisfying payoff).
- **Judging (/70):**
  - Value & impact /20: a genuine need, a clear audience, a real difference
  - Creativity /20: trick + treat + transform
  - Backend /20: **real engineering beyond a few AI prompts, with Netlify in the backend**
  - Frontend /10: functional, intuitive, enjoyable
- **Finals:** shortlisted teams give a **3-minute pitch with a live demo**, so the demo path must never break.

## 2. The idea

| | |
|---|---|
| **Ordinary problem** | People (especially students) pay for subscriptions they've forgotten. Checking a bank statement is boring. |
| **Transform** | Upload your bank statement CSV and your recurring charges **rise from the grave as zombies**. |
| **Trick** | The app works out your subscriptions itself (no manual entry). The longer you've been paying for one, the more rotten its zombie looks. Price hikes show up as "mutated" zombies. |
| **Treat** | "Slay" each zombie: you get the cancel link (or a ready-to-send cancel email), it crumbles into a tombstone, and a **"$ saved per year" counter** climbs. A final "Graveyard Cleared" screen shows your total, plus a global counter of money slain by every user. |
| **Audience** | Uni students and anyone on a tight budget. |
| **Privacy pitch** | Transactions are processed in memory and **never stored**. Only an anonymous running total is saved. |

## 3. Tech stack (keep it simple)

- **Frontend:** plain HTML + CSS + vanilla JS in `public/`. **No framework and no build step.**
- **Backend:** Netlify Functions (modern syntax, `.mjs`) in `netlify/functions/`.
- **Storage:** Netlify Blobs (`@netlify/blobs`), used only for the global "total slain" counter.
- **Fonts:** Google Fonts, `Jersey 10` for headings and `VT323` for body text (8-bit / retro game look).
- **Do not add:** auth/login, a database, bank API integrations, React/Vite, TypeScript, or tests. There's no time.

### File structure

```
/
├── CLAUDE.md
├── netlify.toml
├── package.json                  # dependency: @netlify/blobs
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── demo-transactions.csv
└── netlify/functions/
    ├── detect.mjs                # POST /api/detect
    ├── merchants.mjs             # shared merchant data (imported by detect.mjs, not an endpoint)
    ├── slain.mjs                 # GET/POST /api/slain
    └── cancel-email.mjs          # POST /api/cancel-email (stretch)
```

> If the agent's tooling treats every file in `netlify/functions/` as a function, move `merchants.mjs` to `netlify/lib/merchants.mjs` and import it from there.

### netlify.toml

```toml
[build]
  publish = "public"
  functions = "netlify/functions"
```

### Function format (use this pattern)

```js
export default async (req, context) => {
  return Response.json({ ok: true });
};
export const config = { path: "/api/detect" };
```

## 4. Backend spec

### 4.1 `POST /api/detect`: the core engine (real logic, not AI)

**Input:** raw CSV text in the request body (`Content-Type: text/plain`).

**CSV parsing:**
- Find the columns by header name, case-insensitively: date (`date`, `transaction date`), description (`description`, `details`, `narrative`, `merchant`), amount (`amount`, `debit`).
- Accept dates as `YYYY-MM-DD` or `DD/MM/YYYY` (Australian banks use DD/MM).
- Debits may be negative numbers. Use the absolute value and ignore credits/income (positive amounts when the file also contains negative ones).
- Handle quoted fields that contain commas.

**Merchant normalisation:**
1. Uppercase the description and trim it.
2. Strip prefixes: `PAYPAL *`, `SQ *`, `SP `, `VISA PURCHASE`, `EFTPOS`, `DIRECT DEBIT`.
3. Strip reference numbers, card numbers, dates and trailing location codes (e.g. `NETFLIX.COM 1234 SYDNEY AU` → `NETFLIX.COM`).
4. Match against the known-merchant aliases in `merchants.mjs` to get a clean display name (`NETFLIX.COM` → `Netflix`).

**Recurring detection:**
1. Group transactions by normalised merchant.
2. Keep groups with **at least 2 charges** (3+ for weekly).
3. Sort by date, compute the gaps in days between charges, and take the **median gap**.
4. Classify the frequency:
   - weekly 6–8 days
   - fortnightly 13–16 days
   - monthly 27–33 days
   - quarterly 85–95 days
   - yearly 355–375 days
   - otherwise not recurring, so drop it
5. Amount consistency: every charge must be within 25% of the median amount, otherwise drop the group (it's probably regular shopping, not a subscription).
6. **Price hike:** the latest amount is more than 5% above the earliest amount → `priceHike: { from, to }`.
7. **Status:** `active` if the last charge falls within 1.5× the interval of the newest date in the file, otherwise `dormant`.
8. **Yearly cost:** latest amount × charges per year (weekly 52, fortnightly 26, monthly 12, quarterly 4, yearly 1).
9. **Rot level (0–3):** based on months since the first charge (0: <3 months, 1: 3–6, 2: 6–12, 3: 12+).

**Output** (sorted by `yearlyCost` descending):

```json
{
  "subscriptions": [
    {
      "id": "netflix",
      "name": "Netflix",
      "category": "streaming",
      "frequency": "monthly",
      "amount": 18.99,
      "yearlyCost": 227.88,
      "chargeCount": 6,
      "firstCharged": "2025-04-12",
      "lastCharged": "2025-09-12",
      "status": "active",
      "rotLevel": 2,
      "priceHike": { "from": 16.99, "to": 18.99 },
      "cancelUrl": "https://www.netflix.com/account",
      "known": true
    }
  ],
  "totalYearly": 1043.52,
  "transactionsScanned": 214
}
```

Return a `400` with a friendly error message if the CSV can't be parsed.

### 4.2 `merchants.mjs`: known merchants

An array of `{ id, name, aliases: [...], category, cancelUrl }`. Include at least the merchants below. Use each service's account/subscription page as the cancel URL. For unknown merchants, set `known: false` and `cancelUrl` to a Google search: `https://www.google.com/search?q=how+to+cancel+<name>+subscription`.

| Name | Aliases (examples) | Category |
|---|---|---|
| Netflix | NETFLIX, NETFLIX.COM | streaming |
| Spotify | SPOTIFY, SPOTIFY AB | music |
| Disney+ | DISNEY PLUS, DISNEYPLUS | streaming |
| Stan | STAN.COM.AU, STAN ENTERTAINMENT | streaming |
| Binge | BINGE, STREAMOTION BINGE | streaming |
| Kayo | KAYO, STREAMOTION KAYO | streaming |
| YouTube Premium | YOUTUBE, GOOGLE YOUTUBE | streaming |
| Amazon Prime | AMAZON PRIME, PRIME VIDEO | shopping |
| Apple (iCloud / Apple One) | APPLE.COM/BILL, ITUNES | cloud |
| Google One | GOOGLE ONE, GOOGLE STORAGE | cloud |
| Microsoft 365 | MICROSOFT, MSFT | software |
| Adobe | ADOBE, ADOBE CREATIVE CLOUD | software |
| Canva | CANVA | software |
| ChatGPT Plus | OPENAI, CHATGPT | software |
| Claude Pro | ANTHROPIC, CLAUDE.AI | software |
| Duolingo | DUOLINGO | education |
| Audible | AUDIBLE | books |
| Uber One | UBER ONE | delivery |
| Anytime Fitness | ANYTIME FITNESS | gym |
| Fitness First | FITNESS FIRST | gym |

### 4.3 `GET/POST /api/slain`: global counter (Netlify Blobs)

- Store name `graveyard`, key `stats`, value `{ totalSlainYearly: number, zombiesSlain: number }`.
- `GET` returns the current stats (zeros if the key doesn't exist yet).
- `POST { yearlyCost: number }` adds to the totals and returns the new stats. Validate that it's a positive number below 10,000.
- **Never store transaction data or merchant names tied to a user.**

### 4.4 `POST /api/cancel-email` (stretch goal only)

- Input `{ name, amount, frequency }`. Returns `{ subject, body }` for a polite but firm cancellation email.
- Use AI through Netlify's AI Gateway if it's available. **Always fall back to a hard-coded template** if AI fails or isn't configured, so the demo can't break.

## 5. Frontend spec

### Look & feel
- **An 8-bit horror game on a dying CRT TV** (FNAF-style title screen): TV static, scanlines, a rolling bar, flicker, a glitching title and a twitching pixel zombie face. Hard pixel edges only: no border-radius, no blur or soft shadows, stepped (`steps()`) animations. Panels use notched pixel borders (`.btn-pixel` / `.zombie` box-shadow pattern).
- Palette: black `#000000`, bone `#e8e0d0` (text), blood red `#c0262d` (money drained), purple `#6b2fb3` (panel borders, glitch), zombie green `#7fff6a` (only sprites and money saved), dim `#6f675c` (secondary text).
- `Jersey 10` for headings, `VT323` for everything else, set large so it stays readable. No emojis in UI text (they clash with the pixel fonts); use the pixel zombie sprite instead.
- Must work on a laptop screen and on a phone (single column on mobile).
- Respect `prefers-reduced-motion` (tone the animations down).

### Screens (all in one `index.html`; show and hide sections)

**1. Landing**
- Title "Subscription Graveyard" and tagline: *"Your forgotten subscriptions are coming back from the dead."*
- A drag-and-drop zone / file picker for a CSV.
- A big **"🧟 Summon demo graveyard"** button that loads `demo-transactions.csv`. **This is the button used in the pitch.**
- Small print: "Your transactions are never stored."
- The global counter from `GET /api/slain`: "💀 $X,XXX/yr slain by N zombie hunters".

**2. The graveyard (results)**
- A short "summoning…" animation (ground shake, about 1.5s) while `/api/detect` runs.
- Zombies **rise from the ground one by one** (staggered ~300ms each), most expensive first.
- Each zombie card shows: a zombie emoji/CSS figure with rot styling by `rotLevel` (greener, more cracks and a tilt as it gets higher), name, `$amount / frequency`, **`$yearlyCost per year`** in large text, "haunting you since <month year>", a "🧬 MUTATED +$2.00" badge if `priceHike`, and a faded "dormant" look if `status === "dormant"`.
- A header bar: "**N zombies are draining $X per year**".
- A **"⚔️ Slay"** button on every card.

**3. Slay flow**
- Clicking Slay opens a modal with the cancel link ("Open cancel page ↗", new tab), optionally a "Write my cancel email" button (stretch), and a **"I've cancelled it — slay!"** confirm button.
- On confirm: the zombie shakes, crumbles or fades, and turns into a **tombstone** reading "RIP <Name> · <first year>–2026 · saved $X/yr". `POST /api/slain`. The **"💰 Saved: $X per year"** counter at the top animates upward.
- Add fun equivalents under the counter, e.g. "= 42 Opal trips" ($4.80 each), "= 19 Guzman y Gomez burritos" ($15 each).

**4. Graveyard cleared (the treat)**
- Shown when every active zombie is slain, or when the user clicks "Leave the graveyard".
- Big headline "🎃 GRAVEYARD CLEARED", total saved per year, number slain, fun equivalents, the updated global counter, and a "Haunt another statement" button.
- Confetti or bats flying across the screen.

## 6. Demo data: `public/demo-transactions.csv`

- Columns: `Date,Description,Amount` (dates as `DD/MM/YYYY`, debits negative).
- Date range: **01/04/2026 to 30/09/2026** (6 months), about 150–220 rows.
- Recurring charges that **must** be detected:
  - Netflix: monthly, $16.99 for the first 3 months then $18.99 (price hike)
  - Spotify: monthly $13.99
  - Stan: monthly $12.00
  - Adobe Creative Cloud: monthly $34.99
  - Anytime Fitness: fortnightly $29.90
  - ChatGPT Plus (OPENAI): monthly $32.00
  - Duolingo: one yearly charge isn't enough to detect, so use monthly $12.99
  - An unknown merchant, e.g. `CLOUDSTORE PRO 8812`: monthly $4.99 (tests the "unknown" path)
  - Binge: monthly $18.00 that stopped in June (should show as dormant)
- Noise that must **not** be detected: Woolworths, Coles, Opal top-ups, Uber Eats, Guzman y Gomez, Kmart, cafés with random amounts, plus some salary credits (positive amounts).
- Use realistic bank-style descriptions (e.g. `NETFLIX.COM 0412 SYDNEY AU`, `SP SPOTIFY P1A2B3`, `DIRECT DEBIT ANYTIME FITNESS`).

## 7. Build order (follow strictly, and deploy after each step)

| # | Step | Done when |
|---|---|---|
| 1 | Scaffold: `netlify.toml`, `package.json`, a placeholder `index.html` | The site deploys and shows the title |
| 2 | Create `demo-transactions.csv` exactly as in section 6 | The file loads at `/demo-transactions.csv` |
| 3 | `merchants.mjs` + `detect.mjs` | POSTing the demo CSV returns all expected subscriptions and no noise |
| 4 | Landing screen + demo button + call `/api/detect` + plain list of results | Clicking the demo button shows the subscriptions |
| 5 | Graveyard styling: sky, fog, zombie cards, rise animation, rot levels, badges | It looks spooky and readable |
| 6 | Slay modal, tombstone transform, savings counter, fun equivalents | The full slay loop works |
| 7 | `slain.mjs` with Blobs + global counter on the landing and final screens | The counter persists across reloads |
| 8 | "Graveyard cleared" screen + confetti/bats | The full demo runs end to end |
| 9 | **Stretch:** file upload with drag and drop, then `cancel-email.mjs`, then a mobile polish pass | Only once steps 1–8 work |

## 8. Rules for the agent

- **The demo path is sacred:** demo button → zombies rise → slay 2–3 → graveyard cleared. Never break it.
- Make small, working increments. Don't refactor working code late in the build.
- Every `fetch` needs error handling and a friendly spooky error message ("The spirits couldn't read this file…").
- No secrets in frontend code. Don't log transaction data.
- Keep the code readable. Judges may look at the backend, so add brief comments explaining the detection algorithm.

## 9. Pitch script (3 minutes)

1. **Hook (20s):** "The average person forgets about [X] subscriptions. Students especially are bleeding money to services they don't use."
2. **Trick (60s):** Click "Summon demo graveyard". Zombies rise. Point out the rot (Adobe has been haunting you for months), the mutated Netflix price hike, and the dormant Binge.
3. **Treat (60s):** Slay two or three zombies. Tombstones appear, the savings counter climbs, "Graveyard cleared", and the global counter goes up.
4. **Backend (30s):** "This isn't just an AI prompt. It's our own recurring-charge detection engine running on Netlify Functions: merchant normalisation, interval classification, price-hike detection. Netlify Blobs powers the global counter, and we never store your transactions."
5. **Close (10s):** "Subscription Graveyard: let your forgotten subscriptions rest in peace."
