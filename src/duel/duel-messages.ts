export const MATCHMAKING_MESSAGES = {
  alreadyQueued: "You're already in the queue.",
  inDuel: "You're already in a duel.",
  notQueued: "You're not in the queue.",
  opponentLeft: 'Your opponent left.',
} as const;

export const ROOM_MESSAGES = {
  alreadyHosting: 'You already have a room open.',
  notHosting: "You don't have a room open.",
  noRoom: 'No open room has that code.',
  ownRoom: "That's your own room.",
  hosting: 'You have a room open. Close it to join the queue.',
} as const;

// The mock's wording, which the web already shows
export const DUEL_START_MESSAGES = {
  filtersClosed: 'Filters are not open right now.',
  emptyPool: 'No match fits those filters. Try widening them.',
  emptiedSinceFlip: 'No match fits the winning filters.',
} as const;

export const DUEL_PLAY_MESSAGES = {
  waitTurn: 'Wait for your turn.',
  roundOver: 'That round had already ended.',
  notRunning: 'This duel is not running.',
  otherDuel: 'That guess is for another duel.',
  noDuel: 'There is no duel to forfeit.',
} as const;
