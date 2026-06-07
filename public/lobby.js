const socket = io();
let playerName = '';
let roomCode = '';
let isHost = false;
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  $('create-game-btn').addEventListener('click', createRoom);
  $('join-room-btn').addEventListener('click', joinRoom);
  $('room-code').addEventListener('keypress', e => { if (e.key === 'Enter') joinRoom(); });
  $('start-game-btn').addEventListener('click', () => socket.emit('startGame'));
  $('leave-room-btn').addEventListener('click', leaveRoom);
  $('public-room-toggle').addEventListener('change', e => socket.emit('togglePublic', { isPublic: e.target.checked }));
  $('round-count').addEventListener('change', emitSettings);
  socket.emit('getPublicRooms');
});

function emitSettings() {
  if (!isHost) return;
  socket.emit('updateSettings', { rounds: parseInt($('round-count').value), category: 'all', difficulty: 'all' });
}

function createRoom() {
  playerName = $('player-name').value.trim();
  if (!playerName) { alert('Please enter your name!'); return; }
  socket.emit('createRoom', { playerName });
}

function joinRoom() {
  playerName = $('player-name').value.trim();
  const code = $('room-code').value.trim().toUpperCase();
  if (!playerName) { alert('Please enter your name!'); return; }
  if (!code) { alert('Please enter a room code!'); return; }
  socket.emit('joinRoom', { roomCode: code, playerName });
}

function joinPublicRoom(code) {
  playerName = $('player-name').value.trim();
  if (!playerName) { alert('Please enter your name first!'); return; }
  socket.emit('joinRoom', { roomCode: code, playerName });
}
window.joinPublicRoom = joinPublicRoom;

function leaveRoom() {
  socket.emit('leaveRoom');
  $('initial-setup').classList.remove('hidden');
  $('room-lobby').classList.add('hidden');
  roomCode = ''; isHost = false;
}

// Socket events
socket.on('roomCreated', room => { roomCode = room.code; isHost = true; showRoomLobby(room); });
socket.on('roomJoined',  room => { roomCode = room.code; isHost = false; showRoomLobby(room); });
socket.on('playerJoined', ({ players }) => updatePlayersList(players));
socket.on('playerLeft',   ({ players }) => updatePlayersList(players));
socket.on('hostChanged', ({ newHost }) => {
  if (newHost === playerName) { isHost = true; updateHostControls(); }
});
socket.on('settingsUpdated', s => { if ($('round-count')) $('round-count').value = s.rounds; });
socket.on('publicRoomsUpdated', rooms => updatePublicRooms(rooms));
socket.on('gameStarted', () => {
  window.location.href = `game.html?room=${roomCode}&player=${encodeURIComponent(playerName)}`;
});
socket.on('error', msg => alert(msg));

function showRoomLobby(room) {
  $('initial-setup').classList.add('hidden');
  $('room-lobby').classList.remove('hidden');
  $('room-code-display').textContent = room.code;
  $('public-room-toggle').checked = room.isPublic;
  updateHostControls();
  updatePlayersList(room.players);
}

function updateHostControls() {
  $('public-room-toggle').disabled = !isHost;
  $('start-game-btn').disabled = !isHost;
}

function updatePlayersList(players) {
  $('player-count').textContent = players.length;
  const list = $('players-list');
  list.innerHTML = players.map(p => `<li${p.name === playerName ? ' style="font-weight:600"' : ''}>${p.name}${p.name === roomCode ? ' 👑' : ''}</li>`).join('');
  const info = document.querySelector('.game-info');
  if (info) {
    if (players.length < 2) info.textContent = 'Need at least 2 players to start';
    else if (!isHost) info.textContent = 'Waiting for host to start...';
    else info.textContent = `Ready! ${players.length} players in room.`;
  }
  if ($('start-game-btn')) $('start-game-btn').disabled = !isHost || players.length < 2;
}

function updatePublicRooms(rooms) {
  const list = $('public-rooms-list');
  if (!rooms.length) { list.innerHTML = '<p class="no-rooms">No public rooms available</p>'; return; }
  list.innerHTML = rooms.map(r => `
    <div class="public-room-item">
      <div class="room-details">
        <div class="room-code">${r.code}</div>
        <div class="room-players">${r.players}/10 players</div>
      </div>
      <button class="btn btn-primary" onclick="joinPublicRoom('${r.code}')">Join</button>
    </div>`).join('');
}
