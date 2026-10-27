# Let Him Rook

**Plan your move. Fight for the capture.**

Let Him Rook is a multiplayer 3D chess variant built for HackTX 2026. An attempted capture starts a real-time arena battle controlled through your webcam. Your strategy earns the opportunity; your fighting decides whether the capture succeeds.

The idea is to make chess a shared, physical experience: friends can play apart, move around, laugh at unexpected battles, and build a friendly rivalry. Even a pawn gets a chance to fight back.

**[Play at pawnhub.tech](https://pawnhub.tech)**

## How it works

- Play a friend online, practice against a bot, or test individual matchups in Sandbox Mode.
- Move pieces on an 8x8 chessboard. Non-capture moves work normally; captures launch a duel in a 22x22 castle arena with trees, ruins, tunnels, slowing puddles, and destructible cover.
- Each fighter starts a duel with 100 HP. If the attacker wins, it takes the defender's square. If the defender wins, the attacker is removed and the defender stays. The turn then passes to the defender's side.
- Duels last up to 60 seconds. At timeout, higher remaining HP wins; equal HP ends the match in a draw. Standard movement, check, checkmate, castling, en passant, and promotion are supported, with extra rules for failed captures: losing an attacking king or exposing your own king by losing an attacker ends the match.
- **AI Advice** requests game-state-based advice and friendly commentary from Muse Spark when configured. **Fight notes** separately use recorded combat events to show results, mistakes, and suggestions; the recent fight journal stays in your browser.

## Play with a webcam

1. Open the website and create a PvP room, join with a room code, or choose a solo mode. For PvP, send your friend the invite link or six-character room code.
2. Allow camera access. Keep your face, shoulders, and hands visible in good light.
3. Start calibration. After the preparation countdown, keep your left hand open with all five fingers facing the camera. Open your right hand for the first half of the five-second capture, then pinch its thumb and index finger together for the second half.
4. Use the gesture sandbox to test movement and attacks, adjust sensitivity, and enter the match. You can reopen **Calibrate** between duels.
5. On the board, pinch to grab a piece, move to a highlighted legal square, and release. An upright open palm cancels a selection. Mouse clicks also work.
6. In combat, move your upper body left/right to strafe and forward/back relative to your calibrated stance to advance/retreat. Return to neutral to stop. Keep your left hand open and tilt it left/right to turn your view; use your right hand for attacks.

| Piece | Gesture | Ability |
| --- | --- | --- |
| Pawn: sword and shield | Quickly sweep your right wrist; hold a stationary open right palm to block | Sword slash and a temporary parry |
| Rook: marksman | Extend your right arm forward, then lower/bend it to re-arm | Rifle shot; every third accepted shot uses a handheld cannon with splash damage |
| Knight: mounted rider | Raise your right hand above your shoulder, then chop down | Short teleport/dash followed by a spear-thrust/cleave animation |
| Bishop: ice witch | Bring your right hand near your shoulder, then thrust forward | Ice bolt that chills enemies or freezes obstacles and creates an ice hazard |
| Queen: fire wizard | Raise an open right palm near shoulder height, then lower it to re-arm | Three seeking fireballs |
| King: elder summoner | Hold a closed right fist near the center of your chest, then move it away to re-arm | A blue ally clone; summons stack, up to ten per duel |

No webcam? Choose **Skip to Match** and use the mouse for chess. During duels, use **WASD/arrow keys** to move, **Q/E** to turn, **Space** for your ability, and **Shift** to hold the pawn's parry. The small camera panel shows tracking FPS and can be hidden.

## Run locally

Requires **Node.js 24+**, npm, and a modern browser with WebGL2. Webcam access needs localhost or HTTPS.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. This starts both the web client on port 5173 and the game server on port 3001. Running only `dev:web` does not start the backend.

| Command | Purpose |
| --- | --- |
| `npm run dev:server` / `npm run dev:web` | Run either development process separately |
| `npm start` | Build and serve the production app at http://localhost:3001 |
| `npm run build` | Typecheck and build the web client |
| `npm test` | Run unit, integration, and game-flow tests |
| `npm run host` | Build and host a local HTTPS multiplayer server |

### Two laptops on the same network

On the host laptop, run `npm run host`, open the printed HTTPS address, create a room, and share its invite link. The guest needs only a browser. Accept the local self-signed certificate warning on each laptop before using the camera.

Keep the host running. If the guest cannot connect, check the host firewall; campus networks such as eduroam may isolate devices, so try a shared hotspot. `npm run host -- --no-build` reuses an existing build. A disconnected player has a 30-second reconnect window before forfeiting; rooms are held in server memory and disappear when it restarts.

### Optional Apple Silicon tracking

On Apple Silicon Macs, `npm run host` also attempts to start a local Python/CoreML vision helper. It needs Python 3.11-3.13 and terminal camera permission; the first run installs its Python dependencies. A guest Mac can run `npm run vision` from its own checkout. Without the helper, tracking uses browser MediaPipe. Use `npm run host -- --no-vision` to skip the helper.

## Enable Muse AI advice

Copy `.env.example` to `.env` in the repository root and set `META_API_KEY`. On Windows, use `Copy-Item .env.example .env`; on macOS/Linux, use `cp .env.example .env`. Restart the server after changing configuration.

For a hosted deployment, set `META_API_KEY` in the server's environment settings and redeploy/restart. The key stays on the server. Optional `AI_BASE_URL` and `AI_MODEL` override the provider defaults; `AI_API_KEY` is an alternative key variable.

Once in a room, click **AI Advice** in the top bar. If it says **AI Advice Off**, enable it first, then click again to request advice. Advice can be dismissed or turned off. Missing keys, failed requests, or timeouts use built-in advice instead; AI never controls game rules or outcomes.

## Under the hood

- **Web:** React, TypeScript, Three.js/React Three Fiber, and Vite, with procedural character models and combat animations.
- **Tracking:** MediaPipe hand and pose models in a Web Worker; camera frames are processed locally rather than streamed to the opponent. An optional native CoreML helper supports Apple Silicon.
- **Server:** Node.js, a custom TypeScript chess engine, and WebSockets. The server validates moves, abilities, cooldowns, collisions, and damage, with a 60 Hz simulation and client-side movement prediction.
- **Shared rules:** `packages/shared` contains message types, combat settings, arena geometry, and coordinate helpers used by both sides.
- **Feedback:** optional Muse Spark advice plus local, event-based fight reviews. The hosted game runs on Vultr at the project's .tech domain.

This is a hackathon prototype. Tracking quality depends on lighting, framing, browser, and hardware; use calibration, the practice modes, or keyboard controls when needed.

## Developers

- **Johnny (Dong Quan) Tran** - [dongquan.tran.johnny@gmail.com](mailto:dongquan.tran.johnny@gmail.com)
- **Vu Quang Minh Le** - [minh.levuq@gmail.com](mailto:minh.levuq@gmail.com)

<!-- Team members: add your name and preferred contact link above. -->
