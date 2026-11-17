# CardGames — a private card room

Texas Hold'em, Blackjack and Durak with friends in the browser. Play money only.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000.

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. Neon). Without it, data goes to `data/db.json` — fine locally, **temporary on Render**. |
| `OWNER_USERNAMES` | Comma-separated usernames allowed into the owner dashboard at `/admin`, e.g. `abuspecki`. |
| `PORT` | Set automatically by Render. |

## What's inside

**The rooms**
- The lobby has two permanent tables for each game: **Table 1**, and a **High Roller** table for members only.
- Cards are dealt automatically once enough players sit down. There's no host.
- Anyone at a table can invite or dismiss bots, and bots play every game.
- Each game has its own room design:
  - **The Club Room:** Texas Hold'em, No-Limit, up to 8 players.
  - **Salon Privé:** Blackjack, 3:2 payout, dealer stands on 17, double and split.
  - **The Winter Palace:** Durak, the throw-in version, 2–6 players.

**Accounts, chips and coins.** Two play-money currencies that can never be bought or cashed out:
- **Chips** are your bankroll. Members start with 5,000.
  - Sitting down moves the table's buy-in from your bankroll to the table; leaving moves the chips back.
  - Server shutdowns return chips first. After a crash, chips that were at tables are refunded on the next start.
  - **Bankrupt?** Under 100 chips in total, the house stakes you 1,000 (at most every 15 minutes). This also happens automatically when you sit down with nothing left.
- **Coins** are the shop currency. You get them from:
  - a daily bonus of 100–250 coins, with a 7-day streak;
  - winning at tables (capped at 500 a day; doubled at High Roller tables);
  - exchanging chips at 100 chips per coin.
- **Anti-exploit rules:**
  - Only chips above your 5,000 starting amount can be exchanged, so free chips never become coins.
  - At most 300 coins can be exchanged per day.
  - Every balance change locks the wallet row, so nothing can be claimed, spent or charged twice.
- **The Shop** (all items are bought with coins, never real money):
  - On your own screen: card backs, decks (card faces), table felts, chip sets, backgrounds and turn markers.
  - Seen by everyone at your table: portraits (a frame around your initials), titles before your name (Sir, Lady, Baron, Grand Duke…), and gestures you can use at the table (tip of the hat, polite applause…).
  - Retired items (the old emoji portraits and badges, Flames) are no longer sold, but players who bought them keep them.

**Friends:**
- Send and accept requests, see who is online and at which table, invite friends to your table, and view profiles.

**Feedback:**
- A form for bug reports, suggestions, feature requests and general feedback. Guests can use it too.
- Messages are stored in the database and are rate-limited.

**Owner dashboard** (`/admin`):
- Totals: members, activity, coins and chips in circulation.
- A chart of hands per day for each game, and live tables.
- A player list with search and detail views; ban or unban (a ban signs the player out and removes them from tables with their chips returned); adjust balances.
- A feedback inbox.
- Every request is checked on the server.

**Phones and tablets:**
- Each table has an upright layout for phones and tall tablets, and a wide layout for desktops and landscape screens.
- On short screens held sideways, the bars become compact.
- Touch-sized buttons. In Durak, tap a card to select it and tap again to play.
- On small screens, chat, the log, odds and table settings live in a side panel that slides in.

## Code map

| | |
|---|---|
| `server.js` | HTTP + WebSocket bootstrap, graceful shutdown |
| `tables.js` | the six tables: seats, bots, timers, buy-in / cash-out |
| `api.js` | accounts, wallet, shop, friends, profiles, feedback, owner API |
| `coins.js` | the chip & coin economy and shop catalogue |
| `store.js` | Postgres / JSON-file persistence (same interface) |
| `poker.js`, `games/` | game engines (Hold'em, Blackjack, Durak) |
| `bots.js` | poker bot |
| `public/` | the website — `js/app.js` shell, `js/holdem.js` · `blackjack.js` · `durak.js` tables, `css/` design system, `admin.html` dashboard |

## Tests

```bash
npm test
```

The tests cover:
- hand rankings and Blackjack payouts;
- 2,000 simulated Durak games;
- the economy (also under concurrent requests);
- a full API run against a real server: chips at tables, friends, feedback, the dashboard, bans, and shutdown and crash refunds.

To run the economy and API tests against Postgres, set `TEST_DATABASE_URL`.
