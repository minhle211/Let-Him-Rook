# Let Him Rook

A two-player chess variant: captures start real-time spell battles. Includes a simple mouse-controlled test screen; webcam controls are next.

## Run

Requires Node.js 24+.

```sh
npm install
npm start
npm test
npm run typecheck
```

On PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

## Play on one laptop

1. Run `npm start` and open `http://localhost:3001`.
2. Click **Create room · White**, then **Open join tab**.
3. In the new tab, click **Join · Black**. Each tab controls one side.
4. Click a piece and then a marked square to move. Black sees the board from Black's side.
5. For a quick battle: White plays **e2 → e4**, Black plays **d7 → d5**, then White plays **e4 → d5**.
6. Use **Attack**, **Shield**, and **Special** in each tab during battle.

Refresh keeps that tab's player session. Live updates reconnect automatically after a dropped connection. **Back to lobby** forgets the tab's session; it does not free its seat in the old room. Create a new room for a fresh game. Place the tabs in separate windows side by side to see both players at once.

## Play over Wi-Fi

The server listens on all network interfaces on port 3001 (`PORT` overrides it).
On the host laptop, run `ipconfig` to find its Wi-Fi IPv4 address. Both laptops can reach `http://<host-ip>:3001/health` on the same network. Windows may ask to allow Node through the firewall; use the private network option. Some guest Wi-Fi networks block connections between laptops; use a private hotspot if needed.

## Rules

- Standard piece movement, without check, checkmate, castling, or en passant.
- White starts. Capturing a king wins, including defeating an attacking king.
- Capture attempts start a battle and block board moves until it ends.
- Attacker wins: replaces defender. Defender wins: stays, attacker disappears.
- The other player's board turn follows every battle, regardless of winner.
- Health persists. Pawns automatically promote to queens, keeping their health and maximum health.
- Rooks have 140 HP, pawns 80 HP, other pieces 100 HP.
- Attack: 25 damage, 700 ms travel time, 1200 ms cooldown.
- Defense: absorbs up to 30 damage for 1000 ms, 1800 ms cooldown.
- Special: empowers the next attack to 40 damage; rook instead gets a 60-point shield for 1600 ms. Special cooldown is 5000 ms. Empowerment does not stack.
- Shields replace existing shields. Buffs and cooldowns reset between battles.
- Battles end after 60 seconds: higher remaining HP percentage wins, ties favor the defender.
- Spells use server receipt order and server time. Already-arrived projectiles resolve before a new spell. If lethal projectiles arrive together, the first accepted attack resolves first.

These balance values and timeout rules are provisional.

## API

JSON over HTTP for commands; server-sent events (SSE) for live snapshots. The server owns all game state. Cameras and gesture recognition will stay on each laptop.

| Request | Body | Result |
| --- | --- | --- |
| `GET /health` | — | Server health |
| `POST /rooms` | `{}` | Room code, white player token, snapshot |
| `POST /rooms/:id/join` | `{}` | Black player token, snapshot |
| `GET /rooms/:id` | — | Current snapshot |
| `GET /rooms/:id/events` | — | Live snapshot stream |
| `POST /rooms/:id/move` | `{"from":12,"to":28,"revision":0}` | Updated snapshot |
| `POST /rooms/:id/cast` | `{"battleId":"...","commandId":"unique-id","spell":"attack"}` | Updated snapshot |

All room endpoints except create/join require `Authorization: Bearer <player-token>`. Keep tokens private and retain them to reconnect. SSE should use streaming `fetch` so the browser can send this header. Serve the future UI from the backend origin or use a development proxy.

Squares are integers: `a1=0`, `h1=7`, `a2=8`, `a8=56`, `h8=63`. Snapshots include `serverTime`, `ready`, `legalMoves` (square number to destination list), and `game`; game includes `board`, `turn`, `phase`, `battle`, `winner`, and `revision`. Both players must join before moving. Each board entry is a piece or `null`.

Moves require the current revision; stale commands return HTTP 409 with a fresh snapshot. Spells use the current battle ID and a unique command ID; retry the same ID to avoid casting twice. They do not require a revision, so simultaneous casts can both succeed. Valid spells: `attack`, `defense`, `special`. An invalid command returns 400, missing credentials 401, full room 409. Reconnect to the event stream to receive a full snapshot.

## AI extension

`src/ai.ts` defines an optional provider interface for position explanations. It receives a copied game state and has a five-second timeout. No provider, endpoint, paid call, or credentials are configured yet. AI never decides legal moves or battle outcomes. Add the hackathon provider once available; keep its API key on the server.

## Current limits

Rooms live in memory and disappear on restart. Disconnected players can reconnect with their token; their battle keeps running. Board turns have no timeout yet. Empty connections do not forfeit a game. Rooms with no event streams expire after two hours of inactivity. This is a trusted-LAN prototype, not a public deployment with accounts, TLS, and abuse protection.

Next: webcam tracing and gesture recognition, then the final UI. The test screen uses plain browser JavaScript with no frontend build step.

## Webcam spell drawing

Restart the server after this update, then refresh the browser. The **Spell practice** pad works before joining a room.

- Click **Enable camera**, allow access, and show one hand. Open your thumb and index finger first.
- Pinch thumb and index finger, move your index fingertip to draw, then release.
- Straight line in any direction: attack. Circle either direction: shield. Upright Z (or traced backwards): special.
- Practice is the default. Check **Cast spells during battle** to send recognized spells to the current battle. Server cooldowns still apply.
- With the camera off, drag on the pad to test the same recognizer using your mouse.
- Tracking gaps up to 300 ms preserve the stroke; longer gaps, switching tabs, or a changed battle cancel it. Open your fingers for 120 ms to finish a stroke. Wide and tall Z shapes are supported. Stop camera releases the webcam.
- Use the camera in just one tab when testing on one laptop. The other player can use spell buttons.
- Camera use requires localhost or HTTPS. Plain HTTP over a LAN IP supports the game but not webcam access; HTTPS setup is needed for the second laptop.
- MediaPipe 0.10.14 and its model load from jsDelivr/Google on first use; internet is currently required. No video is uploaded. Tracking runs in a worker.
- Recognition thresholds are provisional and need real-camera testing. Board gestures are available; menu gestures are available in Menu hands mode.

Hand tracking reference: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js

The camera panel shows rolling one-second camera FPS, tracking FPS (completed hand checks), worker detection time, hand/pinch state, and hand-loss episodes since camera start. Camera FPS measures presented video frames; unsupported browsers show N/A. Tracking FPS counts checks even when no hand is found. Counters pause in hidden tabs; restarting the camera resets the drop count. This monitor helps diagnose drops but does not change recognition thresholds.

## Hand-controlled board moves

Enable the camera and check **Hand-controlled moves** above the board. The middle 80% of the camera view maps to the board, mirrored like the practice pad. Both White and Black see their own board orientation.

Open your thumb and index finger first. Point at your piece, pinch to grab, move to a marked square, and open your fingers to release. A white outline marks the target; legal destinations and the held piece are highlighted. Small border jitters keep the current square. The target freezes while the pinch release is confirmed, so opening your fingers does not shift the target.

Release on an illegal square or outside the control area to cancel. Long tracking loss, turning off the camera, switching tabs, or a changed turn/connection also cancels a grab. Short tracking gaps keep the grab without moving it. Mouse controls remain available.

During battles, the camera returns to spell drawing. Enable **Cast spells during battle** to send those spells; otherwise the spell pad stays in practice mode. Board control resumes on the next board turn. Use Menu hands mode for menu buttons.

## Hand-controlled menus

Enable the camera with the mouse first (browser permission still requires confirmation), then turn on **Menu hands** in the floating bar. The middle 80% of the mirrored camera view maps to the visible browser window. Point at an outlined button, make a short pinch, and release on the same button to confirm. Moving off the button, holding longer than 1.5 seconds, or losing hand tracking cancels the press.

Create rooms, use the hex keypad to enter a room code, join, toggle board/live-spell controls, return to the lobby, or stop the camera. Use **Up** and **Down** to scroll. The open-join-tab link still uses the mouse because browsers can block gesture-triggered popups.

Menu mode pauses board and spell gestures. Pinch **Menu hands: on** to turn it off and resume play. Menu presses have a short cooldown to prevent duplicate clicks. Turn the camera on again with the mouse after stopping it.

## Solo practice bot

Restart the server, refresh, and choose **Practice vs bot** (also available through hand-controlled menus). You play White, and the server controls Black. No second tab or API key is needed. Mouse, board gestures, and spell gestures work as before. Enable **Cast spells during battle** for camera spells.

The bot waits one second before board moves and 1.5 seconds before its first battle action. It then considers one spell per second, obeying the same cooldowns and damage rules. It prefers captures and moving toward your king; it sometimes shields visible incoming attacks. It is a simple practice opponent, not a strong chess engine. Existing battle timeouts still apply.

Practice rooms are ready immediately and cannot be joined by another player. Refresh reconnects as White. Return to the lobby and choose Practice again for a new game. If you disconnect, an active battle continues. Rooms still live in memory and disappear on server restart.

API: create a solo room with POST /rooms and body {"mode":"bot"}. Default or {"mode":"pvp"} creates the normal two-player room. Snapshots include mode ("bot" or "pvp"). Bot actions run on the server and broadcast through the same live stream.

## Personal pinch calibration

Enable the camera, then use **Calibrate pinch** below its buttons. Keep your hand at normal playing distance. Each pose has 1.5 seconds to get ready and two seconds of recording.

1. Spread thumb and index finger apart and hold steady.
2. When prompted, click **Capture pinch**, touch thumb and index together, and hold steady.
3. Open your fingers again, then test drawing or dragging.

The setup requires at least 20 valid readings per pose and rejects overlapping or unstable readings. Good thresholds are saved locally in this browser; no images are saved or uploaded. **Restore defaults** removes saved thresholds. Cancelled or failed setup keeps previous settings. Changing camera position or playing hand may call for recalibration.

Board, spell, and menu gestures pause during setup. Calibration cannot start during a battle; a new battle, hidden tab, or stopped camera cancels it. The server game itself does not pause, so calibrate before playing. Finger-distance readings now use a three-sample median filter to reject isolated spikes. Existing 120 ms release confirmation and 300 ms tracking-loss grace still apply. Detector settings are unchanged for comparison.

Pinch calibration now places both thresholds close to measured fingertip contact. A small separation releases the pinch; the wide-open pose only verifies that the samples are distinct. A small gap between the close/release thresholds plus distance filtering prevents flickering. Recalibrate once after this update: old broad-release profiles are not loaded. Actual physical contact cannot be guaranteed from a single webcam image.
