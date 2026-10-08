# Capsa Banting Online

A mobile-web remake of the Capsa Banting room you play on ZingPlay, so you can play with friends instead of strangers.
2-4 players per table with real-time multiplayer, room codes and invite links, bots for empty seats, and virtual chips only (no real money).

The rules follow the in-app "Aturan Banting Pro" screen recorded from ZingPlay:
- 13 cards each. Ranks 3 < ... < A < 2, suits ♦ < ♣ < ♥ < ♠.
- Combinations: single, pair, three of a kind, and 5-card hands. 5-card hands rank Urutan < Flush < Full House < Empat Kembar < Straight Flush < Royal Flush. A 2 can't be part of a straight.
- The holder of the lowest card leads the first game and must play that card. After that, the previous winner leads.
- Play goes counter-clockwise. Passing (**Lewat**) locks you out until the round resets.
- Payout = penalty points × stake. Each card left costs 1 point (1-8 cards), 2 points (9-12 cards) or 3 points (13 cards).

## Play locally / on your Wi-Fi

```bash
npm install
npm start
```

Open `http://localhost:3000`. Friends on the same Wi-Fi can open `http://<your-PC-IP>:3000`.

## Host it online (free)

### Option A: Render.com (recommended, free)
1. Push this folder to a GitHub repo.
2. On https://render.com, choose New → Blueprint and pick the repo. `render.yaml` sets everything up.
3. Share the `https://<name>.onrender.com` URL. Free instances sleep after ~15 minutes idle, so the first load takes ~30 s.

### Option B: Railway / Fly.io / any Docker host
There's a `Dockerfile`. Railway: New Project → Deploy from GitHub. Any host that runs Node 18+ with WebSockets works (`npm start`, uses `PORT`).

### Option C: Instant share from your PC (no account)
```bash
npm start
npx cloudflared tunnel --url http://localhost:3000
```
This prints a public `https://*.trycloudflare.com` link. It works while your PC is on.

## How to play with friends
1. Enter a name, pick a stake room (Peasant 40K / Merchant 200K / Tycoon 1M / Raja 5M), and a table is created.
2. Tap **Undang** to share the link, or tell friends the 5-letter table code.
3. As host, fill empty seats with **+ Bot** if you like, then tap **Mulai Main**.
4. Select cards by tapping (or dragging across them), or tap a suggestion chip; tap it again to play. Use **Buang** to play and **Lewat** to pass. ⇅ sorts by rank or suit.
5. After each game everyone taps **Lanjut Main**, and the next game starts automatically.

If you refresh or lose connection you go back to the same seat. If your turn runs out (20 s), you auto-pass, or you play your lowest card when leading.
Tip: on Android Chrome, "Add to Home screen" gives a fullscreen, landscape app.

## Accounts & saved history
Players sign up / log in with a username + password (hashed with scrypt). Every game is saved to the player's account:
sessions (table code, multiplier, date), who they played with, points per game, final rank and net amount.
Open **Riwayat Saya** on the home screen to see stats, friends played with, and per-game details.

Storage:
- **Local dev:** no setup. An embedded Postgres (PGlite) is stored in `~/.capsa-banting-online/`.
- **Production (Render):** set `DATABASE_URL` to a Postgres connection string (e.g. Supabase, free). Tables are created automatically on start.
  Render's free disk is wiped on every restart/deploy, so a real database is required online.

## Friends, chat, invites & voice
- **Friends:** add by username (the other player accepts), remove anytime. Friends show live status: online, at a table, playing, or offline.
- **Invite:** from the 👥 Teman panel, invite an online friend to your current table; they get a Gabung / Nanti popup.
- **Direct chat:** private messages between friends, saved in the database, delivered live with unread badges.
- **Table reactions:** type any message (up to 80 chars) or pick a quick phrase.
- **Voice chat:** tap 🎤 at the table to join, tap again to mute. Peer-to-peer WebRTC; the server only relays signaling.
  STUN is used by default. Some mobile networks need a TURN relay. Set `ICE_SERVERS` to a JSON array of ICE servers
  (e.g. from a TURN provider) to enable it.
- **Arrange cards:** press and slide a card sideways to move it; tap to select; ⇅ auto-sorts by rank / suit.

## Project layout
- `server.js`: authoritative game server (Express + Socket.IO). Hands are never sent to other players.
- `auth.js`, `store.js`: account API (signup/login/history) and database layer.
- `shared/rules.js`: card ranking, combination evaluation, hints and bot logic (shared with the browser).
- `public/`: the mobile web client (`index.html`, `style.css`, `client.js`).
- `test/sim.js`: rules unit checks plus a full multiplayer simulation (`npm test`).