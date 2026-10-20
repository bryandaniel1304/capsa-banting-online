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

If you refresh or lose connection, you're asked first whether to continue at your table (**Lanjutkan** / **Tidak**). If your turn runs out (20 s), you auto-pass, or you play your lowest card when leading.
- **Tidak**: your hand is no longer played but still counts when the game ends. After that game, the remaining players choose to continue without you (you leave the table, and your points stay in the final settlement) or to end the session.
- Offline players never block the table: ending the session needs only the players who are online, and after a game the others can continue without them.

**Keluar Meja** asks whether you'll come back:
- **Keluar sementara** (back later): your seat, cards and points stay. Your turns are skipped (counted as a pass for that round) until you return. If you come back before being skipped in the current round you play on; otherwise you join in the next round. New games are dealt without you until you're back. The home screen shows **Kembali ke Meja**.
- **Keluar dari permainan**: your cards are no longer played but still count. The others are asked right away whether to continue without you or end the session (an unfinished game is then not counted).

The app starts with a loading screen (it also explains when the free server is waking up) and shows a spinner while tables load.
It reads the device it runs on (OS, phone / tablet / computer, notch safe-area, installed app, low-memory phones) and adapts:
the table stays inside the notch / home-indicator area, low-end phones get lighter effects, and the menu offers fullscreen or "add to home screen" where the device supports it.
Tip: on Android Chrome, "Add to Home screen" gives a fullscreen, landscape app.

## Accounts & saved history
Players sign up / log in with a username + password (hashed with scrypt). Every game is saved to the player's account:
sessions (table code, multiplier, date), who they played with, points per game, final rank and net amount.
Open **Riwayat Saya** on the home screen to see stats, friends played with, and per-game details.

Storage:
- **Local dev:** no setup. An embedded Postgres (PGlite) is stored in `~/.capsa-banting-online/`.
- **Production (Render):** set `DATABASE_URL` to a Postgres connection string (e.g. Supabase, free). Tables are created automatically on start.
  Render's free disk is wiped on every restart/deploy, so a real database is required online.

## Table rules & presets
Capsa Banting has many house-rule variants, so every table has its own rules (`shared/rules.js` → `DEFAULT_RULES`, `make(rules)`):
turn time, suit order (♦<♣<♥<♠ or ♣<♦<♥<♠), first lead must use the lowest card, winner opens the next game, pass locks you out
until the round ends, 2♠ plays again, dragon, *flush containing a 2 beats flushes without a 2*, *ceki duty* (the player right before someone on their last card must play their highest single, else +150 if that player wins next), and all scoring values
(win points, closing with a single 2, remaining-card tiers, points per 2 left, package bonuses).
- Only the player who **created** the table can change its rules, and only before the first game. Everyone can view them (📋).
- Rules can be **saved as presets** on your account and picked for the next table you create; **Aturan Default** is always available.
- **Aturan Tambahan** extend (never replace) the platform rules: written "cara main" notes shown to everyone in 📋, and named point items
  (e.g. "Tutup pakai As −15") that the table creator / host gives by hand on the result screen (✕ to undo). They count in the
  game points, the session total, the final settlement and the saved history, and are kept in presets.
- The **closing play** (Kartu penutup) of each game is shown on the result screen, in the table history and in Riwayat Saya.

## Players
Tap a player at the table to see their profile and stats, and add them as a friend (or accept / chat).

## Friends, chat, invites & voice
- **Profile picture:** tap your avatar on the home screen and pick an emoji or **📷 Pilih Foto dari Galeri**. The phone crops it square and shrinks it (192×192 JPEG, a few KB) before uploading; it shows at tables, in friends / online lists, history and profiles. Picking an emoji removes the photo.
- **Friends:** add by username (the other player accepts), remove anytime. Friends show live status: online, at a table, playing, or offline.
- **Invite:** from the 👥 Teman panel, invite an online friend, or anyone online in the **🌐 Pemain Online** tab (and add them as a friend), to your current table; they get a Gabung / Nanti popup.
- **Direct chat:** private messages between friends, saved in the database, delivered live with unread badges.
- **Table reactions:** type any message (up to 80 chars) or pick a quick phrase.
- **Voice chat:** tap 🎤 at the table to join, tap again to mute. Peer-to-peer WebRTC; the server only relays signaling.
  STUN alone only works when the players' networks allow a direct link (often the same Wi-Fi). On mobile data
  (carrier NAT) voice needs a **TURN relay**. Set one of these on the server (Render → Environment):
  - **Metered** (free tier): `METERED_DOMAIN` (e.g. `yourapp.metered.live`) + `METERED_API_KEY`
  - **Cloudflare** (free tier): `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN`
  - or `ICE_SERVERS`: a JSON array of ICE servers from any TURN provider
  The table menu shows `voice: TURN ✓` once it's active, plus each voice connection's state.
  Voice needs `https://` (not a LAN IP address) and works best in Chrome / Safari rather than in-app browsers.
- **Arrange cards:** press and slide a card sideways to move it; tap to select; ⇅ auto-sorts by rank / suit.

## Project layout
- `server.js`: authoritative game server (Express + Socket.IO). Hands are never sent to other players.
- `auth.js`, `store.js`: account API (signup/login/history) and database layer.
- `shared/rules.js`: card ranking, combination evaluation, hints and bot logic (shared with the browser).
- `public/`: the mobile web client (`index.html`, `style.css`, `client.js`).
- `test/sim.js`: rules unit checks plus a full multiplayer simulation (`npm test`).
## Android app (`app/`)
A Capacitor 8 shell (targets Android 16 / API 36, as Google Play requires) that opens the live server full screen in
landscape (mic allowed for voice chat, screen stays on, offline page with auto-retry). Because it loads the server URL,
every Render deploy reaches the app without a new release.
```
cd app
npm install
npm run icons      # only after changing make-icons.js
npm run apk        # debug APK  -> android/app/build/outputs/apk/debug/
npm run aab        # Play Store -> android/app/build/outputs/bundle/release/app-release.aab
npm run store      # Play listing images -> ../store/
```
Needs **JDK 21** (`JAVA_HOME`) and the Android SDK (`ANDROID_HOME`). Release builds are signed with the upload key from
`app/android/keystore.properties` (not in git):
```
storeFile=C:/path/to/capsa-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```
On Windows, if Gradle fails with "Unable to establish loopback connection", set `TEMP`/`TMP` to a short path such as `C:	mp`.
Play Console answers, listing text and release steps: [store/PLAY-STORE.md](store/PLAY-STORE.md).

## Safety & accounts (Play Store policies)
- Players can **block** (no friend requests, invites or DMs; their table chat is hidden) and **report** others from the profile popup.
  Recent table chat of the reported player is attached for review.
- Moderators are the usernames in `ADMIN_USERNAMES` (comma separated): they get **🛡️ Laporan** on the home screen to resolve
  reports and ban accounts (signed out everywhere, login refused).
- Accounts can be **deleted** in the app (🗑️ Hapus akun) or on `/hapus-akun`. Other players' history keeps the rows as "Akun dihapus".
- `/privasi` and `/ketentuan` show the privacy policy and terms; `CONTACT_EMAIL` is the contact shown on them.
- Points have no money value: the final screen shows point differences only.
