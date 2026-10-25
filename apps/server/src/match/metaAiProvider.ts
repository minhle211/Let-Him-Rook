import type { MatchSnapshot } from '@let-him-rook/shared';
import type { AiProvider } from './aiAdvisor.ts';

/**
 * Live AI advice provider for the Meta Model API (Muse Spark), built on the
 * OpenAI-compatible chat completions endpoint:
 *
 *   POST {baseUrl}/chat/completions   Authorization: Bearer <META_API_KEY>
 *
 * Defaults target Meta's endpoint and `muse-spark-1.1`. Because the endpoint
 * is OpenAI-compatible, the same code works with any compatible provider by
 * changing AI_BASE_URL / AI_MODEL (e.g. a free tier used as a fallback).
 *
 * No API key, no provider: `createAiProviderFromEnv()` returns null and
 * aiAdvisor falls back to its built-in template advice, so the game always
 * runs — the AI is an enhancement, never a single point of failure.
 *
 * The key is read from the server environment (or a local `.env` file, which
 * is git-ignored). It is never sent to clients and never logged.
 */

export const DEFAULT_META_AI_BASE_URL = 'https://api.meta.ai/v1';
export const DEFAULT_META_AI_MODEL = 'muse-spark-1.1';

export interface MetaAiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Cap on generated tokens per advice call — keeps free credits lasting. */
  maxTokens?: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

const SYSTEM_PROMPT = [
  'You are the AI host of "Let Him Rook", a social chess game where two friends',
  'in different places fight a real-time, webcam-gesture duel whenever one of',
  'them attempts a capture. You speak to BOTH players at once.',
  'Given the match state, reply with 2-3 short sentences (max 60 words), plain',
  'text, no markdown. Cover: (1) what is at stake right now, in concrete chess',
  'or duel terms taken only from the state given, and (2) one friendly,',
  'specific line the two players can react to — encouragement, a gentle',
  'rivalry nudge, or what a rematch could settle. Never invent pieces, moves,',
  'or results that are not in the state. Never claim you decided a game',
  'outcome: the game server decides all rules and results.',
].join(' ');

export function describeSnapshotForPrompt(snapshot: Readonly<MatchSnapshot>): string {
  const lines: string[] = [
    `Mode: ${snapshot.mode}`,
    `Phase: ${snapshot.phase}`,
    `Side to move: ${snapshot.turn === 'w' ? 'White' : 'Black'}`,
    `Board (FEN): ${snapshot.fen}`,
    `Match paused: ${snapshot.paused ? 'yes' : 'no'}`,
  ];
  if (snapshot.pendingCapture) {
    const c = snapshot.pendingCapture;
    lines.push(
      `Capture duel about to start: ${c.attackerColor === 'w' ? 'White' : 'Black'} ${c.attackerClass} ` +
        `captures ${c.defenderClass} moving ${c.from} to ${c.to}. In this game the capture only ` +
        `succeeds if the attacker wins the duel.`
    );
  }
  if (snapshot.duelSnapshot) {
    const d = snapshot.duelSnapshot;
    lines.push(
      `Duel in progress: attacker ${d.attacker.pieceClass} (${d.attacker.color === 'w' ? 'White' : 'Black'}) ` +
        `at ${Math.round(d.attacker.hp)}/${d.attacker.maxHp} HP vs defender ${d.defender.pieceClass} ` +
        `(${d.defender.color === 'w' ? 'White' : 'Black'}) at ${Math.round(d.defender.hp)}/${d.defender.maxHp} HP, ` +
        `${Math.round(d.remainingMs / 1000)} seconds left.`
    );
  }
  if (snapshot.winner) {
    lines.push(
      `Match over: winner is ${snapshot.winner === 'draw' ? 'neither player (draw)' : snapshot.winner === 'w' ? 'White' : 'Black'}` +
        (snapshot.winReason ? ` — ${snapshot.winReason}` : '') +
        '. This is the moment for the shared recap and a rematch nudge.'
    );
  }
  return lines.join('\n');
}

export class MetaAiProvider implements AiProvider {
  public readonly baseUrl: string;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: MetaAiProviderConfig) {
    if (!config.apiKey) {
      throw new Error('MetaAiProvider requires an API key');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_META_AI_BASE_URL).replace(/\/+$/, '');
    this.model = config.model || DEFAULT_META_AI_MODEL;
    this.maxTokens = config.maxTokens ?? 180;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  public async explainPosition(
    snapshot: Readonly<MatchSnapshot>,
    signal: AbortSignal
  ): Promise<string> {
    const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: describeSnapshotForPrompt(snapshot) },
        ],
        max_tokens: this.maxTokens,
        temperature: 0.7,
      }),
      signal,
    });

    if (!response.ok) {
      // aiAdvisor catches this and serves the template advice instead.
      throw new Error(`AI provider request failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('AI provider returned an empty response');
    }
    return content.trim();
  }
}

/**
 * Build a provider from environment variables, or return null when no key is
 * configured (the game then uses its built-in template advice).
 *
 *   META_API_KEY   Meta Model API key (aliases: AI_API_KEY)
 *   AI_BASE_URL    Override endpoint (default https://api.meta.ai/v1)
 *   AI_MODEL       Override model (default muse-spark-1.1)
 *
 * Also attempts to load a local `.env` file first (Node's built-in loader),
 * so `cp .env.example .env`, filling in the key, and `npm run host` is all a
 * host needs to do. `.env` is already covered by .gitignore.
 */
export function createAiProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): MetaAiProvider | null {
  if (env === process.env) {
    try {
      // Loads .env from the current working directory when present.
      // The host entry point chdirs to the repo root before starting.
      process.loadEnvFile();
    } catch {
      // No .env file — real environment variables still apply.
    }
  }
  const apiKey = env.META_API_KEY || env.AI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new MetaAiProvider({
    apiKey,
    baseUrl: env.AI_BASE_URL || env.META_AI_BASE_URL || DEFAULT_META_AI_BASE_URL,
    model: env.AI_MODEL || env.META_AI_MODEL || DEFAULT_META_AI_MODEL,
  });
}
