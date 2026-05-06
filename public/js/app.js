// ══════════════════════════════════════
// Constants & State
// ══════════════════════════════════════
const COLORS = [
  '#c53030', '#2563eb', '#16a34a', '#ca8a04', '#7c3aed',
  '#db2777', '#0891b2', '#d97706', '#059669', '#e67e22'
];

let socket, myId, myRoom, myColor = COLORS[0], myName = '';
let lastState = null, isHost = false;

// ══════════════════════════════════════
// Preload Cards to Blob Memory
// ══════════════════════════════════════
window.cardBlobCache = {};
function preloadCards() {
  const images = ['dos.jpg', '0.jpg'];
  for (let i = 1; i <= 21; i++) images.push(i + '.jpg');
  images.forEach(img => {
    // Use browser's normal fetch (will use disk cache if available)
    fetch('/cards/' + img)
      .then(r => r.blob())
      .then(blob => {
        // Create a fast, local memory URL for the image
        window.cardBlobCache[img] = URL.createObjectURL(blob);
      }).catch(() => { });
  });
}
preloadCards();

// ══════════════════════════════════════
// Color Picker
// ══════════════════════════════════════
function initColorPicker(containerId, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  COLORS.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (i === 0 ? ' picked' : '');
    s.style.background = c;
    s.onclick = () => {
      el.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('picked'));
      s.classList.add('picked');
      onPick(c);
    };
    el.appendChild(s);
  });
}
initColorPicker('h-colors', c => { myColor = c; });

// ══════════════════════════════════════
// Socket
// ══════════════════════════════════════
function connectSocket() {
  socket = io();

  socket.on('joined', ({ code, playerId }) => {
    myId = playerId;
    myRoom = code;
    document.getElementById('room-code-display').textContent = code;
    showScreen('lobby');
  });

  socket.on('lobby_state', (data) => {
    isHost = (socket.id === data.hostId);
    renderLobby(data);
    if (data.started && lastState) showScreen('game');
  });

  socket.on('game_state', (gs) => {
    lastState = gs;
    if (gs.phase === 'end') {
      renderEnd(gs);
      showScreen('endscreen');
    } else {
      showScreen('game');
      renderGame(gs);
    }
  });

  socket.on('error', (msg) => toast('⚠ ' + msg));
}

// ══════════════════════════════════════
// Room actions
// ══════════════════════════════════════
function createRoom() {
  myName = document.getElementById('h-name').value.trim() || 'Hôte';
  connectSocket();
  socket.emit('create_room', { name: myName, color: myColor });
}
function joinRoom() {
  const code = document.getElementById('h-code').value.trim().toUpperCase();
  if (code.length !== 6) return toast('Code invalide (6 caractères)');
  myName = document.getElementById('h-name').value.trim() || 'Joueur';
  connectSocket();
  socket.emit('join_room', { code, name: myName, color: myColor });
}
function startGame() { socket.emit('start_game'); }
function restartGame() { socket.emit('restart_game'); showScreen('lobby'); }

// ══════════════════════════════════════
// Lobby Render
// ══════════════════════════════════════
function renderLobby(data) {
  document.getElementById('room-code-display').textContent = data.code;
  const el = document.getElementById('lobby-players');
  el.innerHTML = data.players.map(p => {
    const initials = p.name.substring(0, 2).toUpperCase();
    return `<div class="lobby-player${!p.ready ? ' lp-dc' : ''}">
      <div class="lp-avatar" style="background:${p.color};">${initials}</div>
      <span class="lp-name">${p.name}</span>
      ${p.id === data.hostId ? '<span class="lp-badge">HÔTE</span>' : ''}
      ${!p.ready ? '<span style="font-size:.62rem;opacity:.4;">hors ligne</span>' : ''}
    </div>`;
  }).join('');

  const n = data.players.length;
  const hint = document.getElementById('lobby-hint');
  const btn = document.getElementById('btn-start');
  if (isHost) {
    hint.textContent = n < 3 ? `En attente de joueurs… (${n}/3 minimum)` : `${n} joueur${n > 1 ? 's' : ''} — prêts à jouer !`;
    btn.style.display = 'block';
    btn.disabled = n < 3;
  } else {
    hint.textContent = `En attente que l'hôte lance la partie…`;
    btn.style.display = 'none';
  }
}

// ══════════════════════════════════════
// Seat Positions
// ══════════════════════════════════════
function getSeatPositions(n, myIdx) {
  const positions = [];
  for (let i = 0; i < n; i++) {
    const relative = (i - myIdx + n) % n;
    let angle;
    if (n === 3) {
      const angles = [90, 210, 330];
      angle = angles[relative];
    } else if (n === 4) {
      const angles = [90, 180, 270, 0];
      angle = angles[relative];
    } else {
      const angles = [90, 162, 234, 306, 18];
      angle = angles[relative];
    }
    const rad = (angle * Math.PI) / 180;
    const rx = 41, ry = 34;
    const cx = 50, cy = 50;
    const x = cx + rx * Math.cos(rad);
    const y = cy + ry * Math.sin(rad);
    positions[i] = { left: x, top: y };
  }
  return positions;
}

// ══════════════════════════════════════
// Card rendering
// ══════════════════════════════════════
function cardHTML(card, opts = {}) {
  const { clickable = false, clickFn = '' } = opts;
  const hoverLabel = !card || card.hidden ? '' : (card.isExcuse ? '★' : String(card.value));

  if (!card || card.hidden) {
    const backSrc = window.cardBlobCache['dos.jpg'] || '/cards/dos.jpg';
    return `<div class="tcard tcard-back">
      <div class="tcard-face" style="padding:0;overflow:hidden;background:#fff;">
        <img src="${backSrc}" draggable="false"
          style="width:100%;height:100%;object-fit:cover;border-radius:6px;display:block;"
          onerror="this.style.display='none'">
      </div>
    </div>`;
  }

  const imgFile = card.isExcuse ? '0.jpg' : `${card.value}.jpg`;
  const frontSrc = window.cardBlobCache[imgFile] || `/cards/${imgFile}`;

  const evLabel = card.isExcuse && card.effectiveValue !== null && card.effectiveValue !== undefined
    ? `<div style="position:absolute;bottom:3px;left:0;right:0;text-align:center;font-family:'Cinzel',serif;font-size:.52rem;font-weight:700;color:var(--gold);background:rgba(0,0,0,.65);padding:1px 0;">(=${card.effectiveValue})</div>`
    : '';

  return `<div class="tcard${clickable ? ' playable' : ' not-playable'}" ${clickFn ? `onclick="${clickFn}"` : ''}>
    <div class="tcard-face" style="padding:0;overflow:hidden;background:#fff;position:relative;">
      <div class="card-center-val">${hoverLabel}</div>
      <img src="${frontSrc}" draggable="false"
        style="width:100%;height:100%;object-fit:cover;border-radius:6px;display:block;"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <div style="display:none;width:100%;height:100%;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
        <div class="card-val">${card.isExcuse ? '★' : card.value}</div>
        <div class="card-sym">⚜</div>
      </div>
      ${evLabel}
      <div class="card-hover-veil"><span class="card-hover-veil-val">${hoverLabel}</span></div>
    </div>
  </div>`;
}

// ══════════════════════════════════════
// Excuse modal helpers
// ══════════════════════════════════════
let _excuseModalVisible = false;
function showExcuseModal() {
  if (_excuseModalVisible) return; // avoid re-render flicker
  _excuseModalVisible = true;
  document.getElementById('excuse-modal').classList.remove('hidden');
}
function hideExcuseModal() {
  _excuseModalVisible = false;
  document.getElementById('excuse-modal').classList.add('hidden');
}

// Bind excuse buttons with both click AND touch events for mobile
function bindExcuseButtons() {
  const btn0 = document.getElementById('excuse-btn-0');
  const btn22 = document.getElementById('excuse-btn-22');
  if (!btn0 || !btn22) return;

  function handleExcuse(value) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      resolveExcuse(value);
    };
  }

  // Remove old listeners by cloning
  const newBtn0 = btn0.cloneNode(true);
  const newBtn22 = btn22.cloneNode(true);
  btn0.parentNode.replaceChild(newBtn0, btn0);
  btn22.parentNode.replaceChild(newBtn22, btn22);

  newBtn0.addEventListener('click', handleExcuse(0));
  newBtn0.addEventListener('touchend', handleExcuse(0));
  newBtn22.addEventListener('click', handleExcuse(22));
  newBtn22.addEventListener('touchend', handleExcuse(22));
}
// Bind on load
bindExcuseButtons();

// ══════════════════════════════════════
// Main Game Render
// ══════════════════════════════════════
function renderGame(gs) {
  const n = gs.players.length;
  const size = gs.roundSize;
  const me = gs.players[gs.myIdx];
  const isMyTurn = gs.myIdx === gs.currentPlayerIdx;
  const isMyAnnounceTurn = gs.phase === 'announce' && gs.myIdx === gs.announceIdx;
  const canPlay = gs.phase === 'play' && isMyTurn && !gs.excuseWaiting;

  // Top bar
  document.getElementById('g-round-info').textContent =
    `Manche ${gs.roundIdx + 1} · ${size} carte${size > 1 ? 's' : ''}`;

  // Phase banner
  const phaseBanner = document.getElementById('phase-banner');
  const activeName = gs.players[gs.currentPlayerIdx]?.name || '';
  let phaseTxt = '', phaseSub = '';
  if (gs.phase === 'announce') {
    phaseTxt = 'Annonces';
    phaseSub = isMyAnnounceTurn ? 'À vous d\'annoncer !' : `En attente de ${gs.players[gs.announceIdx]?.name}…`;
  } else if (gs.phase === 'play') {
    phaseTxt = 'Phase de jeu';
    phaseSub = isMyTurn ? 'À vous de jouer !' : `Au tour de ${activeName}…`;
  }
  if (phaseTxt) {
    phaseBanner.style.display = 'block';
    document.getElementById('phase-title').textContent = phaseTxt;
    document.getElementById('phase-sub').textContent = phaseSub;
  } else {
    phaseBanner.style.display = 'none';
  }

  // One-card banner
  document.getElementById('onecard-banner').style.display = gs.oneCardSpecial ? 'block' : 'none';

  // Trick counter
  const trickCounterEl = document.getElementById('trick-counter');
  if (gs.phase === 'play') {
    trickCounterEl.style.display = 'block';
    const myTricksWon = me.tricksWon || 0;
    const myAnnounced = me.announced !== null ? me.announced : '?';
    let pipsHtml = '';
    for (let pi = 0; pi < size; pi++) {
      pipsHtml += `<div class="tc-pip${pi < myTricksWon ? ' won' : ''}"></div>`;
    }
    trickCounterEl.innerHTML = `
          <div class="tc-label">PLIS</div>
          <div class="tc-pips">${pipsHtml}</div>
          <div class="tc-score-txt">${myTricksWon}/${myAnnounced}</div>
        `;
  } else {
    trickCounterEl.style.display = 'none';
  }

  // ── Player seats ──
  const center = document.getElementById('table-center');
  center.querySelectorAll('.player-seat').forEach(e => e.remove());

  const positions = getSeatPositions(n, gs.myIdx);

  gs.players.forEach((p, i) => {
    if (i === gs.myIdx) return;
    const pos = positions[i];
    const isActive = i === gs.currentPlayerIdx && (gs.phase === 'play' || gs.phase === 'announce');
    const isDealer = i === gs.dealerIdx;
    const initials = p.name.substring(0, 2).toUpperCase();

    const pips = Array.from({ length: 10 }, (_, j) =>
      `<div class="life-pip${j >= p.lives ? ' lost' : ''}" style="background:${p.color};"></div>`
    ).join('');

    let scorePillHtml = '';
    if (p.announced !== null) {
      const ann = p.announced;
      const done = p.tricksWon;
      const maxPips = Math.max(ann, done, 1);
      let pipHtml = '';
      for (let pi = 0; pi < maxPips; pi++) {
        const isDone = pi < done;
        const isOver = isDone && pi >= ann;
        pipHtml += `<div class="sst-pip${isDone ? (isOver ? ' over' : ' done') : ''}"></div>`;
      }
      const diff = done - ann;
      const badgeCls = diff === 0 ? 'ssb-ok' : 'ssb-bad';
      const badgeTxt = diff === 0 ? '✓' : (diff > 0 ? `+${diff}` : `${diff}`);
      scorePillHtml = `
            <div class="seat-score">
              <div class="seat-score-nums">
                <span class="seat-score-done">${done}</span>
                <span class="seat-score-sep">/</span>
                <span class="seat-score-ann">${ann}</span>
                <span class="seat-score-badge ${badgeCls}">${badgeTxt}</span>
              </div>
              <div class="seat-score-track">${pipHtml}</div>
            </div>`;
    } else {
      scorePillHtml = `<div class="seat-score"><span class="ssb-wait" style="font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:1px;">…</span></div>`;
    }

    const handCount = p.hand?.length || 0;
    const miniCards = gs.oneCardSpecial && p.hand
      ? p.hand.map(c => cardHTML(c)).join('')
      : Array.from({ length: handCount }, () =>
        `<div class="mini-card-back" style="transform:rotate(${Math.random() * 6 - 3}deg);"></div>`
      ).join('');

    const seat = document.createElement('div');
    seat.className = 'player-seat';
    seat.style.cssText = `left:${pos.left}%;top:${pos.top}%;transform:translate(-50%,-50%);`;
    seat.innerHTML = `
      <div class="seat-hand-back" style="margin-bottom:4px;">${miniCards}</div>
      <div style="position:relative;">
        <div class="seat-avatar${isActive ? ' active-turn' : ''}${isDealer ? ' dealer' : ''}" style="background:${p.color};">${initials}</div>
      </div>
      <div class="seat-name" style="color:${p.color};">${p.name}</div>
      <div class="seat-lives">${pips}</div>
      ${gs.phase === 'play' || gs.phase === 'score' ? scorePillHtml : ''}
    `;
    center.appendChild(seat);

    // ── Persistent announce bubble for this player ──
    let pBubble = document.getElementById(`bubble-${p.id}`);
    if (!pBubble) {
      pBubble = document.createElement('div');
      pBubble.id = `bubble-${p.id}`;
      pBubble.className = 'announce-bubble';
      center.appendChild(pBubble);
    }
    pBubble.style.left = `calc(${pos.left}% + 26px)`;
    pBubble.style.top = `calc(${pos.top}% - 16px)`;

    if (gs.phase === 'announce' && p.announced !== null) {
      pBubble.textContent = `${p.announced}`;
      pBubble.style.display = 'block';
      pBubble.classList.remove('bubble-exit');
    } else if (gs.phase === 'play' && pBubble.style.display === 'block' && !pBubble.classList.contains('bubble-exit')) {
      pBubble.classList.add('bubble-exit');
      setTimeout(() => { pBubble.style.display = 'none'; }, 400);
    } else if (gs.phase !== 'announce' || p.announced === null) {
      if (!pBubble.classList.contains('bubble-exit')) {
        pBubble.style.display = 'none';
      }
    }
  });

  // Cleanup old bubbles for players who left
  center.querySelectorAll('.announce-bubble').forEach(b => {
    if (!b.id.startsWith('bubble-')) return;
    const pid = b.id.replace('bubble-', '');
    if (!gs.players.find(p => p.id === pid)) b.remove();
  });

  // ── My own announce bubble ──
  let myBubble = document.getElementById('my-announce-bubble');
  if (!myBubble) {
    myBubble = document.createElement('div');
    myBubble.id = 'my-announce-bubble';
    myBubble.className = 'my-announce-bubble';
    center.appendChild(myBubble);
  }
  if (gs.phase === 'announce' && me.announced !== null) {
    myBubble.textContent = `${me.announced}`;
    myBubble.style.display = 'block';
    myBubble.classList.remove('bubble-exit');
  } else if (gs.phase === 'play' && myBubble.style.display === 'block' && !myBubble.classList.contains('bubble-exit')) {
    // Animate out when transitioning to play phase
    myBubble.classList.add('bubble-exit');
    setTimeout(() => { myBubble.style.display = 'none'; }, 400);
  } else if (gs.phase !== 'announce' || me.announced === null) {
    if (!myBubble.classList.contains('bubble-exit')) {
      myBubble.style.display = 'none';
    }
  }

  // ── Trick zone ── cards spread in front of each player ──
  const trickZone = document.getElementById('trick-zone');

  // Compute position for each played card: placed toward the player's seat
  function getTrickCardPosition(playerIdx, nPlayers, myIdx) {
    const relative = (playerIdx - myIdx + nPlayers) % nPlayers;
    // Positions around the center of trick-zone (as % of trick-zone dimensions)
    // Bottom = me (relative 0), then clockwise
    if (nPlayers === 3) {
      const positions = [
        { left: 50, top: 72 },   // me (bottom)
        { left: 20, top: 28 },   // left
        { left: 80, top: 28 },   // right
      ];
      return positions[relative];
    } else if (nPlayers === 4) {
      const positions = [
        { left: 50, top: 72 },   // me (bottom)
        { left: 18, top: 50 },   // left
        { left: 50, top: 22 },   // top
        { left: 82, top: 50 },   // right
      ];
      return positions[relative];
    } else {
      const positions = [
        { left: 50, top: 75 },   // me (bottom)
        { left: 15, top: 55 },   // left
        { left: 25, top: 20 },   // top-left
        { left: 75, top: 20 },   // top-right
        { left: 85, top: 55 },   // right
      ];
      return positions[relative];
    }
  }

  const renderTrickCards = (trick, players) => {
    trickZone.innerHTML = '';
    if (!trick || trick.length === 0) return;
    const nPlayers = players.length;
    trick.forEach((t, idx) => {
      const p = players[t.playerIdx];
      const pos = getTrickCardPosition(t.playerIdx, nPlayers, gs.myIdx);
      const wrap = document.createElement('div');
      wrap.className = 'trick-card-wrap';
      wrap.style.cssText = `
            left: ${pos.left}%;
            top: ${pos.top}%;
            z-index: ${idx + 1};
          `;
      wrap.innerHTML = `
            ${cardHTML(t.card)}
            <div class="trick-player-lbl" style="color:${p.color};">${p.name}</div>
          `;
      trickZone.appendChild(wrap);
    });
  };

  if (gs.currentTrick?.length > 0) {
    // Trick in progress: show cards played so far
    renderTrickCards(gs.currentTrick, gs.players);
  } else if (gs.lastCompletedTrick && gs.lastCompletedTrick.length > 0) {
    // Trick just finished: show ALL cards (including last played) with winner overlay
    const winnerIdx = gs.lastTrickWinnerIdx;
    const winnerP = winnerIdx !== null && winnerIdx !== undefined ? gs.players[winnerIdx] : null;
    renderTrickCards(gs.lastCompletedTrick, gs.players);
    if (winnerP) {
      const overlay = document.createElement('div');
      overlay.className = 'trick-done-overlay';
      overlay.innerHTML = `<div class="trick-done-badge">✓ Pli remporté par <span style="color:${winnerP.color}">${winnerP.name}</span></div>`;
      trickZone.appendChild(overlay);
    }
    clearTimeout(window._trickClearTimer);
    window._trickClearTimer = setTimeout(() => {
      trickZone.innerHTML = '';
    }, 2500);
  } else {
    trickZone.innerHTML = '';
  }

  // ── Excuse modal — affiche le modal global si c'est mon tour de choisir ──
  if (gs.excuseWaiting && gs.excuseWaiting.playerIdx === gs.myIdx) {
    showExcuseModal();
    // Re-bind buttons in case DOM was touched
    bindExcuseButtons();
  } else {
    hideExcuseModal();
  }

  // Pill d'attente pour les autres quand quelqu'un choisit l'Excuse
  // (on réutilise l'ancien #excuse-panel-wrap pour la pill, réintégré ici)
  let excuseWaitPill = document.getElementById('excuse-wait-pill');
  if (!excuseWaitPill) {
    excuseWaitPill = document.createElement('div');
    excuseWaitPill.id = 'excuse-wait-pill';
    excuseWaitPill.className = 'excuse-waiting-pill';
    document.body.appendChild(excuseWaitPill);
  }
  if (gs.excuseWaiting && gs.excuseWaiting.playerIdx !== gs.myIdx) {
    const waitName = gs.players[gs.excuseWaiting.playerIdx]?.name || '…';
    excuseWaitPill.textContent = `⭐ ${waitName} choisit la valeur de l'Excuse…`;
    excuseWaitPill.style.display = 'block';
  } else {
    excuseWaitPill.style.display = 'none';
  }

  // ── Announce panel ──
  const annPanel = document.getElementById('ann-panel');
  if (gs.phase === 'announce' && isMyAnnounceTurn) {
    const remaining = gs.players.filter(p => p.announced === null).length;
    const isLast = remaining === 1;
    const announced = gs.players.reduce((s, p) => s + (p.announced !== null ? p.announced : 0), 0);
    const forbidden = isLast ? size - announced : -1;

    const buttons = Array.from({ length: size + 1 }, (_, i) => {
      const isForbid = isLast && i === forbidden;
      return `<button
            class="ann-num-btn${isForbid ? ' forbidden-btn' : ''}"
            ${isForbid ? 'disabled' : `onclick="doAnnounce(${i})"`}
            style="${isForbid ? 'opacity:.3;cursor:not-allowed;border-color:rgba(192,57,43,.3);background:rgba(192,57,43,.08);' : ''}">
            <span style="position:relative;z-index:1;">${i}</span>
            ${isForbid ? '<span class="forbid-x">✕</span>' : ''}
          </button>`;
    }).join('');

    annPanel.style.display = 'block';
    annPanel.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:${isLast ? '6px' : '10px'};">
            <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(201,168,76,.3),transparent);"></div>
            <div style="font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:3px;color:rgba(201,168,76,.85);white-space:nowrap;">COMBIEN DE PLIS ?</div>
            <div style="flex:1;height:1px;background:linear-gradient(to right,transparent,rgba(201,168,76,.3),transparent);"></div>
          </div>
          ${isLast ? `<div style="font-size:.68rem;color:#e57373;text-align:center;font-style:italic;margin-bottom:8px;font-family:'Crimson Pro',serif;">⚠ Interdit : ${forbidden} (total égal au nombre de cartes)</div>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">${buttons}</div>
        `;
  } else {
    annPanel.style.display = 'none';
  }

  // ── Score overlay ──
  const scoreWrap = document.getElementById('score-overlay-wrap');
  if (gs.phase === 'score') {
    const rows = gs.players.map(p => {
      const diff = Math.abs((p.announced || 0) - p.tricksWon);
      const cls = diff === 0 ? 's-ok' : 's-bad';
      const txt = diff === 0 ? '✓ Exact !' : `−${diff} vie${diff > 1 ? 's' : ''}`;
      const initials = p.name.substring(0, 2).toUpperCase();
      return `<div class="score-row">
        <div class="s-avatar" style="background:${p.color};">${initials}</div>
        <div>
          <div class="s-name" style="color:${p.color};">${p.name}</div>
          <div class="s-detail">Annoncé ${p.announced} · Réalisé ${p.tricksWon}</div>
        </div>
        <div class="s-result ${cls}">${txt}</div>
      </div>`;
    }).join('');

    scoreWrap.innerHTML = `
      <div class="score-overlay">
        <div class="score-card">
          <div class="score-card-title">RÉSULTATS DE LA MANCHE</div>
          ${rows}
          <div style="margin-top:1.1rem;">
            ${isHost
        ? `<button class="btn btn-primary" onclick="doNextRound()" style="width:100%;">Manche suivante →</button>`
        : `<div style="font-size:.75rem;color:var(--cream-dim);opacity:.55;text-align:center;font-style:italic;">En attente de l'hôte…</div>`
      }
          </div>
        </div>
      </div>`;
  } else {
    scoreWrap.innerHTML = '';
  }

  // ── My hand ──
  const myHand = document.getElementById('my-hand');
  if (me.hand && me.hand.length > 0) {
    const cards = me.hand.map((c) => {
      if (c.hidden) return cardHTML(c);
      const isExcuse = c.isExcuse;
      const fn = canPlay ? `doPlayCard('${isExcuse ? 'EXCUSE' : 'T' + c.value}')` : '';
      return cardHTML(c, { clickable: canPlay, clickFn: fn });
    });
    myHand.innerHTML = cards.join('');

    const items = myHand.querySelectorAll('.tcard');
    const total = items.length;
    items.forEach((card, i) => {
      const mid = (total - 1) / 2;
      const offset = i - mid;
      const rot = offset * Math.min(6, 30 / total);
      const lift = Math.abs(offset) * 1.5;
      card.style.transform = `rotate(${rot}deg) translateY(${lift}px)`;
      card.style.zIndex = i;
      if (canPlay) {
        card.addEventListener('mouseenter', () => {
          card.style.transform = `rotate(${rot}deg) translateY(-18px) scale(1.05)`;
          card.style.zIndex = 100;
        });
        card.addEventListener('mouseleave', () => {
          card.style.transform = `rotate(${rot}deg) translateY(${lift}px)`;
          card.style.zIndex = i;
        });
      }
    });
  } else {
    myHand.innerHTML = '';
  }

  // ── Log strip ──
  const logStrip = document.getElementById('log-strip');
  if (gs.log && gs.log.length > 0) {
    logStrip.innerHTML = gs.log.slice(-5).map(l =>
      `<div class="log-line">${l}</div>`
    ).join('');
  }

  // ── Waiting pill ──
  const waitingPill = document.getElementById('waiting-pill');
  if (gs.phase === 'announce' && !isMyAnnounceTurn) {
    const annDone = gs.players.filter(p => p.announced !== null).map(p => `${p.name}: ${p.announced}`).join(' · ');
    waitingPill.textContent = annDone ? `Annoncé — ${annDone}` : '';
    waitingPill.style.display = annDone ? 'block' : 'none';
  } else {
    waitingPill.style.display = 'none';
  }
}

// ══════════════════════════════════════
// End render
// ══════════════════════════════════════
function renderEnd(gs) {
  const winner = gs.players.reduce((b, p) => p.lives > b.lives ? p : b, gs.players[0]);
  const el = document.getElementById('end-winner');
  el.textContent = winner.name;
  el.style.color = winner.color;

  const sorted = [...gs.players].sort((a, b) => b.lives - a.lives);
  document.getElementById('end-scores').innerHTML = sorted.map((p, i) => {
    const initials = p.name.substring(0, 2).toUpperCase();
    return `<div class="score-row" style="justify-content:space-between;">
      <div class="s-avatar" style="background:${p.color};width:28px;height:28px;font-size:.7rem;">${initials}</div>
      <span style="color:${p.color};font-weight:600;flex:1;padding-left:.7rem;">${i === 0 ? '🥇 ' : ''}${p.name}</span>
      <span style="color:var(--cream-dim);font-size:.85rem;">${p.lives} vie${p.lives !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');

  document.getElementById('end-host-btns').style.display = isHost ? 'block' : 'none';
}

// ══════════════════════════════════════
// Actions
// ══════════════════════════════════════
function doAnnounce(num) { socket.emit('announce', { num }); }
function doPlayCard(cardId) { socket.emit('play_card', { cardId }); }
function resolveExcuse(value) {
  if (!_excuseModalVisible) return; // prevent double-fire
  hideExcuseModal();
  socket.emit('resolve_excuse', { value });
}
function doNextRound() { socket.emit('next_round'); }

// ══════════════════════════════════════
// UI helpers
// ══════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function toast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}