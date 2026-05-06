// ══════════════════════════════════════
// Constants & State
// ══════════════════════════════════════
const COLORS = [
  '#c53030', '#2563eb', '#16a34a', '#ca8a04', '#7c3aed',
  '#db2777', '#0891b2', '#d97706', '#059669', '#e67e22'
];

let socket, myId, myRoom, myColor = COLORS[0], myName = '';
let lastState = null, isHost = false, mySpectator = false;

// ══════════════════════════════════════════════════════════════════
// TRICK ZONE — SYSTÈME DOM PERSISTANT
// Les cartes sur la table ne sont JAMAIS recréées de zéro.
// On les crée une fois, on les anime, et elles restent jusqu'au
// ramassage du pli. Aucune disparition parasite.
// ══════════════════════════════════════════════════════════════════

// Map<playerIdx, { wrapEl, cardEl, animDone }> — les wrappers DOM en vie
const trickDOMCards = new Map();

// Dernier état du trick pour détecter les nouvelles cartes
let _lastTrickIds = new Set();

// Direction d'arrivée selon la position relative du joueur
function getDealDirection(relativePosition, nPlayers) {
  if (nPlayers === 3) {
    // 0=moi(bas), 1=gauche, 2=droite
    return ['deal-from-bottom', 'deal-from-left', 'deal-from-right'][relativePosition];
  } else if (nPlayers === 4) {
    // 0=moi(bas), 1=gauche, 2=haut, 3=droite
    return ['deal-from-bottom', 'deal-from-left', 'deal-from-top', 'deal-from-right'][relativePosition];
  } else {
    // 5 joueurs : 0=bas, 1=gauche, 2=topleft, 3=topright, 4=droite
    return ['deal-from-bottom', 'deal-from-left', 'deal-from-topleft', 'deal-from-topright', 'deal-from-right'][relativePosition];
  }
}

// Position de chaque carte sur la table (% du trick-zone)
function getTrickCardPos(relativePosition, nPlayers) {
  if (nPlayers === 3) {
    return [[50, 73], [22, 30], [78, 30]][relativePosition];
  } else if (nPlayers === 4) {
    return [[50, 74], [18, 50], [50, 22], [82, 50]][relativePosition];
  } else {
    return [[50, 76], [14, 56], [24, 20], [76, 20], [86, 56]][relativePosition];
  }
}

// Rotation naturelle aléatoire pour chaque carte (simuler la pose humaine)
function naturalRot(seed) {
  // Déterministe selon le seed (playerIdx) pour stabilité entre renders
  const r = ((seed * 17 + 7) % 13) - 6; // [-6, +6] degrés
  return r;
}

// Crée le HTML d'une carte sur la table (sans onclick — juste visuel)
function tablecardHTML(card, playerColor) {
  if (!card || card.hidden) {
    const src = window.cardBlobCache['dos.jpg'] || '/cards/dos.jpg';
    return `
      <div class="tcard tcard-back" style="--card-w:90px;--card-h:135px;">
        <div class="tcard-face">
          <img class="tcard-img" src="${src}" alt="dos">
        </div>
      </div>`;
  }
  const imgFile = card.isExcuse ? '0.jpg' : `${card.value}.jpg`;
  const src = window.cardBlobCache[imgFile] || `/cards/${imgFile}`;
  const label = card.isExcuse ? '★' : String(card.value);
  const evBadge = (card.isExcuse && card.effectiveValue !== null && card.effectiveValue !== undefined)
    ? `<div class="card-ev-badge">(=${card.effectiveValue})</div>`
    : '';
  return `
    <div class="tcard not-playable" style="--card-w:90px;--card-h:135px;">
      <div class="tcard-face">
        <img class="tcard-img" src="${src}" alt="carte ${label}" onerror="this.style.opacity='.15'">
        <div class="card-corner card-corner-tl">${label}</div>
        <div class="card-corner card-corner-br">${label}</div>
        ${evBadge}
      </div>
    </div>`;
}

/**
 * Met à jour la zone de pli avec animation cinématique.
 * Ne détruit que les cartes dont le pli est terminé (ramassage animé).
 */
function updateTrickZone(gs) {
  const trickZone = document.getElementById('trick-zone');
  const nPlayers = gs.players.length;
  const trick = gs.currentTrick || [];

  // ── Cas 1 : pli en cours — ajouter les nouvelles cartes ──
  if (trick.length > 0) {
    // Retirer le badge winner si présent
    const badge = trickZone.querySelector('.trick-done-overlay');
    if (badge) badge.remove();

    // Supprimer les wrappers obsolètes (après un ramassage précédent)
    for (const [pIdx, data] of trickDOMCards) {
      if (!trick.find(t => t.playerIdx === pIdx)) {
        data.wrapEl.remove();
        trickDOMCards.delete(pIdx);
      }
    }

    trick.forEach((t) => {
      const cardKey = `${t.playerIdx}_${t.card?.id || t.card?.value}`;
      // Si cette carte est déjà dans le DOM, ne rien faire
      if (trickDOMCards.has(t.playerIdx) && trickDOMCards.get(t.playerIdx).cardKey === cardKey) {
        return;
      }

      const relative = (t.playerIdx - gs.myIdx + nPlayers) % nPlayers;
      const [px, py] = getTrickCardPos(relative, nPlayers);
      const rot = naturalRot(t.playerIdx);
      const rotStart = rot - 10 + Math.random() * 5;
      const rotMid = rot + 3 + Math.random() * 3;
      const dirClass = getDealDirection(relative, nPlayers);
      const p = gs.players[t.playerIdx];

      // Supprimer l'ancien wrapper pour ce joueur si existant
      if (trickDOMCards.has(t.playerIdx)) {
        trickDOMCards.get(t.playerIdx).wrapEl.remove();
        trickDOMCards.delete(t.playerIdx);
      }

      const wrap = document.createElement('div');
      wrap.className = 'trick-card-wrap'; // pas d'anim class encore
      wrap.style.cssText = `
        left: ${px}%;
        top: ${py}%;
        z-index: ${t.playerIdx + 2};
        --final-rot: ${rot}deg;
        --rot-start: ${rotStart}deg;
        --rot-mid: ${rotMid}deg;
        --rot-land: ${rot + 1}deg;
      `;

      wrap.innerHTML = `
        ${tablecardHTML(t.card, p.color)}
        <div class="trick-player-lbl" style="color:${p.color};">${p.name}</div>
      `;
      trickZone.appendChild(wrap);

      // Forcer reflow puis déclencher l'animation
      void wrap.offsetWidth;
      wrap.classList.add(dirClass);

      trickDOMCards.set(t.playerIdx, { wrapEl: wrap, cardKey });
    });

    // ── Cas 2 : pli vient d'être complété — afficher badge + préparer ramassage ──
  } else if (gs.lastCompletedTrick && gs.lastCompletedTrick.length > 0) {
    const winnerIdx = gs.lastTrickWinnerIdx;
    const winner = winnerIdx !== null ? gs.players[winnerIdx] : null;

    // S'assurer que les cartes du dernier pli sont bien affichées
    gs.lastCompletedTrick.forEach((t) => {
      if (!trickDOMCards.has(t.playerIdx)) {
        const relative = (t.playerIdx - gs.myIdx + nPlayers) % nPlayers;
        const [px, py] = getTrickCardPos(relative, nPlayers);
        const rot = naturalRot(t.playerIdx);
        const p = gs.players[t.playerIdx];

        const wrap = document.createElement('div');
        wrap.className = 'trick-card-wrap';
        wrap.style.cssText = `left:${px}%;top:${py}%;z-index:${t.playerIdx + 2};--final-rot:${rot}deg;`;
        wrap.innerHTML = `${tablecardHTML(t.card, p.color)}<div class="trick-player-lbl" style="color:${p.color};">${p.name}</div>`;
        trickZone.appendChild(wrap);
        trickDOMCards.set(t.playerIdx, { wrapEl: wrap, cardKey: `${t.playerIdx}_done` });
      }
    });

    // Badge de victoire
    if (winner && !trickZone.querySelector('.trick-done-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'trick-done-overlay';
      overlay.innerHTML = `<div class="trick-done-badge">✓ Pli de <span style="color:${winner.color}">${winner.name}</span></div>`;
      trickZone.appendChild(overlay);
    }

    // Calculer la direction de ramassage vers le gagnant
    if (winner && winnerIdx !== null) {
      const relWinner = (winnerIdx - gs.myIdx + nPlayers) % nPlayers;
      const [wx, wy] = getTrickCardPos(relWinner, nPlayers);

      // Déclencher le sweep après 1.8s (laisse voir le badge)
      clearTimeout(window._sweepTimer);
      window._sweepTimer = setTimeout(() => {
        // Retirer le badge
        const badge = trickZone.querySelector('.trick-done-overlay');
        if (badge) badge.remove();

        // Animer chaque carte vers le gagnant
        for (const [pIdx, data] of trickDOMCards) {
          const relative = (pIdx - gs.myIdx + nPlayers) % nPlayers;
          const [cx, cy] = getTrickCardPos(relative, nPlayers);
          // Vecteur vers le gagnant (en px depuis le centre de la zone)
          const zoneW = trickZone.offsetWidth || 480;
          const zoneH = trickZone.offsetHeight || 340;
          const dx = ((wx - cx) / 100) * zoneW;
          const dy = ((wy - cy) / 100) * zoneH;
          const spin = naturalRot(pIdx) * 3;

          const el = data.wrapEl;
          el.style.setProperty('--sweep-x', `${dx}px`);
          el.style.setProperty('--sweep-y', `${dy}px`);
          el.style.setProperty('--sweep-spin', `${spin}deg`);
          el.classList.add('sweeping');
        }

        // Nettoyer après la fin de l'animation
        setTimeout(() => {
          for (const [, data] of trickDOMCards) {
            data.wrapEl.remove();
          }
          trickDOMCards.clear();
          trickZone.innerHTML = '';
        }, 700);
      }, 1800);
    }

  } else {
    // ── Cas 3 : zone vide (nouvelle manche, etc.) ──
    // Nettoyer immédiatement sans animation
    clearTimeout(window._sweepTimer);
    for (const [, data] of trickDOMCards) {
      data.wrapEl.remove();
    }
    trickDOMCards.clear();
    trickZone.innerHTML = '';
  }
}

// ══════════════════════════════════════
// Preload Cards to Blob Memory
// ══════════════════════════════════════
window.cardBlobCache = {};
function preloadCards() {
  const images = ['dos.jpg', '0.jpg'];
  for (let i = 1; i <= 21; i++) images.push(i + '.jpg');
  images.forEach(img => {
    fetch('/cards/' + img)
      .then(r => r.blob())
      .then(blob => { window.cardBlobCache[img] = URL.createObjectURL(blob); })
      .catch(() => { });
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

  socket.on('joined', ({ code, playerId, isSpectator }) => {
    myId = playerId; myRoom = code;
    mySpectator = !!isSpectator;
    localStorage.setItem('tarot_code', code);
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
    if (gs.phase === 'end') { renderEnd(gs); showScreen('endscreen'); }
    else { showScreen('game'); renderGame(gs); }
  });

  socket.on('error', (msg) => {
    toast('⚠ ' + msg);
    if (msg === 'Salon introuvable' || msg === 'Impossible de vous reconnecter') {
      localStorage.removeItem('tarot_code');
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  /*
  // Fonctionnalité de reconnexion automatique mise de côté pour l'instant
  const code = localStorage.getItem('tarot_code');
  const name = localStorage.getItem('tarot_name');
  if (code && name) {
    document.getElementById('h-name').value = name;
    document.getElementById('h-code').value = code;
    myName = name;
    connectSocket();
    socket.emit('reconnect_room', { code, name });
  }
  */
});

// ══════════════════════════════════════
// Room actions
// ══════════════════════════════════════
function createRoom() {
  myName = document.getElementById('h-name').value.trim() || 'Hôte';
  localStorage.setItem('tarot_name', myName);
  connectSocket();
  socket.emit('create_room', { name: myName, color: myColor });
}
function joinRoom() {
  const code = document.getElementById('h-code').value.trim().toUpperCase();
  if (code.length !== 6) return toast('Code invalide (6 caractères)');
  myName = document.getElementById('h-name').value.trim() || 'Joueur';
  localStorage.setItem('tarot_name', myName);
  localStorage.setItem('tarot_code', code);
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
    if (n === 3) { angle = [90, 210, 330][relative]; }
    else if (n === 4) { angle = [90, 180, 270, 0][relative]; }
    else { angle = [90, 162, 234, 306, 18][relative]; }
    const rad = (angle * Math.PI) / 180;
    positions[i] = { left: 50 + 41 * Math.cos(rad), top: 50 + 34 * Math.sin(rad) };
  }
  return positions;
}

// ══════════════════════════════════════
// Card rendering — Main + Trick
// ══════════════════════════════════════
function cardHTML(card, opts = {}) {
  const { clickable = false, clickFn = '' } = opts;
  const hoverLabel = !card || card.hidden ? '' : (card.isExcuse ? '★' : String(card.value));

  if (!card || card.hidden) {
    const backSrc = window.cardBlobCache['dos.jpg'] || '/cards/dos.jpg';
    return `<div class="tcard tcard-back">
      <div class="tcard-face">
        <img class="card-back-img" src="${backSrc}" alt="dos" onerror="this.style.display='none'">
        <div class="card-back-inner"></div>
      </div>
    </div>`;
  }

  const imgFile = card.isExcuse ? '0.jpg' : `${card.value}.jpg`;
  const frontSrc = window.cardBlobCache[imgFile] || `/cards/${imgFile}`;

  // Valeur en coin (haut-gauche + bas-droit miroir) comme une vraie carte
  const cornerVal = hoverLabel;

  // Badge valeur effective de l'Excuse
  const evLabel = (card.isExcuse && card.effectiveValue !== null && card.effectiveValue !== undefined)
    ? `<div class="card-ev-badge">(=${card.effectiveValue})</div>`
    : '';

  return `<div class="tcard${clickable ? ' playable' : ' not-playable'}" ${clickFn ? `onclick="${clickFn}"` : ''}>
    <div class="tcard-face">
      <img class="tcard-img" src="${frontSrc}" alt="carte ${hoverLabel}"
        onerror="this.style.opacity='.15'">
      <div class="card-corner card-corner-tl">${cornerVal}</div>
      <div class="card-corner card-corner-br">${cornerVal}</div>
      ${evLabel}
      <div class="card-hover-veil"><span class="card-hover-veil-val">${hoverLabel}</span></div>
    </div>
  </div>`;
}

// ══════════════════════════════════════
// Excuse modal
// ══════════════════════════════════════
let _excuseModalVisible = false;
function showExcuseModal() {
  if (_excuseModalVisible) return;
  _excuseModalVisible = true;
  document.getElementById('excuse-modal').classList.remove('hidden');
}
function hideExcuseModal() {
  _excuseModalVisible = false;
  document.getElementById('excuse-modal').classList.add('hidden');
}
function bindExcuseButtons() {
  const btn0 = document.getElementById('excuse-btn-0');
  const btn22 = document.getElementById('excuse-btn-22');
  if (!btn0 || !btn22) return;
  function handleExcuse(value) {
    return function (e) { e.preventDefault(); e.stopPropagation(); resolveExcuse(value); };
  }
  const newBtn0 = btn0.cloneNode(true);
  const newBtn22 = btn22.cloneNode(true);
  btn0.parentNode.replaceChild(newBtn0, btn0);
  btn22.parentNode.replaceChild(newBtn22, btn22);
  newBtn0.addEventListener('click', handleExcuse(0));
  newBtn0.addEventListener('touchend', handleExcuse(0));
  newBtn22.addEventListener('click', handleExcuse(22));
  newBtn22.addEventListener('touchend', handleExcuse(22));
}
bindExcuseButtons();

// ══════════════════════════════════════
// Main Game Render
// ══════════════════════════════════════
function renderGame(gs) {
  const n = gs.players.length;
  const size = gs.roundSize;
  const isSpectator = gs.isSpectator;
  const viewIdx = isSpectator ? 0 : gs.myIdx;
  const me = isSpectator ? {} : gs.players[gs.myIdx];
  const isMyTurn = !isSpectator && gs.myIdx === gs.currentPlayerIdx;
  const isMyAnnounceTurn = !isSpectator && gs.phase === 'announce' && gs.myIdx === gs.announceIdx;
  const canPlay = !isSpectator && gs.phase === 'play' && isMyTurn && !gs.excuseWaiting;

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
  } else { phaseBanner.style.display = 'none'; }

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
      <div class="tc-score-txt">${myTricksWon}/${myAnnounced}</div>`;
  } else { trickCounterEl.style.display = 'none'; }

  // ── Player seats ──
  const center = document.getElementById('table-center');
  center.querySelectorAll('.player-seat').forEach(e => e.remove());
  const positions = getSeatPositions(n, viewIdx);

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
      const ann = p.announced, done = p.tricksWon;
      const maxPips = Math.max(ann, done, 1);
      let pipHtml = '';
      for (let pi = 0; pi < maxPips; pi++) {
        const isDone = pi < done, isOver = isDone && pi >= ann;
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

    // Announce bubble
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
      if (!pBubble.classList.contains('bubble-exit')) pBubble.style.display = 'none';
    }
  });

  center.querySelectorAll('.announce-bubble').forEach(b => {
    if (!b.id.startsWith('bubble-')) return;
    if (!gs.players.find(p => p.id === b.id.replace('bubble-', ''))) b.remove();
  });

  // My announce bubble
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
    myBubble.classList.add('bubble-exit');
    setTimeout(() => { myBubble.style.display = 'none'; }, 400);
  } else if (gs.phase !== 'announce' || me.announced === null) {
    if (!myBubble.classList.contains('bubble-exit')) myBubble.style.display = 'none';
  }

  // ── TRICK ZONE — mise à jour persistante ──
  updateTrickZone(gs);

  // ── Excuse modal ──
  if (gs.excuseWaiting && gs.excuseWaiting.playerIdx === gs.myIdx) {
    showExcuseModal();
    bindExcuseButtons();
  } else {
    hideExcuseModal();
  }

  // Pill d'attente excuse
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
  } else { excuseWaitPill.style.display = 'none'; }

  // ── Announce panel ──
  const annPanel = document.getElementById('ann-panel');
  if (gs.phase === 'announce' && isMyAnnounceTurn) {
    const remaining = gs.players.filter(p => p.announced === null).length;
    const isLast = remaining === 1;
    const announced = gs.players.reduce((s, p) => s + (p.announced !== null ? p.announced : 0), 0);
    const forbidden = isLast ? size - announced : -1;
    const buttons = Array.from({ length: size + 1 }, (_, i) => {
      const isForbid = isLast && i === forbidden;
      return `<button class="ann-num-btn${isForbid ? ' forbidden-btn' : ''}"
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
      ${isLast ? `<div style="font-size:.68rem;color:#e57373;text-align:center;font-style:italic;margin-bottom:8px;font-family:'Crimson Pro',serif;">⚠ Interdit : ${forbidden}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">${buttons}</div>`;
  } else { annPanel.style.display = 'none'; }

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
        : `<div style="font-size:.75rem;color:var(--cream-dim);opacity:.55;text-align:center;font-style:italic;">En attente de l'hôte…</div>`}
          </div>
        </div>
      </div>`;
  } else { scoreWrap.innerHTML = ''; }

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
      const transform = `rotate(${rot}deg) translateY(${lift}px)`;
      card.style.transform = transform;
      card.style.zIndex = i;
      // Stocker la transform de base pour l'animation de jeu
      card.style.setProperty('--fan-transform', transform);
      if (canPlay) {
        card.addEventListener('mouseenter', () => {
          card.style.transform = `rotate(${rot}deg) translateY(-18px) scale(1.05)`;
          card.style.zIndex = 100;
        });
        card.addEventListener('mouseleave', () => {
          card.style.transform = transform;
          card.style.zIndex = i;
        });
      }
    });
  } else { myHand.innerHTML = ''; }

  // ── Log strip ──
  const logStrip = document.getElementById('log-strip');
  if (gs.log && gs.log.length > 0) {
    logStrip.innerHTML = gs.log.slice(-5).map(l => `<div class="log-line">${l}</div>`).join('');
  }

  // ── Waiting pill ──
  const waitingPill = document.getElementById('waiting-pill');
  if (gs.phase === 'announce' && !isMyAnnounceTurn) {
    const annDone = gs.players.filter(p => p.announced !== null).map(p => `${p.name}: ${p.announced}`).join(' · ');
    waitingPill.textContent = annDone ? `Annoncé — ${annDone}` : '';
    waitingPill.style.display = annDone ? 'block' : 'none';
  } else { waitingPill.style.display = 'none'; }
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

function doPlayCard(cardId) {
  // Animation de jeu depuis la main avant d'émettre
  const myHand = document.getElementById('my-hand');
  const cards = myHand.querySelectorAll('.tcard');
  cards.forEach(card => {
    const fn = card.getAttribute('onclick') || '';
    if (fn.includes(`'${cardId}'`)) {
      card.classList.add('playing');
      card.style.pointerEvents = 'none';
    }
  });
  // Émettre légèrement après le début de l'anim pour un rendu fluide
  setTimeout(() => socket.emit('play_card', { cardId }), 80);
}

function resolveExcuse(value) {
  if (!_excuseModalVisible) return;
  hideExcuseModal();
  socket.emit('resolve_excuse', { value });
}
function doNextRound() { socket.emit('next_round'); }

function goHome() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  lastState = null;
  isHost = false;
  mySpectator = false;
  showScreen('home');
}

function toggleHistory() {
  const modal = document.getElementById('history-modal');
  if (modal.classList.contains('hidden')) {
    modal.classList.remove('hidden');
    renderHistory();
    modal.style.display = 'flex';
  } else {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function renderHistory() {
  const content = document.getElementById('history-content');
  if (!lastState || !lastState.trickHistory || lastState.trickHistory.length === 0) {
    content.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.5);margin:20px 0;">Aucun pli joué</div>';
    return;
  }
  let html = '';
  lastState.trickHistory.forEach((h, idx) => {
    let trickHtml = h.trick.map(t => {
      const p = lastState.players[t.playerIdx];
      const nameHtml = `<div style="font-size:10px;color:${p.color};text-align:center;margin-top:4px;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</div>`;
      return `<div style="display:flex;flex-direction:column;align-items:center;">${cardHTML(t.card)}${nameHtml}</div>`;
    }).join('');
    
    html += `
      <div style="border-bottom:1px solid rgba(255,255,255,0.1);padding:10px 0;">
        <div style="font-size:0.8rem;color:var(--cream);margin-bottom:5px;">Gagnant : <strong>${h.winner}</strong></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;--card-w:60px;--card-h:90px;">${trickHtml}</div>
      </div>
    `;
  });
  content.innerHTML = html;
}

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