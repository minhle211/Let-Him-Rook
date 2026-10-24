# Let Him Rook

A two-player chess variant: captures start real-time spell battles.

## Run

Requires Node.js 24+.

```sh
npm install
npm test
npm run typecheck
```

On PowerShell, use `npm.cmd` if script execution policy blocks `npm`.

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

These balance values and timeout rules are provisional.
