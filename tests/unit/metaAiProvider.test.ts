import test from 'node:test';
import assert from 'node:assert/strict';
import type { MatchSnapshot } from '../../packages/shared/src/index.ts';
import {
  MetaAiProvider,
  createAiProviderFromEnv,
  describeSnapshotForPrompt,
} from '../../apps/server/src/match/metaAiProvider.ts';
import {
  defaultTacticalAdvice,
  explainPosition,
} from '../../apps/server/src/match/aiAdvisor.ts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    roomId: 'TEST01',
    revision: 1,
    phase: 'chess_turn',
    mode: 'pvp',
    fen: START_FEN,
    turn: 'w',
    pendingCapture: null,
    duelSnapshot: null,
    players: {
      w: { color: 'w', connected: true, calibrated: true, pingMs: 0 },
      b: { color: 'b', connected: true, calibrated: true, pingMs: 0 },
    },
    winner: null,
    legalMoves: {},
    serverTime: 0,
    simulationTime: 0,
    paused: false,
    ...overrides,
  } as MatchSnapshot;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('provider posts an OpenAI-compatible chat completion with the game state', async () => {
  let seenUrl = '';
  let seenInit: RequestInit | undefined;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return jsonResponse({ choices: [{ message: { content: '  White to move — make it count, both of you.  ' } }] });
  }) as typeof fetch;

  const provider = new MetaAiProvider({ apiKey: 'test-key', fetchFn });
  const advice = await provider.explainPosition(makeSnapshot(), AbortSignal.timeout(5000));

  assert.equal(advice, 'White to move — make it count, both of you.');
  assert.equal(seenUrl, 'https://api.meta.ai/v1/chat/completions');
  const headers = seenInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(String(seenInit?.body)) as {
    model: string;
    max_tokens: number;
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.model, 'muse-spark-1.1');
  assert.equal(body.max_tokens, 180);
  assert.match(body.messages[1].content, new RegExp(START_FEN.replace(/\//g, '\\/')));
});

test('prompt description includes a pending capture duel and its stakes', () => {
  const text = describeSnapshotForPrompt(
    makeSnapshot({
      pendingCapture: {
        from: 'e4',
        to: 'd5',
        attackerColor: 'w',
        attackerClass: 'pawn',
        defenderClass: 'knight',
      },
    })
  );
  assert.match(text, /pawn captures knight/);
  assert.match(text, /e4 to d5/);
});

test('HTTP failure throws so aiAdvisor can fall back to template advice', async () => {
  const failing = new MetaAiProvider({
    apiKey: 'test-key',
    fetchFn: (async () => jsonResponse({ error: 'nope' }, 401)) as typeof fetch,
  });
  await assert.rejects(
    () => failing.explainPosition(makeSnapshot(), AbortSignal.timeout(5000)),
    /HTTP 401/
  );

  const snapshot = makeSnapshot();
  const advice = await explainPosition(failing, snapshot);
  assert.equal(advice, defaultTacticalAdvice(snapshot));
});

test('successful provider result is used by explainPosition', async () => {
  const provider = new MetaAiProvider({
    apiKey: 'test-key',
    fetchFn: (async () =>
      jsonResponse({ choices: [{ message: { content: 'Live AI line.' } }] })) as typeof fetch,
  });
  assert.equal(await explainPosition(provider, makeSnapshot()), 'Live AI line.');
});

test('createAiProviderFromEnv: null without a key, Meta defaults with one', () => {
  assert.equal(createAiProviderFromEnv({}), null);
  const provider = createAiProviderFromEnv({ META_API_KEY: 'k' });
  assert.ok(provider instanceof MetaAiProvider);
  assert.equal(provider?.baseUrl, 'https://api.meta.ai/v1');
  assert.equal(provider?.model, 'muse-spark-1.1');

  const custom = createAiProviderFromEnv({
    AI_API_KEY: 'k2',
    AI_BASE_URL: 'https://example.test/v1/',
    AI_MODEL: 'some-model',
  });
  assert.equal(custom?.baseUrl, 'https://example.test/v1');
  assert.equal(custom?.model, 'some-model');
});
