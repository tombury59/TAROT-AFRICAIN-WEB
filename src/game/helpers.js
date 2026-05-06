const crypto = require('crypto');

function genCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [];
  for (let i = 1; i <= 21; i++) deck.push({ value: i, isExcuse: false, id: `T${i}` });
  deck.push({ value: null, isExcuse: true, id: 'EXCUSE' });
  return deck;
}

// Dynamic round sizes based on number of players
// 3 players → max 7 cards, 4 players → max 5, 5 players → max 4
function getRoundSize(roundIdx, numPlayers) {
  const maxCards = Math.floor(22 / numPlayers);
  // Cycle: maxCards, maxCards-1, ..., 2, 1, maxCards, maxCards-1, ...
  return maxCards - (roundIdx % maxCards);
}

// Build the "view" a specific player sees
function buildPlayerView(room, playerId) {
  const gs = room.state;
  if (!gs) return null;

  const myIdx = room.players.findIndex(p => p.id === playerId);
  const gs_players = gs.players.map((gp, i) => {
    const isMe = i === myIdx;
    let hand;
    if (gs.oneCardSpecial) {
      // In 1-card round: you see everyone's cards except your own
      hand = isMe
        ? gp.hand.map(() => ({ hidden: true }))
        : gp.hand;
    } else {
      // Normal: you only see your own hand
      hand = isMe ? gp.hand : gp.hand.map(() => ({ hidden: true }));
    }
    return {
      ...gp,
      hand,
      isMe,
    };
  });

  return {
    phase: gs.phase,
    roundIdx: gs.roundIdx,
    roundSize: getRoundSize(gs.roundIdx, gs.players.length),
    dealerIdx: gs.dealerIdx,
    currentPlayerIdx: gs.currentPlayerIdx,
    announceIdx: gs.announceIdx,
    currentTrick: gs.currentTrick,
    lastCompletedTrick: gs.lastCompletedTrick || null,
    lastTrickWinnerIdx: gs.lastTrickWinnerIdx !== undefined ? gs.lastTrickWinnerIdx : null,
    tricksPlayed: gs.tricksPlayed,
    oneCardSpecial: gs.oneCardSpecial,
    excuseWaiting: gs.excuseWaiting ? { playerIdx: gs.excuseWaiting.playerIdx } : null,
    players: gs_players,
    myIdx,
    log: gs.log.slice(-8),
  };
}



module.exports = {
  genCode,
  shuffle,
  buildDeck,
  getRoundSize,
  buildPlayerView
};
