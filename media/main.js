(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const COLS = 11, CW = 84, RH = 56, X0 = 40, MAXROWS = 30, MINROWS = 6;
  const NS = 'http://www.w3.org/2000/svg';
  const isCoil = t => t === 'coil' || t === 'ncoil' || t === 'set' || t === 'reset';
  const KEYS = { '1': 'no', '2': 'nc', '3': 'p', '4': 'n', '5': 'coil', '6': 'ncoil', '7': 'set', '8': 'reset', '-': 'wire' };
  const TOOLS = [
    ['no', '1', 'NO', 'Contact normalement ouvert'], ['nc', '2', 'NF', 'Contact normalement fermé'],
    ['p', '3', 'P', 'Front montant'], ['n', '4', 'N', 'Front descendant'], ['wire', '-', 'Fil', 'Connexion horizontale'],
    ['coil', '5', 'Bobine', 'Bobine'], ['ncoil', '6', 'Bob. /', 'Bobine inversée'],
    ['set', '7', 'Set', 'Bobine Set'], ['reset', '8', 'Reset', 'Bobine Reset']
  ];

  const newRung = () => ({ comment: '', rows: MINROWS, cells: [], links: [] });
  let doc = { version: 1, rungs: [newRung()] };
  let sel = { ri: 0, r: 0, c: 0 };
  let lastSent = '', editing = false;

  const getCell = (g, r, c) => g.cells.find(e => e.r === r && e.c === c);
  const hasLink = (g, r, c) => g.links.some(l => l.r === r && l.c === c);

  function H(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) { if (k === 'value') el.value = attrs[k]; else el.setAttribute(k, attrs[k]); }
    kids.forEach(k => el.append(k));
    return el;
  }
  function S(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  const line = (g, x1, y1, x2, y2, cls) => S('line', { x1, y1, x2, y2, class: cls || 'wire' }, g);
  function text(g, x, y, str, cls) { const t = S('text', { x, y, class: cls }, g); t.textContent = str; return t; }

  // Dessin d'un élément dans une cellule dont le bord gauche est x et l'axe vertical cy.
  function drawElement(g, t, x, cy, name) {
    const m = x + CW / 2;
    if (t === 'wire') { line(g, x, cy, x + CW, cy); return; }
    if (isCoil(t)) {
      line(g, x, cy, m - 14, cy); line(g, m + 14, cy, x + CW, cy);
      S('path', { d: `M${m - 7} ${cy - 15} Q${m - 19} ${cy} ${m - 7} ${cy + 15}`, class: 'wire' }, g);
      S('path', { d: `M${m + 7} ${cy - 15} Q${m + 19} ${cy} ${m + 7} ${cy + 15}`, class: 'wire' }, g);
      if (t === 'ncoil') line(g, m - 5, cy + 8, m + 5, cy - 8, 'wire thin');
      if (t === 'set') text(g, m, cy + 5, 'S', 'tag');
      if (t === 'reset') text(g, m, cy + 5, 'R', 'tag');
    } else {
      line(g, x, cy, m - 10, cy); line(g, m + 10, cy, x + CW, cy);
      line(g, m - 10, cy - 14, m - 10, cy + 14); line(g, m + 10, cy - 14, m + 10, cy + 14);
      if (t === 'nc') line(g, m - 6, cy + 12, m + 6, cy - 12, 'wire thin');
      if (t === 'p') text(g, m, cy + 5, 'P', 'tag');
      if (t === 'n') text(g, m, cy + 5, 'N', 'tag');
    }
    if (name !== undefined) {
      const full = name || '';
      const label = full ? (full.length > 11 ? full.slice(0, 10) + '…' : full) : '?';
      const tx = text(g, m, cy - 20, label, 'name' + (full ? '' : ' missing'));
      const ti = S('title', {}, tx); ti.textContent = full || 'Variable non renseignée';
    }
  }

  function renderBar() {
    const bar = document.getElementById('bar');
    bar.textContent = '';
    TOOLS.forEach(([t, key, label, tip]) => {
      const svg = S('svg', { viewBox: '0 0 84 56', width: 42, height: 28 });
      drawElement(svg, t, 0, 28);
      const b = H('button', { class: 'tool', title: `${tip} (touche ${key})` }, svg, H('span', {}, label));
      b.addEventListener('click', () => place(t));
      bar.appendChild(b);
    });
    bar.appendChild(H('div', { class: 'sep' }));
    const mk = (label, tip, fn, cls) => { const b = H('button', { title: tip, class: cls || '' }, label); b.addEventListener('click', fn); bar.appendChild(b); };
    mk('Lien vertical', 'Relie la ligne à la suivante, à droite de la cellule (touche V)', toggleLink);
    mk('Effacer', 'Efface l’élément ou le lien (touche Suppr)', erase);
    mk('Câbler le réseau', 'Complète les fils horizontaux manquants', autoWire);
    bar.appendChild(H('div', { class: 'sep' }));
    mk('+ Réseau', 'Insère un réseau après le réseau sélectionné', addRung);
    mk('Exporter en ST', 'Génère le code Structured Text', () => vscode.postMessage({ type: 'exportST' }), 'primary');
    bar.appendChild(H('span', { class: 'status', id: 'status' }, 'Flèches : déplacer · 1-8 : placer · Entrée : variable'));
  }
  const status = m => { const s = document.getElementById('status'); if (s) s.textContent = m; };

  function renderRung(rung, ri) {
    const box = H('section', { class: 'rung' });
    const head = H('div', { class: 'rhead' }, H('span', { class: 'rnum' }, 'Réseau ' + (ri + 1)));
    const cm = H('input', { class: 'rcomment', placeholder: 'Commentaire du réseau', value: rung.comment || '' });
    cm.addEventListener('change', () => { rung.comment = cm.value; commit(); });
    head.appendChild(cm);
    const hb = (label, tip, fn) => { const b = H('button', { title: tip }, label); b.addEventListener('click', fn); head.appendChild(b); };
    hb('+ ligne', 'Ajouter une ligne', () => { if (rung.rows < MAXROWS) { rung.rows++; commit(); } });
    hb('− ligne', 'Retirer la dernière ligne (si vide)', () => {
      const last = rung.rows - 1;
      const used = rung.cells.some(e => e.r >= last) || rung.links.some(l => l.r >= last - 1 && l.r + 1 >= last);
      if (rung.rows > MINROWS && !used) { rung.rows--; commit(); } else status('Impossible : ligne utilisée ou minimum atteint.');
    });
    hb('Supprimer', 'Supprimer ce réseau', () => {
      doc.rungs.splice(ri, 1);
      if (!doc.rungs.length) doc.rungs.push(newRung());
      sel = { ri: Math.min(sel.ri, doc.rungs.length - 1), r: 0, c: 0 };
      commit();
    });
    box.appendChild(head);

    const W = X0 + COLS * CW + 24, Ht = rung.rows * RH + 4;
    const wrap = H('div', { class: 'canvas', 'data-ri': ri });
    const svg = S('svg', { width: W, height: Ht, viewBox: `0 0 ${W} ${Ht}` });
    wrap.appendChild(svg);
    const selr = S('rect', { class: 'selrect', 'data-ri': ri, rx: 2 }, svg);

    for (let r = 0; r < rung.rows; r++) for (let c = 0; c < COLS; c++) {
      if (!getCell(rung, r, c)) S('circle', { cx: X0 + c * CW + CW / 2, cy: r * RH + RH / 2 + 2, r: 1.5, class: 'dot' }, svg);
    }
    rung.cells.forEach(e => drawElement(svg, e.t, X0 + e.c * CW, e.r * RH + RH / 2 + 2, isCoil(e.t) || e.t !== 'wire' ? (e.n || '') : undefined));
    rung.links.forEach(l => {
      const x = X0 + (l.c + 1) * CW, y1 = l.r * RH + RH / 2 + 2, y2 = (l.r + 1) * RH + RH / 2 + 2;
      line(svg, x, y1, x, y2, 'vl');
      S('circle', { cx: x, cy: y1, r: 3, class: 'vdot' }, svg); S('circle', { cx: x, cy: y2, r: 3, class: 'vdot' }, svg);
    });
    line(svg, X0, 0, X0, Ht, 'rail'); line(svg, X0 + COLS * CW, 0, X0 + COLS * CW, Ht, 'rail');
    for (let r = 0; r < rung.rows; r++) for (let c = 0; c < COLS; c++) {
      const hit = S('rect', { class: 'hit', x: X0 + c * CW, y: r * RH + 2, width: CW, height: RH - 4 }, svg);
      hit.addEventListener('mousedown', () => { if (!editing) { sel = { ri, r, c }; updateSel(); } });
      hit.addEventListener('dblclick', () => editName());
    }
    box.appendChild(wrap);
    return box;
  }

  function render() {
    const root = document.getElementById('root');
    root.textContent = '';
    doc.rungs.forEach((g, i) => root.appendChild(renderRung(g, i)));
    updateSel();
  }
  function updateSel() {
    document.querySelectorAll('.selrect').forEach(el => {
      const on = +el.getAttribute('data-ri') === sel.ri;
      el.classList.toggle('on', on);
      if (on) { el.setAttribute('x', X0 + sel.c * CW); el.setAttribute('y', sel.r * RH + 2); }
    });
  }
  function commit() {
    lastSent = JSON.stringify(doc, null, 2);
    vscode.postMessage({ type: 'edit', text: lastSent });
    render();
  }

  function place(t) {
    const rung = doc.rungs[sel.ri]; if (!rung) return;
    if (isCoil(t)) sel.c = COLS - 1;
    else if (sel.c === COLS - 1) { status('La dernière colonne est réservée aux bobines.'); return; }
    const ex = getCell(rung, sel.r, sel.c);
    if (ex) { ex.t = t; if (t === 'wire') delete ex.n; } else rung.cells.push({ r: sel.r, c: sel.c, t });
    commit();
    if (t !== 'wire') editName();
  }
  function erase() {
    const rung = doc.rungs[sel.ri]; if (!rung) return;
    const i = rung.cells.findIndex(e => e.r === sel.r && e.c === sel.c);
    if (i >= 0) rung.cells.splice(i, 1);
    else rung.links = rung.links.filter(l => !(l.r === sel.r && l.c === sel.c));
    commit();
  }
  function toggleLink() {
    const rung = doc.rungs[sel.ri]; if (!rung) return;
    if (sel.c >= COLS - 1 || sel.r >= rung.rows - 1) { status('Lien impossible ici (dernière colonne ou dernière ligne).'); return; }
    if (hasLink(rung, sel.r, sel.c)) rung.links = rung.links.filter(l => !(l.r === sel.r && l.c === sel.c));
    else rung.links.push({ r: sel.r, c: sel.c });
    commit();
  }
  function addRung() { doc.rungs.splice(sel.ri + 1, 0, newRung()); sel = { ri: sel.ri + 1, r: 0, c: 0 }; commit(); }

  // Fils horizontaux : une ligne avec bobine est câblée depuis le rail ; sinon on comble les trous entre éléments.
  function autoWire() {
    const rung = doc.rungs[sel.ri]; if (!rung) return;
    for (let r = 0; r < rung.rows; r++) {
      const cols = rung.cells.filter(e => e.r === r).map(e => e.c);
      if (!cols.length) continue;
      const coil = rung.cells.some(e => e.r === r && isCoil(e.t));
      const from = coil ? 0 : Math.min(...cols), to = coil ? COLS - 2 : Math.max(...cols);
      for (let c = from; c <= to; c++) if (!getCell(rung, r, c) && c < COLS - 1) rung.cells.push({ r, c, t: 'wire' });
    }
    commit();
  }

  function editName() {
    const rung = doc.rungs[sel.ri]; if (!rung) return;
    const e = getCell(rung, sel.r, sel.c);
    if (!e || e.t === 'wire') { status('Sélectionne un contact ou une bobine.'); return; }
    const wrap = document.querySelector(`.canvas[data-ri="${sel.ri}"]`);
    const inp = H('input', { class: 'namebox', placeholder: 'Variable', value: e.n || '' });
    inp.style.left = (X0 + sel.c * CW + 4) + 'px';
    inp.style.top = (sel.r * RH + 4) + 'px';
    inp.style.width = (CW - 8) + 'px';
    wrap.appendChild(inp);
    editing = true; inp.focus(); inp.select();
    const done = save => { if (!editing) return; editing = false; if (save) e.n = inp.value.trim(); inp.remove(); commit(); };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
      else if (ev.key === 'Escape') done(false);
      ev.stopPropagation();
    });
    inp.addEventListener('blur', () => done(true));
  }

  function move(dr, dc) {
    let { ri, r, c } = sel; const rung = doc.rungs[ri];
    c = Math.max(0, Math.min(COLS - 1, c + dc)); r += dr;
    if (r < 0) { if (ri > 0) { ri--; r = doc.rungs[ri].rows - 1; } else r = 0; }
    else if (r >= rung.rows) { if (ri < doc.rungs.length - 1) { ri++; r = 0; } else r = rung.rows - 1; }
    sel = { ri, r, c }; updateSel();
  }

  document.addEventListener('keydown', ev => {
    if (editing || ev.target.tagName === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    if (k === 'ArrowRight') move(0, 1); else if (k === 'ArrowLeft') move(0, -1);
    else if (k === 'ArrowDown') move(1, 0); else if (k === 'ArrowUp') move(-1, 0);
    else if (KEYS[k]) place(KEYS[k]);
    else if (k === 'v' || k === 'V' || k === '|') toggleLink();
    else if (k === 'Delete' || k === 'Backspace') erase();
    else if (k === 'Enter' || k === 'F2') editName();
    else return;
    ev.preventDefault();
  });

  function load(txt) {
    let d;
    try { d = JSON.parse(txt); } catch (e) { status('JSON invalide : ' + e.message); return; }
    if (!d || !Array.isArray(d.rungs) || !d.rungs.length) d = { version: 1, rungs: [newRung()] };
    d.rungs.forEach(g => {
      g.cells = Array.isArray(g.cells) ? g.cells : []; g.links = Array.isArray(g.links) ? g.links : [];
      const maxR = Math.max(-1, ...g.cells.map(e => e.r), ...g.links.map(l => l.r + 1));
      g.rows = Math.min(MAXROWS, Math.max(g.rows || MINROWS, MINROWS, maxR + 1));
    });
    doc = d; sel = { ri: Math.min(sel.ri, d.rungs.length - 1), r: 0, c: sel.c };
    render();
  }

  window.addEventListener('message', ev => {
    const m = ev.data;
    if (m.type !== 'doc' || m.text === lastSent) return;
    lastSent = m.text;
    if (m.text.trim()) load(m.text); else { doc = { version: 1, rungs: [newRung()] }; render(); }
  });

  renderBar(); render();
  vscode.postMessage({ type: 'ready' });
})();
