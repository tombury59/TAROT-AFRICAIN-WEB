const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Game state store ───────────────────────────────────────────────────────
// rooms[code] = { code, hostId, state: GameState, players: [{id, name, color, socketId}] }
const rooms = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

function broadcast(room) {
  room.players.forEach(p => {
    if (p.socketId) {
      const view = buildPlayerView(room, p.id);
      io.to(p.socketId).emit('game_state', view);
    }
  });
  // Also send lobby state
  io.to(room.code).emit('lobby_state', {
    code: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
    hostId: room.hostId,
    started: !!room.state,
  });
}

// ─── Game Logic ──────────────────────────────────────────────────────────────
function initGameState(room) {
  const n = room.players.length;

  // Draw highest card to find first dealer
  const deck = shuffle(buildDeck());
  let highest = -1, dealerIdx = 0;
  for (let i = 0; i < n; i++) {
    const card = deck[i];
    const val = card.isExcuse ? -1 : card.value;
    if (val > highest) { highest = val; dealerIdx = i; }
  }

  room.state = {
    phase: 'lobby',
    roundIdx: 0,
    dealerIdx,
    currentPlayerIdx: (dealerIdx + 1) % n,
    announceIdx: (dealerIdx + 1) % n,
    leadPlayerIdx: (dealerIdx + 1) % n,
    currentTrick: [],
    lastCompletedTrick: null,
    lastTrickWinnerIdx: null,
    tricksPlayed: 0,
    oneCardSpecial: false,
    excuseWaiting: null,
    log: [],
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      lives: 10,
      hand: [],
      announced: null,
      tricksWon: 0,
    })),
  };

  dealRound(room);
}

function dealRound(room) {
  const gs = room.state;
  const n = gs.players.length;
  const size = getRoundSize(gs.roundIdx, n);
  const deck = shuffle(buildDeck());

  gs.oneCardSpecial = size === 1;
  gs.currentTrick = [];
  gs.lastCompletedTrick = null;
  gs.lastTrickWinnerIdx = null;
  gs.tricksPlayed = 0;
  gs.excuseWaiting = null;

  gs.players.forEach((p, i) => {
    p.hand = deck.slice(i * size, (i + 1) * size);
    p.announced = null;
    p.tricksWon = 0;
  });

  gs.phase = 'announce';
  gs.announceIdx = (gs.dealerIdx + 1) % n;
  gs.currentPlayerIdx = gs.announceIdx;
  gs.leadPlayerIdx = (gs.dealerIdx + 1) % n;

  const roundSize = getRoundSize(gs.roundIdx, n);
  gs.log.push(`📋 Manche ${gs.roundIdx + 1} — ${roundSize} carte${roundSize > 1 ? 's' : ''}`);
}

function getTotalAnnounced(gs) {
  return gs.players.reduce((s, p) => s + (p.announced !== null ? p.announced : 0), 0);
}

// Auto-play all cards in 1-card special round (all cards revealed at once)
function autoPlayOneCard(room) {
  const gs = room.state;
  const n = gs.players.length;

  let excusePlayerIdx = -1;
  gs.players.forEach((p, i) => {
    const card = p.hand[0];
    if (card.isExcuse) {
      excusePlayerIdx = i;
      gs.currentTrick.push({ card: { ...card, effectiveValue: null }, playerIdx: i });
    } else {
      card.effectiveValue = card.value;
      gs.currentTrick.push({ card, playerIdx: i });
    }
    p.hand = [];
  });

  if (excusePlayerIdx >= 0) {
    gs.excuseWaiting = { playerIdx: excusePlayerIdx, cardId: 'EXCUSE' };
    gs.log.push(`⭐ ${gs.players[excusePlayerIdx].name} doit choisir la valeur de l'Excuse`);
  } else {
    // Broadcast first so players see the cards on the table
    broadcast(room);
    // Then resolve after a delay so they can see the result
    setTimeout(() => {
      if (!room.state || room.state.phase !== 'play') return;
      resolveTrick(room);
      broadcast(room);
    }, 2500);
    return 'delayed'; // Signal to caller not to broadcast again
  }
}

function handleAnnounce(room, playerIdx, num) {
  const gs = room.state;
  const n = gs.players.length;
  if (gs.phase !== 'announce') return { error: 'Mauvaise phase' };
  if (playerIdx !== gs.announceIdx) return { error: 'Ce n\'est pas votre tour d\'annoncer' };

  const size = getRoundSize(gs.roundIdx, n);
  const remaining = gs.players.filter(p => p.announced === null).length;
  const isLast = remaining === 1;

  if (isLast) {
    const forbidden = size - getTotalAnnounced(gs);
    if (num === forbidden) return { error: `Annonce interdite ! (ferait total = ${size})` };
  }

  if (num < 0 || num > size) return { error: 'Annonce invalide' };

  gs.players[playerIdx].announced = num;
  gs.log.push(`🗣 ${gs.players[playerIdx].name} annonce ${num}`);

  // Find next to announce
  if (gs.players.every(p => p.announced !== null)) {
    gs.phase = 'play';
    gs.currentPlayerIdx = gs.leadPlayerIdx;

    if (gs.oneCardSpecial) {
      // 1-card round: auto-play all cards at once
      gs.log.push('🃏 Manche spéciale — révélation des cartes !');
      const autoResult = autoPlayOneCard(room);
      if (autoResult === 'delayed') return { delayed: true };
    } else {
      gs.log.push(`🃏 Phase de jeu — ${gs.players[gs.leadPlayerIdx].name} commence`);
    }
  } else {
    let next = (gs.announceIdx + 1) % n;
    while (gs.players[next].announced !== null) next = (next + 1) % n;
    gs.announceIdx = next;
    gs.currentPlayerIdx = next;
  }

  return {};
}

function handlePlayCard(room, playerIdx, cardId, excuseValue) {
  const gs = room.state;
  const n = gs.players.length;
  if (gs.phase !== 'play') return { error: 'Mauvaise phase' };
  if (playerIdx !== gs.currentPlayerIdx) return { error: 'Ce n\'est pas votre tour' };
  if (gs.excuseWaiting) return { error: 'Résolvez l\'Excuse d\'abord' };

  const player = gs.players[playerIdx];
  const cardIdx = player.hand.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return { error: 'Carte introuvable' };

  const card = player.hand[cardIdx];

  if (card.isExcuse) {
    if (excuseValue === 0 || excuseValue === 22) {
      card.effectiveValue = excuseValue;
    } else {
      // Need to ask for excuse value
      gs.excuseWaiting = { playerIdx, cardId };
      player.hand.splice(cardIdx, 1);
      gs.currentTrick.push({ card: { ...card, effectiveValue: null }, playerIdx });
      gs.log.push(`⭐ ${player.name} pose l'Excuse (choix en cours...)`);
      return { excuseChoice: true };
    }
  } else {
    card.effectiveValue = card.value;
  }

  player.hand.splice(cardIdx, 1);
  gs.currentTrick.push({ card, playerIdx });
  gs.log.push(`🎴 ${player.name} joue ${card.isExcuse ? 'l\'Excuse' : card.value}`);

  if (gs.currentTrick.length === n) {
    resolveTrick(room);
  } else {
    gs.currentPlayerIdx = (playerIdx + 1) % n;
  }

  return {};
}

function handleResolveExcuse(room, playerIdx, value) {
  const gs = room.state;
  const n = gs.players.length;
  if (!gs.excuseWaiting) return { error: 'Pas d\'Excuse en attente' };
  if (gs.excuseWaiting.playerIdx !== playerIdx) return { error: 'Ce n\'est pas votre Excuse' };
  if (value !== 0 && value !== 22) return { error: 'Valeur invalide' };

  // Update the card in the trick
  const trickEntry = gs.currentTrick.find(t => t.playerIdx === playerIdx && t.card.isExcuse);
  if (trickEntry) trickEntry.card.effectiveValue = value;

  gs.excuseWaiting = null;
  gs.log.push(`⭐ L'Excuse vaut ${value}`);

  if (gs.currentTrick.length === n) {
    resolveTrick(room);
  } else {
    gs.currentPlayerIdx = (playerIdx + 1) % n;
  }

  return {};
}

function resolveTrick(room) {
  const gs = room.state;
  const n = gs.players.length;
  const size = getRoundSize(gs.roundIdx, n);

  let winner = gs.currentTrick[0];
  gs.currentTrick.forEach(t => {
    if ((t.card.effectiveValue ?? -1) > (winner.card.effectiveValue ?? -1)) winner = t;
  });

  gs.players[winner.playerIdx].tricksWon++;
  gs.tricksPlayed++;

  const winnerName = gs.players[winner.playerIdx].name;
  gs.log.push(`✅ Pli remporté par ${winnerName} (${gs.tricksPlayed}/${size})`);

  // Save completed trick before clearing so clients can display it
  gs.lastCompletedTrick = [...gs.currentTrick];
  gs.lastTrickWinnerIdx = winner.playerIdx;
  gs.currentTrick = [];
  gs.leadPlayerIdx = winner.playerIdx;
  gs.currentPlayerIdx = winner.playerIdx;

  if (gs.tricksPlayed === size) {
    gs.phase = 'score';
    gs.log.push('📊 Fin de manche — décompte des points');
  }
}

function handleNextRound(room) {
  const gs = room.state;
  const n = gs.players.length;

  // Apply scores
  const results = gs.players.map(p => {
    const diff = Math.abs((p.announced || 0) - p.tricksWon);
    return { name: p.name, announced: p.announced, won: p.tricksWon, diff };
  });

  gs.players.forEach((p, i) => {
    const diff = results[i].diff;
    p.lives -= diff;
    if (p.lives < 0) p.lives = 0;
  });

  // Log results
  results.forEach(r => {
    const diff = r.diff;
    if (diff === 0) gs.log.push(`✨ ${r.name} : ${r.won}/${r.announced} — EXACT !`);
    else gs.log.push(`💀 ${r.name} : ${r.won}/${r.announced} — -${diff} vie${diff > 1 ? 's' : ''}`);
  });

  // Check game end: last player standing with lives (after min 2 full cycles)
  const allZero = gs.players.every(p => p.lives <= 0);
  if (allZero || (gs.roundIdx >= n * 2 && gs.players.filter(p => p.lives > 0).length <= 1)) {
    gs.phase = 'end';
    gs.log.push('🏆 Partie terminée !');
    return;
  }

  // Reset lives at 0
  gs.players.forEach(p => { if (p.lives <= 0) p.lives = 10; });

  gs.roundIdx++;
  gs.dealerIdx = (gs.dealerIdx + 1) % n;
  dealRound(room);
}

// ─── Socket.io events ────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('create_room', ({ name, color }) => {
    const code = genCode();
    const playerId = socket.id;
    rooms[code] = {
      code,
      hostId: playerId,
      state: null,
      players: [{
        id: playerId,
        socketId: socket.id,
        name: name || 'Hôte',
        color: color || '#c9a84c',
        ready: true,
      }],
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    broadcast(rooms[code]);
    socket.emit('joined', { code, playerId });
  });

  socket.on('join_room', ({ code, name, color }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Salon introuvable');
    if (room.state) return socket.emit('error', 'La partie a déjà commencé');
    if (room.players.length >= 5) return socket.emit('error', 'Salon plein (5 joueurs max)');

    const playerId = socket.id;
    room.players.push({
      id: playerId,
      socketId: socket.id,
      name: name || `Joueur ${room.players.length + 1}`,
      color: color || '#2563eb',
      ready: true,
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    broadcast(room);
    socket.emit('joined', { code, playerId });
  });

  socket.on('start_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (socket.id !== room.hostId) return socket.emit('error', 'Seul l\'hôte peut lancer la partie');
    if (room.players.length < 3) return socket.emit('error', 'Il faut au moins 3 joueurs');

    initGameState(room);
    broadcast(room);
  });

  socket.on('announce', ({ num }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.state) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx === -1) return;

    const result = handleAnnounce(room, playerIdx, num);
    if (result.error) return socket.emit('error', result.error);
    if (!result.delayed) broadcast(room);
  });

  socket.on('play_card', ({ cardId, excuseValue }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.state) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx === -1) return;

    const result = handlePlayCard(room, playerIdx, cardId, excuseValue);
    if (result.error) return socket.emit('error', result.error);
    broadcast(room);
  });

  socket.on('resolve_excuse', ({ value }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.state) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx === -1) return;

    const result = handleResolveExcuse(room, playerIdx, value);
    if (result.error) return socket.emit('error', result.error);
    broadcast(room);
  });

  socket.on('next_round', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || !room.state) return;
    if (socket.id !== room.hostId) return;

    handleNextRound(room);
    broadcast(room);
  });

  socket.on('restart_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    room.state = null;
    room.players.forEach(p => { p.ready = true; });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) room.players[idx].socketId = null; // Mark as disconnected but keep in game

    // If host disconnected and game not started, pick new host
    if (socket.id === room.hostId && !room.state) {
      const connected = room.players.find(p => p.socketId);
      if (connected) room.hostId = connected.id;
      else { delete rooms[code]; return; }
    }

    broadcast(room);
  });

  socket.on('reconnect_room', ({ code, name }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Salon introuvable');

    // Try to find existing player by name
    const existing = room.players.find(p => p.name === name && !p.socketId);
    if (existing) {
      existing.socketId = socket.id;
      existing.id = socket.id;
      socket.data.roomCode = code;
      socket.data.playerId = socket.id;
      socket.join(code);
      broadcast(room);
      socket.emit('joined', { code, playerId: socket.id });
    } else {
      socket.emit('error', 'Impossible de vous reconnecter');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🃏 Tarot Africain — serveur sur http://localhost:${PORT}`);
});
