# Let Him Rook

**Let Him Rook** is a 3D gesture-controlled chess and real-time spell-duel game built with **TypeScript, React Three Fiber (Three.js), MediaPipe Vision (`HandLandmarker` + `PoseLandmarker`), `chess.js`, and WebSockets**.

Every non-capture move plays out on a 3D tabletop chessboard. Whenever a piece attempts a capture, the board freezes and the two pieces drop into a **real-time 20 Hz 3D arena duel** right on the tabletop—dodging obstacles via upper-body torso lean and unleashing class-specific signature abilities via physical hand and arm gestures.

---

## Quick Start

Requires **Node.js 24+** and a modern browser with WebGL2 (`Chromium 120+` recommended for webcam MediaPipe WASM SIMD).

```sh
npm install
npm run dev
```

 Then open **`http://localhost:5173`** in your browser.

### Other Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Launches both the 3D authoritative server (`:3001`) and Vite 3D frontend (`:5173`) |
| `npm start` | Builds `apps/web/dist` and serves the full 3D game + WebSocket server on `http://localhost:3001` |
| `npm run host` | Hosts LAN PvP from this laptop over HTTPS on port 3001 (see below; macOS + Windows) |
| `npm run dev:server` | Runs only the 3D WebSocket server (`apps/server/src/index.ts`) with watch mode |
| `npm run dev:web` | Runs only the Vite 3D frontend (`apps/web`) on `http://localhost:5173` |
| `npm test` | Runs unit, integration, and end-to-end tests |
| `npm run typecheck` | Typechecks `packages/shared`, `apps/server`, and `apps/web` |
| `npm run build` | Runs full TypeScript verification and builds the production 3D web bundle |

### Two-laptop LAN PvP playtest

Works the same on macOS and Windows. Only the **host** laptop needs Node.js 24+ and this repo; the guest only needs a browser (Chrome, Edge, Safari, or Firefox). Both laptops must be on the same network.

On the host, at the repository root:

```sh
npm install
npm run host
```

This builds the game, creates a self-signed HTTPS certificate for the host's current LAN address (saved in the git-ignored `certs/` folder, no mkcert/openssl needed), and serves the page and game server on one port: `https://<host-lan-ip>:3001`. The terminal prints the exact address.

1. The host opens the printed link, clicks **Create PvP Duel Room**, then **🔗 Copy invite link** and sends it to the guest. The guest opens the link and joins automatically. (Typing the six-character room code into **Join** also works.)
2. Each browser warns about the self-signed certificate the first time. Click **Advanced → Proceed** (Chrome/Edge) or **Show Details → visit this website** (Safari). Webcam gestures work after that, because the page is served over HTTPS.
3. Both players calibrate or choose **Skip to Match**. Mouse clicks move chess pieces; WASD or arrow keys move during duels, Space uses the primary ability, and Shift holds a Pawn parry.

If the guest can't connect:
- **Firewall:** allow Node.js to accept incoming connections when the OS asks. On Windows, tick **Public networks** too; eduroam and most campus Wi-Fi are classified as Public.
- **Campus network isolation:** some eduroam networks block traffic between devices ("client isolation"). If the link never loads on the guest even with the firewall open, connect both laptops to a phone hotspot and run `npm run host` again.
- **Port:** use another port with `PORT=4000 npm run host` (Windows PowerShell: `$env:PORT=4000; npm run host`).

**Hand/pose tracking on Apple Silicon Macs (CoreML, Neural Engine).** `npm run host` also starts a native vision helper (`apps/vision-native`) that runs MediaPipe's hand and pose models as CoreML on the Neural Engine and streams landmarks to the browser on `ws://127.0.0.1:3101`, so no MediaPipe runs in the browser (about 7–12 ms per frame vs 40–55 ms in-browser on an M1). The first run creates `apps/vision-native/.venv` and installs its Python packages (needs Python 3.11–3.13, e.g. `brew install python@3.13`). macOS asks to allow camera access for your terminal app the first time; allow it (System Settings → Privacy & Security → Camera) and restart. **The guest Mac runs `npm run vision`** (helper only) and then opens the host's invite link, so each player is tracked by their own Mac. If no helper is running, the browser falls back to in-browser MediaPipe automatically. `ROOK_CAMERA=1 npm run host` picks another camera; `--no-vision` skips the helper.

`npm run host -- --no-build` skips the build when nothing changed. The host laptop must stay awake and running because rooms are stored in its server memory. On a disconnect during a match, the game pauses and the player has 30 seconds to reconnect (re-opening the same tab resumes the session) before a forfeit.

---

## Monorepo Architecture

```text
Let-Him-Rook/
├── packages/
│   └── shared/                 # @let-him-rook/shared — Protocol, types, constants, 3D coordinate math
├── apps/
│   ├── server/                 # @let-him-rook/server — Authoritative Node.js WebSocket server, chess.js adapter, 20Hz duel sim, Bot & AI advisor
│   └── web/                    # @let-him-rook/web — React 18 + React Three Fiber 3D client, MediaPipe Web Worker, calibration & gesture FSMs
└── tests/
    ├── unit/                   # Chess adapter, 20Hz duel simulator, and gesture state machine unit tests
    ├── integration/            # Multiplayer WebSocket room, turn, duel, and 30s reconnect integration tests
    └── e2e/                    # Full solo vs. bot and 2-player PvP capture-duel match flow tests
```

---

## How to Play

### 1. Lobby & Game Modes
- **Practice vs Bot (Solo)**: Play immediately as White against the server-side autonomous Bot (which plays chess moves and fights 3D duels as Black).
- **Create PvP Duel Room**: Creates a 6-character room code as White. Share the code with a second player (or open a second browser tab/window) to join as Black.

### 2. Vision & Gesture Calibration
When you join a room, the **Vision & Gesture Calibration** overlay opens with a live mirrored webcam preview and real-time skeleton/hand overlay:
1. **Step 1 — Body and Pinch Calibration**: After a three-second preparation countdown, stand inside the body outline for five seconds. Hold one hand open for the first half, then touch thumb and index finger together for the second half. Keep your stance steady throughout.
2. **Step 2 — Movement and Ability Gesture Sandbox**: Practice stepping in each direction, returning to neutral, and testing the six piece abilities. Adjust each movement direction's trigger distance or recenter your stance for this room before clicking **I'm Ready — Enter 3D Match!**.
- *No webcam?* Click **Skip to Match** to play using mouse clicks on the 3D chessboard and `WASD` + `Spacebar` / `Shift` dev controls during duels.
- During a match, a collapsible **Picture-in-Picture (PiP) camera monitor** in the bottom-right corner displays your live pose/hand tracking and FPS, and you can click **📷 Calibrate** in the top bar between duels to recalibrate anytime.

### 3. Chessboard Controls (`chess_turn`)
- **Webcam Gesture**: Point with your index fingertip (`landmark 8`) over the middle 80% of the camera frame to highlight a square (`hoverSquare`). **Pinch** thumb and index finger to pick up a piece, move to a legal green destination dot, and **release** to commit the move. Hold an **upright open palm** for 4 frames to cancel your current selection.
- **Mouse Fallback**: Click any friendly piece with legal moves, then click a highlighted green destination square.
- **Pawn Promotion**: Advancing a Pawn to the 8th/1st rank opens the 4-choice **Promotion Modal** (`Queen`, `Rook`, `Bishop`, `Knight`), selectable via fingertip pinch or click before the move (or capture duel) is submitted.

---

## Chess Rules & Custom Capture Resolution

- Authoritative move validation via `chess.js`, including **check, checkmate, stalemate, castling, en passant, and 4-choice promotion**.
- **Non-capture moves** apply immediately on the board.
- **Capture moves** freeze the board and launch a real-time 3D duel (`duel_intro` → `active_duel` → `duel_result`):
  - **Attacker Wins**: The capture (and any pending Pawn promotion) is committed on the chessboard, and the turn passes to the defender's side.
  - **Defender Wins**: The attacking piece is **destroyed and removed from its origin square**, the defending piece survives on its square, castling rights update accurately if a home-square Rook was lost, and the turn passes to the defender's side.
  - **King Duel Rule**: Kings are never captured without a fight, but if a King initiates a capture duel and loses, that King's side immediately loses the match (`king_duel_lost`).
  - **Discovered-Check King Safety Rule**: If an attacking piece loses a duel and its removal exposes its own King to a discovered attack as the turn passes to the defender, the defender immediately wins the match (`king_exposed_after_failed_capture`).
  - **Duel Timeout (90s)**: Higher remaining HP wins the duel; exact equal HP ends the match in a draw (`duel_timeout_tie`).

---

## 3D Tabletop Arena & Obstacles

- **Chessboard Footprint**: `8×8` world units (`[-4, 4]` on X and Z, `1.0` unit per square).
- **Tabletop Boundary**: `14×14` world units (`[-7, 7]` on X and Z), enforced as a hard server-side perimeter with a glowing blue boundary rail.
- **Spawns & Clear Fighting Lane**: Fighters spawn `5.0` units apart facing each other around the contested capture midpoint, with a `2.5`-unit clearance radius that temporarily hides adjacent board pieces for the duel so neither fighter starts boxed in.
- **Destructible Obstacles (3 Hits / 75 HP)**:
  - All remaining non-dueling chess pieces outside the `2.5u` spawn clearance plus **4 fixed outer-tabletop props** (2 translucent tumbler glasses at `(-5.5, -5.5)` / `(5.5, 5.5)` and 2 ceramic plant vases at `(-5.5, 5.5)` / `(5.5, -5.5)`).
  - Obstacles block projectiles and break after **3 hits** for the remainder of that duel (collateral damage in a duel never removes non-dueling pieces from the actual chess game).

---

## Class Abilities & Gesture Controls (100 HP Baseline)

Every fighter enters each duel with **100 HP** and moves at **3.5 units/sec** while auto-facing their opponent.
- **Movement**: Stand with face and shoulders visible. Calibrate your neutral stance, then step forward/back to advance/retreat and sideways to strafe; return to neutral to stop (or use `WASD` / Arrow keys in Dev Mode). Tracking loss `> 300 ms` automatically halts movement velocity.

| Class | Gesture | Ability & Balance Tuning |
| --- | --- | --- |
| **♙ Pawn** | **Sweep right wrist** horizontally across chest<br>**Hold left upright open palm** | **Slash**: `18 dmg` melee arc (`2.2u` range, `120°` arc, `1.2s` CD)<br>**Parry**: Blocks `100%` of incoming damage for up to `1.0s` while held (`3.0s` CD after release) |
| **♖ Rook** | **Extend right arm** straight forward (drop arm to re-arm) | **Cannon Shot**: `16 dmg` fast projectile (`10 u/s`, `1.5s` CD)<br>**Cannon Bomb**: Every **3rd accepted shot** fires an AoE bomb dealing `28 dmg` in a `2.0u` splash radius |
| **♘ Knight** | **Cross forearms** at chest, then **rapidly separate** horizontally | **Teleport Cleave**: Teleports up to `4.5u` to land `1.5u` in front of opponent + `0.35s` windup + `24 dmg` slash (`2.5u` radius, `4.5s` CD). Fails safely without consuming CD if blocked or out of range |
| **♗ Bishop** | **Cock right hand** near right shoulder, then **thrust forward** | **Ice Bolt**: `14 dmg` frost projectile (`8 u/s`, `2.5s` CD). Opponent hit applies `4.0s` chill (`40%` slow + `3 dmg/s` DoT). Obstacle hit freezes obstacle for `4.0s` and spawns a `1.5u` ice puddle (`40%` slow + `3 dmg/s` DoT) |
| **♕ Queen** | **Raise both open palms** to shoulder height and **push forward** | **Seeking Volley**: Fires `3` homing arcane orbs (`-18°, 0°, +18°`, `3 × 9 = 27 dmg`, `7 u/s`, `3.5s` CD). Each orb deals `1` hit to obstacles, breaking a 3-hit obstacle in one full volley |
| **♔ King** | **Clasp both hands** at chest center and **hold for 0.4s** | **Royal Summon**: Spawns `1` random ally (`Pawn`, `Rook`, `Knight`, `Bishop`, or `Queen`; `1 HP`, `12s` duration, `6.0s` CD). Summons **stack** — a new ally doesn't wait for the previous one to die — up to `10` summons per duel. Each ally approaches the enemy and attacks every `2.0s` for `75%` of that class's base damage |

---

## WebSocket Protocol (`/ws`)

The server (`apps/server`) and web client (`apps/web`) communicate over `/ws` using strictly validated JSON messages defined in `@let-him-rook/shared`:

- **Client → Server (`ClientMessage`)**:
  - `create_room` (`{ mode?: 'pvp' | 'bot' }`)
  - `join_room` (`{ roomId: string }`)
  - `reconnect_room` (`{ roomId: string, token: string }`) — restores session within a `30s` disconnect grace window
  - `calibration_ready` (`{ ready: boolean }`)
  - `chess_move_intent` (`{ from, to, promotion?, actionId }`)
  - `duel_move_intent` (`{ moveX, moveZ, actionId }`)
  - `duel_ability_intent` (`{ ability, parryHolding?, actionId }`)
  - `request_ai_advice` (`{}`)
  - `ping` (`{ timestamp }`)
- **Server → Client (`ServerMessage`)**:
  - `room_joined` (`{ roomId, color, token, mode }`)
  - `snapshot` (`{ snapshot: MatchSnapshot }`) — monotonic `revision`, broadcasted on board updates and at `20 Hz` (`50 ms`) during active duels
  - `duel_events` (`{ events: DuelEvent[] }`) — combat telemetry for VFX (`projectile_spawn`, `projectile_hit`, `melee_hit`, `parry_blocked`, `teleport`, `obstacle_damage`, `obstacle_broken`, `ice_hazard_spawn`, `summon_ally`, `duel_end`)
  - `action_feedback` (`{ actionId, accepted, reason? }`)
  - `ai_advice` (`{ advice: string }`)
  - `error` (`{ code, message }`)
  - `pong` (`{ timestamp }`)
