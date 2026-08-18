/** A refusal the player should see, with a stable code the client can branch on. */
export class GameError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const errors = {
  unauthorized: () => new GameError('unauthorized', 'Sign in to play', 401),
  forbidden: (msg = 'Not yours') => new GameError('forbidden', msg, 403),
  notFound: (what: string) => new GameError('not_found', `${what} not found`, 404),
  rateLimited: (retryAfter: number) =>
    new GameError('rate_limited', 'Slow down a moment', 429, { retryAfter }),
  levelLocked: (what: string, lvl: number) =>
    new GameError('level_locked', `${what} unlocks at level ${lvl}`, 400),
  notEnoughCoins: () => new GameError('insufficient_coins', 'Not enough coins', 400),
  notEnoughHay: () => new GameError('insufficient_hay', 'Not enough $HAY', 400),
  missingItems: (need: Record<string, number>) =>
    new GameError('missing_items', 'Missing ingredients', 400, { need }),
  noSpace: (store: 'silo' | 'barn') =>
    new GameError('no_space', store === 'silo' ? 'Silo is full — sell or upgrade' : 'Barn is full', 400),
  notReady: (what: string) => new GameError('not_ready', `${what} is still working`, 400),
  queueFull: (name: string) => new GameError('queue_full', `${name} queue is full`, 400),
  disabled: (what: string) => new GameError('disabled', `${what} is not available yet`, 503),
  badRequest: (msg: string, details?: unknown) => new GameError('bad_request', msg, 400, details),
  conflict: (msg: string) => new GameError('conflict', msg, 409),
  inviteRequired: () => new GameError('invite_required', 'This beta needs an invite code', 403),
  inviteInvalid: () => new GameError('invite_invalid', 'That invite code is not right', 403),
};
