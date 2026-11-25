(() => {
  'use strict';

  // ---------- config ----------
  const ROUNDS = {
    J:  { values: [200, 400, 600, 800, 1000],   max: 1000 },
    DJ: { values: [400, 800, 1200, 1600, 2000], max: 2000 },
  };
  const COLS = 6;
  const CELLS = COLS * 5;
  const STORE_GAME = 'pas.game.v1';
  const STORE_HISTORY = 'pas.history.v1';

  // ---------- storage (fails soft in private mode etc.) ----------
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };

  // ---------- state ----------
  function newGame() {
    return {
      started: new Date().toISOString(),
      round: 'J',
      clues: { J: Array(CELLS).fill(null), DJ: Array(CELLS).fill(null) },
      final: null, // { wager, right }
    };
  }

  function isValidGame(g) {
    return g && g.clues && Array.isArray(g.clues.J) && g.clues.J.length === CELLS
      && Array.isArray(g.clues.DJ) && g.clues.DJ.length === CELLS;
  }

  let game = storage.get(STORE_GAME, null);
  if (!isValidGame(game)) game = newGame();
  let undoStack = [];

  function save() { storage.set(STORE_GAME, game); }

  function commit(mutate) {
    undoStack.push(JSON.stringify(game));
    if (undoStack.length > 200) undoStack.shift();
    mutate(game);
    save();
    render();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    const round = game.round; // keep the user on the tab they're looking at
    game = JSON.parse(prev);
    game.round = round;
    save();
    render();
  }

  // ---------- scoring ----------
  const valueAt = (round, index) => ROUNDS[round].values[Math.floor(index / COLS)];

  // skip: { round, index } — leave one clue out (used for Daily Double wager limits)
  function totals(g, skip) {
    let board = 0, coryat = 0, right = 0, wrong = 0, pass = 0;
    for (const round of ['J', 'DJ']) {
      g.clues[round].forEach((c, i) => {
        if (!c || (skip && skip.round === round && skip.index === i)) return;
        const value = valueAt(round, i);
        const amount = c.dd ? c.wager : value;
        if (c.result === 'right') {
          board += amount; coryat += value; right++;
        } else if (c.result === 'wrong') {
          board -= amount; if (!c.dd) coryat -= value; wrong++;
        } else {
          pass++;
        }
      });
    }
    let score = board;
    if (g.final) {
      const w = Math.min(g.final.wager, Math.max(board, 0));
      score += g.final.right ? w : -w;
    }
    return { board, score, coryat, right, wrong, pass };
  }

  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    score: $('#score'), coryat: $('#coryat'), rw: $('#rw'), acc: $('#acc'),
    board: $('#board'), final: $('#final'),
    finalNote: $('#finalNote'), fjWager: $('#fjWager'), fjError: $('#fjError'),
    fjRight: $('#fjRight'), fjWrong: $('#fjWrong'), fjAllIn: $('#fjAllIn'),
    finalResult: $('#finalResult'), fjClear: $('#fjClear'),
    undo: $('#undo'),
    clueDialog: $('#clueDialog'), clueBody: $('#clueBody'),
    newDialog: $('#newDialog'), newSummary: $('#newSummary'),
    historyDialog: $('#historyDialog'), historyBody: $('#historyBody'),
  };

  // ---------- render ----------
  function render() {
    const t = totals(game);
    el.score.textContent = money(t.score);
    el.score.classList.toggle('negative', t.score < 0);
    el.coryat.textContent = money(t.coryat);
    el.rw.textContent = `${t.right} / ${t.wrong}`;
    const attempts = t.right + t.wrong;
    el.acc.textContent = attempts ? Math.round((100 * t.right) / attempts) + '%' : '—';
    el.undo.disabled = undoStack.length === 0;

    document.querySelectorAll('.tabs button').forEach((b) => {
      const on = b.dataset.round === game.round;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });

    const isFinal = game.round === 'FJ';
    el.board.hidden = isFinal;
    el.final.hidden = !isFinal;
    if (isFinal) renderFinal(t); else renderBoard();
  }

  function renderBoard() {
    const round = game.round;
    const frag = document.createDocumentFragment();
    game.clues[round].forEach((c, i) => {
      const value = valueAt(round, i);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.dataset.index = i;
      if (!c) {
        btn.textContent = money(value);
        btn.setAttribute('aria-label', `${money(value)} clue, not played`);
      } else {
        btn.classList.add('played', c.result);
        if (c.dd) btn.classList.add('dd');
        const mark = { right: '✓', wrong: '✗', pass: '–' }[c.result];
        const sub = c.dd ? `DD ${money(c.wager)}` : money(value);
        btn.innerHTML = `<span class="mark">${mark}</span><span class="sub">${sub}</span>`;
        const word = { right: 'correct', wrong: 'missed', pass: 'not answered' }[c.result];
        btn.setAttribute('aria-label', `${money(value)} clue, ${word}${c.dd ? `, Daily Double wager ${money(c.wager)}` : ''}`);
      }
      frag.appendChild(btn);
    });
    el.board.replaceChildren(frag);
  }

  function renderFinal(t) {
    const pre = t.board;
    const eligible = pre > 0;
    el.finalNote.textContent = eligible
      ? `Score going in: ${money(pre)}. Wager anything from $0 to ${money(pre)}.`
      : `Score going in: ${money(pre)}. With $0 or less you'd sit out Final — play for fun, nothing is wagered.`;
    el.fjWager.disabled = !eligible;
    el.fjAllIn.disabled = !eligible;
    el.fjWager.max = String(Math.max(pre, 0));
    if (document.activeElement !== el.fjWager) {
      el.fjWager.value = game.final
        ? String(Math.min(game.final.wager, Math.max(pre, 0)))
        : (eligible ? '' : '0');
    }
    el.fjRight.classList.toggle('selected', !!game.final && game.final.right);
    el.fjWrong.classList.toggle('selected', !!game.final && !game.final.right);
    if (game.final) {
      const w = Math.min(game.final.wager, Math.max(pre, 0));
      const delta = game.final.right ? w : -w;
      el.finalResult.textContent =
        `${game.final.right ? 'Got it' : 'Missed it'} (${delta >= 0 ? '+' : ''}${money(delta)}). Final score: ${money(t.score)}`;
      el.fjClear.hidden = false;
    } else {
      el.finalResult.textContent = '';
      el.fjClear.hidden = true;
    }
  }

  // ---------- clue dialog ----------
  let active = null; // { round, index, value, mode, max }

  function openClue(index) {
    const round = game.round;
    const existing = game.clues[round][index];
    active = { round, index, value: valueAt(round, index), mode: existing && existing.dd ? 'dd' : 'normal' };
    renderClueDialog();
    el.clueDialog.showModal();
    if (active.mode === 'dd') $('#ddWager').focus();
  }

  function renderClueDialog() {
    const { round, index, value, mode } = active;
    const existing = game.clues[round][index];
    const clearBtn = existing ? '<button class="link" data-act="clear" type="button">Clear this clue</button>' : '';

    if (mode === 'normal') {
      el.clueBody.innerHTML = `
        <h2>${money(value)} clue</h2>
        <div class="choices">
          <button class="btn right" data-act="right" type="button">✓ Got it</button>
          <button class="btn wrong" data-act="wrong" type="button">✗ Missed it</button>
          <button class="btn pass" data-act="pass" type="button">– Didn't answer</button>
          <button class="btn dd" data-act="dd" type="button">Daily Double</button>
        </div>
        ${clearBtn}
        <p class="kbd-hint">Keys: R = got it · W = missed · P = pass · D = Daily Double</p>`;
      return;
    }

    const before = totals(game, { round, index }).board;
    active.max = Math.max(before, ROUNDS[round].max);
    el.clueBody.innerHTML = `
      <h2>Daily Double!</h2>
      <p class="hint">Score before this clue: ${money(before)}.<br>Wager $5 to ${money(active.max)}.</p>
      <div class="wager-row">
        <label for="ddWager">Wager</label>
        <input id="ddWager" type="number" inputmode="numeric" min="5" max="${active.max}" step="1"
               value="${existing && existing.dd ? existing.wager : ''}">
        <button class="btn small" data-act="allIn" type="button">All in</button>
      </div>
      <p id="ddError" class="error" role="alert"></p>
      <div class="choices">
        <button class="btn right" data-act="dd-right" type="button">✓ Got it</button>
        <button class="btn wrong" data-act="dd-wrong" type="button">✗ Missed it</button>
      </div>
      <button class="link" data-act="back" type="button">← Not a Daily Double</button>
      ${clearBtn}`;
  }

  function handleClueAction(act) {
    if (!active) return;
    const { round, index } = active;
    switch (act) {
      case 'right':
      case 'wrong':
      case 'pass':
        commit((g) => { g.clues[round][index] = { result: act }; });
        el.clueDialog.close();
        break;
      case 'dd':
        active.mode = 'dd';
        renderClueDialog();
        $('#ddWager').focus();
        break;
      case 'back':
        active.mode = 'normal';
        renderClueDialog();
        break;
      case 'allIn':
        $('#ddWager').value = String(active.max);
        break;
      case 'dd-right':
      case 'dd-wrong': {
        const raw = $('#ddWager').value.trim();
        const w = Number(raw);
        if (raw === '' || !Number.isInteger(w) || w < 5 || w > active.max) {
          $('#ddError').textContent = `Enter a whole-dollar wager from $5 to ${money(active.max)}.`;
          $('#ddWager').focus();
          return;
        }
        commit((g) => {
          g.clues[round][index] = { result: act === 'dd-right' ? 'right' : 'wrong', dd: true, wager: w };
        });
        el.clueDialog.close();
        break;
      }
      case 'clear':
        commit((g) => { g.clues[round][index] = null; });
        el.clueDialog.close();
        break;
      case 'close':
        el.clueDialog.close();
        break;
    }
  }

  el.clueDialog.addEventListener('click', (e) => {
    if (e.target === el.clueDialog) { el.clueDialog.close(); return; } // backdrop
    const btn = e.target.closest('[data-act]');
    if (btn) handleClueAction(btn.dataset.act);
  });

  el.clueDialog.addEventListener('keydown', (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey) return;
    if (active.mode === 'dd') {
      if (e.key === 'Enter' && e.target.id === 'ddWager') e.preventDefault();
      return;
    }
    const map = { r: 'right', w: 'wrong', p: 'pass', d: 'dd' };
    const act = map[e.key.toLowerCase()];
    if (act) { e.preventDefault(); handleClueAction(act); }
  });

  el.clueDialog.addEventListener('close', () => { active = null; });

  // ---------- board + tabs ----------
  el.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) openClue(Number(cell.dataset.index));
  });

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-round]');
    if (!btn) return;
    game.round = btn.dataset.round;
    save();
    render();
  });

  // ---------- final ----------
  function recordFinal(right) {
    const pre = totals(game).board;
    let w = 0;
    if (pre > 0) {
      const raw = el.fjWager.value.trim();
      w = Number(raw);
      if (raw === '' || !Number.isInteger(w) || w < 0 || w > pre) {
        el.fjError.textContent = `Enter a whole-dollar wager from $0 to ${money(pre)}.`;
        el.fjWager.focus();
        return;
      }
    }
    el.fjError.textContent = '';
    el.fjWager.blur();
    commit((g) => { g.final = { wager: w, right }; });
  }

  el.fjRight.addEventListener('click', () => recordFinal(true));
  el.fjWrong.addEventListener('click', () => recordFinal(false));
  el.fjAllIn.addEventListener('click', () => {
    el.fjWager.value = String(Math.max(totals(game).board, 0));
    el.fjError.textContent = '';
  });
  el.fjClear.addEventListener('click', () => {
    el.fjError.textContent = '';
    commit((g) => { g.final = null; });
    el.fjWager.value = '';
  });

  // ---------- undo ----------
  el.undo.addEventListener('click', undo);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !document.querySelector('dialog[open]')
        && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      undo();
    }
  });

  // ---------- new game / history ----------
  const hasProgress = (g) => g.final !== null || g.clues.J.some(Boolean) || g.clues.DJ.some(Boolean);

  function resetGame() {
    game = newGame();
    undoStack = [];
    el.fjError.textContent = '';
    el.fjWager.value = '';
    save();
    render();
  }

  $('#newGame').addEventListener('click', () => {
    if (!hasProgress(game)) { resetGame(); return; }
    const t = totals(game);
    el.newSummary.textContent =
      `Current game: ${money(t.score)} (Coryat ${money(t.coryat)}), ${t.right} right / ${t.wrong} wrong.`;
    el.newDialog.showModal();
  });

  el.newDialog.addEventListener('click', (e) => {
    if (e.target === el.newDialog) { el.newDialog.close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'save') {
      const t = totals(game);
      const history = storage.get(STORE_HISTORY, []);
      history.unshift({
        date: game.started,
        score: t.score,
        coryat: t.coryat,
        right: t.right,
        wrong: t.wrong,
        final: game.final ? game.final.right : null,
      });
      storage.set(STORE_HISTORY, history.slice(0, 1000));
    }
    if (act === 'save' || act === 'discard') resetGame();
    el.newDialog.close();
  });

  function renderHistory() {
    const history = storage.get(STORE_HISTORY, []);
    if (!history.length) {
      el.historyBody.innerHTML = '<p class="hint">No saved games yet. Use “New game → Save to history” when you finish an episode.</p>';
      return;
    }
    const n = history.length;
    const avg = (k) => Math.round(history.reduce((s, h) => s + h[k], 0) / n);
    const best = (k) => Math.max(...history.map((h) => h[k]));
    const finals = history.filter((h) => h.final !== null);
    const finalPct = finals.length
      ? `${Math.round((100 * finals.filter((h) => h.final).length) / finals.length)}%`
      : '—';
    const cls = (v) => (v < 0 ? ' class="neg"' : '');
    const rows = history.map((h) => {
      const d = new Date(h.date);
      const date = isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
      const fj = h.final === null ? '—' : h.final ? '✓' : '✗';
      return `<tr><td>${date}</td><td${cls(h.score)}>${money(h.score)}</td><td${cls(h.coryat)}>${money(h.coryat)}</td>
              <td>${h.right}/${h.wrong}</td><td>${fj}</td></tr>`;
    }).join('');

    el.historyBody.innerHTML = `
      <div class="stats-grid">
        <div class="stat"><span class="label">Games</span><strong>${n}</strong></div>
        <div class="stat"><span class="label">Avg Coryat</span><strong>${money(avg('coryat'))}</strong></div>
        <div class="stat"><span class="label">Best Coryat</span><strong>${money(best('coryat'))}</strong></div>
        <div class="stat"><span class="label">Final Jeopardy!</span><strong>${finalPct}</strong></div>
      </div>
      <div class="history-scroll">
        <table class="history-table">
          <thead><tr><th>Date</th><th>Score</th><th>Coryat</th><th>R/W</th><th>FJ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="link" data-act="clearHistory" type="button">Delete all history</button>`;
  }

  $('#historyBtn').addEventListener('click', () => {
    renderHistory();
    el.historyDialog.showModal();
  });

  el.historyDialog.addEventListener('click', (e) => {
    if (e.target === el.historyDialog) { el.historyDialog.close(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') el.historyDialog.close();
    if (act === 'clearHistory' && confirm('Delete all saved games? This cannot be undone.')) {
      storage.set(STORE_HISTORY, []);
      renderHistory();
    }
  });

  render();
})();
