# Poker Night

Play poker with friends in the browser, using play money only.

**Games:** Texas Hold'em (No Limit), Omaha (Pot Limit), 5-Card Omaha (Pot Limit), or rotate between them each hand.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, create a room, and send friends the invite link.

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

- **Practice vs bots:** On the start screen, pick how many bots you want and click **🤖 Practice vs bots**. The table fills with bots and the first hand is dealt right away.
- **Bots in a room with friends:** The host can use **Add bot** and **Remove bot** in the host controls at any time.
- **How bots play:** Each bot estimates its chance of winning by simulating the rest of the hand thousands of times. Bots only see their own cards and the board. Every bot gets a random style (tight, normal or wild), so they play differently.
- **Seats:** If the table is full of bots and a friend joins, a bot gives up its seat.
- **No humans, no new hands:** Bots won't start new hands when no human is connected.

## Odds window and hand rankings

- **📊 Odds** (key **O**) shows:
  - your chance to win the hand;
  - whether calling is worth the price;
  - which hand you're likely to end up with by the river.

  It's calculated in your own browser from only your cards and the board. The host can turn it off for everyone with **Allow odds window**.
- **🏆 Hand rankings** (key **H**) lists every hand from best to worst with example cards, and highlights the hand you currently hold.

## Controls

- Keyboard shortcuts: **F** to fold, **C** to check or call, **R** to raise.
- If you refresh the page, you keep your seat.
- When you run out of chips, you get a free rebuy.
- The host picks the game, blinds and starting stack.

## Tests

```bash
npm test
```

The tests check hand rankings, the Omaha 2-card rule, and 900 simulated games for chip conservation.
