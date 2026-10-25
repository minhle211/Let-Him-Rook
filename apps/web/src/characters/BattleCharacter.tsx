import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

interface Props {
  mounted: boolean;
  armor: string;
  trim: string;
  cloth: string;
  hit: boolean;
  attacking: boolean;
  windingUp: boolean;
  shotCount: number;
}

// Shared simple shapes keep these models easy to edit and inexpensive to draw.
function Block({ at, size, color }: { key?: string | number; at: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh castShadow position={at}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>;
}

export function BattleCharacter({ mounted, armor, trim, cloth, hit, attacking, windingUp, shotCount }: Props) {
  const body = useRef<Group>(null);
  const weapon = useRef<Group>(null);
  const legs = useRef<Group>(null);
  const rider = useRef<Group>(null);
  const flash = useRef<Group & { visible: boolean }>(null);
  const motion = useRef({ shot: shotCount, active: false, elapsed: 1 });
  const cannon = attacking
    ? shotCount > 0 && shotCount % 3 === 0
    : shotCount % 3 === 2;
  useFrame((_, delta) => {
    const state = motion.current;
    // A knight starts once on its accepted skill, rather than again on impact.
    const active = mounted ? windingUp : attacking;
    if (shotCount !== state.shot || (active && !state.active)) state.elapsed = 0;
    state.shot = shotCount;
    state.active = active;
    state.elapsed += Math.min(delta, 0.05);
    const t = state.elapsed;
    const smooth = (v: number) => {
      const x = Math.max(0, Math.min(1, v));
      return x * x * (3 - 2 * x);
    };
    // Dash ends at 220ms; the spear thrust follows, peaking at 350ms.
    const dash = smooth(t / 0.22) * (1 - smooth((t - 0.42) / 0.24));
    const thrust = smooth((t - 0.22) / 0.13) * (1 - smooth((t - 0.38) / 0.22));
    const recoil = t < 0.09 ? smooth(t / 0.09) : 1 - smooth((t - 0.09) / 0.25);
    const raise = t < 0.4 ? 1 : 1 - smooth((t - 0.4) / 0.2);
    if (body.current) {
      body.current.position.z = mounted ? -dash * 0.28 : recoil * 0.035;
      body.current.rotation.x = mounted ? -dash * 0.08 : -recoil * 0.045;
    }
    if (weapon.current) {
      weapon.current.position.z = mounted ? -thrust * 0.3 : recoil * (cannon ? 0.18 : 0.09);
      weapon.current.position.y = mounted ? 0 : raise * 0.1;
      weapon.current.rotation.x = mounted ? -thrust * 0.08 : -raise * 0.08 - recoil * (cannon ? 0.2 : 0.1);
    }
    if (rider.current) {
      rider.current.position.z = 0.05 - thrust * 0.08;
      rider.current.rotation.x = -thrust * 0.14;
    }
    if (legs.current) legs.current.rotation.x = t < 0.22 ? Math.sin(t * 50) * 0.25 : 0;
    if (flash.current) flash.current.visible = !mounted && t < 0.09;

  });
  const metal = hit ? '#ef4444' : armor;
  return <group>
    <mesh receiveShadow position={[0, 0.08, 0]}><cylinderGeometry args={[0.36, 0.4, 0.16, 10]} /><meshStandardMaterial color={trim} roughness={0.7} /></mesh>
    <group ref={body}>
      {mounted ? <>
        {/* Horse, saddle, four legs, mane and forward-facing muzzle. */}
        <Block at={[0, 0.53, 0.02]} size={[0.34, 0.32, 0.65]} color="#705044" />
        <group ref={legs}>
          {[-0.12, 0.12].flatMap(x => [-0.21, 0.23].map(z => <Block key={x + ':' + z} at={[x, 0.29, z]} size={[0.09, 0.3, 0.1]} color="#49352e" />))}
        </group>
        <Block at={[0, 0.75, -0.23]} size={[0.19, 0.42, 0.2]} color="#705044" />
        <Block at={[0, 0.91, -0.36]} size={[0.2, 0.19, 0.3]} color="#705044" />
        <Block at={[0, 0.81, -0.12]} size={[0.07, 0.43, 0.08]} color="#292524" />
        {[-0.065, 0.065].map(x => <Block key={x} at={[x, 1.04, -0.28]} size={[0.055, 0.12, 0.06]} color="#49352e" />)}
        <Block at={[0, 0.56, 0.39]} size={[0.07, 0.3, 0.09]} color="#292524" />
        <Block at={[0, 0.72, 0.04]} size={[0.38, 0.08, 0.29]} color={cloth} />
        {[-0.22, 0.22].map(x => <Block key={x} at={[x, 0.64, 0.06]} size={[0.12, 0.3, 0.17]} color={metal} />)}
      </> : <>
        {[-0.13, 0.13].map(x => <Block key={x} at={[x, 0.29, 0]} size={[0.19, 0.25, 0.24]} color={metal} />)}
      </>}
      <group ref={mounted ? rider : undefined} position={[0, mounted ? 0.42 : 0, mounted ? 0.05 : 0]}>
        <Block at={[0, 0.56, 0]} size={[mounted ? 0.32 : 0.4, 0.34, 0.26]} color={metal} />
        <Block at={[0, 0.55, -0.145]} size={[0.14, 0.3, 0.025]} color={cloth} />
        <Block at={[0, 0.86, 0]} size={[0.29, 0.27, 0.28]} color={metal} />
        <Block at={[0, 0.88, -0.15]} size={[0.22, 0.055, 0.025]} color="#0f172a" />
        {[-0.16, 0, 0.16].map(x => <Block key={x} at={[x, 1.03, 0]} size={[0.08, 0.12, 0.24]} color={trim} />)}
        {[-0.25, 0.25].map(x => <Block key={x} at={[x, 0.65, -0.03]} size={[0.15, 0.17, 0.22]} color={metal} />)}
      </group>
      <group ref={weapon}>
        {mounted ? <>
          {/* Long forward spear, grip and a small team banner. */}
          <Block at={[0.28, 0.92, -0.3]} size={[0.11, 0.12, 0.16]} color={metal} />
          <mesh position={[0.28, 0.94, -0.46]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 1.15, 6]} /><meshStandardMaterial color="#855c35" /></mesh>
          <mesh position={[0.28, 0.94, -1.1]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.075, 0.22, 4]} /><meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.5} /></mesh>
          <Block at={[-0.22, 1.15, 0.25]} size={[0.025, 0.65, 0.025]} color={trim} />
          <Block at={[-0.1, 1.4, 0.25]} size={[0.24, 0.16, 0.025]} color={cloth} />
        </> : <>
          {/* Both hands support the rifle or the third-shot handheld cannon. */}
          <Block at={[-0.15, 0.59, -0.22]} size={[0.13, 0.13, 0.22]} color={metal} />
          <Block at={[0.15, 0.59, -0.13]} size={[0.13, 0.13, 0.23]} color={metal} />
          <Block at={[0.06, 0.65, -0.15]} size={[0.15, 0.16, 0.3]} color="#614332" />
          <mesh position={[0.06, 0.67, -0.45]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[cannon ? 0.14 : 0.045, cannon ? 0.12 : 0.045, 0.48, 8]} /><meshStandardMaterial color={cannon ? trim : '#334155'} roughness={0.55} metalness={0.4} /></mesh>
          <mesh position={[0.06, 0.67, -0.695]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[cannon ? 0.1 : 0.03, cannon ? 0.1 : 0.03, 0.012, 8]} /><meshBasicMaterial color="#0f172a" /></mesh>
          {!cannon && <Block at={[0.06, 0.79, -0.28]} size={[0.06, 0.07, 0.19]} color="#0f172a" />}
          <group ref={flash} visible={false}>
            <mesh position={[0.06, 0.67, -0.79]}><octahedronGeometry args={[cannon ? 0.2 : 0.11, 0]} /><meshBasicMaterial color="#fbbf24" /></mesh>
          </group>
        </>}
      </group>
    </group>
  </group>;
}
