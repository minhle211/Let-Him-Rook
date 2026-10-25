import React from 'react';
import type { FightRecord } from '../review/fightReview.ts';

function resultColor(result: FightRecord['result']): string {
  if (result === 'win') return '#4ade80';
  if (result === 'loss') return '#f87171';
  return '#fbbf24';
}

function oneLine(record: FightRecord): string {
  const square = record.square ? ` on ${record.square}` : '';
  return `${record.result.toUpperCase()} · ${record.localClass} vs ${record.opponentClass}${square}`;
}

export const FightReviewPanel: React.FC<{
  record: FightRecord | null;
  earlier: FightRecord[];
  onClose: () => void;
}> = ({ record, earlier, onClose }) => {
  return (
    <aside
      style={{
        position: 'fixed',
        top: 84,
        right: 16,
        width: 320,
        maxHeight: 'min(520px, calc(100vh - 260px))',
        zIndex: 42,
        pointerEvents: 'auto',
        overflow: 'auto',
        background: 'rgba(15, 23, 42, 0.9)',
        border: '1px solid rgba(251, 191, 36, 0.65)',
        borderRadius: 12,
        padding: '0.75rem 0.85rem 0.9rem',
        color: '#e2e8f0',
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: '0.95rem', color: '#fbbf24' }}>Fight notes</strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            color: '#cbd5e1',
            border: '1px solid #475569',
            borderRadius: 6,
            padding: '0.15rem 0.45rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
          }}
        >
          Close
        </button>
      </div>

      {!record && (
        <p style={{ fontSize: '0.86rem', lineHeight: 1.45, color: '#cbd5e1', margin: '0.7rem 0 0' }}>
          Finish a duel and this saves the HP, hits, and parries from that fight, then writes what to change next time. Notes stay on this computer.
        </p>
      )}

      {record && (
        <>
          <p style={{ margin: '0.55rem 0 0.15rem', fontSize: '0.95rem', fontWeight: 800, color: resultColor(record.result) }}>
            {record.result === 'win' ? 'You took the square' : record.result === 'loss' ? 'You lost the square' : 'The square was a draw'}
          </p>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.4 }}>
            {record.localClass.toUpperCase()} ({record.role}) vs {record.opponentClass.toUpperCase()}
            {record.square ? ` · ${record.square}` : ''} · {record.durationSec}s · {record.reason}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 0.6rem', marginTop: '0.7rem', fontSize: '0.8rem' }}>
            <span>Your HP {record.localHp}</span>
            <span>Their HP {record.opponentHp}</span>
            <span>Hits landed {record.hitsLanded}</span>
            <span>Hits taken {record.hitsTaken}</span>
            <span>Parries {record.parries}</span>
            <span>Parried against you {record.attacksParried}</span>
            <span>Shots {record.shotsFired}</span>
            <span>Props hit {record.obstacleHits}</span>
          </div>

          <h3 style={{ margin: '0.85rem 0 0.3rem', fontSize: '0.78rem', letterSpacing: '0.04em', color: '#fca5a5' }}>
            WHAT HURT YOU
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.84rem', lineHeight: 1.4 }}>
            {record.drawbacks.map(line => (
              <li key={line} style={{ marginBottom: 4 }}>{line}</li>
            ))}
          </ul>

          <h3 style={{ margin: '0.75rem 0 0.3rem', fontSize: '0.78rem', letterSpacing: '0.04em', color: '#86efac' }}>
            HOW TO IMPROVE
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.84rem', lineHeight: 1.4 }}>
            {record.improvements.map(line => (
              <li key={line} style={{ marginBottom: 4 }}>{line}</li>
            ))}
          </ul>

          <h3 style={{ margin: '0.75rem 0 0.3rem', fontSize: '0.78rem', letterSpacing: '0.04em', color: '#fde68a' }}>
            PLAN FOR THE NEXT FIGHT
          </h3>
          <ol style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.84rem', lineHeight: 1.4 }}>
            {record.plan.map(line => (
              <li key={line} style={{ marginBottom: 4 }}>{line}</li>
            ))}
          </ol>
        </>
      )}

      {earlier.length > 0 && (
        <>
          <h3 style={{ margin: '0.85rem 0 0.3rem', fontSize: '0.78rem', letterSpacing: '0.04em', color: '#94a3b8' }}>
            EARLIER FIGHTS
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: '#cbd5e1' }}>
            {earlier.map(fight => (
              <li key={fight.id} style={{ marginBottom: 3 }}>{oneLine(fight)}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
};
