import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

interface Props {
  kind: 'bishop' | 'queen' | 'king';
  armor: string;
  cloth: string;
  trim: string;
  attacking: boolean;
  clone: boolean;
}

export function MageCharacter({ kind, armor, cloth, trim, attacking, clone }: Props) {
  const staff = useRef<Group>(null);
  const hands = useRef<Group>(null);
  const circle = useRef<Group & { visible: boolean }>(null);
  const motion = useRef({ active: false, elapsed: 2 });
  const ice = kind === 'bishop';
  const king = kind === 'king';
  const magic = clone ? '#38bdf8' : ice ? '#67e8f9' : king ? '#60a5fa' : '#fb923c';
  const robe = clone ? '#2563eb' : ice ? '#23749a' : king ? cloth : '#9a3412';
  const skin = clone ? '#93c5fd' : '#e7bf9e';
  useFrame((_, delta) => {
    const m = motion.current;
    if (attacking && !m.active) m.elapsed = 0;
    m.active = attacking;
    m.elapsed += Math.min(delta, 0.05);
    const t = m.elapsed;
    const smooth = (n: number) => { const x = Math.max(0, Math.min(1, n)); return x * x * (3 - 2 * x); };
    const lift = smooth(t / 0.18) * (1 - smooth((t - 0.22) / 0.16));
    const push = smooth((t - 0.18) / 0.16) * (1 - smooth((t - 0.4) / 0.22));
    if (staff.current) {
      staff.current.position.y = 0.57 + lift * (king ? 0.24 : 0.14);
      staff.current.position.z = -0.1 - (king ? 0 : push * 0.24);
      staff.current.rotation.x = king ? -lift * 0.18 : -push * 0.85;
    }
    if (hands.current) {
      hands.current.position.z = lift * 0.12 - push * 0.28;
      hands.current.position.y = lift * 0.08;
      hands.current.rotation.x = -push * 0.15;
    }
    if (circle.current) {
      circle.current.visible = king && t >= 0.34 && t < 1.1;
      const size = 0.65 + smooth((t - 0.34) / 0.45) * 0.5;
      circle.current.scale.set(size, size, size);
      circle.current.rotation.y += delta * 0.8;
    }
  });
  return <group>
    <mesh receiveShadow position={[0, 0.08, 0]}><cylinderGeometry args={[0.34, 0.39, 0.16, 10]} /><meshStandardMaterial color={trim} roughness={0.7} /></mesh>
    <mesh castShadow position={[0, 0.47, 0]}><cylinderGeometry args={[0.18, 0.32, 0.62, 8]} /><meshStandardMaterial color={robe} roughness={0.85} flatShading /></mesh>
    {/* Team mantle and a short cloak behind the body. */}
    <mesh castShadow position={[0, 0.73, 0]}><cylinderGeometry args={[0.21, 0.29, 0.18, 8]} /><meshStandardMaterial color={cloth} flatShading /></mesh>
    <mesh castShadow position={[0, 0.48, 0.18]}><boxGeometry args={[0.35, 0.56, 0.07]} /><meshStandardMaterial color={cloth} roughness={0.9} /></mesh>
    <mesh position={[0, 0.5, -0.22]}><boxGeometry args={[0.07, 0.48, 0.035]} /><meshStandardMaterial color={trim} /></mesh>
    <mesh castShadow position={[0, 0.91, -0.015]}><sphereGeometry args={[0.17, 8, 6]} /><meshStandardMaterial color={skin} flatShading roughness={0.85} /></mesh>
    {ice ? <>
      <mesh castShadow position={[0, 1.1, 0.04]}><coneGeometry args={[0.24, 0.43, 6]} /><meshStandardMaterial color={cloth} flatShading /></mesh>
      <mesh position={[0, 0.98, -0.16]}><boxGeometry args={[0.23, 0.055, 0.04]} /><meshStandardMaterial color={armor} /></mesh>
    </> : <>
      <mesh position={[0, 1.055, 0]}><cylinderGeometry args={[0.2, 0.18, 0.1, 8]} /><meshStandardMaterial color={trim} metalness={0.3} roughness={0.6} /></mesh>
      {[-0.14, 0, 0.14].map(x => <mesh key={x} position={[x, 1.17, -0.06]} rotation={[0, 0, -x * 1.7]}><coneGeometry args={[0.06, king ? 0.16 : 0.25, 4]} /><meshStandardMaterial color={king ? trim : magic} emissive={king ? '#000000' : magic} emissiveIntensity={0.3} /></mesh>)}
    </>}
    {/* Eyes remain readable under the hood or crown. */}
    {[-0.055, 0.055].map(x => <mesh key={x} position={[x, 0.94, -0.164]}><boxGeometry args={[0.035, 0.025, 0.025]} /><meshBasicMaterial color="#0f172a" /></mesh>)}
    {king && <mesh castShadow position={[0, 0.78, -0.16]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.14, 0.36, 5]} /><meshStandardMaterial color={clone ? '#bfdbfe' : '#f1f5f9'} flatShading /></mesh>}
    {ice || king ? <group ref={staff} position={[0.3, 0.57, -0.1]}>
      <mesh castShadow><cylinderGeometry args={[0.025, 0.035, 0.95, 6]} /><meshStandardMaterial color={ice ? '#a5d9e8' : '#795538'} roughness={0.8} /></mesh>
      <mesh position={[0, 0.53, 0]}><octahedronGeometry args={[ice ? 0.15 : 0.11, 0]} /><meshStandardMaterial color={magic} emissive={magic} emissiveIntensity={0.7} flatShading /></mesh>
      <mesh position={[0, 0.05, 0]}><boxGeometry args={[0.12, 0.13, 0.14]} /><meshStandardMaterial color={skin} /></mesh>
    </group> : <group ref={hands}>
      {[-0.28, 0.28].map(x => <group key={x} position={[x, 0.68, -0.18]}>
        <mesh castShadow><boxGeometry args={[0.15, 0.18, 0.22]} /><meshStandardMaterial color={robe} /></mesh>
        <mesh position={[0, 0, -0.14]}><sphereGeometry args={[0.08, 6, 4]} /><meshStandardMaterial color={skin} flatShading /></mesh>
        <mesh position={[0, 0.04, -0.18]}><octahedronGeometry args={[0.13, 0]} /><meshStandardMaterial color={magic} emissive={magic} emissiveIntensity={0.9} /></mesh>
        <mesh position={[0, 0.15, -0.18]}><coneGeometry args={[0.06, 0.17, 5]} /><meshBasicMaterial color={clone ? '#bfdbfe' : '#fde68a'} /></mesh>
      </group>)}
    </group>}
    <group ref={circle} visible={false} position={[0, 0.025, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.58, 0.65, 24]} /><meshBasicMaterial color="#60a5fa" transparent opacity={0.8} depthWrite={false} side={2} /></mesh>
      {[0, 1, 2, 3, 4, 5].map(i => <mesh key={i} position={[Math.cos(i * Math.PI / 3) * 0.48, 0, Math.sin(i * Math.PI / 3) * 0.48]} rotation={[-Math.PI / 2, 0, i]}><ringGeometry args={[0.055, 0.085, 4]} /><meshBasicMaterial color="#93c5fd" side={2} /></mesh>)}
    </group>
  </group>;
}
