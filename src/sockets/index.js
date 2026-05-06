const { rooms } = require('../store');
const { genCode, buildPlayerView } = require('../game/helpers');
const {
  setBroadcast,
  initGameState,
  handleAnnounce,
  handlePlayCard,
  handleResolveExcuse,
  handleNextRound
} = require('../game/logic');

module.exports = function(io) {

  function broadcast(room) {
    room.players.forEach(p => {
      if (p.socketId) {
        const view = buildPlayerView(room, p.id);
        io.to(p.socketId).emit('game_state', view);
      }
    });
    io.to(room.code).emit('lobby_state', {
      code: room.code,
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, ready: p.ready })),
      hostId: room.hostId,
      started: !!room.state,
    });
  }

  setBroadcast(broadcast);

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
};
