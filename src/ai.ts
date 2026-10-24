import type { Game } from './game.ts';

// Supply a provider later. Keep credentials and API calls on the server.
// Providers receive a copy of the state and cannot mutate the live game.
export interface AiProvider {
  explainPosition(state: Readonly<Game>, signal: AbortSignal): Promise<string>;
}
export async function explainPosition(provider: AiProvider, game: Game): Promise<string> {
  const signal = AbortSignal.timeout(5000);
  return Promise.race([
    provider.explainPosition(structuredClone(game), signal),
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('AI request timed out')), { once: true })),
  ]);
}
