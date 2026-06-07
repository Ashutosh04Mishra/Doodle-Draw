const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const playerName = urlParams.get('player');

if (!roomCode || !playerName) window.location.href = 'index.html';

const $ = id => document.getElementById(id);

// Canvas state
let canvas, ctx;
let isDrawingLocal = false;
let lastX = 0, lastY = 0;
let currentTool = 'brush';
let currentColor = '#000000';
let currentSize = 3;
let amIDrawer = false;

// Game state
let currentWord = '';

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupCanvas();
  setupToolListeners();

  $('send-guess').addEventListener('click', sendGuess);
  $('guess-input').addEventListener('keypress', e => { if (e.key === 'Enter') sendGuess(); });
  $('play-again-btn').addEventListener('click', () => socket.emit('playAgain'));
  $('back-to-lobby-btn').addEventListener('click', () => { socket.emit('leaveRoom'); window.location.href = 'index.html'; });

  const quitBtn = $('quit-game-btn');
  if (quitBtn) {
    quitBtn.addEventListener('click', () => $('quit-modal').classList.remove('hidden'));
    $('confirm-quit').addEventListener('click', () => { socket.emit('leaveRoom'); window.location.href = 'index.html'; });
    $('cancel-quit').addEventListener('click', () => $('quit-modal').classList.add('hidden'));
  }

  // Tell server we're ready (re-join socket room)
  socket.emit('joinRoom', { roomCode, playerName });
});

// ── Canvas ────────────────────────────────────────────────────────────────────
function setupCanvas() {
  canvas = $('drawing-canvas');
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousedown', e => { if (!amIDrawer) return; isDrawingLocal = true; [lastX, lastY] = getPos(e); });
  canvas.addEventListener('mousemove', e => { if (!isDrawingLocal || !amIDrawer) return; drawLine(getPos(e)); });
  canvas.addEventListener('mouseup',   () => { isDrawingLocal = false; });
  canvas.addEventListener('mouseout',  () => { isDrawingLocal = false; });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); if (!amIDrawer) return; isDrawingLocal = true; [lastX, lastY] = getPos(e.touches[0]); });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (!isDrawingLocal || !amIDrawer) return; drawLine(getPos(e.touches[0])); });
  canvas.addEventListener('touchend',   e => { e.preventDefault(); isDrawingLocal = false; });
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * (canvas.width / rect.width),
          (e.clientY - rect.top)  * (canvas.height / rect.height)];
}

function drawLine([x, y], remote = false, opts = {}) {
  const col  = remote ? opts.color : (currentTool === 'eraser' ? '#FFFFFF' : currentColor);
  const size = remote ? opts.size  : currentSize;
  const lx   = remote ? opts.lastX : lastX;
  const ly   = remote ? opts.lastY : lastY;

  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(x, y);
  ctx.strokeStyle = col;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.stroke();

  if (!remote) {
    socket.emit('draw', { lastX, lastY, x, y, color: col, size: currentSize });
    [lastX, lastY] = [x, y];
  }
}

function setupToolListeners() {
  $('brush-tool').addEventListener('click',  () => setTool('brush'));
  $('eraser-tool').addEventListener('click', () => setTool('eraser'));
  $('clear-canvas').addEventListener('click', () => { if (amIDrawer) { clearCanvas(); socket.emit('clearCanvas'); } });
  $('brush-size').addEventListener('input', e => { currentSize = parseInt(e.target.value); });
  document.querySelectorAll('.color-option').forEach(c => {
    c.addEventListener('click', () => {
      currentColor = c.dataset.color;
      document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
      c.classList.add('active');
    });
  });
}

function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  $(`${tool}-tool`).classList.add('active');
  canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function setDrawerMode(isDrawer) {
  amIDrawer = isDrawer;
  canvas.style.cursor = isDrawer ? 'crosshair' : 'default';
  const tools = document.querySelector('.drawing-tools');
  if (tools) tools.style.opacity = isDrawer ? '1' : '0.4';
  const guessInput = $('guess-input');
  if (guessInput) guessInput.disabled = isDrawer;
}

// ── Guessing ──────────────────────────────────────────────────────────────────
function sendGuess() {
  const input = $('guess-input');
  const guess = input.value.trim();
  if (!guess || amIDrawer) return;
  socket.emit('sendGuess', { guess });
  input.value = '';
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function addChat(text, type = 'system') {
  const msgs = $('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${type}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Scoreboard ────────────────────────────────────────────────────────────────
function updateScoreboard(players) {
  const list = $('scoreboard-list');
  list.innerHTML = [...players]
    .sort((a, b) => b.score - a.score)
    .map(p => `<div class="score-item"><span class="player-name">${p.name}</span><span class="player-score">${p.score} pts</span></div>`)
    .join('');
}

// ── Word choice overlay ───────────────────────────────────────────────────────
function showWordChoices(choices) {
  let overlay = $('word-choice-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'word-choice-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1000;gap:16px';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <h2 style="color:#fff;margin-bottom:8px">Choose a word to draw!</h2>
    ${choices.map(w => `<button onclick="chooseWord('${w}')" style="padding:14px 32px;font-size:18px;border-radius:8px;border:none;background:#fff;cursor:pointer;font-weight:600;min-width:180px">${w}</button>`).join('')}
  `;
  overlay.style.display = 'flex';
}

function chooseWord(word) {
  socket.emit('wordChosen', { word });
  const overlay = $('word-choice-overlay');
  if (overlay) overlay.style.display = 'none';
}
window.chooseWord = chooseWord;

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('roomJoined', room => {
  updateScoreboard(room.players);
});

socket.on('roundStarted', ({ round, totalRounds, drawerName, drawerId, turnIndex, totalTurns }) => {
  $('current-round').textContent = `Round ${round}`;
  $('total-rounds').textContent = totalRounds;
  $('drawer-name').textContent = drawerName;
  const turnInfo = document.querySelector('.turn-info');
  if (turnInfo) turnInfo.textContent = `Turn ${turnIndex} of ${totalTurns}`;
  $('chat-messages').innerHTML = '';
  addChat(`Round ${round}: ${drawerName} is drawing!`, 'system');
  $('timer-display').textContent = '60';
  $('word-hint').textContent = '...';
  $('word-to-draw').classList.add('hidden');
  setDrawerMode(socket.id === drawerId);
  showScreen('game');
});

socket.on('wordChoices', ({ choices }) => showWordChoices(choices));

socket.on('wordRevealed', ({ word, hint, isDrawer }) => {
  if (isDrawer) {
    currentWord = word;
    $('word-to-draw').textContent = word.toUpperCase();
    $('word-to-draw').classList.remove('hidden');
    $('word-hint').textContent = 'Draw this word!';
  } else {
    $('word-to-draw').classList.add('hidden');
    $('word-hint').textContent = hint;
  }
});

socket.on('timerTick', ({ timer }) => {
  $('timer-display').textContent = timer;
});

socket.on('draw', data => {
  drawLine([data.x, data.y], true, { lastX: data.lastX, lastY: data.lastY, color: data.color, size: data.size });
});

socket.on('clearCanvas', () => clearCanvas());

socket.on('chatMessage', ({ text, type }) => addChat(text, type));

socket.on('scoreUpdate', players => updateScoreboard(players));

socket.on('roundEnded', ({ word, scores }) => {
  addChat(`⏱ Round over! The word was: ${word.toUpperCase()}`, 'system');
  updateScoreboard(scores);
  amIDrawer = false;
});

socket.on('playerLeft', ({ playerName: left, players }) => {
  addChat(`${left} left the game.`, 'system');
  updateScoreboard(players);
});

socket.on('gameEnded', ({ rankings }) => {
  showResults(rankings);
});

socket.on('gameStarted', room => {
  updateScoreboard(room.players);
  showScreen('game');
});

socket.on('error', msg => { alert(msg); window.location.href = 'index.html'; });

// ── Results ───────────────────────────────────────────────────────────────────
function showResults(rankings) {
  const medals = ['rank-1','rank-2','rank-3'];
  medals.forEach((id, i) => {
    const el = $(id);
    if (!el) return;
    const p = rankings[i];
    el.querySelector('.player-name').textContent = p ? p.name : '-';
    el.querySelector('.player-score').textContent = p ? `${p.score} pts` : '0 pts';
  });
  const list = $('final-rankings-list');
  if (list) {
    list.innerHTML = rankings.map((p, i) =>
      `<div class="ranking-item"><span class="ranking-position">#${i+1}</span><span class="player-name">${p.name}</span><span class="player-score">${p.score} pts</span></div>`
    ).join('');
  }
  showScreen('results');
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`${name}-screen`);
  if (el) el.classList.add('active');
}
