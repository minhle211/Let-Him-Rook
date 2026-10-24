import React, { useState } from 'react';
import type {
  AiBehaviorMode,
  BoardSquare,
  MatchSnapshot,
  PieceClass,
  PlayerColor,
  SandboxConfig,
} from '@let-him-rook/shared';

export interface SandboxControlCenterProps {
  isOpen: boolean;
  onToggle: () => void;
  snapshot: MatchSnapshot;
  selectedPalette: { pieceClass: PieceClass; color: PlayerColor } | 'eraser' | null;
  onSelectPalette: (palette: { pieceClass: PieceClass; color: PlayerColor } | 'eraser' | null) => void;
  onSetFen: (fen: string) => void;
  onPlacePiece: (square: BoardSquare, pieceClass: PieceClass | null, color?: PlayerColor) => void;
  onFreeMove: (from: BoardSquare, to: BoardSquare) => void;
  onStartDuel: (
    attackerClass: PieceClass,
    defenderClass: PieceClass,
    aiBehavior?: AiBehaviorMode,
    standalone?: boolean
  ) => void;
  onUpdateConfig: (config: Partial<SandboxConfig>) => void;
  onResetDuel: () => void;
  onExitDuel: () => void;
  onRespawnObstacles: () => void;
}

const PIECE_SYMBOLS: Record<PieceClass, { w: string; b: string; label: string }> = {
  king: { w: '♔', b: '♚', label: 'King' },
  queen: { w: '♕', b: '♛', label: 'Queen' },
  rook: { w: '♖', b: '♜', label: 'Rook' },
  bishop: { w: '♗', b: '♝', label: 'Bishop' },
  knight: { w: '♘', b: '♞', label: 'Knight' },
  pawn: { w: '♙', b: '♟', label: 'Pawn' },
};

const BOARD_PRESETS: { name: string; fen: string }[] = [
  {
    name: 'Standard Opening',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  },
  {
    name: 'King + Rook Endgame',
    fen: '8/8/8/8/8/4k3/8/4K2R w K - 0 1',
  },
  {
    name: 'Queen vs King',
    fen: '8/8/8/4k3/8/8/4Q3/4K3 w - - 0 1',
  },
  {
    name: 'Promotion Ready',
    fen: '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1',
  },
  {
    name: 'Empty Board',
    fen: '8/8/8/8/8/8/8/8 w - - 0 1',
  },
];

const PIECE_CLASSES: PieceClass[] = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];

export const SandboxControlCenter: React.FC<SandboxControlCenterProps> = ({
  isOpen,
  onToggle,
  snapshot,
  selectedPalette,
  onSelectPalette,
  onSetFen,
  onStartDuel,
  onUpdateConfig,
  onResetDuel,
  onExitDuel,
  onRespawnObstacles,
}) => {
  const [activeTab, setActiveTab] = useState<'chess' | 'combat'>('chess');
  const [fenInput, setFenInput] = useState<string>(snapshot.fen);
  const [copiedFen, setCopiedFen] = useState(false);

  // Combat stage choices
  const [playerClass, setPlayerClass] = useState<PieceClass>('knight');
  const [opponentClass, setOpponentClass] = useState<PieceClass>('bishop');

  const config = snapshot.sandboxConfig ?? {
    rulesEnforced: true,
    godMode: false,
    noCooldowns: false,
    moveSpeedMultiplier: 1.0,
    aiBehavior: 'dummy' as AiBehaviorMode,
    isStandaloneDuel: false,
  };

  const isDuel =
    snapshot.phase === 'active_duel' ||
    snapshot.phase === 'duel_intro' ||
    snapshot.phase === 'duel_result';

  const handleCopyFen = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(snapshot.fen).catch(() => {});
      setCopiedFen(true);
      setTimeout(() => setCopiedFen(false), 1500);
    }
  };

  const handleLoadFen = () => {
    if (fenInput.trim()) {
      onSetFen(fenInput.trim());
    }
  };

  const handleToggleTurn = () => {
    const tokens = snapshot.fen.split(' ');
    const currentTurn = tokens[1] || 'w';
    tokens[1] = currentTurn === 'w' ? 'b' : 'w';
    onSetFen(tokens.join(' '));
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        title="Open Sandbox Control Center"
        style={{
          position: 'fixed',
          top: 64,
          right: 20,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.6rem 1rem',
          borderRadius: 12,
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #06b6d4',
          color: '#38bdf8',
          fontSize: '0.85rem',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 10px rgba(6, 182, 212, 0.3)',
          transition: 'all 0.2s',
        }}
      >
        🛠️ Sandbox Dock ⚙️
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 64,
        right: 20,
        width: 360,
        maxHeight: 'calc(100vh - 84px)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(6, 182, 212, 0.5)',
        borderRadius: 16,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7), 0 0 20px rgba(6, 182, 212, 0.25)',
        color: '#e2e8f0',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      {/* Dock Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #1e293b',
          backgroundColor: '#0f172a',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>🛠️</span>
          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#38bdf8', letterSpacing: '0.05em' }}>
            SANDBOX DOCK
          </span>
        </div>
        <button
          onClick={onToggle}
          title="Minimize dock"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            fontSize: '1rem',
            cursor: 'pointer',
            padding: '0.2rem 0.5rem',
            borderRadius: 6,
          }}
        >
          ✕
        </button>
      </div>

      {/* Tabs Switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
        <button
          onClick={() => setActiveTab('chess')}
          style={{
            flex: 1,
            padding: '0.65rem',
            background: activeTab === 'chess' ? '#1e293b' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'chess' ? '2px solid #06b6d4' : '2px solid transparent',
            color: activeTab === 'chess' ? '#38bdf8' : '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          ♟️ Chessboard
        </button>
        <button
          onClick={() => setActiveTab('combat')}
          style={{
            flex: 1,
            padding: '0.65rem',
            background: activeTab === 'combat' ? '#1e293b' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'combat' ? '2px solid #06b6d4' : '2px solid transparent',
            color: activeTab === 'combat' ? '#38bdf8' : '#94a3b8',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          ⚔️ Combat Arena
        </button>
      </div>

      {/* Dock Content Body */}
      <div
        style={{
          padding: '1rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          fontSize: '0.85rem',
        }}
      >
        {activeTab === 'chess' ? (
          <>
            {/* Rules Toggle & Turn Selector */}
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#1e293b',
                padding: '0.6rem 0.8rem',
                borderRadius: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#f1f5f9' }}>
                  {config.rulesEnforced ? '📜 Rules Enforced' : '🔓 Free Placement'}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  {config.rulesEnforced ? 'Legal moves & turns only' : 'Move any piece anywhere'}
                </div>
              </div>
              <button
                onClick={() => onUpdateConfig({ rulesEnforced: !config.rulesEnforced })}
                style={{
                  padding: '0.4rem 0.75rem',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: config.rulesEnforced ? '#0284c7' : '#e11d48',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {config.rulesEnforced ? 'Switch Free' : 'Enforce Rules'}
              </button>
            </div>

            {/* Turn Switcher */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#1e293b',
                padding: '0.6rem 0.8rem',
                borderRadius: 10,
              }}
            >
              <div>
                <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Current Turn: </span>
                <span
                  style={{
                    fontWeight: 800,
                    color: snapshot.turn === 'w' ? '#fbbf24' : '#c084fc',
                  }}
                >
                  {snapshot.turn === 'w' ? 'WHITE' : 'BLACK'}
                </span>
              </div>
              <button
                onClick={handleToggleTurn}
                style={{
                  padding: '0.35rem 0.7rem',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  backgroundColor: '#0f172a',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                Pass Turn
              </button>
            </div>

            {/* 12-Piece Palette & Eraser */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.4rem',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#94a3b8' }}>
                  PIECE PALETTE
                </span>
                {selectedPalette && (
                  <button
                    onClick={() => onSelectPalette(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#f87171',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Clear Tool
                  </button>
                )}
              </div>

              {/* White Pieces */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.3rem', marginBottom: '0.3rem' }}>
                {PIECE_CLASSES.map(p => {
                  const isSelected =
                    selectedPalette &&
                    selectedPalette !== 'eraser' &&
                    selectedPalette.pieceClass === p &&
                    selectedPalette.color === 'w';
                  return (
                    <button
                      key={`w_${p}`}
                      onClick={() =>
                        onSelectPalette(isSelected ? null : { pieceClass: p, color: 'w' })
                      }
                      title={`Place White ${PIECE_SYMBOLS[p].label}`}
                      style={{
                        padding: '0.35rem 0',
                        fontSize: '1.25rem',
                        backgroundColor: isSelected ? '#0284c7' : '#1e293b',
                        color: '#fbbf24',
                        border: isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                        borderRadius: 6,
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                    >
                      {PIECE_SYMBOLS[p].w}
                    </button>
                  );
                })}
              </div>

              {/* Black Pieces */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.3rem', marginBottom: '0.5rem' }}>
                {PIECE_CLASSES.map(p => {
                  const isSelected =
                    selectedPalette &&
                    selectedPalette !== 'eraser' &&
                    selectedPalette.pieceClass === p &&
                    selectedPalette.color === 'b';
                  return (
                    <button
                      key={`b_${p}`}
                      onClick={() =>
                        onSelectPalette(isSelected ? null : { pieceClass: p, color: 'b' })
                      }
                      title={`Place Black ${PIECE_SYMBOLS[p].label}`}
                      style={{
                        padding: '0.35rem 0',
                        fontSize: '1.25rem',
                        backgroundColor: isSelected ? '#7c3aed' : '#1e293b',
                        color: '#c084fc',
                        border: isSelected ? '1px solid #a855f7' : '1px solid #334155',
                        borderRadius: 6,
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                    >
                      {PIECE_SYMBOLS[p].b}
                    </button>
                  );
                })}
              </div>

              {/* Eraser Tool */}
              <button
                onClick={() => onSelectPalette(selectedPalette === 'eraser' ? null : 'eraser')}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 8,
                  backgroundColor: selectedPalette === 'eraser' ? '#dc2626' : '#1e293b',
                  color: selectedPalette === 'eraser' ? '#ffffff' : '#fca5a5',
                  border: selectedPalette === 'eraser' ? '1px solid #f87171' : '1px solid #451a1a',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                }}
              >
                🧹 {selectedPalette === 'eraser' ? 'Eraser Active (Click Square)' : 'Select Eraser Tool'}
              </button>
            </div>

            {/* Board Reset & Clear Actions */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                BOARD ACTIONS
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  onClick={() => {
                    const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                    onSetFen(standardFen);
                    setFenInput(standardFen);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: 8,
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.3rem',
                  }}
                >
                  🔄 Reset Board
                </button>
                <button
                  onClick={() => {
                    const emptyFen = '8/8/8/8/8/8/8/8 w - - 0 1';
                    onSetFen(emptyFen);
                    setFenInput(emptyFen);
                  }}
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: 8,
                    backgroundColor: '#334155',
                    color: '#f1f5f9',
                    border: '1px solid #475569',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.3rem',
                  }}
                >
                  🗑️ Clear Board
                </button>
              </div>
            </div>

            {/* Presets */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                BOARD PRESETS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                {BOARD_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      onSetFen(preset.fen);
                      setFenInput(preset.fen);
                    }}
                    style={{
                      padding: '0.45rem',
                      borderRadius: 6,
                      backgroundColor: '#1e293b',
                      color: '#cbd5e1',
                      border: '1px solid #334155',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* FEN Controls */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                CUSTOM FEN
              </div>
              <input
                type="text"
                value={fenInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFenInput(e.target.value)}
                placeholder="Paste FEN string here"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '0.5rem',
                  borderRadius: 6,
                  border: '1px solid #334155',
                  backgroundColor: '#0f172a',
                  color: '#94a3b8',
                  fontSize: '0.72rem',
                  fontFamily: 'monospace',
                  marginBottom: '0.4rem',
                }}
              />
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  onClick={handleCopyFen}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    borderRadius: 6,
                    backgroundColor: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #334155',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {copiedFen ? '✅ Copied' : '📋 Copy FEN'}
                </button>
                <button
                  onClick={handleLoadFen}
                  style={{
                    flex: 1,
                    padding: '0.45rem',
                    borderRadius: 6,
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  📥 Load FEN
                </button>
              </div>
            </div>

            {/* Stage Duel From Board */}
            <div
              style={{
                backgroundColor: '#1e293b',
                padding: '0.8rem',
                borderRadius: 10,
                border: '1px solid #334155',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#f1f5f9', marginBottom: '0.5rem' }}>
                ⚔️ STAGE CONTESTED DUEL
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>
                    White Fighter
                  </label>
                  <select
                    value={playerClass}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setPlayerClass(e.target.value as PieceClass)
                    }
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: 6,
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      fontSize: '0.75rem',
                    }}
                  >
                    {PIECE_CLASSES.map(c => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>
                    Black Fighter
                  </label>
                  <select
                    value={opponentClass}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setOpponentClass(e.target.value as PieceClass)
                    }
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: 6,
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      fontSize: '0.75rem',
                    }}
                  >
                    {PIECE_CLASSES.map(c => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={() => onStartDuel(playerClass, opponentClass, config.aiBehavior, false)}
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  borderRadius: 8,
                  backgroundColor: '#d97706',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ⚔️ Launch Board Capture Duel
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Tab 2: Combat Arena Sandbox */}
            {/* Standalone Instant Duel Trigger */}
            <div
              style={{
                backgroundColor: '#1e293b',
                padding: '0.8rem',
                borderRadius: 10,
                border: '1px solid #334155',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#38bdf8', marginBottom: '0.6rem' }}>
                🏟️ ARENA DUEL SETUP
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>
                    Your Class (White)
                  </label>
                  <select
                    value={playerClass}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPlayerClass(e.target.value as PieceClass)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: 6,
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      fontSize: '0.75rem',
                    }}
                  >
                    {PIECE_CLASSES.map(c => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>
                    Opponent (Black)
                  </label>
                  <select
                    value={opponentClass}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setOpponentClass(e.target.value as PieceClass)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: 6,
                      backgroundColor: '#0f172a',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      fontSize: '0.75rem',
                    }}
                  >
                    {PIECE_CLASSES.map(c => (
                      <option key={c} value={c}>
                        {c.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* AI Behavior Selector */}
              <div style={{ marginBottom: '0.8rem' }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>
                  Opponent AI Behavior
                </label>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  {(['dummy', 'passive', 'aggressive'] as AiBehaviorMode[]).map(b => (
                    <button
                      key={b}
                      onClick={() => onUpdateConfig({ aiBehavior: b })}
                      style={{
                        flex: 1,
                        padding: '0.4rem 0',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: config.aiBehavior === b ? '#0284c7' : '#0f172a',
                        color: config.aiBehavior === b ? '#ffffff' : '#94a3b8',
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {b === 'dummy' ? '🛑 Dummy' : b === 'passive' ? '🏃 Passive' : '⚔️ Aggro'}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => onStartDuel(playerClass, opponentClass, config.aiBehavior, true)}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: 8,
                  backgroundColor: '#06b6d4',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 0 12px rgba(6, 182, 212, 0.4)',
                }}
              >
                🚀 Start Standalone Duel
              </button>
            </div>

            {/* Combat Arena Cheats & Tweakables */}
            <div
              style={{
                backgroundColor: '#1e293b',
                padding: '0.8rem',
                borderRadius: 10,
                border: '1px solid #334155',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#f1f5f9', marginBottom: '0.6rem' }}>
                ⚡ COMBAT CHEATS & TWEAKS
              </div>

              {/* God Mode Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '0.6rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#f8fafc' }}>
                    🛡️ God Mode
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    Negates White fighter damage (Infinite HP)
                  </div>
                </div>
                <button
                  onClick={() => onUpdateConfig({ godMode: !config.godMode })}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: config.godMode ? '#10b981' : '#334155',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {config.godMode ? 'ACTIVE' : 'OFF'}
                </button>
              </div>

              {/* No Cooldowns Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '0.6rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#f8fafc' }}>
                    ⚡ No Cooldowns
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    Rapid-fire abilities with 0s cooldown
                  </div>
                </div>
                <button
                  onClick={() => onUpdateConfig({ noCooldowns: !config.noCooldowns })}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: config.noCooldowns ? '#eab308' : '#334155',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {config.noCooldowns ? 'ACTIVE' : 'OFF'}
                </button>
              </div>

              {/* Movement Speed Multiplier Slider */}
              <div style={{ marginTop: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#f8fafc' }}>
                    🏃 Move Speed:
                  </span>
                  <span style={{ fontWeight: 800, color: '#38bdf8' }}>
                    {(config.moveSpeedMultiplier ?? 1.0).toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={config.moveSpeedMultiplier ?? 1.0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onUpdateConfig({ moveSpeedMultiplier: parseFloat(e.target.value) })
                  }
                  style={{ width: '100%', accentColor: '#06b6d4', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* Duel In-Progress Controls */}
            {isDuel && (
              <div
                style={{
                  backgroundColor: '#1e293b',
                  padding: '0.8rem',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#f1f5f9' }}>
                  🎮 DUEL CONTROLS
                </div>
                <button
                  onClick={onRespawnObstacles}
                  style={{
                    padding: '0.55rem',
                    borderRadius: 6,
                    backgroundColor: '#0d9488',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  🧱 Respawn Obstacles
                </button>
                <button
                  onClick={onResetDuel}
                  style={{
                    padding: '0.55rem',
                    borderRadius: 6,
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  🔄 Restart Duel (Reset HP & Positions)
                </button>
                <button
                  onClick={onExitDuel}
                  style={{
                    padding: '0.55rem',
                    borderRadius: 6,
                    backgroundColor: '#475569',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  ♟️ Exit Duel (Return to Board)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
