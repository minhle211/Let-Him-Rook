import React, { useMemo } from 'react';
import {
  getBoardPiecesFromFen,
  indexToSquare,
  squareToTableCoords,
  TABLE_HALF_EXTENT,
  type BoardSquare,
  type MatchPhase,
  type ObstacleState,
} from '@let-him-rook/shared';
import { PieceCharacter } from '../characters/PieceCharacter.tsx';
import { FairytaleRuins } from './FairytaleRuins.tsx';
import { ArenaFeatures } from './ArenaFeatures.tsx';
import { StoneBattlefield, weatheredShade } from './StoneBattlefield.tsx';

interface TabletopArenaProps {
  hoverSquare: BoardSquare | null;
  selectedSquare: BoardSquare | null;
  legalDestinations: BoardSquare[];
  obstacles: ObstacleState[];
  fen?: string;
  phase?: MatchPhase;
  onSquareClick?: (square: BoardSquare) => void;
}

export const TabletopArena: React.FC<TabletopArenaProps> = ({
  hoverSquare,
  selectedSquare,
  legalDestinations,
  obstacles,
  fen,
  phase,
  onSquareClick,
}) => {
  const squares = useMemo(() => {
    const list: { square: BoardSquare; x: number; z: number; isDark: boolean }[] = [];
    for (let idx = 0; idx < 64; idx++) {
      const sq = indexToSquare(idx);
      const coords = squareToTableCoords(sq);
      const file = sq.charCodeAt(0) - 97;
      const rank = parseInt(sq[1], 10) - 1;
      const isDark = (file + rank) % 2 === 0;
      list.push({ square: sq, x: coords.x, z: coords.z, isDark });
    }
    return list;
  }, []);

  const isDuel = phase === 'active_duel' || phase === 'duel_intro' || phase === 'duel_result';

  const { lightStone, darkStone } = useMemo(() => {
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    squares.forEach(({ square }, i) => {
      light[square] = weatheredShade('#d3ccbc', i * 3 + 1, 0.1);
      dark[square] = weatheredShade('#45484e', i * 3 + 2, 0.16);
    });
    return { lightStone: light, darkStone: dark };
  }, [squares]);

  const boardPieces = useMemo(() => {
    if (!fen || isDuel) return [];
    return getBoardPiecesFromFen(fen);
  }, [fen, isDuel]);

  const pieceObstacles = useMemo(() => {
    if (!isDuel) return [];
    return obstacles.filter(o => o.type === 'piece' && o.hitsRemaining > 0);
  }, [obstacles, isDuel]);

  return (
    <group>
      {/* Stone base under the whole battlefield; its dark top shows as the grout between the flagstones */}
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[TABLE_HALF_EXTENT * 2, 0.4, TABLE_HALF_EXTENT * 2]} />
        <meshStandardMaterial color="#2f2c28" roughness={1} />
      </mesh>
      <StoneBattlefield />

      <FairytaleRuins />

      {/* 8x8 Chessboard Inset Border */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[8.4, 0.04, 8.4]} />
        <meshStandardMaterial color="#2a2a2d" roughness={0.95} />
      </mesh>

      {/* 64 Chessboard Squares */}
      {squares.map(({ square, x, z, isDark }) => {
        const isHover = hoverSquare === square;
        const isSelected = selectedSquare === square;
        const isLegal = legalDestinations.includes(square);

        // Weathered limestone and slate squares
        let color = isDark ? darkStone[square] : lightStone[square];
        if (isSelected) {
          color = '#ffd700'; // Gold
        } else if (isHover) {
          color = '#4fd1c5'; // Cyan
        }

        return (
          <group key={square} position={[x, 0.04, z]}>
            <mesh
              receiveShadow
              onClick={(e: any) => {
                e.stopPropagation();
                onSquareClick?.(square);
              }}
            >
              <boxGeometry args={[0.94, 0.02, 0.94]} />
              <meshStandardMaterial
                color={color}
                roughness={0.9}
                emissive={isSelected ? '#554400' : isHover ? '#003344' : '#000000'}
              />
            </mesh>

            {/* Legal move indicator dot */}
            {isLegal && (
              <mesh
                position={[0, 0.03, 0]}
                onClick={(e: any) => {
                  e.stopPropagation();
                  onSquareClick?.(square);
                }}
              >
                <cylinderGeometry args={[0.2, 0.2, 0.025, 20]} />
                <meshStandardMaterial color="#48bb78" emissive="#22543d" emissiveIntensity={0.6} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Puddles, trees and the castle tower */}
      <ArenaFeatures obstacles={obstacles} />

      {/* Chessboard Pieces during chess turn */}
      {!isDuel &&
        boardPieces.map(piece => {
          const coords = squareToTableCoords(piece.square);
          const isSelected = selectedSquare === piece.square;
          const yPos = isSelected ? 0.18 : 0;
          const facingY = piece.color === 'b' ? Math.PI : 0;

          return (
            <group
              key={piece.square}
              position={[coords.x, yPos, coords.z]}
              rotation={[0, facingY, 0]}
              onClick={(e: any) => {
                e.stopPropagation();
                onSquareClick?.(piece.square);
              }}
            >
              <PieceCharacter
                pieceClass={piece.pieceClass}
                color={piece.color}
                scale={0.9}
              />
            </group>
          );
        })}

      {/* Non-dueling Piece Obstacles during 3D duels */}
      {isDuel &&
        pieceObstacles.map(obs => {
          const isFrozen = (obs.frozenRemainingMs ?? 0) > 0;
          const facingY = obs.pieceColor === 'b' ? Math.PI : 0;
          return (
            <group key={obs.id} position={[obs.x, 0, obs.z]} rotation={[0, facingY, 0]}>
              <PieceCharacter
                pieceClass={obs.pieceClass || 'pawn'}
                color={obs.pieceColor || 'w'}
                scale={0.85}
                hp={obs.hitsRemaining * 25}
                maxHp={75}
                isChilled={isFrozen}
              />
              {isFrozen && (
                <mesh position={[0, 0.45, 0]}>
                  <cylinderGeometry args={[0.45, 0.45, 0.9, 8]} />
                  <meshStandardMaterial
                    color="#67e8f9"
                    emissive="#06b6d4"
                    transparent
                    opacity={0.6}
                  />
                </mesh>
              )}
            </group>
          );
        })}
    </group>
  );
};
