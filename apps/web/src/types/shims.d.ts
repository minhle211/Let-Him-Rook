/// <reference types="node" />

declare namespace React {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P) => any;
  export type FormEvent<T = any> = { preventDefault(): void; target: any };
  export interface RefObject<T> {
    readonly current: T | null;
  }
}

declare module 'react' {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P) => any;
  export type FormEvent<T = any> = { preventDefault(): void; target: any };
  export interface RefObject<T> {
    readonly current: T | null;
  }
  export function useState<T>(initial: T | (() => T)): [T, (val: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void;
  export function useRef<T>(initial?: T | null): { current: T };
  export function useMemo<T>(factory: () => T, deps?: any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: any[]): T;
  export function createContext<T>(defaultValue: T): any;
  export function useContext<T>(context: any): T;
  export const Fragment: any;
  const _default: {
    useState: typeof useState;
    useEffect: typeof useEffect;
    useRef: typeof useRef;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    createContext: typeof createContext;
    useContext: typeof useContext;
    Fragment: typeof Fragment;
  };
  export default _default;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module 'react-dom' {
  export interface Root {
    render(children: any): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
  const _default: {
    createRoot: typeof createRoot;
  };
  export default _default;
}

declare module 'react-dom/client' {
  export interface Root {
    render(children: any): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
  const _default: {
    createRoot: typeof createRoot;
  };
  export default _default;
}

declare module 'three' {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    lerp(v: Vector3, alpha: number): this;
  }
  export class Euler {
    constructor(x?: number, y?: number, z?: number, order?: string);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }
  export class Color {
    constructor(color?: string | number);
    set(color: string | number): this;
  }
  export class Group {
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
  }
  export class Mesh {
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
  }
  export const MathUtils: {
    lerp(x: number, y: number, t: number): number;
  };
}

declare module '@react-three/fiber' {
  export interface CanvasProps {
    children?: any;
    camera?: any;
    shadows?: boolean;
    style?: any;
    gl?: any;
  }
  export const Canvas: (props: CanvasProps) => any;
  export function useFrame(callback: (state: any, delta: number) => void): void;
  export function useThree(): {
    camera: any;
    scene: any;
    gl: any;
    size: { width: number; height: number };
  };
}

declare module '@react-three/drei' {
  export const OrbitControls: (props: any) => any;
  export const Text: (props: any) => any;
  export const Float: (props: any) => any;
  export const Billboard: (props: any) => any;
}

declare module '@mediapipe/tasks-vision' {
  export interface FilesetResolver {
    forVisionTasks(wasmPath: string): Promise<any>;
  }
  export const FilesetResolver: FilesetResolver;
  export interface HandLandmarkerResult {
    landmarks: Array<Array<{ x: number; y: number; z: number }>>;
    handednesses: Array<Array<{ index: number; score: number; categoryName: string; displayName: string }>>;
  }
  export interface PoseLandmarkerResult {
    landmarks: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>;
  }
  export class HandLandmarker {
    static createFromOptions(wasm: any, options: any): Promise<HandLandmarker>;
    detectForVideo(video: HTMLVideoElement | ImageBitmap, timestamp: number): HandLandmarkerResult;
  }
  export class PoseLandmarker {
    static createFromOptions(wasm: any, options: any): Promise<PoseLandmarker>;
    detectForVideo(video: HTMLVideoElement | ImageBitmap, timestamp: number): PoseLandmarkerResult;
  }
}

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_WS_URL?: string;
  readonly VITE_ALLOW_DEV_CONTROLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
