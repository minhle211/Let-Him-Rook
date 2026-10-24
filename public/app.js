const $ = id => document.getElementById(id);
const symbols = { pawn: '♟', rook: '♜', knight: '♞', bishop: '♝', queen: '♛', king: '♚' };
let session = null, state = null, selected = null, busy = false, connected = false, generation = 0, streamController;
let clockOffset = 0;
// Optional camera controls must never block room creation or mouse play.
let boardHand = { hover: null, grab: null, cancel() {}, sync() {}, update() { return null; } };
$('board-hands').disabled = true;
let boardHandPoint = null;
const squareName = n => 'abcdefgh'[n % 8] + (Math.floor(n / 8) + 1);
function error(message = '') { $('error').textContent = message; }
function accept(next) {
  if (state && next.game.revision < state.game.revision) return;
  state = next; clockOffset = next.serverTime - Date.now();
  if (selected !== null && (!state.legalMoves[selected]?.length || state.game.turn !== session.color)) selected = null;
  render();
}
async function request(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) { if (result.game) accept(result); throw new Error(result.error || 'Request failed'); }
  return result;
}
async function enter(path, options = {}) {
  if (busy) return;
  busy = true; $('practice').disabled = true; $('create').disabled = true; $('join-form').querySelector('button').disabled = true; error();
  try {
    const result = await request(path, options);
    session = { roomId: result.roomId, token: result.token, color: result.color };
    sessionStorage.setItem('rook-session', JSON.stringify(session));
    history.replaceState(null, '', '/');
    state = null; accept(result); connect();
  } catch (e) { error(e.message); }
  finally { busy = false; $('practice').disabled = false; $('create').disabled = false; $('join-form').querySelector('button').disabled = false; }
}
$('create').onclick = () => enter('/rooms');
$('practice').onclick = () => enter('/rooms', { mode: 'bot' });
$('join-form').onsubmit = e => { e.preventDefault(); const code = $('room-code').value.trim().toUpperCase(); if (/^[A-F0-9]{6}$/.test(code)) enter(`/rooms/${code}/join`); };
$('leave').onclick = () => {
  generation++; streamController?.abort(); sessionStorage.removeItem('rook-session'); session = null; state = null; selected = null; connected = false;
  $('lobby').hidden = false; $('match').hidden = true; error(); render();
};
async function connect() {
  const current = ++generation;
  streamController?.abort();
  while (session && current === generation) {
    streamController = new AbortController();
    try {
      const response = await fetch(`/rooms/${session.roomId}/events`, { headers: { Authorization: `Bearer ${session.token}` }, signal: streamController.signal });
      if (!response.ok) {
        if ([401, 404].includes(response.status)) { $('leave').click(); error('This room is no longer available. Create or join a room.'); return; }
        throw new Error('Connection failed');
      }
      connected = true; $('connection').textContent = 'Connected · Live updates'; render();
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      try {
        while (current === generation) {
          const { value, done } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            if (event.startsWith('data: ')) accept(JSON.parse(event.slice(6)));
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch { /* Retry with the same player token. */ }
    if (current !== generation) return;
    connected = false; $('connection').textContent = 'Disconnected · Reconnecting…'; render();
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}
async function command(action, data) {
  if (busy || !connected) return false;
  busy = true; error(); render();
  try { accept(await request(`/rooms/${session.roomId}/${action}`, data)); return true; }
  catch (e) { error(e.message); return false; }
  finally { busy = false; render(); }
}
function render() {
  const wasGrabbed = !!boardHand.grab;
  boardHand.sync(handContext());
  if (wasGrabbed && !boardHand.grab) selected = null;
  window.dispatchEvent(new CustomEvent('game-context', { detail: { battleId: state?.game.battle?.id || null, ready: connected && !!state?.ready } }));
  if (!state || !session) return;
  $('lobby').hidden = true; $('match').hidden = false;
  $('code').textContent = session.roomId; $('player').textContent = state.mode === 'bot' ? 'You play White against the practice bot (Black)' : `You play ${session.color}`;
  $('leave').disabled = busy;
  $('second-tab').href = `/?join=${session.roomId}`;
  $('second-tab').hidden = state.mode === 'bot';
  const g = state.game;
  $('status').textContent = !state.ready ? 'Waiting for Black to join' : g.winner ? `${g.winner} wins!` : g.phase === 'battle' ? 'Capture battle' : `${g.turn === session.color ? 'Your' : 'Opponent’s'} turn · ${g.turn}`;
  if (state.mode === 'bot' && g.phase === 'board' && g.turn === 'black') $('status').textContent = 'Bot is thinking...';
  const board = $('board'); board.replaceChildren();
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const n = session.color === 'white' ? (7 - row) * 8 + col : row * 8 + (7 - col);
    const p = g.board[n], legal = selected !== null && state.legalMoves[selected]?.includes(n);
    const cell = document.createElement('button');
    cell.className = `square ${(Math.floor(n / 8) + n % 8) % 2 === 0 ? 'dark' : ''} ${n === selected ? 'selected' : ''} ${legal ? 'legal' : ''}`;
    cell.disabled = busy || !connected || !state.ready || g.phase !== 'board' || g.turn !== session.color;
    cell.setAttribute('aria-label', `${squareName(n)}${p ? ` ${p.color} ${p.kind}, ${p.hp} health` : ' empty'}${legal ? ', legal destination' : ''}`);
    cell.dataset.square = String(n);
    cell.setAttribute('aria-pressed', String(n === selected));
    const coord = document.createElement('span'); coord.className = 'coord'; coord.textContent = squareName(n); cell.append(coord);
    if (p) {
      const icon = document.createElement('span'); icon.className = `piece ${p.color}-piece`; icon.textContent = symbols[p.kind]; cell.append(icon);
      const hp = document.createElement('span'); hp.className = 'hp'; const fill = document.createElement('i'); fill.style.width = `${p.hp / p.maxHp * 100}%`; hp.append(fill); cell.append(hp);
    }
    cell.onclick = () => {
      boardHand.cancel(); boardHandPoint = null;
      if (legal) { const from = selected; selected = null; command('move', { from, to: n, revision: g.revision }); }
      else { selected = selected === n ? null : p?.color === session.color ? n : null; render(); }
    };
    board.append(cell);
  }
  $('battle').hidden = !g.battle;
  if (!g.battle) $('battle-title').textContent = 'Battle arena';
  $('battle-hint').textContent = g.battle ? 'White on the left · Black on the right' : g.winner ? 'Match complete. Return to the lobby to start again.' : 'Move onto an enemy piece to begin.';
  renderBattle();
  paintBoardHand();
}
function renderBattle() {
  const b = state?.game.battle; if (!b || !session) return;
  const now = Date.now() + clockOffset;
  $('battle-title').textContent = `Battle · ${Math.max(0, Math.ceil((b.startedAt + 60000 - now) / 1000))}s`;
  const fighters = $('fighters'); fighters.replaceChildren();
  for (const f of [b.attacker, b.defender].sort((a, b) => a.piece.color === b.piece.color ? 0 : a.piece.color === 'white' ? -1 : 1)) {
    const box = document.createElement('div'); box.className = 'fighter';
    const label = document.createElement('p'); label.textContent = `${f.piece.color} ${f.piece.kind} · ${f.piece.hp}/${f.piece.maxHp} HP${f.empowered ? ' · Empowered' : ''}`;
    const bar = document.createElement('progress'); bar.max = f.piece.maxHp; bar.value = f.piece.hp; bar.setAttribute('aria-label', label.textContent); box.append(label, bar);
    const shield = document.createElement('p'); shield.className = 'shield'; shield.textContent = f.shieldUntil > now && f.shield ? `Shield: ${f.shield} · ${((f.shieldUntil - now) / 1000).toFixed(1)}s` : 'No shield'; box.append(shield); fighters.append(box);
  }
  const track = $('projectiles'); track.replaceChildren();
  for (const shot of b.projectiles) {
    const progress = Math.max(0, Math.min(1, 1 - (shot.arrivesAt - now) / 700));
    const dot = document.createElement('span'); dot.className = 'shot'; dot.textContent = shot.target === 'black' ? '→' : '←'; dot.style.left = `${(shot.target === 'black' ? progress : 1 - progress) * 90}%`; track.append(dot);
  }
  const own = b.attacker.piece.color === session.color ? b.attacker : b.defender;
  document.querySelectorAll('[data-spell]').forEach(button => {
    const spell = button.dataset.spell, wait = Math.max(0, own.cooldowns[spell] - now);
    button.disabled = busy || !connected || wait > 0;
    button.textContent = `${spell === 'defense' ? 'Shield' : spell === 'attack' ? 'Attack' : 'Special'}${wait ? ` ${(wait / 1000).toFixed(1)}s` : ''}`;
  });
}
document.querySelectorAll('[data-spell]').forEach(button => button.onclick = () => {
  if (state?.game.battle) command('cast', { battleId: state.game.battle.id, commandId: Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''), spell: button.dataset.spell });
});
setInterval(renderBattle, 100);
const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode && /^[a-fA-F0-9]{6}$/.test(joinCode)) $('room-code').value = joinCode.toUpperCase();
// A join link intentionally starts a fresh player, even if a browser copied tab storage.
if (!joinCode) {
  try { session = JSON.parse(sessionStorage.getItem('rook-session')); } catch { sessionStorage.removeItem('rook-session'); }
  if (session?.roomId && session?.token && ['white', 'black'].includes(session.color)) {
    $('lobby').hidden = true; $('match').hidden = false; $('connection').textContent = 'Reconnecting…'; connect();
  } else session = null;
}

window.addEventListener('gesture-cast', async ({ detail }) => {
  const b = state?.game.battle;
  const own = b && (b.attacker.piece.color === session?.color ? b.attacker : b.defender);
  let message;
  if (!b || b.id !== detail.battleId || !connected) message = 'No active battle connection.';
  else if (busy) message = 'Previous command is still sending. Draw again.';
  else if (own.cooldowns[detail.spell] > Date.now() + clockOffset) message = 'Spell is cooling down. Draw again when ready.';
  else {
    const ok = await command('cast', { battleId: b.id, commandId: Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''), spell: detail.spell });
    message = ok ? 'Spell cast: ' + detail.spell : 'Spell failed. Check the game message and try again.';
  }
  window.dispatchEvent(new CustomEvent('gesture-result', { detail: message }));
});

function handContext() {
  return {
    enabled: $('board-hands').checked,
    canMove: !!session && connected && !!state?.ready && !busy && state.game.phase === 'board' && state.game.turn === session.color,
    roomId: session?.roomId, revision: state?.game.revision, color: session?.color,
    legalMoves: state?.legalMoves || {},
  };
}
function paintBoardHand() {
  const cursor = $('board-hand-cursor');
  const show = boardHand.hover !== null && boardHandPoint && handContext().canMove && $('board-hands').checked;
  cursor.hidden = !show;
  if (show) {
    cursor.style.left = ((boardHandPoint.x - 0.1) / 0.8 * 100) + '%';
    cursor.style.top = ((boardHandPoint.y - 0.1) / 0.8 * 100) + '%';
  }
  cursor.classList.toggle('grabbing', !!boardHand.grab);
  document.querySelectorAll('#board .square').forEach(cell => {
    const n = Number(cell.dataset.square);
    cell.classList.toggle('hand-hover', show && n === boardHand.hover);
    cell.classList.toggle('hand-grab', n === boardHand.grab?.from);
    cell.classList.toggle('selected', n === selected);
    cell.classList.toggle('legal', selected !== null && !!state?.legalMoves[selected]?.includes(n));
  });
}
window.addEventListener('board-hand', async ({ detail }) => {
  const hadGrab = !!boardHand.grab;
  if (detail.action !== 'hold' && detail.action !== 'end') boardHandPoint = detail.point || null;
  const move = boardHand.update(detail.action, detail.point, handContext());
  if (boardHand.grab) selected = boardHand.grab.from;
  else if (hadGrab) selected = null;
  paintBoardHand();
  const status = $('board-hand-status');
  if (detail.action === 'cancel') { if (hadGrab) status.textContent = 'Grab cancelled. Open your fingers to try again.'; return; }
  if (!$('board-hands').checked) return;
  if (!handContext().canMove) { status.textContent = state?.game.battle ? 'Battle active. Use the spell pad to cast.' : 'Waiting for your board turn and both players to connect.'; return; }
  if (move) {
    status.textContent = 'Moving...';
    const ok = await command('move', move);
    status.textContent = ok ? 'Move sent.' : 'Move failed. Open your fingers and try again.';
  } else if (detail.action === 'end' && hadGrab) status.textContent = 'Move cancelled. Release on a highlighted square.';
  else if (boardHand.grab) status.textContent = 'Holding ' + squareName(boardHand.grab.from) + '. Release on a highlighted square.';
  else if (detail.action !== 'end') status.textContent = boardHand.hover !== null ? 'Pointing at ' + squareName(boardHand.hover) + '. Pinch to grab your piece.' : 'Move your hand into the middle of the camera view.';
});

import('./board-hand.mjs').then(({ BoardHandController }) => {
  boardHand = new BoardHandController();
  $('board-hands').disabled = false;
}).catch(() => {
  $('board-hands').checked = false;
  $('board-hand-status').textContent = 'Hand controls could not load. Restart the server with npm.cmd start, then refresh. Room buttons and mouse play still work.';
});
