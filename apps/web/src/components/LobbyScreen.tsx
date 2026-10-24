import React, { useState } from 'react';
import type { MatchMode } from '@let-him-rook/shared';

interface LobbyScreenProps {
  onCreateRoom: (mode: MatchMode) => void;
  onJoinRoom: (roomId: string) => void;
  isLoading: boolean;
  error?: string | null;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  onCreateRoom,
  onJoinRoom,
  isLoading,
  error,
}) => {
  const [roomCode, setRoomCode] = useState('');

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim()) {
      onJoinRoom(roomCode.trim().toUpperCase());
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(13, 15, 24, 0.95)',
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          padding: '2.5rem',
          borderRadius: 16,
          backgroundColor: '#171b2c',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          border: '1px solid #2e3856',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: '2.2rem',
            fontWeight: 800,
            letterSpacing: '0.05em',
            background: 'linear-gradient(135deg, #60a5fa, #c084fc)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '0.5rem',
          }}
        >
          LET HIM ROOK
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '2rem' }}>
          3D Gesture Chess & Real-Time Spell Duels
        </p>

        {error && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: 8,
              backgroundColor: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              fontSize: '0.9rem',
              marginBottom: '1.5rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            onClick={() => onCreateRoom('pvp')}
            disabled={isLoading}
            style={{
              padding: '1rem',
              borderRadius: 10,
              fontSize: '1rem',
              fontWeight: 700,
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            Create PvP Duel Room
          </button>

          <button
            onClick={() => onCreateRoom('bot')}
            disabled={isLoading}
            style={{
              padding: '1rem',
              borderRadius: 10,
              fontSize: '1rem',
              fontWeight: 700,
              backgroundColor: '#8b5cf6',
              color: '#ffffff',
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            Practice vs Bot (Solo)
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              margin: '1rem 0',
              color: '#64748b',
              fontSize: '0.85rem',
            }}
          >
            <div style={{ flex: 1, height: 1, backgroundColor: '#334155' }} />
            <span style={{ padding: '0 0.75rem' }}>OR JOIN EXISTING</span>
            <div style={{ flex: 1, height: 1, backgroundColor: '#334155' }} />
          </div>

          <form onSubmit={handleJoin} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="ENTER ROOM CODE"
              value={roomCode}
              onChange={(e: any) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={8}
              style={{
                flex: 1,
                padding: '0.85rem',
                borderRadius: 8,
                border: '1px solid #334155',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                fontSize: '1rem',
                fontWeight: 600,
                textAlign: 'center',
                letterSpacing: '0.1em',
              }}
            />
            <button
              type="submit"
              disabled={isLoading || !roomCode.trim()}
              style={{
                padding: '0.85rem 1.5rem',
                borderRadius: 8,
                backgroundColor: '#10b981',
                color: '#ffffff',
                fontWeight: 700,
                border: 'none',
                cursor: isLoading || !roomCode.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Join
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
