'use strict';
// Génération Structured Text à partir du modèle de grille ladder.
const COLS = 11;
const TRUE = { s: 'TRUE', rail: true, or: false };
const atom = s => ({ s, or: false });
const wrap = x => (x.or ? '(' + x.s + ')' : x.s);
const isCoil = t => t === 'coil' || t === 'ncoil' || t === 'set' || t === 'reset';

function and(a, b) { return a.rail ? b : { s: wrap(a) + ' AND ' + wrap(b), or: false }; }
function or(list) {
  const l = list.filter(Boolean);
  if (!l.length) return null;
  if (l.length === 1) return l[0];
  if (l.some(x => x.rail)) return TRUE;
  return { s: l.map(x => x.s).join(' OR '), or: true };
}
function neg(x) {
  if (x.rail) return 'FALSE';
  return /^[^\s]+$/.test(x.s) ? 'NOT ' + x.s : 'NOT (' + x.s + ')';
}

function coilStmt(t, nm, inp) {
  switch (t) {
    case 'coil':  return [nm + ' := ' + (inp ? inp.s : 'FALSE') + ';'];
    case 'ncoil': return [nm + ' := ' + (inp ? neg(inp) : 'TRUE') + ';'];
    case 'set':   return inp ? ['IF ' + inp.s + ' THEN ' + nm + ' := TRUE; END_IF;'] : [];
    case 'reset': return inp ? ['IF ' + inp.s + ' THEN ' + nm + ' := FALSE; END_IF;'] : [];
  }
  return [];
}

function rungToST(rung, ctx) {
  const R = rung.rows || 6;
  const cells = new Map();
  (rung.cells || []).forEach(e => cells.set(e.r + ',' + e.c, e));
  const links = new Set((rung.links || []).map(l => l.r + ',' + l.c));
  const pre = [], post = [];
  let cur = Array(R).fill(TRUE); // frontière 0 = rail gauche

  for (let c = 0; c < COLS; c++) {
    const out = Array(R).fill(null);
    for (let r = 0; r < R; r++) {
      const e = cells.get(r + ',' + c);
      if (!e) continue;
      const inp = cur[r];
      const nm = e.n && e.n.trim() ? e.n.trim() : '<?>';
      if (isCoil(e.t)) { post.push(...coilStmt(e.t, nm, inp)); continue; }
      if (!inp) continue;
      if (e.t === 'wire') out[r] = inp;
      else if (e.t === 'no') out[r] = and(inp, atom(nm));
      else if (e.t === 'nc') out[r] = and(inp, atom('NOT ' + nm));
      else if (e.t === 'p' || e.t === 'n') {
        const kind = e.t === 'p' ? 'R_TRIG' : 'F_TRIG';
        const id = kind + '_' + (++ctx.n);
        ctx.vars.push(id + ' : ' + kind + ';');
        pre.push(id + '(CLK := ' + nm + ');');
        out[r] = and(inp, atom(id + '.Q'));
      }
    }
    // Liens verticaux à droite de la colonne c : les lignes reliées ne forment qu'un nœud (OU).
    const next = Array(R).fill(null);
    for (let r = 0; r < R;) {
      let end = r;
      while (end < R - 1 && links.has(end + ',' + c)) end++;
      const g = or(out.slice(r, end + 1));
      for (let k = r; k <= end; k++) next[k] = g;
      r = end + 1;
    }
    cur = next;
  }
  return pre.concat(post);
}

function toST(doc) {
  const ctx = { n: 0, vars: [] };
  const body = [];
  (doc.rungs || []).forEach((rung, i) => {
    const cm = (rung.comment || '').replace(/\*\)/g, '* )');
    body.push('(* Réseau ' + (i + 1) + (cm ? ' : ' + cm : '') + ' *)');
    const st = rungToST(rung, ctx);
    body.push(...(st.length ? st : ['(* réseau vide *)']), '');
  });
  const head = ['(* Généré par Ladder Editor — déclare tes variables dans ton projet *)', 'PROGRAM Ladder'];
  if (ctx.vars.length) head.push('VAR', ...ctx.vars.map(v => '  ' + v), 'END_VAR');
  head.push('');
  return head.concat(body, ['END_PROGRAM', '']).join('\n');
}

module.exports = { toST, COLS };
