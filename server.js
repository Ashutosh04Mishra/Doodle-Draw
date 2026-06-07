const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ── Word Bank ─────────────────────────────────────────────────────────────────
const WORD_BANK = {
  animals: {
    easy:   ['cat','dog','fish','bird','lion','bear','duck','frog','cow','pig','hen','ant','bee','owl','fox'],
    medium: ['elephant','giraffe','penguin','dolphin','kangaroo','crocodile','cheetah','flamingo','gorilla','peacock'],
    hard:   ['platypus','salamander','chameleon','narwhal','axolotl','capybara','wolverine','pangolin','tapir','okapi']
  },
  food: {
    easy:   ['pizza','cake','apple','bread','rice','soup','taco','egg','milk','corn','pie','jam','tea'],
    medium: ['spaghetti','sandwich','burrito','pancake','avocado','meatball','dumpling','pretzel','brownie','noodles'],
    hard:   ['tiramisu','bruschetta','couscous','arancini','chimichanga','baklava','pho','ceviche','ratatouille','gazpacho']
  },
  objects: {
    easy:   ['chair','table','book','lamp','door','window','phone','clock','bag','cup','pen','hat','key','bed','box'],
    medium: ['umbrella','keyboard','telescope','compass','calculator','microscope','bicycle','skateboard','suitcase','lantern'],
    hard:   ['periscope','kaleidoscope','protractor','barometer','sextant','theremin','astrolabe','sundial']
  },
  nature: {
    easy:   ['tree','cloud','rain','sun','moon','rock','lake','fire','snow','leaf','wind','hill','pond','bush','sand'],
    medium: ['volcano','rainbow','glacier','tornado','waterfall','earthquake','avalanche','lightning','canyon','swamp'],
    hard:   ['stalactite','archipelago','tundra','bioluminescence','mangrove','fjord','sinkhole','aurora','permafrost','lagoon']
  },
  sports: {
    easy:   ['ball','bat','run','swim','jump','kick','goal','race','team','win','hit','net','ski'],
    medium: ['cricket','archery','gymnastics','volleyball','basketball','badminton','wrestling','fencing','surfing'],
    hard:   ['decathlon','bobsled','biathlon','equestrian','pentathlon','curling','luge','falconry']
  },
  tech: {
    easy:   ['phone','robot','drone','app','chip','wifi','game','code','bug','screen','mouse','wire','disk'],
    medium: ['satellite','algorithm','database','processor','bluetooth','bandwidth','encryption','firmware','compiler','server'],
    hard:   ['microcontroller','overclocking','hexadecimal','throughput','latency','kernel','blockchain','hypervisor']
  },
  places: {
    easy:   ['house','school','park','shop','farm','city','bank','beach','cave','bridge'],
    medium: ['castle','airport','stadium','hospital','library','museum','lighthouse','cathedral','observatory'],
    hard:   ['acropolis','amphitheatre','colosseum','ziggurat','parthenon','necropolis','mausoleum','catacombs','labyrinth']
  },
  actions: {
    easy:   ['run','jump','swim','eat','sleep','fly','draw','sing','dance','read'],
    medium: ['juggling','climbing','painting','surfing','cooking','knitting','gardening','fishing','cycling','skating'],
    hard:   ['ventriloquism','paragliding','blacksmithing','taxidermy','bouldering','freediving','origami','glassblowing']
  }
};

function getWordPool(category = 'all', difficulty = 'all') {
  const diffs = difficulty === 'all' ? ['easy','medium','hard'] : [difficulty];
  const cats  = category  === 'all' ? Object.keys(WORD_BANK) : [category];
  let pool = [];
  cats.forEach(c => diffs.forEach(d => { if (WORD_BANK[c]?.[d]) pool.push(...WORD_BANK[c][d]); }));
  return pool.length ? pool : Object.values(WORD_BANK).flatMap(c => Object.values(c).flat());
}

function getWordChoices(category = 'all', difficulty = 'all', count = 3) {
  return [...getWordPool(category, difficulty)].sort(() => Math.random() - 0.5).slice(0, count);
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/words/random', (req, res) => {
  const { count = 3, difficulty = 'all', category = 'all' } = req.query;
  res.json({ words: getWordChoices(category, difficulty, parseInt(count)) });
});
app.get('/api/words/categories', (req, res) => res.json({ categories: Object.keys(WORD_BANK) }));

// ── Room State ────────────────────────────────────────────────────────────────
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

function getPublicRooms() {
  return Object.values(rooms)
    .filter(r => r.isPublic && r.gameState === 'waiting' && r.players.length < 10)
    .map(r => ({ code: r.code, players: r.players.length, host: r.host }));
}

function roomSummary(room) {
  return {
    code: room.code, host: room.host, isPublic: room.isPublic,
    settings: room.settings, gameState: room.gameState,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    currentDrawerIndex: room.currentDrawerIndex,
    currentRound: room.currentRound, totalRounds: room.totalRounds,
  };
}

function getSocket(id) { return io.sockets.sockets.get(id); }

function updateScoreboards(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('scoreUpdate', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
}

// ── Game Flow ─────────────────────────────────────────────────────────────────
function startRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.guessedPlayerIds = [];
  const drawer = room.players[room.currentDrawerIndex];
  const choices = getWordChoices(room.settings.category, room.settings.difficulty, 3);

  io.to(roomCode).emit('roundStarted', {
    round: room.currentRound, totalRounds: room.totalRounds,
    drawerName: drawer.name, drawerId: drawer.id,
    turnIndex: room.turnIndex + 1, totalTurns: room.players.length,
  });
  io.to(roomCode).emit('clearCanvas');

  const drawerSocket = getSocket(drawer.id);
  if (drawerSocket) {
    drawerSocket.emit('wordChoices', { choices });
  } else {
    room.currentWord = choices[0];
    broadcastWordInfo(roomCode);
    startTimer(roomCode);
  }
}

function broadcastWordInfo(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const drawer = room.players[room.currentDrawerIndex];
  const hint = room.currentWord.split('').map(() => '_').join(' ');
  room.players.forEach(p => {
    const s = getSocket(p.id);
    if (!s) return;
    if (p.id === drawer.id) {
      s.emit('wordRevealed', { word: room.currentWord, isDrawer: true });
    } else {
      s.emit('wordRevealed', { hint, wordLength: room.currentWord.length, isDrawer: false });
    }
  });
}

function startTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.timer = 60;
  clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timer--;
    io.to(roomCode).emit('timerTick', { timer: room.timer });
    if (room.timer <= 0) { clearInterval(room.timerInterval); endRound(roomCode); }
  }, 1000);
}

function endRound(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearInterval(room.timerInterval);
  const drawer = room.players[room.currentDrawerIndex];
  if (drawer && room.guessedPlayerIds.length > 0) drawer.score += room.guessedPlayerIds.length * 50;
  io.to(roomCode).emit('roundEnded', {
    word: room.currentWord,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
  });
  setTimeout(() => nextTurn(roomCode), 3000);
}

function nextTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
  room.turnIndex++;
  if (room.turnIndex >= room.players.length) {
    room.turnIndex = 0; room.currentDrawerIndex = 0; room.currentRound++;
    if (room.currentRound > room.totalRounds) { endGame(roomCode); return; }
  }
  startRound(roomCode);
}

function endGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.gameState = 'finished';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(roomCode).emit('gameEnded', { rankings: sorted.map(p => ({ name: p.name, score: p.score })) });
}

// KEY FIX: only delete room if empty AND no one reconnects within 10 seconds
function scheduleRoomCleanup(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.cleanupTimeout = setTimeout(() => {
    const r = rooms[roomCode];
    if (r && r.players.length === 0) {
      clearInterval(r.timerInterval);
      delete rooms[roomCode];
      console.log(`Room ${roomCode} deleted`);
      io.emit('publicRoomsUpdated', getPublicRooms());
    }
  }, 10000); // wait 10s before deleting
}

function handleLeave(socket, permanent = false) {
  const roomCode = socket.roomCode;
  if (!roomCode || !rooms[roomCode]) return;
  const room = rooms[roomCode];

  // Mark player as disconnected but keep them in the room
  const player = room.players.find(p => p.id === socket.id);
  if (player) {
    if (permanent) {
      // Full leave - remove player
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(roomCode).emit('playerLeft', {
        playerName: socket.playerName,
        players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
      });
    } else {
      // Just disconnected (page navigation) - keep player, update socket id later on rejoin
      player.disconnected = true;
    }
  }

  if (room.host === socket.playerName && room.players.filter(p => !p.disconnected).length > 0) {
    const newHost = room.players.find(p => !p.disconnected);
    if (newHost) {
      room.host = newHost.name;
      io.to(roomCode).emit('hostChanged', { newHost: room.host });
    }
  }

  if (room.players.filter(p => !p.disconnected).length === 0) {
    scheduleRoomCleanup(roomCode);
  }

  io.emit('publicRoomsUpdated', getPublicRooms());
}

// ── Socket Events ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('createRoom', ({ playerName }) => {
    const code = generateCode();
    const player = { id: socket.id, name: playerName, score: 0, disconnected: false };
    rooms[code] = {
      code, host: playerName, players: [player], isPublic: false,
      gameState: 'waiting', settings: { rounds: 3, category: 'all', difficulty: 'all' },
      currentDrawerIndex: 0, currentWord: '', currentRound: 1, totalRounds: 3,
      guessedPlayerIds: [], turnIndex: 0, timer: 60, timerInterval: null, cleanupTimeout: null,
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit('roomCreated', roomSummary(rooms[code]));
    io.emit('publicRoomsUpdated', getPublicRooms());
    console.log(`Room ${code} created by ${playerName}`);
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Room not found');
    if (room.players.length >= 10) return socket.emit('error', 'Room is full');

    const existingPlayer = room.players.find(p => p.name === playerName);
    // Block new players if game already started
    if (room.gameState !== 'waiting' && !existingPlayer) {
      return socket.emit('error', 'Game already in progress');
    }
    // Block duplicate names only for genuinely new players
    if (!existingPlayer && room.players.some(p => p.name === playerName && !p.disconnected)) {
      return socket.emit('error', 'Name already taken');
    }

    // If player was disconnected, update their socket id
    const existing = room.players.find(p => p.name === playerName);
    if (existing) {
      existing.id = socket.id;
      existing.disconnected = false;
    } else {
      room.players.push({ id: socket.id, name: playerName, score: 0, disconnected: false });
    }

    // Cancel any pending cleanup
    if (room.cleanupTimeout) { clearTimeout(room.cleanupTimeout); room.cleanupTimeout = null; }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;
    socket.emit('roomJoined', roomSummary(room));
    socket.to(roomCode).emit('playerJoined', {
      player: { id: socket.id, name: playerName, score: existing?.score || 0 },
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
    });
    io.emit('publicRoomsUpdated', getPublicRooms());
    console.log(`${playerName} joined room ${roomCode}`);
  });

  // Rejoin after page navigation (game page load)
  socket.on('rejoinRoom', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) { console.log(`rejoin failed - room ${roomCode} not found`); return socket.emit('error', 'Room not found'); }

    // Cancel any pending cleanup
    if (room.cleanupTimeout) { clearTimeout(room.cleanupTimeout); room.cleanupTimeout = null; }

    // Find player and update socket id
    let player = room.players.find(p => p.name === playerName);
    if (player) {
      player.id = socket.id;
      player.disconnected = false;
    } else {
      player = { id: socket.id, name: playerName, score: 0, disconnected: false };
      room.players.push(player);
    }

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;

    socket.emit('roomJoined', roomSummary(room));
    updateScoreboards(roomCode);
    console.log(`${playerName} rejoined room ${roomCode}`);
  });

  socket.on('getPublicRooms', () => socket.emit('publicRoomsUpdated', getPublicRooms()));

  socket.on('togglePublic', ({ isPublic }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.playerName) return;
    room.isPublic = isPublic;
    io.emit('publicRoomsUpdated', getPublicRooms());
  });

  socket.on('updateSettings', ({ rounds, category, difficulty }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.playerName) return;
    room.settings = { rounds, category, difficulty };
    io.to(socket.roomCode).emit('settingsUpdated', room.settings);
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.playerName) return;
    if (room.players.length < 2) return socket.emit('error', 'Need at least 2 players');
    room.gameState = 'playing';
    room.totalRounds = room.settings.rounds;
    room.currentRound = 1; room.currentDrawerIndex = 0; room.turnIndex = 0;
    room.players.forEach(p => p.score = 0);
    io.to(socket.roomCode).emit('gameStarted', roomSummary(room));
    startRound(socket.roomCode);
  });

  socket.on('wordChosen', ({ word }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    room.currentWord = word;
    broadcastWordInfo(socket.roomCode);
    startTimer(socket.roomCode);
  });

  socket.on('draw', (data) => socket.to(socket.roomCode).emit('draw', data));

  socket.on('clearCanvas', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (drawer && drawer.id === socket.id) io.to(socket.roomCode).emit('clearCanvas');
  });

  socket.on('sendGuess', ({ guess }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.gameState !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    const drawer = room.players[room.currentDrawerIndex];
    if (!player || player.id === drawer?.id) return;
    if (room.guessedPlayerIds.includes(player.id)) return;

    const isCorrect = guess.trim().toLowerCase() === room.currentWord.toLowerCase();
    io.to(socket.roomCode).emit('chatMessage', { text: `${player.name}: ${guess}`, type: isCorrect ? 'correct' : 'guess' });

    if (isCorrect) {
      room.guessedPlayerIds.push(player.id);
      const pos = room.guessedPlayerIds.length;
      const pts = pos === 1 ? 500 : pos === 2 ? 250 : pos === 3 ? 100 : 70;
      player.score += pts;
      io.to(socket.roomCode).emit('chatMessage', { text: `🎉 ${player.name} guessed correctly! (+${pts} pts)`, type: 'system' });
      io.to(socket.roomCode).emit('scoreUpdate', room.players.map(p => ({ id: p.id, name: p.name, score: p.score })));
      if (room.guessedPlayerIds.length >= room.players.length - 1) {
        clearInterval(room.timerInterval);
        setTimeout(() => endRound(socket.roomCode), 1000);
      }
    }
  });

  socket.on('playAgain', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.playerName) return;
    room.gameState = 'playing';
    room.players.forEach(p => p.score = 0);
    room.currentRound = 1; room.currentDrawerIndex = 0; room.turnIndex = 0;
    io.to(socket.roomCode).emit('gameStarted', roomSummary(room));
    startRound(socket.roomCode);
  });

  socket.on('leaveRoom', () => handleLeave(socket, true));

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id, socket.playerName);
    handleLeave(socket, false); // not permanent - could be page navigation
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎨 Doodle Hunt server on http://localhost:${PORT}`));
