import React from 'react';
import type { PromotionPieceClass } from '@let-him-rook/shared';

interface PromotionModalProps {
  onSelect: (piece: PromotionPieceClass) => void;
  hoverChoice?: PromotionPieceClass | null;
}

const CHOICES: { id: PromotionPieceClass; label: string; icon: string; desc: string }[] = [
  { id: 'queen', label: 'Queen', icon: '♛', desc: '3-Orb Homing Volley' },
  { id: 'rook', label: 'Rook', icon: '♜', desc: 'Cannon Shot + 3rd AoE Bomb' },
  { id: 'bishop', label: 'Bishop', icon: '♝', desc: 'Ice Bolt + Freeze Hazard' },
  { id: 'knight', label: 'Knight', icon: '♞', desc: 'Teleport Windup Cleave' },
];

export const PromotionModal: React.FC<PromotionModalProps> = ({ onSelect, hoverChoice }) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(13, 15, 24, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          backgroundColor: '#171b2c',
          borderRadius: 16,
          padding: '2rem',
          border: '1px solid #3b82f6',
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.6)',
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.5rem' }}>
          Pawn Promotion!
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          Select your class upgrade with fingertip pinch or click:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {CHOICES.map(c => {
            const isHover = hoverChoice === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                style={{
                  padding: '1.2rem',
                  borderRadius: 12,
                  backgroundColor: isHover ? '#1e3a8a' : '#0f172a',
                  border: isHover ? '2px solid #60a5fa' : '1px solid #334155',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.15s ease',
                  transform: isHover ? 'scale(1.04)' : 'scale(1.0)',
                }}
              >
                <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>{c.icon}</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{c.label}</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{c.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
