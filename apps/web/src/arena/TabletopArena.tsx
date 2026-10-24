import React, { useMemo } from 'react';
import {
  FIXED_PROPS,
  getBoardPiecesFromFen,
  indexToSquare,
  squareToTableCoords,
  type BoardSquare,
  type MatchPhase,
  type ObstacleState,
} from '@let-him-rook/shared';
import { PieceCharacter } from '../characters/PieceCharacter.tsx';

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

  const propsById = useMemo(() => {
    const map = new Map<string, ObstacleState>();
    for (const obs of obstacles) {
      map.set(obs.id, obs);
    }
    return map;
  }, [obstacles]);

  const isDuel = phase === 'active_duel' || phase === 'duel_intro' || phase === 'duel_result';

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
      {/* 14x14 Tabletop Wood Base */}
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[14, 0.4, 14]} />
        <meshStandardMaterial color="#2d1d13" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* 4 Glowing Perimeter Boundary Rails along outer edges of 14x14 tabletop ([-7, 7]) */}
      <group position={[0, 0.06, 0]}>
        {/* North Rail (z = -7) */}
        <mesh position={[0, 0, -7]}>
          <boxGeometry args={[14.12, 0.12, 0.12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.85} />
        </mesh>
        {/* South Rail (z = +7) */}
        <mesh position={[0, 0, 7]}>
          <boxGeometry args={[14.12, 0.12, 0.12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.85} />
        </mesh>
        {/* West Rail (x = -7) */}
        <mesh position={[-7, 0, 0]}>
          <boxGeometry args={[0.12, 0.12, 14.12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.85} />
        </mesh>
        {/* East Rail (x = +7) */}
        <mesh position={[7, 0, 0]}>
          <boxGeometry args={[0.12, 0.12, 14.12]} />
          <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.85} />
        </mesh>
      </group>

      {/* 8x8 Chessboard Inset Border */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[8.4, 0.04, 8.4]} />
        <meshStandardMaterial color="#1f140e" roughness={0.6} />
      </mesh>

      {/* 64 Chessboard Squares */}
      {squares.map(({ square, x, z, isDark }) => {
        const isHover = hoverSquare === square;
        const isSelected = selectedSquare === square;
        const isLegal = legalDestinations.includes(square);

        let color = isDark ? '#4a3222' : '#d2b48c';
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
              <boxGeometry args={[0.96, 0.02, 0.96]} />
              <meshStandardMaterial
                color={color}
                roughness={0.5}
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

      {/* 4 Fixed Tabletop Props: 2 Glasses and 2 Plant Vases */}
      {FIXED_PROPS.map(prop => {
        const state = propsById.get(prop.id);
        const hits = state?.hitsRemaining ?? 3;
        const isFrozen = (state?.frozenRemainingMs ?? 0) > 0;
        if (hits <= 0) return null; // Broken

        const opacity = hits === 3 ? 0.85 : hits === 2 ? 0.65 : 0.45;

        if (prop.type === 'glass') {
          return (
            <group key={prop.id} position={[prop.x, 0.45, prop.z]}>
              {/* Tumbler Glass */}
              <mesh castShadow receiveShadow>
                <cylinderGeometry args={[0.38, 0.32, 0.9, 16]} />
                <meshPhysicalMaterial
                  color="#dbeafe"
                  transmission={0.75}
                  opacity={opacity}
                  transparent
                  roughness={0.12}
                  ior={1.45}
                />
              </mesh>
              {/* Frozen ice crystal shell */}
              {isFrozen && (
                <mesh>
                  <cylinderGeometry args={[0.42, 0.36, 0.96, 8]} />
                  <meshStandardMaterial
                    color="#67e8f9"
                    emissive="#06b6d4"
                    transparent
                    opacity={0.65}
                  />
                </mesh>
              )}
            </group>
          );
        }

        // Ceramic Plant Vase
        return (
          <group key={prop.id} position={[prop.x, 0.5, prop.z]}>
            {/* Ceramic Pot */}
            <mesh castShadow receiveShadow position={[0, 0, 0]}>
              <cylinderGeometry args={[0.42, 0.3, 0.8, 16]} />
              <meshStandardMaterial color="#9a3412" roughness={0.8} />
            </mesh>
            {/* Foliage */}
            <mesh position={[0, 0.55, 0]}>
              <sphereGeometry args={[0.45, 12, 12]} />
              <meshStandardMaterial color="#15803d" roughness={0.9} />
            </mesh>
            {/* Frozen ice crystal shell */}
            {isFrozen && (
              <mesh position={[0, 0.3, 0]}>
                <cylinderGeometry args={[0.5, 0.4, 1.4, 8]} />
                <meshStandardMaterial
                  color="#67e8f9"
                  emissive="#06b6d4"
                  transparent
                  opacity={0.65}
                />
              </mesh>
            )}
          </group>
        );
      })}

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
