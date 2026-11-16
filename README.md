# Poker Night

Play card games with friends in the browser, using play money only.

**Tables:** the lobby has two permanent tables per game. Anyone can join, and there's no host. Cards are dealt automatically once enough players sit down (1 for Blackjack, 2 for the others).
- **Texas Hold'em** (no limit)
- **Blackjack:** everyone plays against the dealer. Blackjack pays 3:2 and the dealer stands on 17. You can double, or split once.
- **Durak:** the classic "throw-in" (podkidnoy) version with 36 cards, 2–6 players and a trump suit. The last player holding cards is the durak.

Bots can play all three. **📖 How to play** explains the rules of each game in the game itself.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, pick a table, and send friends the invite link (or just tell them which table).

## Play with friends online

Friends need to reach your server. Options:

- **Deploy (recommended):** Push this folder to GitHub and create a free "Web Service" on Render, Railway or Fly.io.
  Use `npm install` as the build command and `npm start` as the start command. WebSockets work out of the box.
- **Quick test from your own computer:** Run `npm start`, then `npx localtunnel --port 3000` or `cloudflared tunnel --url http://localhost:3000`, and share the URL it prints.

## Sounds

All sounds are generated in code (`public/sound.js`). Edit the `synth` section to change how they sound.
To use your own sound files instead, drop them into `public/sounds/` named after the sound:

`deal` · `fold` · `check` · `chips` · `allin` · `street` · `win` · `turn` · `chat` (`.mp3`, `.wav` or `.ogg`)

Example: `public/sounds/win.mp3` replaces the win jingle.

## Playing against bots

- **Adding bots:** anyone seated at a table can use **Add bot** and **Remove bot**, for example to play alone or to fill a Durak game.
- **Clean-up:** bots leave automatically once no real player is left at the table. Players who stay disconnected for 3 minutes lose their seat between hands.
- **How bots play:** Each bot estimates its chance of winning by simulating the rest of the hand thousands of times. Bots only see their own cards and the board. Every bot gets a random style (tight, normal or wild), so they play differently.
- **Seats:** If the table is full of bots and a friend joins, a bot gives up its seat.
- **No humans, no new hands:** Bots won't start new hands when no human is connected.

## Coins 🪙

Coins are a play-money reward currency for accounts, separate from table chips. **They can't be bought with real money or cashed out.**

- **Welcome gift:** 200 coins for every new account.
- **Daily bonus:** 100 coins, plus 25 for each day in a row, up to 250 on day 7. Missing a day resets the streak.
- **Winning at tables:**
  - Hold'em win: 10 coins, plus up to 40 for big pots.
  - Blackjack win: 5 coins, plus up to 20.
  - Escaping in Durak: 15 coins.

  Table winnings are capped at 500 coins per day.
- **Free refill:** under 50 coins, claim 100 coins once every 4 hours.
- **High roller tables:** each game's second table. You need 500 coins to sit down. Stakes are 5× higher and coin rewards are doubled.
- **Shop:**
  - card backs and table felt colours, shown on your own screen;
  - name badges, which everyone at the table sees.

Wallet updates lock the wallet row, so a bonus or purchase can never be paid or charged twice.

## Odds window and hand rankings

- **📊 Odds** (key **O**) shows:
  - your chance to win the hand;
  - whether calling is worth the price;
  - which hand you're likely to end up with by the river.

  It's calculated in your own browser from only your cards and the board.
- **🏆 Hand rankings** (key **H**) lists every hand from best to worst with example cards, and highlights the hand you currently hold.

## Accounts and leaderboard

- **Accounts:** players can create an account (username + password) or play as a guest. Only accounts appear on the leaderboard.
- **🥇 Leaderboard** (key **L**) has two tabs:
  - **With friends:** hands with at least 2 people;
  - **Vs bots:** solo practice.

  Players are ranked by total chips won. Losses count, and rebuys don't hide them.
- **Passwords** are stored as scrypt hashes, never as plain text.
- **Storage:** accounts need a permanent database. On Render, the server's disk is wiped on every restart.
  1. Create a free Postgres database, for example at neon.tech.
  2. In Render, under Environment, add a variable named `DATABASE_URL` with the database's connection string.

  Without `DATABASE_URL`, accounts are saved to `data/db.json`. That's fine for local testing, but they're temporary on Render.

## Controls

- Keyboard shortcuts: **F** to fold, **C** to check or call, **R** to raise.
- If you refresh the page, you keep your seat.
- When you run out of chips, you get a free rebuy.

## Tests

```bash
npm test
```

The tests check hand rankings, the Omaha 2-card rule, and 900 simulated games for chip conservation.
