/*!
 * ScoreEditor 1.0 — petit éditeur de partition en notation ABC (rendu : abcjs)
 * Saisie tactile / souris sur la portée, accords, symboles d'accord, slash,
 * texte et flèches attachés aux notes, couleurs, export (ABC, SVG, PNG, HTML, JSON).
 *
 * Dépendance : abcjs (https://www.abcjs.net), fourni via window.ABCJS
 *   https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.5.2/abcjs-basic-min.js  (à charger avant ce fichier)
 *
 * Usage minimal :
 *   const ed = new ScoreEditor('#partition', { clef: 'grand', measures: 4 });
 *   ed.addNote({ staff: 0, measure: 0, pitch: ['C4','E4','G4'], dur: 'h', chord: 'C' });
 *   ed.getABC();  ed.toSVG();  ed.toJSON();
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ScoreEditor = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

/* =====================================================================
 * 1. THÉORIE MUSICALE
 * Unité de durée : la double-croche (1/16). Ronde = 16, blanche = 8,
 * noire = 4, croche = 2, double = 1 ; pointées : 12, 6, 3.
 * ===================================================================== */
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
const FR = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const ALLOWED = [16, 12, 8, 6, 4, 3, 2, 1];
const DUR_BASE = { w: 16, h: 8, q: 4, e: 2, s: 1 };
const DUR_NAME = { 16: 'ronde', 12: 'blanche pointée', 8: 'blanche', 6: 'noire pointée', 4: 'noire', 3: 'croche pointée', 2: 'croche', 1: 'double-croche' };
const CLEF_D0 = { treble: 30, bass: 18 }; // numéro diatonique de la ligne du bas (Mi4, Sol2)

const PALETTE = [
  { c: '#d6336c', n: 'Framboise' }, { c: '#e8590c', n: 'Orange' }, { c: '#2f9e44', n: 'Vert' },
  { c: '#1971c2', n: 'Bleu' }, { c: '#7048e8', n: 'Violet' }, { c: '#0c8599', n: 'Turquoise' },
  { c: '#868e96', n: 'Gris' }
];
const VOICE_COLORS = ['#d6336c', '#e8590c', '#2f9e44', '#1971c2']; // S, A, T, B
const MOVE_COLORS = { common: '#868e96', step: '#2f9e44', third: '#e8590c', leap: '#d6336c' };

let _uid = 0;
const uid = (p) => p + (++_uid).toString(36) + Math.random().toString(36).slice(2, 5);
const clone = (o) => JSON.parse(JSON.stringify(o));
const mod = (a, n) => ((a % n) + n) % n;

function frNote(k) {
  const s = FR[STEPS.indexOf(k[0])];
  const a = k.slice(1);
  return s + (a === '#' ? '♯' : a === 'b' ? '♭' : '');
}
function accCount(f) { return f > 0 ? ' (' + f + '♯)' : f < 0 ? ' (' + (-f) + '♭)' : ''; }

const KEYS = [];
[['C', 0], ['G', 1], ['D', 2], ['A', 3], ['E', 4], ['B', 5], ['F#', 6], ['C#', 7],
 ['F', -1], ['Bb', -2], ['Eb', -3], ['Ab', -4], ['Db', -5], ['Gb', -6], ['Cb', -7]]
  .forEach(([k, f]) => KEYS.push({ abc: k, fifths: f, minor: false, label: frNote(k) + ' majeur' + accCount(f) }));
[['Am', 0], ['Em', 1], ['Bm', 2], ['F#m', 3], ['C#m', 4], ['G#m', 5], ['D#m', 6], ['A#m', 7],
 ['Dm', -1], ['Gm', -2], ['Cm', -3], ['Fm', -4], ['Bbm', -5], ['Ebm', -6], ['Abm', -7]]
  .forEach(([k, f]) => KEYS.push({ abc: k, fifths: f, minor: true, label: frNote(k.slice(0, -1)) + ' mineur' + accCount(f) }));

const METERS = [[2, 4], [3, 4], [4, 4], [2, 2], [3, 8], [6, 8], [9, 8]];

function keyFifths(abc) { const k = KEYS.find((x) => x.abc === abc); return k ? k.fifths : 0; }
function keyAlts(f) {
  const a = [0, 0, 0, 0, 0, 0, 0];
  if (f > 0) for (let i = 0; i < f; i++) a[SHARP_ORDER[i]] = 1;
  else for (let i = 0; i < -f; i++) a[FLAT_ORDER[i]] = -1;
  return a;
}
const capOf = (m) => (m[0] * 16) / m[1];
const beatOf = (m) => (m[1] === 8 && m[0] % 3 === 0 ? 6 : 4);

const mkPitch = (step, alt, oct, color) => ({ id: uid('p'), step, alt: alt || 0, oct, color: color || '' });
const midiOf = (p) => 12 * (p.oct + 1) + STEP_PC[p.step] + p.alt;
const diaOf = (p) => p.oct * 7 + p.step;
const octOf = (midi, step, alt) => Math.round((midi - alt - STEP_PC[step]) / 12) - 1;
const accStr = (a) => (a === 1 ? '♯' : a === -1 ? '♭' : a === 2 ? '♯♯' : a === -2 ? '♭♭' : '');
const pitchName = (p) => FR[p.step] + accStr(p.alt) + p.oct;
function pitchLabelEn(p) { return STEPS[p.step] + (p.alt > 0 ? '#'.repeat(p.alt) : 'b'.repeat(-p.alt)) + p.oct; }

const SHARPS = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const FLATS = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

/** Orthographie d'une hauteur MIDI selon l'armure (et le sens du mouvement en Do majeur). */
function spellMidi(m, fifths, dir) {
  const pc = mod(m, 12), ka = keyAlts(fifths);
  let sa = null;
  for (let s = 0; s < 7; s++) if (mod(STEP_PC[s] + ka[s], 12) === pc) { sa = [s, ka[s]]; break; }
  if (!sa) sa = ((fifths < 0 || (fifths === 0 && dir < 0)) ? FLATS : SHARPS)[pc];
  return { step: sa[0], alt: sa[1], oct: octOf(m, sa[0], sa[1]) };
}

/** 'C#4' | 'Bb3' | 'Do4' n'est pas géré : notation anglo-saxonne uniquement. */
function parsePitch(s) {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?(-?\d)$/.exec(String(s).trim());
  if (!m) return null;
  const acc = m[2] || '';
  const alt = acc ? (acc[0] === '#' || acc[0] === '♯' ? acc.length : -acc.length) : 0;
  return mkPitch(STEPS.indexOf(m[1].toUpperCase()), alt, parseInt(m[3], 10));
}

function abcPitch(p) {
  let l = STEPS[p.step];
  if (p.oct >= 5) l = l.toLowerCase() + "'".repeat(p.oct - 5);
  else l += ','.repeat(4 - p.oct);
  return l;
}

/* =====================================================================
 * 2. SYMBOLES D'ACCORD « intelligents » (analyse, nom, notes)
 * ===================================================================== */
// [suffixe, alias, demi-tons, degrés (nombre de lettres au-dessus de la fondamentale)]
const CHORD_TYPES = [
  ['', ['', 'maj', 'M'], [0, 4, 7], [0, 2, 4]],
  ['m', ['m', 'min', '-'], [0, 3, 7], [0, 2, 4]],
  ['dim', ['dim', 'o', '°'], [0, 3, 6], [0, 2, 4]],
  ['aug', ['aug', '+'], [0, 4, 8], [0, 2, 4]],
  ['sus4', ['sus4', 'sus'], [0, 5, 7], [0, 3, 4]],
  ['sus2', ['sus2'], [0, 2, 7], [0, 1, 4]],
  ['6', ['6'], [0, 4, 7, 9], [0, 2, 4, 5]],
  ['m6', ['m6', 'min6', '-6'], [0, 3, 7, 9], [0, 2, 4, 5]],
  ['7', ['7'], [0, 4, 7, 10], [0, 2, 4, 6]],
  ['maj7', ['maj7', 'M7', 'Δ', 'Δ7'], [0, 4, 7, 11], [0, 2, 4, 6]],
  ['m7', ['m7', 'min7', '-7'], [0, 3, 7, 10], [0, 2, 4, 6]],
  ['m7b5', ['m7b5', 'ø', 'ø7', 'm7♭5'], [0, 3, 6, 10], [0, 2, 4, 6]],
  ['dim7', ['dim7', 'o7', '°7'], [0, 3, 6, 9], [0, 2, 4, 6]],
  ['mMaj7', ['mMaj7', 'mM7', 'm(maj7)'], [0, 3, 7, 11], [0, 2, 4, 6]],
  ['7sus4', ['7sus4', '7sus'], [0, 5, 7, 10], [0, 3, 4, 6]],
  ['add9', ['add9'], [0, 4, 7, 14], [0, 2, 4, 8]],
  ['9', ['9'], [0, 4, 7, 10, 14], [0, 2, 4, 6, 8]],
  ['maj9', ['maj9', 'M9'], [0, 4, 7, 11, 14], [0, 2, 4, 6, 8]],
  ['m9', ['m9', 'min9', '-9'], [0, 3, 7, 10, 14], [0, 2, 4, 6, 8]],
  ['5', ['5'], [0, 7], [0, 4]]
];

const altFromStr = (s) => (!s ? 0 : (s[0] === '#' || s[0] === '♯') ? s.length : -s.length);
const altToAbc = (a) => (a > 0 ? '#'.repeat(a) : 'b'.repeat(-a));

/** "Bbm7/Eb" → { root:{step,alt}, type, bass:{step,alt}|null } (type=null si qualité inconnue) */
function parseChord(sym) {
  const m = /^\s*([A-G])(#{1,2}|b{1,2}|♯{1,2}|♭{1,2})?([^/]*?)(?:\/([A-G])(#|b|♯|♭)?)?\s*$/.exec(String(sym || ''));
  if (!m) return null;
  const q = m[3].trim();
  const type = CHORD_TYPES.find((t) => t[1].indexOf(q) >= 0) || null;
  return {
    root: { step: STEPS.indexOf(m[1]), alt: altFromStr(m[2]) },
    type,
    bass: m[4] ? { step: STEPS.indexOf(m[4]), alt: altFromStr(m[5]) } : null
  };
}

/** Notes (orthographiées) d'un symbole, en position fondamentale. */
function chordTones(pc) {
  if (!pc || !pc.type) return null;
  const rootPc = mod(STEP_PC[pc.root.step] + pc.root.alt, 12);
  return pc.type[2].map((semi, i) => {
    const step = (pc.root.step + pc.type[3][i]) % 7;
    const v = mod(rootPc + semi - STEP_PC[step], 12);
    return { step, alt: v > 6 ? v - 12 : v, semi };
  });
}

/** Réalise un symbole en notes empilées, la plus basse ≥ lowMidi. */
function voiceChord(sym, lowMidi) {
  const pc = parseChord(sym);
  const tones = chordTones(pc);
  if (!tones) return null;
  const rootPc = mod(STEP_PC[pc.root.step] + pc.root.alt, 12);
  let rootMidi = lowMidi + mod(rootPc - lowMidi, 12);
  const out = tones.map((t) => {
    const midi = rootMidi + t.semi;
    return mkPitch(t.step, t.alt, octOf(midi, t.step, t.alt));
  });
  if (pc.bass) { // renversement / basse : la note grave est ajoutée sous l'accord
    const bpc = mod(STEP_PC[pc.bass.step] + pc.bass.alt, 12);
    const bm = rootMidi - 1 - mod(rootMidi - 1 - bpc, 12);
    out.unshift(mkPitch(pc.bass.step, pc.bass.alt, octOf(bm, pc.bass.step, pc.bass.alt)));
  }
  return out;
}

/** Nomme un empilement de notes ("Cmaj7", "F/A"…) — '' si non reconnu. */
function nameChord(pitches) {
  if (!pitches || pitches.length < 2) return '';
  const sorted = pitches.slice().sort((a, b) => midiOf(a) - midiOf(b));
  const bass = sorted[0];
  const pcs = [];
  sorted.forEach((p) => { const c = mod(midiOf(p), 12); if (pcs.indexOf(c) < 0) pcs.push(c); });
  if (pcs.length < 2) return '';
  const bassPc = mod(midiOf(bass), 12);
  const roots = [bassPc].concat(pcs.filter((c) => c !== bassPc));
  const spell = (pc) => { const p = sorted.find((q) => mod(midiOf(q), 12) === pc); return STEPS[p.step] + altToAbc(p.alt); };
  for (const r of roots) {
    const iv = pcs.map((c) => mod(c - r, 12)).sort((a, b) => a - b);
    const t = CHORD_TYPES.find((ty) => {
      if (ty[0] === '5' && pcs.length !== 2) return false;
      const set = [];
      ty[2].forEach((s) => { const x = s % 12; if (set.indexOf(x) < 0) set.push(x); });
      set.sort((a, b) => a - b);
      return set.length === iv.length && set.every((x, i) => x === iv[i]);
    });
    if (t) return spell(r) + t[0] + (r !== bassPc ? '/' + spell(bassPc) : '');
  }
  return '';
}

/* =====================================================================
 * 3. DURÉES, SILENCES, MESURES
 * ===================================================================== */
const largestAllowed = (n) => ALLOWED.find((d) => d <= n) || 0;
const newRest = (dur) => ({ id: uid('e'), kind: 'rest', dur, pitches: [], chord: '', text: '', textPos: 'above', color: '', mute: false });

/** Décompose une durée vide en silences alignés (mesure vide = un seul silence). */
function splitRests(start, len, cap) {
  if (start === 0 && len === cap && ALLOWED.indexOf(cap) >= 0) return [cap];
  const out = [];
  let pos = start, left = len;
  while (left > 0) {
    const d = [16, 8, 4, 2, 1].find((x) => x <= left && pos % x === 0);
    out.push(d); pos += d; left -= d;
  }
  return out;
}

function fitMeasure(evs, cap) {
  const out = [];
  let pos = 0;
  for (const e of evs) {
    if (pos >= cap) break;
    let d = e.dur;
    if (pos + d > cap) d = largestAllowed(cap - pos);
    if (!d) break;
    out.push(d === e.dur ? e : Object.assign({}, e, { dur: d }));
    pos += d;
  }
  if (pos < cap) splitRests(pos, cap - pos, cap).forEach((d) => out.push(newRest(d)));
  return out;
}

function posOf(m, idx) { let p = 0; for (let i = 0; i < idx; i++) p += m[i].dur; return p; }

/** Remplace un silence (et si besoin les silences suivants) par un nouvel événement. */
function placeInRest(m, idx, cap, want, make) {
  const start = posOf(m, idx);
  let avail = 0, j = idx;
  while (j < m.length && m[j].kind === 'rest') { avail += m[j].dur; j++; }
  let d = ALLOWED.indexOf(want) >= 0 ? want : largestAllowed(want);
  if (d > avail) d = largestAllowed(avail);
  let need = d, i = idx, leftover = 0;
  while (need > 0) {
    const r = m[i];
    if (r.dur <= need) { need -= r.dur; i++; } else { leftover = r.dur - need; need = 0; i++; }
  }
  const ev = make(d);
  const tail = leftover > 0 ? splitRests(start + d, leftover, cap).map(newRest) : [];
  return { ev, m: m.slice(0, idx).concat([ev], tail, m.slice(i)), dur: d };
}

/** Change la durée d'un événement ; null si impossible (notes qui suivent). */
function resizeEvent(m, idx, cap, newDur) {
  const e = m[idx], start = posOf(m, idx);
  if (newDur === e.dur) return m;
  if (newDur < e.dur) {
    const tail = splitRests(start + newDur, e.dur - newDur, cap).map(newRest);
    return m.slice(0, idx).concat([Object.assign({}, e, { dur: newDur })], tail, m.slice(idx + 1));
  }
  let need = newDur - e.dur, avail = 0, j = idx + 1;
  while (j < m.length && m[j].kind === 'rest') { avail += m[j].dur; j++; }
  if (avail < need) return null;
  let i = idx + 1, leftover = 0;
  while (need > 0) {
    const r = m[i];
    if (r.dur <= need) { need -= r.dur; i++; } else { leftover = r.dur - need; need = 0; i++; }
  }
  const tail = leftover > 0 ? splitRests(start + newDur, leftover, cap).map(newRest) : [];
  return m.slice(0, idx).concat([Object.assign({}, e, { dur: newDur })], tail, m.slice(i));
}

/** Fusionne la suite de silences contenant idx (re-découpe alignée). */
function mergeRestRun(m, idx, cap) {
  if (m[idx].kind !== 'rest') return m;
  let a = idx, b = idx;
  while (a > 0 && m[a - 1].kind === 'rest') a--;
  while (b < m.length - 1 && m[b + 1].kind === 'rest') b++;
  let len = 0; for (let i = a; i <= b; i++) len += m[i].dur;
  return m.slice(0, a).concat(splitRests(posOf(m, a), len, cap).map(newRest), m.slice(b + 1));
}

/** Coupe un silence à la position `unit` (pour poser une note au milieu d'un silence). */
function splitRestAt(m, unit, cap) {
  let pos = 0;
  for (let i = 0; i < m.length; i++) {
    const e = m[i];
    if (unit >= pos && unit < pos + e.dur) {
      if (unit === pos) return { m, idx: i };
      if (e.kind !== 'rest') return { m, idx: i };
      const left = splitRests(pos, unit - pos, cap).map(newRest);
      const right = splitRests(unit, pos + e.dur - unit, cap).map(newRest);
      return { m: m.slice(0, i).concat(left, right, m.slice(i + 1)), idx: i + left.length };
    }
    pos += e.dur;
  }
  return { m, idx: -1 };
}

/* =====================================================================
 * 4. ÉTAT ET NORMALISATION
 * ===================================================================== */
function fixEvent(e) {
  const kind = ['note', 'rest', 'slash'].indexOf(e.kind) >= 0 ? e.kind : 'rest';
  const pitches = (e.pitches || []).map((p) => ({ id: p.id || uid('p'), step: p.step, alt: p.alt || 0, oct: p.oct, color: p.color || '' }));
  return {
    id: e.id || uid('e'),
    kind: kind === 'note' && !pitches.length ? 'rest' : kind,
    dur: ALLOWED.indexOf(e.dur) >= 0 ? e.dur : 4,
    pitches: kind === 'note' ? pitches : [],
    chord: e.chord || '', text: e.text || '', textPos: e.textPos === 'below' ? 'below' : 'above',
    color: e.color || '',
    tie: kind === 'note' && !!e.tie, sOpen: kind === 'note' ? (e.sOpen | 0) : 0, sClose: kind === 'note' ? (e.sClose | 0) : 0,
    mute: kind === 'slash' && !!e.mute
  };
}

function newState(o) {
  const clefs = o.clef === 'grand' ? ['treble', 'bass'] : [o.clef === 'bass' ? 'bass' : 'treble'];
  const meter = (o.meter || [4, 4]).slice();
  const cap = capOf(meter);
  const S = {
    v: 1, title: o.title || '', meter, key: KEYS.some((k) => k.abc === o.key) ? o.key : 'C',
    tempo: o.tempo || 80, barNumbers: !!o.barNumbers,
    staves: clefs.map((c) => ({ clef: c, measures: [] })), arrows: []
  };
  const n = Math.max(1, Math.min(64, o.measures || 4));
  S.staves.forEach((st) => { for (let i = 0; i < n; i++) st.measures.push(fitMeasure([], cap)); });
  return S;
}

function pruneArrows(S) {
  const ok = {};
  S.staves.forEach((st) => st.measures.forEach((m) => m.forEach((e) => { e.pitches.forEach((p) => { ok[e.id + ':' + p.id] = 1; }); })));
  S.arrows = (S.arrows || []).filter((a) => ok[a.from.e + ':' + a.from.p] && ok[a.to.e + ':' + a.to.p]);
}

function normalizeState(d) {
  const S = clone(d);
  S.v = 1; S.title = S.title || '';
  S.meter = S.meter && S.meter.length === 2 ? S.meter : [4, 4];
  S.key = KEYS.some((k) => k.abc === S.key) ? S.key : 'C';
  S.tempo = S.tempo || 80; S.barNumbers = !!S.barNumbers; S.arrows = S.arrows || [];
  const cap = capOf(S.meter);
  S.staves = (S.staves && S.staves.length ? S.staves : [{ clef: 'treble', measures: [] }]).slice(0, 2);
  const nm = Math.max(1, Math.min(64, Math.max.apply(null, S.staves.map((s) => (s.measures ? s.measures.length : 0)))));
  S.staves.forEach((st) => {
    st.clef = st.clef === 'bass' ? 'bass' : 'treble';
    st.measures = st.measures || [];
    while (st.measures.length < nm) st.measures.push([]);
    st.measures = st.measures.slice(0, nm).map((m) => fitMeasure(m.map(fixEvent), cap));
  });
  S.arrows = S.arrows.map((a) => ({
    id: a.id || uid('a'), from: a.from, to: a.to, color: a.color || '#495057', label: a.label || '',
    curve: a.curve === 0 ? 0 : a.curve === -1 ? -1 : 1, dashed: !!a.dashed
  }));
  pruneArrows(S);
  return S;
}

/* =====================================================================
 * 5. GÉNÉRATION ABC
 * ===================================================================== */
const abcText = (t) => String(t == null ? '' : t).replace(/[“”"\\\r\n]/g, ' ').replace(/♯/g, '#').replace(/♭/g, 'b').trim();

function accidental(p, st, ka) {
  const k = p.step + ':' + p.oct;
  const cur = k in st ? st[k] : ka[p.step];
  if (p.alt === cur) return '';
  st[k] = p.alt;
  return p.alt === 0 ? '=' : p.alt === 1 ? '^' : p.alt === 2 ? '^^' : p.alt === -1 ? '_' : '__';
}

/** Liaisons d'expression valides d'une portée (ouvertures/fermetures appariées, dans l'ordre du temps). */
function liaisons(stv) {
  const open = {}, close = {}, stack = [];
  stv.measures.forEach((m) => m.forEach((e) => {
    if (e.kind !== 'note') return;
    let c = e.sClose | 0;
    while (c-- > 0 && stack.length) { const o = stack.pop(); open[o] = (open[o] || 0) + 1; close[e.id] = (close[e.id] || 0) + 1; }
    let n = e.sOpen | 0;
    while (n-- > 0) stack.push(e.id);
  }));
  return { open, close };
}

function measureABC(clef, evs, beat, ka, lia) {
  const st = {};
  let pos = 0, prevBeam = false, prevBeatIdx = -1, out = '';
  evs.forEach((e, i) => {
    let s = '';
    if (e.chord) s += '"' + abcText(e.chord) + '"';
    if (e.text) s += '"' + (e.textPos === 'below' ? '_' : '^') + abcText(e.text) + '"';
    const dn = e.dur === 1 ? '' : String(e.dur);
    if (e.kind === 'rest') s += 'z' + dn;
    else if (e.kind === 'slash') s += (clef === 'bass' ? 'D,' : 'B') + dn;
    else {
      const ps = e.pitches.slice().sort((a, b) => midiOf(a) - midiOf(b));
      const o = '('.repeat((lia && lia.open[e.id]) || 0), c = ')'.repeat((lia && lia.close[e.id]) || 0), tie = e.tie ? '-' : '';
      if (ps.length === 1) s += o + accidental(ps[0], st, ka) + abcPitch(ps[0]) + dn + tie + c;
      else s += o + '[' + ps.map((p) => accidental(p, st, ka) + abcPitch(p)).join('') + ']' + dn + tie + c;
    }
    const beamable = e.kind === 'note' && e.dur <= 2 && (pos % beat) + e.dur <= beat;
    const bi = Math.floor(pos / beat);
    if (i > 0) out += (beamable && prevBeam && bi === prevBeatIdx) ? '' : ' ';
    out += s;
    prevBeam = beamable; prevBeatIdx = bi;
    pos += e.dur;
  });
  return out;
}

/** opts : perLine (mesures par système), tempo (écrit Q:) */
function buildABC(S, opts) {
  opts = opts || {};
  const beat = beatOf(S.meter), ka = keyAlts(keyFifths(S.key));
  const perLine = Math.max(1, opts.perLine || 4);
  const L = ['X:1'];
  if (S.title) L.push('T:' + abcText(S.title));
  L.push('M:' + S.meter[0] + '/' + S.meter[1], 'L:1/16');
  if (opts.tempo) L.push('Q:1/4=' + S.tempo);
  if (S.barNumbers) L.push('%%barnumbers 1');
  const nst = S.staves.length;
  if (nst > 1) {
    L.push('%%score {1 2}', 'V:1 clef=' + S.staves[0].clef, 'V:2 clef=' + S.staves[1].clef, 'K:' + S.key);
  } else L.push('K:' + S.key + ' clef=' + S.staves[0].clef);
  const nm = S.staves[0].measures.length, LIA = S.staves.map(liaisons);
  for (let start = 0; start < nm; start += perLine) {
    const end = Math.min(nm, start + perLine);
    S.staves.forEach((stv, si) => {
      const parts = [];
      for (let m = start; m < end; m++) parts.push(measureABC(stv.clef, stv.measures[m], beat, ka, LIA[si]));
      L.push((nst > 1 ? '[V:' + (si + 1) + '] ' : '') + parts.join(' | ') + (end === nm ? ' |]' : ' |'));
    });
  }
  return L.join('\n') + '\n';
}

/* =====================================================================
 * 6. CLASSE ScoreEditor — état, opérations d'édition, API publique
 * ===================================================================== */
const DEFAULTS = {
  clef: 'treble',        // 'treble' | 'bass' | 'grand'
  measures: 4,
  meter: [4, 4],
  key: 'C',
  tempo: 80,
  title: '',
  scale: null,           // zoom de la partition (1.35 par défaut, 1.7 sur écran tactile)
  perLine: 'auto',       // mesures par système : 'auto' ou un nombre
  barNumbers: false,
  readOnly: false,       // true = affichage seul (pas d'édition)
  ui: true,              // false = pas de barre d'outils (API seule)
  sound: true,           // petit son de contrôle en écrivant / sélectionnant
  abcjs: null,           // par défaut window.ABCJS
  download: null,        // function(filename, mime, data) → remplace le téléchargement par défaut
  onChange: null,
  data: null             // état JSON à charger (voir toJSON)
};

function parseDur(d, dotted) {
  let v;
  if (typeof d === 'number') v = d;
  else {
    const s = String(d);
    v = DUR_BASE[s.replace('.', '')] || 4;
    if (/\.$/.test(s)) dotted = true;
  }
  if (dotted && v > 1) v = v * 1.5;
  return ALLOWED.indexOf(v) >= 0 ? v : (largestAllowed(v) || 4);
}
function toPitchObj(p) {
  if (typeof p === 'string') { const q = parsePitch(p); if (!q) throw new Error('Hauteur invalide : ' + p); return q; }
  return mkPitch(p.step, p.alt, p.oct, p.color);
}
// Nom d'intervalle à partir du nombre de demi-tons (indépendant de l'orthographe des notes) : 4 demi-tons = toujours « 3ce M ».
const IV_NAMES = ['unisson', '2de m', '2de M', '3ce m', '3ce M', '4te', 'triton', '5te', '6te m', '6te M', '7e m', '7e M'];
function intervalLabel(semi) {
  const a = Math.abs(semi);
  if (a === 0) return '=';
  const oct = Math.floor(a / 12), r = a % 12;
  let name = r === 0 && oct > 0 ? '8ve' : IV_NAMES[r];
  if (oct > 0 && r !== 0) name += ' +' + oct + '8ve';
  else if (oct > 1) name += '×' + oct;
  return (semi > 0 ? '↑' : '↓') + name;
}

class ScoreEditor {
  constructor(target, opts) {
    const o = this.o = Object.assign({}, DEFAULTS, opts || {});
    this._h = {}; this.undoS = []; this.redoS = [];
    this.sel = []; this.dur = 4; this.dotted = false; this.acc = 'auto';
    this.kind = 'note'; this.mode = 'write'; this.multi = false; this.tab = 'write';
    this.pending = null; this.geo = null;
    this.touch = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
    this.confirm = false; // désactivé par défaut, y compris sur écran tactile — l'utilisateur l'active s'il le souhaite
    this.S = o.data ? normalizeState(o.data) : newState(o);
    this.scale = o.scale || (this.touch ? 1.7 : 1.35);
    this.el = (typeof target === 'string' && root.document) ? root.document.querySelector(target) : target;
    this.headless = !this.el || !root.document || !this.el.appendChild;
    this.abcjs = o.abcjs || root.ABCJS || null;
    if (o.onChange) this.on('change', o.onChange);
    if (!this.headless) { this._build(); this.render(); this._observe(); }
  }

  /* ---------- événements ---------- */
  on(name, fn) { (this._h[name] = this._h[name] || []).push(fn); return this; }
  off(name, fn) { this._h[name] = (this._h[name] || []).filter((f) => f !== fn); return this; }
  _emit(name, data) { (this._h[name] || []).forEach((f) => { try { f(data, this); } catch (e) { if (root.console) console.error(e); } }); }

  /* ---------- historique ---------- */
  _snap() { this.undoS.push(JSON.stringify(this.S)); if (this.undoS.length > 100) this.undoS.shift(); this.redoS.length = 0; }
  _mutate(type, fn) {
    this._snap();
    let r;
    try { r = fn(); } catch (e) { this.undoS.pop(); throw e; }
    if (r === false) { this.undoS.pop(); return false; }
    pruneArrows(this.S); this._cleanSel(); this.render(); this._emit('change', { type });
    return r === undefined ? true : r;
  }
  undo() {
    if (!this.undoS.length) return false;
    this.redoS.push(JSON.stringify(this.S)); this.S = JSON.parse(this.undoS.pop());
    this._cleanSel(); this.render(); this._emit('change', { type: 'undo' }); return true;
  }
  redo() {
    if (!this.redoS.length) return false;
    this.undoS.push(JSON.stringify(this.S)); this.S = JSON.parse(this.redoS.pop());
    this._cleanSel(); this.render(); this._emit('change', { type: 'redo' }); return true;
  }

  /* ---------- recherche ---------- */
  _find(id) {
    const S = this.S;
    for (let si = 0; si < S.staves.length; si++) {
      const ms = S.staves[si].measures;
      for (let mi = 0; mi < ms.length; mi++) {
        const ei = ms[mi].findIndex((e) => e.id === id);
        if (ei >= 0) return { si, mi, ei, ev: ms[mi][ei], m: ms[mi] };
      }
    }
    return null;
  }
  _targets(t) {
    const list = t == null ? this.sel : (Array.isArray(t) ? t : [t]);
    const out = [];
    list.forEach((x) => {
      const it = typeof x === 'string' ? { e: x, p: null } : x;
      const f = this._find(it.e);
      if (!f) return;
      out.push(Object.assign({}, f, { p: it.p ? (f.ev.pitches.find((q) => q.id === it.p) || null) : null }));
    });
    return out;
  }
  _pitchTargets(t) { // liste dédoublonnée de pitches (objets vivants)
    const set = new Set();
    this._targets(t).forEach((x) => { (x.p ? [x.p] : x.ev.pitches).forEach((p) => set.add(p)); });
    return Array.from(set);
  }
  _uniqueEvents(t) {
    const seen = {}, out = [];
    this._targets(t).forEach((x) => { if (!seen[x.ev.id]) { seen[x.ev.id] = 1; out.push(x); } });
    return out;
  }
  _startOf(f) { return posOf(f.m, f.ei); }

  /* ---------- sélection ---------- */
  _selKey(it) { return it.e + ':' + (it.p || ''); }
  isSelected(e, p) {
    return this.sel.some((it) => it.e === e && (it.p === (p || null) || (it.p === null && p && false)));
  }
  select(items, keep) {
    const list = (items || []).map((x) => (typeof x === 'string' ? { e: x, p: null } : { e: x.e, p: x.p || null }));
    this.sel = keep ? this.sel.concat(list) : list;
    this._afterSel();
  }
  _toggleSel(it, multi) {
    const k = this._selKey(it), i = this.sel.findIndex((x) => this._selKey(x) === k);
    if (multi) { if (i >= 0) this.sel.splice(i, 1); else this.sel.push(it); }
    else this.sel = (i >= 0 && this.sel.length === 1) ? [] : [it];
    this._afterSel();
  }
  clearSelection() { this.sel = []; this.pending = null; this._afterSel(); }
  selectAll() {
    const list = [];
    this.S.staves.forEach((st) => st.measures.forEach((m) => m.forEach((e) => { if (e.kind !== 'rest') list.push({ e: e.id, p: null }); })));
    this.sel = list; this._afterSel();
  }
  selectMeasure(mi) {
    const list = [];
    this.S.staves.forEach((st) => (st.measures[mi] || []).forEach((e) => { if (e.kind !== 'rest') list.push({ e: e.id, p: null }); }));
    this.sel = list; this._afterSel();
  }
  /** Déplace la sélection vers l'événement précédent (-1) ou suivant (+1) de la même portée. */
  moveSelection(dir) {
    const t = this._targets()[0];
    if (!t) return;
    const flat = [];
    this.S.staves[t.si].measures.forEach((m) => m.forEach((e) => flat.push(e)));
    const i = flat.findIndex((e) => e.id === t.ev.id), n = flat[i + dir];
    if (n) { this.sel = [{ e: n.id, p: null }]; this._afterSel(); }
  }
  getSelection() { return this.sel.slice(); }
  _cleanSel() {
    this.sel = this.sel.filter((it) => { const f = this._find(it.e); return f && (!it.p || f.ev.pitches.some((p) => p.id === it.p)); });
  }
  _afterSel() { this._cleanSel(); if (!this.headless) { this._drawStatic(); this._updateUI(); } this._emit('select', this.getSelection()); }
  _selectionText() {
    const ts = this._targets();
    if (!ts.length) return '';
    const names = [];
    ts.forEach((t) => (t.p ? [t.p] : t.ev.pitches).forEach((p) => names.push(pitchName(p))));
    const evs = this._uniqueEvents().length;
    return names.length ? names.join(' · ') : (evs + (evs > 1 ? ' éléments' : ' silence / slash') + ' sélectionné' + (evs > 1 ? 's' : ''));
  }

  /* ---------- partition : réglages globaux ---------- */
  setClef(c) {
    return this._mutate('clef', () => {
      const S = this.S, cap = capOf(S.meter), n = S.staves[0].measures.length;
      const cur = S.staves.length > 1 ? 'grand' : S.staves[0].clef;
      if (c === cur) return false;
      const blank = () => { const a = []; for (let i = 0; i < n; i++) a.push(fitMeasure([], cap)); return a; };
      if (c === 'grand') {
        const only = S.staves[0];
        S.staves = only.clef === 'treble' ? [only, { clef: 'bass', measures: blank() }] : [{ clef: 'treble', measures: blank() }, only];
      } else if (S.staves.length > 1) {
        const keep = c === 'bass' ? S.staves[1] : S.staves[0];
        keep.clef = c; S.staves = [keep];
      } else S.staves[0].clef = c;
      this.sel = [];
    });
  }
  setKey(k) { if (!KEYS.some((x) => x.abc === k) || this.S.key === k) return false; return this._mutate('key', () => { this.S.key = k; }); }
  setMeter(n, d) {
    if (this.S.meter[0] === n && this.S.meter[1] === d) return false;
    return this._mutate('meter', () => {
      this.S.meter = [n, d]; const cap = capOf([n, d]);
      this.S.staves.forEach((st) => { st.measures = st.measures.map((m) => fitMeasure(m, cap)); });
    });
  }
  setTempo(t) { t = Math.max(30, Math.min(240, parseInt(t, 10) || 80)); return this._mutate('tempo', () => { this.S.tempo = t; }); }
  setTitle(t) { return this._mutate('title', () => { this.S.title = String(t || ''); }); }
  setBarNumbers(b) { return this._mutate('barNumbers', () => { this.S.barNumbers = !!b; }); }
  setMeasureCount(n) {
    n = Math.max(1, Math.min(64, parseInt(n, 10) || 1));
    if (n === this.S.staves[0].measures.length) return false;
    return this._mutate('measures', () => {
      const cap = capOf(this.S.meter);
      this.S.staves.forEach((st) => { while (st.measures.length < n) st.measures.push(fitMeasure([], cap)); st.measures.length = n; });
    });
  }
  addMeasure() { return this.setMeasureCount(this.S.staves[0].measures.length + 1); }
  removeMeasure() { return this.setMeasureCount(this.S.staves[0].measures.length - 1); }
  clearMeasure(mi) {
    return this._mutate('clearMeasure', () => {
      const cap = capOf(this.S.meter);
      this.S.staves.forEach((st) => { if (st.measures[mi]) st.measures[mi] = fitMeasure([], cap); });
    });
  }
  reset() { this.S = newState(Object.assign({}, this.o, { data: null })); this.sel = []; this.undoS = []; this.redoS = []; this.render(); this._emit('change', { type: 'reset' }); }

  /* ---------- notes ---------- */
  /**
   * addNote({ staff, measure, position, pitch, dur, dotted, kind, chord, text, textPos, color })
   *  - pitch : 'C4' | ['C4','E4','G4']   (notation anglo-saxonne, # et b)
   *  - dur   : 'w' 'h' 'q' 'e' 's' (+ '.') ou 16 8 4 2 1
   *  - position : en noires depuis le début de la mesure (défaut : premier silence libre)
   *  - kind  : 'note' (défaut) | 'slash' | 'mark' (repère visuel muet, durée fixe : une noire)
   * Retourne l'id de l'événement (ou null).
   */
  addNote(spec) {
    const S = this.S, si = spec.staff || 0, mi = spec.measure || 0;
    const st = S.staves[si];
    if (!st || !st.measures[mi]) throw new Error('Portée ou mesure invalide');
    const isMark = spec.kind === 'mark';
    const cap = capOf(S.meter), d = isMark ? 4 : parseDur(spec.dur != null ? spec.dur : this.dur, spec.dotted);
    const kind = (spec.kind === 'slash' || isMark) ? 'slash' : 'note';
    let id = null;
    const ok = this._mutate('addNote', () => {
      let m = st.measures[mi], idx;
      if (spec.position == null) { idx = m.findIndex((e) => e.kind === 'rest'); if (idx < 0) return false; }
      else { const r = splitRestAt(m, Math.round(spec.position * 4), cap); m = r.m; idx = r.idx; if (idx < 0) return false; }
      const pitches = (Array.isArray(spec.pitch) ? spec.pitch : spec.pitch ? [spec.pitch] : []).map(toPitchObj);
      const target = m[idx];
      let ev;
      if (target.kind === 'note' && kind === 'note' && pitches.length) {
        pitches.forEach((p) => { if (!target.pitches.some((q) => q.step === p.step && q.oct === p.oct)) target.pitches.push(p); });
        ev = target; st.measures[mi] = m;
      } else if (target.kind === 'rest') {
        if (kind === 'note' && !pitches.length) return false;
        const res = placeInRest(m, idx, cap, d, (dd) => Object.assign(newRest(dd), { kind, pitches: kind === 'note' ? pitches : [] }));
        ev = res.ev; st.measures[mi] = res.m;
      } else return false;
      if (spec.chord != null) ev.chord = String(spec.chord);
      if (spec.text != null) ev.text = String(spec.text);
      if (spec.textPos) ev.textPos = spec.textPos === 'below' ? 'below' : 'above';
      if (spec.color) { ev.pitches.forEach((p) => { p.color = spec.color; }); ev.color = spec.color; }
      if (kind === 'slash') ev.mute = isMark ? true : !!spec.mute;
      id = ev.id;
    });
    return ok === false ? null : id;
  }
  /** Supprime : la note (ou l'accord) devient un silence ; un silence est fusionné avec ses voisins. */
  remove(target) {
    const ts = this._targets(target);
    if (!ts.length) return false;
    return this._mutate('remove', () => {
      const cap = capOf(this.S.meter), groups = {}, order = [];
      ts.forEach((t) => {
        const g = groups[t.ev.id] || (groups[t.ev.id] = { id: t.ev.id, ps: {}, n: 0, whole: false });
        if (!g.n && !g.whole) order.push(g);
        if (t.p) { g.ps[t.p.id] = 1; g.n++; } else g.whole = true;
      });
      order.forEach((g) => {
        const f = this._find(g.id);
        if (!f) return;
        const e = f.ev;
        if (e.kind === 'rest') {
          if (e.chord || e.text) { e.chord = ''; e.text = ''; return; }
          const r = mergeRestRun(f.m, f.ei, cap); f.m.splice(0, f.m.length, ...r); return;
        }
        if (e.kind === 'note' && !g.whole && g.n && g.n < e.pitches.length) { e.pitches = e.pitches.filter((p) => !g.ps[p.id]); return; }
        e.kind = 'rest'; e.pitches = []; e.color = ''; e.tie = false; e.sOpen = 0; e.sClose = 0;
      });
      this.sel = [];
    });
  }
  /** Modifie la durée des événements sélectionnés. */
  setDuration(dur, dotted, target) {
    const d = parseDur(dur, dotted), ids = this._uniqueEvents(target).map((x) => x.ev.id);
    if (!ids.length) return false;
    let changed = false;
    const r = this._mutate('duration', () => {
      const cap = capOf(this.S.meter);
      ids.forEach((id) => {
        const f = this._find(id);
        if (!f) return;
        const res = resizeEvent(f.m, f.ei, cap, d);
        if (res) { f.m.splice(0, f.m.length, ...res); changed = true; }
      });
      if (!changed) return false;
    });
    if (r === false) this._toast('Pas assez de place : des notes suivent dans la mesure.');
    return r;
  }
  /** Transpose les notes sélectionnées de n demi-tons (12 = octave). */
  transpose(semi, target) {
    const ps = this._pitchTargets(target);
    if (!ps.length) return false;
    const f = keyFifths(this.S.key);
    return this._mutate('transpose', () => {
      let n = 0;
      ps.forEach((p) => {
        const m = midiOf(p) + semi;
        if (m < 21 || m > 108) return;
        const q = spellMidi(m, f, semi); p.step = q.step; p.alt = q.alt; p.oct = q.oct; n++;
      });
      if (!n) return false;
    });
  }
  /** Modifie l'altération des notes sélectionnées (-1 ♭, 0 ♮, 1 ♯). */
  setAlteration(alt, target) {
    const ps = this._pitchTargets(target);
    if (!ps.length) return false;
    return this._mutate('alteration', () => { ps.forEach((p) => { p.alt = alt; }); });
  }
  clearMeasureAt(mi) { return this.clearMeasure(mi); }

  /* ---------- accords, texte, couleur ---------- */
  setChord(sym, target) {
    const evs = this._uniqueEvents(target);
    if (!evs.length) return false;
    sym = String(sym || '').replace(/["\\]/g, '').trim();
    return this._mutate('chord', () => { evs.forEach((x) => { x.ev.chord = sym; }); });
  }
  setText(text, pos, target) {
    const evs = this._uniqueEvents(target);
    if (!evs.length) return false;
    text = String(text || '').replace(/["\\]/g, '').trim();
    return this._mutate('text', () => { evs.forEach((x) => { x.ev.text = text; if (pos) x.ev.textPos = pos === 'below' ? 'below' : 'above'; }); });
  }
  setColor(color, target) {
    const ts = this._targets(target);
    if (!ts.length) return false;
    return this._mutate('color', () => {
      ts.forEach((t) => {
        if (t.p) t.p.color = color || ''; else { t.ev.pitches.forEach((p) => { p.color = color || ''; }); t.ev.color = color || ''; }
      });
    });
  }
  clearColors() {
    return this._mutate('color', () => { this.S.staves.forEach((st) => st.measures.forEach((m) => m.forEach((e) => { e.color = ''; e.pitches.forEach((p) => { p.color = ''; }); }))); });
  }
  /** Notes présentes en même temps dans les autres portées (grande portée). */
  _stackedPitches(f) {
    const start = this._startOf(f), out = f.ev.pitches.slice();
    this.S.staves.forEach((st, si) => {
      if (si === f.si) return;
      const m = st.measures[f.mi]; let pos = 0;
      (m || []).forEach((e) => { if (pos === start && e.kind === 'note') e.pitches.forEach((p) => out.push(p)); pos += e.dur; });
    });
    return out;
  }
  /** Écrit le symbole d'accord déduit des notes empilées. */
  nameFromNotes(target) {
    const evs = this._uniqueEvents(target).filter((x) => x.ev.kind === 'note');
    if (!evs.length) return false;
    let found = 0;
    const r = this._mutate('chord', () => {
      evs.forEach((x) => { const n = nameChord(this._stackedPitches(x)); if (n) { x.ev.chord = n; found++; } });
      if (!found) return false;
    });
    if (r === false) this._toast('Accord non reconnu (sélectionnez au moins trois notes empilées).');
    return r;
  }
  /** Transforme le symbole d'accord en notes empilées (sur silence, slash ou note). */
  notesFromChord(target) {
    const evs = this._uniqueEvents(target).filter((x) => x.ev.chord && parseChord(x.ev.chord) && parseChord(x.ev.chord).type);
    if (!evs.length) { this._toast('Aucun symbole d\'accord reconnu sur la sélection.'); return false; }
    return this._mutate('chord', () => {
      evs.forEach((x) => {
        const clef = this.S.staves[x.si].clef;
        const ps = voiceChord(x.ev.chord, clef === 'bass' ? 40 : 60);
        if (!ps) return;
        x.ev.kind = 'note'; x.ev.pitches = ps;
      });
    });
  }

  /* ---------- flèches (mouvements de voix) ---------- */
  /** addArrow({e,p}, {e,p}, { color, label, curve: 1|0|-1, dashed }) */
  addArrow(from, to, opts) {
    opts = opts || {};
    if (!from || !to || !from.p || !to.p) return null;
    let id = null;
    const ok = this._mutate('arrow', () => {
      if (!this._find(from.e) || !this._find(to.e)) return false;
      id = uid('a');
      this.S.arrows.push({ id, from: { e: from.e, p: from.p }, to: { e: to.e, p: to.p }, color: opts.color || '#495057', label: opts.label || '', curve: opts.curve === 0 ? 0 : opts.curve === -1 ? -1 : 1, dashed: !!opts.dashed, auto: !!opts.auto });
    });
    return ok === false ? null : id;
  }
  /** Relie les deux premières notes sélectionnées (dans l'ordre de sélection). */
  arrowFromSelection(opts) {
    const ps = [];
    this._targets().forEach((t) => { if (t.p) ps.push({ e: t.ev.id, p: t.p.id }); else if (t.ev.pitches.length === 1) ps.push({ e: t.ev.id, p: t.ev.pitches[0].id }); });
    if (ps.length !== 2) { this._toast('Sélectionnez exactement deux notes (multi-sélection) pour tracer une flèche.'); return null; }
    return this.addArrow(ps[0], ps[1], opts);
  }
  removeArrows(which) { // 'all' | 'selection' | id
    return this._mutate('arrow', () => {
      const n = this.S.arrows.length;
      if (which === 'all') this.S.arrows = [];
      else if (which === 'auto') this.S.arrows = this.S.arrows.filter((a) => !a.auto);
      else if (which === 'selection' || which == null) {
        const ids = {}; this._pitchTargets().forEach((p) => { ids[p.id] = 1; });
        this.S.arrows = this.S.arrows.filter((a) => !(ids[a.from.p] || ids[a.to.p]));
      } else this.S.arrows = this.S.arrows.filter((a) => a.id !== which);
      if (this.S.arrows.length === n) return false;
    });
  }
  /** Notes triées du grave à l'aigu pour chaque événement, par portée : [[{e, sorted}]] */
  _noteEvents(si) {
    const out = [];
    this.S.staves[si].measures.forEach((m) => m.forEach((e) => { if (e.kind === 'note') out.push(e); }));
    return out;
  }
  /** Couleur par voix (soprano / alto / ténor / basse) d'après la position dans l'accord. */
  colorByVoice() {
    return this._mutate('color', () => {
      const grand = this.S.staves.length > 1;
      this.S.staves.forEach((st, si) => st.measures.forEach((m) => m.forEach((e) => {
        if (e.kind !== 'note') return;
        const ps = e.pitches.slice().sort((a, b) => midiOf(b) - midiOf(a)), n = ps.length;
        ps.forEach((p, i) => {
          let v;
          if (grand) v = si === 0 ? Math.min(i, 3) : 3 - (n - 1 - i);
          else v = n === 1 ? 0 : (i === 0 ? 0 : i === n - 1 ? 3 : Math.min(i, 2));
          p.color = VOICE_COLORS[Math.max(0, Math.min(3, v))];
        });
      })));
    });
  }
  /** Couleur d'après le mouvement vers la note suivante (commune / conjoint / tierce / saut). */
  colorByMotion() {
    return this._mutate('color', () => {
      this.S.staves.forEach((st, si) => {
        const evs = this._noteEvents(si);
        evs.forEach((e) => e.pitches.forEach((p) => { p.color = ''; }));
        for (let i = 1; i < evs.length; i++) {
          const a = evs[i - 1].pitches.slice().sort((x, y) => midiOf(y) - midiOf(x));
          const b = evs[i].pitches.slice().sort((x, y) => midiOf(y) - midiOf(x));
          for (let k = 0; k < Math.min(a.length, b.length); k++) {
            const d = Math.abs(midiOf(b[k]) - midiOf(a[k]));
            b[k].color = d === 0 ? MOVE_COLORS.common : d <= 2 ? MOVE_COLORS.step : d <= 4 ? MOVE_COLORS.third : MOVE_COLORS.leap;
          }
        }
      });
    });
  }
  /** Trace une flèche par voix entre notes consécutives (accords de même effectif). */
  autoArrows(opts) {
    opts = opts || {};
    return this._mutate('arrow', () => {
      this.S.arrows = this.S.arrows.filter((a) => !a.auto);
      this.S.staves.forEach((st, si) => {
        const evs = this._noteEvents(si);
        for (let i = 1; i < evs.length; i++) {
          const a = evs[i - 1].pitches.slice().sort((x, y) => midiOf(y) - midiOf(x));
          const b = evs[i].pitches.slice().sort((x, y) => midiOf(y) - midiOf(x));
          if (a.length !== b.length) continue;
          for (let k = 0; k < a.length; k++) {
            const dm = midiOf(b[k]) - midiOf(a[k]);
            const label = opts.labels === false ? '' : intervalLabel(dm);
            const c = dm === 0 ? MOVE_COLORS.common : (a[k].color || (Math.abs(dm) <= 2 ? MOVE_COLORS.step : Math.abs(dm) <= 4 ? MOVE_COLORS.third : MOVE_COLORS.leap));
            this.S.arrows.push({ id: uid('a'), from: { e: evs[i - 1].id, p: a[k].id }, to: { e: evs[i].id, p: b[k].id }, color: c, label, curve: opts.curve != null ? (opts.curve === 0 ? 0 : opts.curve < 0 ? -1 : 1) : (dm === 0 ? 0 : (dm > 0 ? 1 : -1)), dashed: dm === 0, auto: true });
          }
        }
      });
    });
  }

  /* ---------- liaisons ---------- */
  /**
   * Bascule une liaison sur les notes sélectionnées :
   *  - une note (ou deux notes consécutives) de même hauteur → liaison de prolongation ;
   *  - sinon → liaison d'expression (legato) de la première à la dernière note sélectionnée.
   * Avec une seule note sélectionnée, la liaison va vers la note suivante.
   */
  toggleLiaison(target) {
    const ts = this._uniqueEvents(target).filter((x) => x.ev.kind === 'note');
    if (!ts.length) { this._toast('Sélectionnez au moins une note pour créer une liaison.'); return false; }
    const si = ts[0].si;
    if (ts.some((x) => x.si !== si)) { this._toast('Une liaison relie des notes d\'une même portée.'); return false; }
    const flat = [];
    this.S.staves[si].measures.forEach((m) => m.forEach((e) => flat.push(e)));
    const idx = ts.map((x) => flat.indexOf(x.ev)).sort((a, b) => a - b);
    const a = idx[0], b = idx.length === 1 ? a + 1 : idx[idx.length - 1];
    const A = flat[a], B = flat[b];
    if (!B || B.kind !== 'note') { this._toast('Pas de note suivante à relier.'); return false; }
    const same = A.pitches.length === B.pitches.length
      && A.pitches.every((p) => B.pitches.some((q) => q.step === p.step && q.alt === p.alt && q.oct === p.oct));
    // une liaison de prolongation (tenue) exige exactement les mêmes notes des deux côtés ;
    // sinon, même avec une note commune, c'est une liaison d'expression (legato) qui est créée.
    const adjacent = b === a + 1;
    return this._mutate('liaison', () => {
      if (adjacent && same && (idx.length <= 2)) A.tie = !A.tie;
      else if ((A.sOpen | 0) > 0 && (B.sClose | 0) > 0) { A.sOpen--; B.sClose--; }
      else { A.sOpen = (A.sOpen | 0) + 1; B.sClose = (B.sClose | 0) + 1; }
    });
  }

  /* ---------- lecture des données ---------- */
  getEvents() {
    const out = [], cap = capOf(this.S.meter);
    this.S.staves.forEach((st, si) => st.measures.forEach((m, mi) => {
      let pos = 0;
      m.forEach((e, ei) => {
        out.push({ id: e.id, staff: si, measure: mi, index: ei, kind: e.kind, dur: e.dur, start: pos / 4, absStart: (mi * cap + pos) / 4,
          pitches: e.pitches.map(pitchLabelEn), chord: e.chord, text: e.text });
        pos += e.dur;
      });
    }));
    return out;
  }
  toJSON() { const S = clone(this.S); return S; }
  loadJSON(data) {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    this._snap(); this.S = normalizeState(d); this.sel = []; this.render(); this._emit('change', { type: 'load' });
    return true;
  }
  _autoPerLine(w) { return w < 430 ? 2 : w < 780 ? 3 : 4; }
  perLine(w) { return this.o.perLine === 'auto' ? this._autoPerLine(w || (this.$score && this.$score.clientWidth) || 800) : Math.max(1, parseInt(this.o.perLine, 10) || 4); }
  getABC(opts) { return buildABC(this.S, Object.assign({ perLine: this.perLine(), tempo: true }, opts || {})); }
  _openPenPicker() {
    const self = this;
    const close = () => { modal.remove(); self.$root.focus(); };
    const pick = (c) => { self.setPen(c); close(); };
    const row = h('div', { class: 'se-row', style: 'flex-wrap:wrap;max-width:260px' },
      PALETTE.map((p) => h('button', { type: 'button', class: 'se-swatch', title: p.n, 'aria-label': p.n, style: 'background:' + p.c, onclick: () => pick(p.c) })),
      h('button', { type: 'button', class: 'se-swatch se-none', title: 'Sans couleur', 'aria-label': 'Sans couleur', onclick: () => pick('') }));
    const modal = h('div', { class: 'se-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Couleur d\'écriture', onclick: (e) => { if (e.target === modal) close(); }, onkeydown: (e) => { if (e.key === 'Escape') close(); } },
      h('div', { class: 'se-dlg', style: 'width:min(320px,92vw);gap:14px' },
        h('div', { class: 'se-row', style: 'justify-content:space-between' }, h('h3', null, 'Couleur d\'écriture'), h('button', { type: 'button', class: 'se-btn se-icon', 'aria-label': 'Fermer', onclick: close }, '✕')),
        row));
    this.$root.append(modal);
  }
  _toast(msg) { if (this.headless) return; this._msg = msg; if (this.$status) { this.$status.textContent = msg; this.$status.classList.add('se-warn'); clearTimeout(this._tt); this._tt = setTimeout(() => { this.$status.classList.remove('se-warn'); this._updateUI(); }, 3200); } }

  /** Viewer en lecture seule : ScoreEditor.render('#el', json, options) */
  static render(target, data, opts) {
    return new ScoreEditor(target, Object.assign({}, opts || {}, { data, readOnly: true, ui: false }));
  }
}
ScoreEditor.VERSION = '1.0.0';
ScoreEditor.KEYS = KEYS;
ScoreEditor.parsePitch = (s) => { const p = parsePitch(s); return p ? { step: p.step, alt: p.alt, oct: p.oct } : null; };
ScoreEditor.parseChord = parseChord;
ScoreEditor.nameChord = nameChord;
ScoreEditor.voiceChord = voiceChord;
ScoreEditor.buildABC = buildABC;
ScoreEditor._core = { splitRests, fitMeasure, placeInRest, resizeEvent, mergeRestRun, splitRestAt, spellMidi, midiOf, normalizeState, newState, keyAlts, parseDur, capOf, chordTones, pitchName };

/* =====================================================================
 * 7. INTERFACE : CSS, barre d'outils, état visuel
 * ===================================================================== */
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, attrs) {
  const el = root.document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (let i = 2; i < arguments.length; i++) {
    [].concat(arguments[i]).forEach((c) => { if (c == null || c === false) return; el.append(c.nodeType ? c : root.document.createTextNode(String(c))); });
  }
  return el;
}
function sv(tag, attrs) {
  const el = root.document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  for (let i = 2; i < arguments.length; i++) { const c = arguments[i]; if (c) el.append(c.nodeType ? c : root.document.createTextNode(String(c))); }
  return el;
}

const DARK_TOKENS = '--se-ink:#e6ebf7;--se-ink2:#a4aecb;--se-line:#38425d;--se-bg:#151a2a;--se-panel:#1d2437;--se-field:#262f47;--se-fieldink:#e6ebf7;--se-accent:#8ea0ff;--se-accent-ink:#0f1530;--se-warn:#ff8a80;';
const CSS = `
.se-root{--se-ink:#1b2438;--se-ink2:#56617b;--se-line:#cfd6e6;--se-bg:#e8ecf5;--se-panel:#f5f7fb;--se-field:#fff;--se-fieldink:#1b2438;--se-accent:#2f4bff;--se-accent-ink:#fff;--se-warn:#b42318;
font:13px/1.35 "Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--se-ink);background:var(--se-bg);border:1px solid var(--se-line);border-radius:14px;overflow:hidden;box-sizing:border-box;outline:none;position:relative;text-align:left}
@media (prefers-color-scheme:dark){.se-root:not([data-theme="light"]){${DARK_TOKENS}}}
:root[data-theme="dark"] .se-root:not([data-theme="light"]),.se-root[data-theme="dark"]{${DARK_TOKENS}}
.se-root *{box-sizing:border-box}
.se-top{display:flex;align-items:stretch;justify-content:space-between;flex-wrap:wrap;background:var(--se-panel);border-bottom:1px solid var(--se-line)}
.se-tabs{display:flex;overflow-x:auto}
.se-tab{appearance:none;border:0;background:none;color:var(--se-ink2);font:inherit;font-size:12.5px;min-height:30px;padding:0 12px;display:inline-flex;align-items:center;border-bottom:3px solid transparent;cursor:pointer;white-space:nowrap}
.se-tab[aria-selected="true"]{color:var(--se-ink);font-weight:700;border-bottom-color:var(--se-accent)}
.se-quick{display:flex;gap:5px;align-items:center;padding:2px 8px;flex-wrap:wrap}
.se-panel{display:flex;flex-wrap:wrap;gap:8px 18px;padding:8px 12px 10px;background:var(--se-panel);border-bottom:1px solid var(--se-line)}
.se-panel[hidden]{display:none}
.se-group{display:flex;flex-direction:column;gap:3px;min-width:0}
.se-glabel{font-size:11px;color:var(--se-ink2)}
.se-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.se-btn{appearance:none;min-height:28px;padding:0 8px;font-size:12px;border:1px solid var(--se-line);background:var(--se-field);color:var(--se-fieldink);border-radius:9px;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;touch-action:manipulation}
.se-btn:hover{border-color:var(--se-accent)}
.se-btn:disabled{opacity:.4;cursor:default}
.se-btn[aria-pressed="true"]{background:var(--se-accent);border-color:var(--se-accent);color:var(--se-accent-ink)}
.se-btn.se-primary{background:var(--se-accent);border-color:var(--se-accent);color:var(--se-accent-ink);font-weight:700}
.se-btn.se-danger{color:var(--se-warn)}
.se-btn.se-icon{padding:0 6px;min-width:30px}
.se-cyc{justify-content:space-between;gap:4px}
.se-cyc.se-on{background:var(--se-accent);border-color:var(--se-accent);color:var(--se-accent-ink)}
.se-cycm{opacity:.5;font-size:10px;margin-left:auto;padding-left:4px}
.se-cyc svg{flex:none}
.se-hold{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
.se-seg{display:inline-flex}
.se-seg .se-btn{border-radius:0;margin-left:-1px}
.se-seg .se-btn:first-child{border-radius:9px 0 0 9px;margin-left:0}
.se-seg .se-btn:last-child{border-radius:0 9px 9px 0}
.se-seg .se-btn[aria-pressed="true"]{position:relative;z-index:1}
.se-input,.se-select{min-height:28px;padding:0 6px;font-size:12px;border:1px solid var(--se-line);border-radius:9px;background:var(--se-field);color:var(--se-fieldink);font:inherit;max-width:100%}
.se-input:focus,.se-select:focus,.se-btn:focus-visible,.se-tab:focus-visible{outline:2px solid var(--se-accent);outline-offset:1px}
.se-swatch{width:24px;height:24px;padding:0;border-radius:50%;border:2px solid var(--se-field);box-shadow:0 0 0 1px var(--se-line);cursor:pointer}
.se-swatch[aria-pressed="true"]{box-shadow:0 0 0 3px var(--se-accent)}
.se-swatch.se-none{background:linear-gradient(135deg,transparent 46%,var(--se-warn) 46% 54%,transparent 54%),var(--se-field)}
.se-hint{font-size:12.5px;color:var(--se-ink2);max-width:46ch}
.se-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:13px;color:var(--se-ink2)}
.se-legend i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.se-pending{display:flex;gap:6px;align-items:center;flex-wrap:nowrap;overflow:hidden;height:36px;padding:0 12px;background:#2f4bff;color:#fff;font-size:12.5px}
.se-pending[hidden]{display:none}
.se-pending strong{color:#fff}
.se-pending .se-idle{opacity:.95}
.se-pending .se-btn{min-height:28px;background:#fff;color:#14203f;border-color:#fff;font-weight:700}
.se-pending .se-btn:hover{background:#e7ebff;border-color:#e7ebff}
.se-pending .se-btn.se-primary{background:#ffd43b;border-color:#ffd43b;color:#14203f}
.se-score{background:#fff;color:#000;margin:8px;border-radius:8px;box-shadow:0 0 0 1px var(--se-line),0 8px 20px -12px rgba(20,30,60,.45);overflow:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;cursor:crosshair;padding:2px 0}
.se-root.se-ro .se-score{cursor:default;margin:0;border-radius:0;box-shadow:none}
.se-root.se-ro{border:0;background:transparent;border-radius:0}
.se-score svg{display:block;max-width:none}
.se-status{padding:0 14px 8px;font-size:13px;color:var(--se-ink2);min-height:1.6em}
.se-status.se-warn{color:var(--se-warn);font-weight:700}
.se-modal{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,15,30,.55)}
.se-dlg{background:var(--se-panel);color:var(--se-ink);border-radius:14px;width:min(860px,100%);max-height:92vh;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6)}
.se-dlg h3{margin:0;font-size:18px}
.se-ta{width:100%;min-height:220px;font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--se-field);color:var(--se-fieldink);border:1px solid var(--se-line);border-radius:9px;padding:10px;resize:vertical}
.se-prev{background:#fff;border-radius:8px;box-shadow:0 0 0 1px var(--se-line);max-height:260px;overflow:auto;padding:6px}
.se-prev svg{max-width:100%;height:auto;display:block}
@media (pointer:coarse){.se-btn,.se-input,.se-select{min-height:35px}.se-btn.se-icon{min-width:35px}.se-swatch{width:35px;height:35px}.se-tab{min-height:35px}.se-pending .se-btn{min-height:35px}.se-pending{height:40px}.se-quick{padding:0 8px}.se-durbtn{min-height:44px!important;min-width:44px!important}}
.se-durbtn{min-height:35px;min-width:35px}
@media (max-width:640px){.se-panel{gap:8px 14px;max-height:38vh;overflow-y:auto}.se-tab{padding:0 10px}.se-lbl{display:none}.se-quick{gap:4px;padding:4px 8px}}
`;
function injectCSS() {
  const d = root.document;
  if (!d || d.getElementById('se-css')) return;
  const s = d.createElement('style'); s.id = 'se-css'; s.textContent = CSS; d.head.appendChild(s);
}

function kindIcon(k) {
  const stem = '<path d="M15.2 22V4" stroke="currentColor" stroke-width="2" fill="none"/>';
  if (k === 'slash') {
    return '<svg viewBox="0 0 24 32" width="17" height="24" aria-hidden="true">' + stem
      + '<polygon points="4,27 12,27 16,17 8,17" fill="currentColor"/></svg>';
  }
  if (k === 'mark') {
    // repère visuel muet : même losange que le slash mais SANS hampe, pour bien le distinguer du rythme joué
    return '<svg viewBox="0 0 24 32" width="17" height="24" aria-hidden="true">'
      + '<polygon points="5,20 13,20 17,10 9,10" fill="currentColor" fill-opacity="0.62"/></svg>';
  }
  return '<svg viewBox="0 0 24 32" width="17" height="24" aria-hidden="true">' + stem
    + '<ellipse cx="9.5" cy="24" rx="6.6" ry="4.4" transform="rotate(-22 9.5 24)" fill="currentColor"/></svg>';
}

function durIcon(base) {
  const stem = '<path d="M15.2 22V4" stroke="currentColor" stroke-width="2" fill="none"/>';
  const flag = (y) => '<path d="M15.2 ' + y + 'c0 5 6.5 6 5.5 13" stroke="currentColor" stroke-width="2.2" fill="none"/>';
  const open = '<ellipse cx="9.5" cy="24" rx="6.6" ry="4.4" transform="rotate(-22 9.5 24)" fill="none" stroke="currentColor" stroke-width="2.2"/>';
  const solid = '<ellipse cx="9.5" cy="24" rx="6.6" ry="4.4" transform="rotate(-22 9.5 24)" fill="currentColor"/>';
  const body = base === 16 ? '<ellipse cx="12" cy="17" rx="8" ry="5" fill="none" stroke="currentColor" stroke-width="2.4"/>'
    : base === 8 ? open + stem : base === 4 ? solid + stem : base === 2 ? solid + stem + flag(4) : solid + stem + flag(4) + flag(10);
  return '<svg viewBox="0 0 24 32" width="14" height="20" aria-hidden="true">' + body + '</svg>';
}

Object.assign(ScoreEditor.prototype, {
  _build() {
    injectCSS();
    const o = this.o, ro = o.readOnly || !o.ui;
    this.el.innerHTML = '';
    this.$root = h('div', { class: 'se-root' + (o.readOnly ? ' se-ro' : ''), tabindex: o.readOnly ? null : '0', 'data-theme': o.theme });
    this.el.appendChild(this.$root);
    this.$abc = h('div', { class: 'se-abc' });
    this.$score = h('div', { class: 'se-score' }, this.$abc);
    this.$status = h('div', { class: 'se-status', 'aria-live': 'polite' });
    this._ctl = {};
    if (!ro) this._buildToolbar();
    if (!o.readOnly) {
      this.$pend = h('div', { class: 'se-pending', hidden: true });
      this.$root.append(this.$pend);
    }
    this.$root.append(this.$score);
    if (o.readOnly && o.player) this.$root.append(h('div', { class: 'se-status' }, h('button', { type: 'button', class: 'se-btn se-primary', onclick: () => this.togglePlay() }, '▶ Écouter / arrêter')));
    if (!o.readOnly) this.$root.append(this.$status);
    if (!o.readOnly) this._bindEvents();
  },

  _observe() {
    if (!root.ResizeObserver || !this.$score) return;
    this._w = this.$score.clientWidth;
    this._ro = new root.ResizeObserver(() => {
      const w = this.$score.clientWidth;
      if (Math.abs(w - this._w) > 3) { this._w = w; clearTimeout(this._rt); this._rt = setTimeout(() => this.render(), 90); }
    });
    this._ro.observe(this.$score);
  },
  destroy() {
    this.stop && this.stop();
    if (this._ro) this._ro.disconnect();
    if (this.el) this.el.innerHTML = '';
  },

  _buildToolbar() {
    const self = this, C = this._ctl;
    const btn = (label, title, fn, cls) => h('button', { type: 'button', class: 'se-btn ' + (cls || ''), title, 'aria-label': title, onclick: fn }, label);
    const seg = (items) => h('div', { class: 'se-seg', role: 'group' }, items);
    const group = (label, ...kids) => h('div', { class: 'se-group' }, h('div', { class: 'se-glabel' }, label), h('div', { class: 'se-row' }, kids));
    const tog = (key, label, title, fn) => { const b = btn(label, title, fn); b.setAttribute('aria-pressed', 'false'); C[key] = b; return b; };

    /* --- onglet Écrire --- */
    C.cycles = [];
    // bouton cyclique : un toucher passe à l'option suivante (Maj + clic : précédente)
    const cyc = (o) => {
      const b = h('button', { type: 'button', class: 'se-btn se-cyc', title: o.title + ' — toucher pour changer', 'aria-label': o.title, style: o.w ? 'min-width:' + o.w : null,
        onclick: (e) => { const n = o.items.length, i = Math.max(0, o.items.findIndex((x) => String(x.v) === String(o.get()))); o.set(o.items[(i + (e.shiftKey ? n - 1 : 1)) % n].v); } });
      o.btn = b; C.cycles.push(o); return b;
    };
    const clefCyc = cyc({ title: 'Clé', w: '8.6em', items: [{ v: 'treble', l: 'Clé de Sol' }, { v: 'bass', l: 'Clé de Fa' }, { v: 'grand', l: 'Grande portée' }],
      get: () => (self.S.staves.length > 1 ? 'grand' : self.S.staves[0].clef), set: (v) => self.setClef(v) });
    C.key = h('select', { class: 'se-select', 'aria-label': 'Tonalité', onchange: (e) => self.setKey(e.target.value) },
      h('optgroup', { label: 'Majeur' }, KEYS.filter((k) => !k.minor).map((k) => h('option', { value: k.abc }, k.label))),
      h('optgroup', { label: 'Mineur' }, KEYS.filter((k) => k.minor).map((k) => h('option', { value: k.abc }, k.label))));
    C.meter = h('select', { class: 'se-select', 'aria-label': 'Mesure', onchange: (e) => { const [n, d] = e.target.value.split('/').map(Number); self.setMeter(n, d); } },
      METERS.map((m) => h('option', { value: m[0] + '/' + m[1] }, m[0] + '/' + m[1])));
    C.count = h('span', { class: 'se-glabel', style: 'min-width:5.5em;text-align:center' });
    // Boutons de durée (têtes de note) : taille tactile garantie même quand le reste de l'UI est compact.
    // Une note sélectionnée reçoit directement la durée choisie ; sinon, elle ne fait que régler la prochaine saisie.
    C.durs = [16, 8, 4, 2, 1].map((d) => {
      const b = h('button', { type: 'button', class: 'se-btn se-icon se-durbtn', title: DUR_NAME[d][0].toUpperCase() + DUR_NAME[d].slice(1), 'aria-label': DUR_NAME[d], html: durIcon(d),
        onclick: () => { self.setInputDur(d); if (self.sel.length) self.setDuration(d, self.dotted); } });
      b.dataset.dur = d; return b;
    });
    C.dot = tog('dot', '•', 'Pointée (ajoute la moitié de la durée)', () => self.setInputDotted(!self.dotted));
    const modeCyc = cyc({ title: 'Mode de saisie', w: '7.4em', items: [{ v: 'write', l: 'Écrire' }, { v: 'select', l: 'Sélectionner' }], get: () => self.mode, set: (v) => self.setMode(v), on: (v) => v === 'select' });
    const kindCyc = cyc({ title: 'Type de saisie : note, slash (rythme) ou repère (marque muette, durée fixe d\'une noire)', w: '3.2em', items: [{ v: 'note', html: kindIcon('note') }, { v: 'slash', html: kindIcon('slash') }, { v: 'mark', html: kindIcon('mark') }], get: () => self.kind, set: (v) => self.setKind(v), on: (v) => v !== 'note' });
    this.mute = false;
    C.muteTog = tog('muteTog', 'Muet', 'Slash muet (noire pleine, sans hampe) : marque le temps visuellement, sans jouer de son à la lecture — s\'applique au prochain slash écrit', () => { self.mute = !self.mute; self._updateUI(); });
    const accCyc = cyc({ title: 'Altération de la prochaine note', w: '4.6em', items: [{ v: 'auto', l: 'auto' }, { v: -1, l: '♭' }, { v: 0, l: '♮' }, { v: 1, l: '♯' }], get: () => self.acc, set: (v) => self.setAcc(v), on: (v) => v !== 'auto' });
    C.tie = h('button', { type: 'button', class: 'se-btn se-icon', title: 'Liaison : relie les notes sélectionnées (prolongation si même hauteur, sinon liaison d\'expression)', 'aria-label': 'Liaison', onclick: () => self.toggleLiaison(),
      html: '<svg viewBox="0 0 24 14" width="20" height="12" aria-hidden="true"><path d="M2 2.5Q12 15 22 2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' });
    C.multi = tog('multi', 'SélMul', 'Sélection multiple : ajouter à la sélection (ou Maj/Ctrl + clic)', () => { self.multi = !self.multi; self._updateUI(); });
    C.confirmB = tog('confirmB', 'Conf', 'Confirmer avant d\'écrire : un premier toucher prévisualise la note, un second la valide', () => { self.confirm = !self.confirm; if (!self.confirm) self._setPending(null); self._updateUI(); });
    // bouton à appui court / appui long
    const hold = (label, title, shortFn, longFn) => {
      let timer = null, fired = false;
      const stop = () => clearTimeout(timer);
      return h('button', { type: 'button', class: 'se-btn se-icon se-hold', title, 'aria-label': title,
        onpointerdown: () => { fired = false; stop(); timer = setTimeout(() => { fired = true; longFn(); if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(15); }, 450); },
        onpointerup: stop, onpointerleave: stop, onpointercancel: stop, oncontextmenu: (e) => e.preventDefault(),
        onclick: () => { if (fired) { fired = false; return; } shortFn(); } }, label);
    };
    // flèche entre deux notes (libellé, forme) — la forme sert aussi aux flèches automatiques
    C.alabel = h('input', { class: 'se-input', type: 'text', placeholder: 'libellé (option)', 'aria-label': 'Libellé de la flèche', size: 12 });
    C.acurve = h('select', { class: 'se-select', 'aria-label': 'Forme de la flèche' }, h('option', { value: '0' }, 'Droit'), h('option', { value: '1' }, 'Courbe h'), h('option', { value: '-1' }, 'Courbe b'));

    this.pen = this.o.pen || '';
    C.penBtn = h('button', { type: 'button', class: 'se-swatch', title: 'Couleur des prochaines notes — toucher pour choisir', 'aria-label': 'Couleur d\'écriture', onclick: () => self._openPenPicker() });
    const writeP = h('div', { class: 'se-panel', role: 'tabpanel' },
      group('Durée', seg(C.durs), C.dot, C.tie),
      group('Type', kindCyc, C.muteTog),
      group('Altération', accCyc),
      group('Mode', modeCyc),
      group('Couleur', C.penBtn),
      group('Transposer',
        hold('▼', 'Clic court : un demi-ton plus bas · clic long : une octave plus bas', () => self.transpose(-1), () => self.transpose(-12)),
        hold('▲', 'Clic court : un demi-ton plus haut · clic long : une octave plus haut', () => self.transpose(1), () => self.transpose(12))),
      group('Modifier', btn('Vider la mesure', 'Efface toute la mesure de la sélection', () => { const t = self._targets()[0]; if (t) self.clearMeasure(t.mi); })),
      group('Flèche entre deux notes', C.alabel, C.acurve,
        btn('Relier →', 'Sélection multiple : choisissez la note de départ puis celle d\'arrivée', () => self.arrowFromSelection({ label: C.alabel.value, curve: Number(C.acurve.value), color: self.pick || self.pen || '#495057' }), 'se-primary')),
      group('Flèches automatiques', btn('Une flèche par voix', 'Relie chaque voix d\'un accord au suivant (forme choisie ci-dessus : droit / courbe)', () => self.autoArrows({ curve: Number(C.acurve.value) })), btn('Retirer (sélection)', 'Retire les flèches des notes sélectionnées', () => self.removeArrows('selection')), btn('Tout retirer', 'Retire toutes les flèches', () => self.removeArrows('all'), 'se-danger')));

    /* --- onglet Accords & texte --- */
    C.chord = h('input', { class: 'se-input', type: 'text', placeholder: 'Cmaj7, Dm7, G7/B…', 'aria-label': 'Symbole d\'accord', size: 14, onkeydown: (e) => { if (e.key === 'Enter') self.setChord(e.target.value); } });
    C.text = h('input', { class: 'se-input', type: 'text', placeholder: 'ex. sensible ↓, 3ce…', 'aria-label': 'Texte', size: 18, onkeydown: (e) => { if (e.key === 'Enter') self.setText(e.target.value, C.textPos.value); } });
    C.textPos = h('select', { class: 'se-select', 'aria-label': 'Position du texte' }, h('option', { value: 'above' }, 'au-dessus'), h('option', { value: 'below' }, 'en dessous'));
    const GLYPHS = ['↑', '↓', '→', '↗', '↘', '='];
    const openGlyphPicker = () => {
      const close = () => { modal.remove(); C.text.focus(); };
      const pick = (g) => { C.text.value += g; close(); };
      const row = h('div', { class: 'se-row', style: 'flex-wrap:wrap;max-width:260px' },
        GLYPHS.map((g) => h('button', { type: 'button', class: 'se-btn', style: 'min-width:44px;font-size:17px', onclick: () => pick(g) }, g)));
      const modal = h('div', { class: 'se-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Symboles rapides', onclick: (e) => { if (e.target === modal) close(); }, onkeydown: (e) => { if (e.key === 'Escape') close(); } },
        h('div', { class: 'se-dlg', style: 'width:min(320px,92vw);gap:14px' },
          h('div', { class: 'se-row', style: 'justify-content:space-between' }, h('h3', null, 'Insérer un symbole'), h('button', { type: 'button', class: 'se-btn se-icon', 'aria-label': 'Fermer', onclick: close }, '✕')),
          row));
      self.$root.append(modal);
    };
    C.glyphBtn = btn('Symboles rapides…', 'Insérer une flèche ou un signe dans le texte', openGlyphPicker);
    const chordP = h('div', { class: 'se-panel', role: 'tabpanel', hidden: true },
      group('Symbole d\'accord (au-dessus de la note, du silence ou du slash)', C.chord, btn('Appliquer', 'Appliquer le symbole', () => self.setChord(C.chord.value), 'se-primary'), btn('Effacer', 'Retirer le symbole', () => self.setChord('')),),
      group('Lien symbole ↔ notes',
        btn('Nommer d\'après les notes', 'Déduit le symbole des notes empilées', () => self.nameFromNotes()),
        btn('Écrire les notes du symbole', 'Génère les notes à partir du symbole d\'accord', () => self.notesFromChord())),
      group('Texte attaché à la note', C.text, C.textPos, btn('Appliquer', 'Appliquer le texte', () => self.setText(C.text.value, C.textPos.value), 'se-primary'), btn('Effacer', 'Retirer le texte', () => self.setText('', C.textPos.value))),
      group('Symboles rapides', C.glyphBtn),
      h('div', { class: 'se-hint' }, 'Astuce : en mode « Slash », un clic sur un silence crée un slash ; ajoutez ensuite le symbole d\'accord. « Écrire les notes du symbole » le transforme en accord sur la portée.'));

    /* --- onglet Voix --- */
    this.pick = '';
    C.swatches = PALETTE.map((p) => { const b = h('button', { type: 'button', class: 'se-swatch', title: p.n, 'aria-label': p.n, style: 'background:' + p.c, 'aria-pressed': 'false', onclick: () => { self.pick = p.c; self.setColor(p.c); self._updateUI(); } }); b.dataset.c = p.c; return b; });
    C.swNone = h('button', { type: 'button', class: 'se-swatch se-none', title: 'Sans couleur', 'aria-label': 'Sans couleur', onclick: () => { self.pick = ''; self.setColor(''); self._updateUI(); } });
    const voiceP = h('div', { class: 'se-panel', role: 'tabpanel', hidden: true },
      group('Colorer la sélection', h('div', { class: 'se-row' }, C.swatches, C.swNone)),
      group('Colorations automatiques', btn('Par voix (S · A · T · B)', 'Une couleur par voix', () => self.colorByVoice()), btn('Par mouvement', 'Note commune, conjoint, tierce, saut', () => self.colorByMotion()), btn('Effacer les couleurs', 'Retirer toutes les couleurs', () => self.clearColors(), 'se-danger')),
      h('div', { class: 'se-legend' },
        [['Soprano', VOICE_COLORS[0]], ['Alto', VOICE_COLORS[1]], ['Ténor', VOICE_COLORS[2]], ['Basse', VOICE_COLORS[3]]].map(([n, c]) => h('span', null, h('i', { style: 'background:' + c }), n)),
        [['note commune', MOVE_COLORS.common], ['conjoint', MOVE_COLORS.step], ['tierce / quarte', MOVE_COLORS.third], ['grand saut', MOVE_COLORS.leap]].map(([n, c]) => h('span', null, h('i', { style: 'background:' + c }), n))));

    /* --- onglet Fichier --- */
    C.title = h('input', { class: 'se-input', type: 'text', placeholder: 'Titre (optionnel)', 'aria-label': 'Titre', size: 22, onchange: (e) => self.setTitle(e.target.value) });
    C.tempo = h('input', { class: 'se-input', type: 'number', min: 30, max: 240, step: 2, 'aria-label': 'Tempo', style: 'width:5.5em', onchange: (e) => self.setTempo(e.target.value) });
    C.zoom = h('select', { class: 'se-select', 'aria-label': 'Taille de la partition', onchange: (e) => { self.scale = Number(e.target.value); self.render(); } },
      [['0.8', 'Très petite'], ['1', 'Petite'], ['1.35', 'Moyenne'], ['1.7', 'Grande'], ['2.1', 'Très grande']].map(([v, l]) => h('option', { value: v }, l)));
    C.perLine = h('select', { class: 'se-select', 'aria-label': 'Mesures par ligne', onchange: (e) => { self.o.perLine = e.target.value === 'auto' ? 'auto' : Number(e.target.value); self.render(); } },
      h('option', { value: 'auto' }, 'Automatique'), [1, 2, 3, 4, 5, 6, 8].map((n) => h('option', { value: n }, n)));
    C.bars = tog('bars', 'N° de mesure', 'Afficher les numéros de mesure', () => self.setBarNumbers(!self.S.barNumbers));
    const fileP = h('div', { class: 'se-panel', role: 'tabpanel', hidden: true },
      group('Portée', clefCyc, C.key, C.meter),
      group('Mesures', seg([btn('−', 'Retirer la dernière mesure', () => self.removeMeasure(), 'se-icon'), h('span', { class: 'se-btn', style: 'pointer-events:none;border-radius:0;margin-left:-1px' }, C.count), btn('+', 'Ajouter une mesure', () => self.addMeasure(), 'se-icon')])),
      group('Partition', C.title, btn('Nouvelle partition', 'Repartir de zéro', () => { if (root.confirm ? root.confirm('Effacer la partition actuelle ?') : true) self.reset(); }, 'se-danger')),
      group('Affichage', C.zoom, C.perLine, C.bars),
      group('Lecture', h('span', { class: 'se-glabel' }, 'Tempo (noire)'), C.tempo, btn('▶ Écouter', 'Lire la partition', () => self.togglePlay(), 'se-primary')),
      group('Exporter', btn('Exporter / intégrer…', 'ABC, SVG, PNG, HTML, JSON', () => self.openExport('abc'), 'se-primary'), btn('Importer un JSON…', 'Recharger une partition exportée', () => self.openExport('json'))));

    const panels = { write: writeP, chord: chordP, voice: voiceP, file: fileP };
    C.panels = panels;
    C.tabs = [['write', 'Écrire'], ['chord', 'Accords & texte'], ['voice', 'Voix'], ['file', 'Fichier']].map(([k, l]) => {
      const b = h('button', { type: 'button', class: 'se-tab', role: 'tab', 'aria-selected': 'false', onclick: () => self.setTab(k) }, l); b.dataset.tab = k; return b;
    });
    const lbl = (t) => h('span', { class: 'se-lbl' }, t);
    C.undo = btn(['↶', lbl(' Annuler')], 'Annuler (Ctrl+Z)', () => self.undo());
    C.redo = btn(['↷', lbl(' Rétablir')], 'Rétablir (Ctrl+Y)', () => self.redo());
    C.del = btn(['⌫', lbl(' Supprimer')], 'Supprimer la note sélectionnée (Suppr)', () => self.remove(), 'se-danger');
    C.play = btn('▶', 'Lecture / arrêt (Espace)', () => self.togglePlay(), 'se-primary se-icon');
    C.selAll = btn('Tout', 'Tout sélectionner', () => self.selectAll());
    C.selNone = btn('∅', 'Tout désélectionner', () => self.clearSelection(), 'se-icon');
    this.$root.append(
      h('div', { class: 'se-top' }, h('div', { class: 'se-tabs', role: 'tablist' }, C.tabs),
        h('div', { class: 'se-quick' }, C.undo, C.redo, C.del, C.multi, C.confirmB, C.selAll, C.selNone, C.play)),
      writeP, chordP, voiceP, fileP);
  },

  setTab(k) { this.tab = k; this._updateUI(); },
  setMode(m) { this.mode = m; if (m === 'select') this._setPending(null); this._updateUI(); },
  setKind(k) { this.kind = k; this._updateUI(); },
  setAcc(a) { this.acc = a; this._updateUI(); },
  /** Couleur des prochaines notes écrites ('' = noir). Si une sélection existe, elle est aussi colorée. */
  setPen(c) { this.pen = c || ''; if (this.pen && this.sel.length) this.setColor(this.pen); else this._updateUI(); },
  setInputDur(d) { this.dur = d; if (d === 1 || d === 16) this.dotted = false; this._updateUI(); if (this.sel.length && this._uniqueEvents().length && this.o.durApplies) this.setDuration(this.dur, this.dotted); },
  setInputDotted(b) { this.dotted = (this.dur === 1 || this.dur === 16) ? false : b; this._updateUI(); },

  _updateUI() {
    if (this.headless || !this.$root) return;
    const C = this._ctl, S = this.S;
    if (C.tabs) {
      C.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
      Object.keys(C.panels).forEach((k) => { C.panels[k].hidden = k !== this.tab; });
      C.key.value = S.key; C.meter.value = S.meter[0] + '/' + S.meter[1];
      C.count.textContent = S.staves[0].measures.length + ' mesure' + (S.staves[0].measures.length > 1 ? 's' : '');
      C.dot.setAttribute('aria-pressed', String(this.dotted));
      C.cycles.forEach((c) => {
        const it = c.items.find((x) => String(x.v) === String(c.get())) || c.items[0];
        c.btn.innerHTML = '';
        if (it.html) c.btn.insertAdjacentHTML('beforeend', it.html);
        if (it.l) c.btn.append(it.l);
        c.btn.append(h('span', { class: 'se-cycm', 'aria-hidden': 'true' }, '↻'));
        c.btn.classList.toggle('se-on', !!(c.on && c.on(it.v)));
      });
      C.multi.setAttribute('aria-pressed', String(this.multi)); C.confirmB.setAttribute('aria-pressed', String(this.confirm));
      C.muteTog.setAttribute('aria-pressed', String(this.mute));
      C.swatches.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === this.pick)));
      C.penBtn.style.background = this.pen || '';
      C.penBtn.classList.toggle('se-none', !this.pen);
      C.penBtn.setAttribute('aria-pressed', String(!!this.pen));
      C.bars.setAttribute('aria-pressed', String(!!S.barNumbers));
      if (root.document.activeElement !== C.title) C.title.value = S.title || '';
      if (root.document.activeElement !== C.tempo) C.tempo.value = S.tempo;
      { const zs = [].map.call(C.zoom.options, (o) => Number(o.value)); C.zoom.value = String(zs.reduce((a, b) => (Math.abs(b - this.scale) < Math.abs(a - this.scale) ? b : a))); }
      C.durs.forEach((b) => { b.setAttribute('aria-pressed', String(Number(b.dataset.dur) === this.dur)); b.disabled = this.kind === 'mark'; });
      C.dot.disabled = this.kind === 'mark';
      C.muteTog.disabled = this.kind === 'mark';
      C.perLine.value = String(this.o.perLine);
      C.undo.disabled = !this.undoS.length; C.redo.disabled = !this.redoS.length;
      const hasSel = this.sel.length > 0;
      C.del.disabled = !hasSel;
      C.play.textContent = this._playing ? '■' : '▶';
      const one = this._uniqueEvents();
      if (one.length === 1) {
        if (root.document.activeElement !== C.chord) C.chord.value = one[0].ev.chord || '';
        if (root.document.activeElement !== C.text) { C.text.value = one[0].ev.text || ''; if (one[0].ev.text) C.textPos.value = one[0].ev.textPos; }
      }
    }
    if (this.geo && this.geo.ok === false && this.$status) {
      this.$status.textContent = 'Partition affichée, mais les clics ne sont pas reconnus (structure abcjs inattendue). L\'API reste utilisable.';
      this.$status.classList.add('se-warn');
    } else if (this.$status && !this.$status.classList.contains('se-warn')) {
      const t = this._selectionText();
      const dn = DUR_NAME[parseDur(this.dur, this.dotted)];
      this.$status.textContent = t ? 'Sélection : ' + t : (this.mode === 'write'
        ? 'Clic sur un silence : nouvelle ' + (this.kind === 'mark' ? 'marque muette (noire)' : this.kind === 'slash' ? 'barre de slash' : dn) + ' · clic au-dessus/en dessous d\'une note : accord · clic sur une tête de note : sélection'
        : 'Mode sélection : touchez une note pour la sélectionner');
    }
    this._renderPending();
  },

  _renderPending() {
    if (!this.$pend) return;
    const p = this.pending, self = this;
    this.$pend.hidden = !this.confirm;
    if (!this.confirm) return;
    this.$pend.innerHTML = '';
    if (!p) { this.$pend.append(h('span', { class: 'se-idle' }, 'Touchez pour prévisualiser · retouchez pour placer')); return; }
    this.$pend.append(
      h('strong', { style: 'min-width:4.2em' }, (p.type === 'chord' ? '+ ' : '') + (p.type === 'place' && this.kind === 'slash' ? 'slash' : p.type === 'place' && this.kind === 'mark' ? 'repère' : pitchName(p.pitch))),
      h('button', { type: 'button', class: 'se-btn se-icon', 'aria-label': 'Note plus haute', onclick: () => self._nudgePending(1) }, '▲'),
      h('button', { type: 'button', class: 'se-btn se-icon', 'aria-label': 'Note plus basse', onclick: () => self._nudgePending(-1) }, '▼'),
      h('button', { type: 'button', class: 'se-btn se-primary', onclick: () => self._commitPending() }, '✓ Placer'),
      h('button', { type: 'button', class: 'se-btn se-icon', 'aria-label': 'Annuler', onclick: () => self._setPending(null) }, '✕'));
  }
});

/* =====================================================================
 * 8. RENDU abcjs, GÉOMÉTRIE, SUPERPOSITIONS, INTERACTION
 * On génère l'ABC depuis le modèle, abcjs dessine, puis on relit la
 * géométrie du SVG (lignes de portée, éléments note/silence) pour relier
 * chaque clic à (portée, mesure, événement, hauteur).
 * ===================================================================== */
const ACCENT = '#2f4bff';
const yOfStaff = (st, dia) => st.bot - (dia - CLEF_D0[st.clef]) * st.sp / 2;

Object.assign(ScoreEditor.prototype, {
  isSelected(e, p) { return this.sel.some((it) => it.e === e && (it.p || null) === (p || null)); },

  render() {
    if (this.headless || !this.$abc) return;
    const A = this.abcjs || root.ABCJS;
    this.abcjs = A;
    this.pending = null; this._ghost = null; this.geo = null;
    if (!A) {
      this.$abc.innerHTML = '<p style="padding:16px;font:14px sans-serif;color:#b42318">abcjs est introuvable : chargez abcjs avant ScoreEditor.</p>';
      return;
    }
    const w = this.$score.clientWidth || 760, sc = this.scale, MARGIN = 10, target = Math.max(120, w - 2 * MARGIN);
    const abc = buildABC(this.S, { perLine: this.perLine(w) });
    // largeur de portée : on part d'une estimation puis on corrige d'après la largeur réellement dessinée,
    // pour que la partition occupe toute la largeur avec exactement MARGIN px de chaque côté
    let S = w * (this._ratio || 1 / sc), box = null;
    for (let i = 0; i < 4; i++) {
      this.$abc.innerHTML = '';
      try {
        A.renderAbc(this.$abc, abc, { add_classes: true, staffwidth: Math.max(160, Math.round(S)), scale: sc, paddingleft: 0, paddingright: 0, paddingtop: 6, paddingbottom: 10 });
      } catch (e) { if (root.console) console.error(e); break; }
      box = this._contentBox();
      if (!box || Math.abs(box.w - target) <= 2) break;
      const ns = Math.max(160, S * target / box.w);
      if (Math.abs(ns - S) < 1) break;
      S = ns;
    }
    this._ratio = S / w;
    const svg0 = this.$abc.querySelector('svg');
    if (svg0 && box) svg0.style.margin = '0 0 0 ' + (MARGIN - box.left) + 'px';
    this._analyze();
    this._decorate();
    this._updateUI();
  },

  /** Étendue réellement dessinée (portée, accolade, notes) en pixels écran, relative au bord gauche du SVG. */
  _contentBox() {
    const svg = this.$abc.querySelector('svg');
    if (!svg || !svg.getBBox) return null;
    try {
      const bb = svg.getBBox(), m = svg.getScreenCTM();
      if (!m || !(bb.width > 0)) return null;
      return { w: bb.width * m.a, left: bb.x * m.a };
    } catch (e) { return null; }
  },

  /* ---------- lecture de la géométrie du SVG ---------- */
  _analyze() {
    this.geo = null;
    const svg = this.svg = this.$abc.querySelector('svg');
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    // la matrice est relue à chaque appel : la page peut avoir défilé ou changé de mise en page depuis le rendu
    const U = (x, y) => { const m = svg.getScreenCTM(); if (!m) return [0, 0]; pt.x = x; pt.y = y; const q = pt.matrixTransform(m.inverse()); return [q.x, q.y]; };
    const R = (el) => {
      const b = el.getBoundingClientRect(), a = U(b.left, b.top), c = U(b.right, b.bottom);
      return { x: a[0], y: a[1], w: c[0] - a[0], h: c[1] - a[1], cx: (a[0] + c[0]) / 2, cy: (a[1] + c[1]) / 2 };
    };
    this._U = U; this._R = R;
    const nst = this.S.staves.length;

    // 1. lignes de portée : traits horizontaux fins et longs, regroupés par 5
    const hl = [];
    svg.querySelectorAll('path').forEach((p) => { const r = R(p); if (r.h < 1.3 && r.w > 40) hl.push(r); });
    hl.sort((a, b) => a.cy - b.cy);
    const lines = [];
    hl.forEach((r) => {
      const last = lines[lines.length - 1];
      if (last && Math.abs(r.cy - last.cy) < 0.8) { last.x0 = Math.min(last.x0, r.x); last.x1 = Math.max(last.x1, r.x + r.w); }
      else lines.push({ cy: r.cy, x0: r.x, x1: r.x + r.w });
    });
    if (!lines.length || lines.length % 5) { if (root.console) console.warn('ScoreEditor : lignes de portée non reconnues', lines.length); return; }
    const staves = [];
    for (let i = 0; i < lines.length; i += 5) {
      const g = lines.slice(i, i + 5), k = i / 5, si = k % nst;
      staves.push({ k, si, sys: Math.floor(k / nst), clef: this.S.staves[si].clef, top: g[0].cy, bot: g[4].cy, sp: (g[4].cy - g[0].cy) / 4, cy: (g[0].cy + g[4].cy) / 2,
        x0: Math.min.apply(null, g.map((z) => z.x0)), x1: Math.max.apply(null, g.map((z) => z.x1)) });
    }

    // 2. éléments note / silence, rattachés à une portée puis triés dans l'ordre du temps
    let els = [].slice.call(svg.querySelectorAll('.abcjs-note, .abcjs-rest'));
    if (!els.length) els = [].slice.call(svg.querySelectorAll('[data-name="note"], [data-name="rest"]'));
    els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    // rectangle de l'événement = union de ses tracés (on ignore le texte : symboles d'accord, annotations)
    const unionRect = (el) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      [].slice.call(el.querySelectorAll('path')).forEach((p) => { const q = R(p); if (q.w > 0 || q.h > 0) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); } });
      if (x0 > x1) return R(el);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    };
    const per = this.S.staves.map(() => []);
    els.forEach((el) => {
      const r = unionRect(el);
      if (r.w <= 0 || r.h <= 0) return;
      const mv = /abcjs-v(\d+)/.exec(el.getAttribute('class') || '');
      let cand = staves;
      if (mv && +mv[1] < nst) cand = staves.filter((s) => s.si === +mv[1]);
      let best = null, bd = 1e9;
      cand.forEach((s) => { const d = Math.abs(r.cy - s.cy); if (d < bd) { bd = d; best = s; } });
      per[best.si].push({ el, r, st: best });
    });
    per.forEach((a) => a.sort((p, q) => p.st.sys - q.st.sys || p.r.x - q.r.x));

    // 3. correspondance élément ↔ événement du modèle
    const emap = {}, pgeo = {}, rows = {};
    let ok = true;
    this.S.staves.forEach((stv, si) => {
      const flat = [];
      stv.measures.forEach((m, mi) => m.forEach((ev, ei) => flat.push({ ev, mi, ei })));
      if (flat.length !== per[si].length) { ok = false; if (root.console) console.warn('ScoreEditor : ' + per[si].length + ' éléments pour ' + flat.length + ' événements (portée ' + si + ')'); return; }
      flat.forEach((f, i) => {
        const d = per[si][i], st = d.st, sp = st.sp;
        let heads = [];
        if (f.ev.kind !== 'rest') {
          const hc = [].slice.call(d.el.querySelectorAll('.abcjs-notehead'));
          if (hc.length) heads = hc.map((el) => ({ el, r: R(el) }));
          else d.el.querySelectorAll('path').forEach((p) => { const q = R(p); if (q.w > 0.8 * sp && q.w < 2.1 * sp && q.h > 0.55 * sp && q.h < 1.4 * sp) heads.push({ el: p, r: q }); });
        }
        const eg = { si, mi: f.mi, ei: f.ei, ev: f.ev, el: d.el, r: d.r, st, heads, cx: d.r.cx };
        if (f.ev.kind === 'note') {
          let sx = 0;
          f.ev.pitches.forEach((p) => {
            const y = yOfStaff(st, diaOf(p));
            let best = null, bd = 1e9;
            heads.forEach((hd) => { const dd = Math.abs(hd.r.cy - y); if (dd < bd) { bd = dd; best = hd; } });
            const good = best && bd < 0.9 * sp;
            pgeo[p.id] = { cx: good ? best.r.cx : d.r.cx, cy: good ? best.r.cy : y, head: good ? best : null };
            sx += pgeo[p.id].cx;
          });
          eg.cx = sx / f.ev.pitches.length;
        } else if (heads.length) eg.cx = heads[0].r.cx;
        emap[f.ev.id] = eg;
        (rows[st.k] = rows[st.k] || { st, evs: [] }).evs.push(f.ev.id);
      });
    });
    if (!ok) { this.geo = { ok: false }; return; }

    // 4. zones de mesure (limites : barres de mesure si reconnues, sinon milieu entre événements)
    const bars = [].slice.call(svg.querySelectorAll('.abcjs-bar')).map(R);
    Object.keys(rows).forEach((k) => {
      const row = rows[k], st = row.st, zones = [];
      row.evs.forEach((id) => { const eg = emap[id]; const z = zones[zones.length - 1]; if (z && z.mi === eg.mi) z.evs.push(id); else zones.push({ mi: eg.mi, evs: [id] }); });
      let bx = bars.filter((b) => b.y <= st.bot + 1 && b.y + b.h >= st.top - 1 && b.cx > st.x0 - 4 && b.cx < st.x1 + 8).map((b) => b.cx).sort((a, b) => a - b);
      const dd = []; bx.forEach((v) => { if (!dd.length || v - dd[dd.length - 1] > 3) dd.push(v); }); bx = dd;
      zones.forEach((z, i) => {
        const last = emap[z.evs[z.evs.length - 1]];
        if (bx.length === zones.length) z.rgt = i === zones.length - 1 ? 1e9 : bx[i];
        else if (i === zones.length - 1) z.rgt = 1e9;
        else { const nx = emap[zones[i + 1].evs[0]]; z.rgt = (last.r.x + last.r.w + nx.r.x) / 2; }
        z.l = i === 0 ? -1e9 : zones[i - 1].rgt;
      });
      row.zones = zones;
    });
    this.geo = { ok: true, staves, emap, pgeo, rows };
  },

  /* ---------- couleurs des notes ---------- */
  _paint(p, col) {
    const f = p.getAttribute('fill'), s = p.getAttribute('stroke');
    const hasStroke = s && s !== 'none', hasFill = f !== 'none';
    if (hasFill || !hasStroke) p.setAttribute('fill', col);
    if (hasStroke) p.setAttribute('stroke', col);
  },
  _colorEvent(eg, ev) {
    const cols = ev.pitches.map((p) => p.color);
    if (!cols.some(Boolean)) return;
    const uniform = cols.every((c) => c === cols[0]), sp = eg.st.sp, g = this.geo;
    [].slice.call(eg.el.querySelectorAll('path')).forEach((p) => {
      let col;
      if (uniform) col = cols[0];
      else {
        const r = this._R(p);
        if (r.w < 0.35 * sp || r.h < 0.15 * sp || r.h > 3.4 * sp || r.w > 2.4 * sp) return;
        let best = null, bd = 1e9;
        ev.pitches.forEach((q) => { const d = Math.abs(r.cy - g.pgeo[q.id].cy); if (d < bd) { bd = d; best = q; } });
        col = best && best.color;
      }
      if (col) this._paint(p, col);
    });
  },

  /* ---------- superpositions (slashs, flèches, sélection) ---------- */
  _decorate() {
    const g = this.geo;
    this.$ovS = this.$ovD = null;
    if (!g || !g.ok) return;
    this.$ovS = sv('g', { class: 'se-ov', 'pointer-events': 'none' });
    this.$ovD = sv('g', { class: 'se-dyn', 'pointer-events': 'none' });
    this.svg.append(this.$ovS, this.$ovD);
    Object.keys(g.emap).forEach((id) => {
      const eg = g.emap[id];
      if (eg.ev.kind === 'note') this._colorEvent(eg, eg.ev);
      else if (eg.ev.kind === 'slash') eg.el.style.display = 'none';
    });
    this._drawStatic();
  },

  _slashShape(eg) {
    const ev = eg.ev, st = eg.st, sp = st.sp, col = ev.color || '#000';
    const cx = eg.heads.length ? eg.heads[0].r.cx : eg.r.cx, cy = st.cy;
    const a = sp * 1.0, b = sp * 0.95, t = sp * 0.62, d = ev.dur;
    const grp = sv('g', { class: 'se-slash' + (ev.mute ? ' se-slash-mute' : '') });
    const pts = [[cx - a, cy + b], [cx - a + t, cy + b], [cx + a, cy - b], [cx + a - t, cy - b]].map((q) => q.join(',')).join(' ');
    if (ev.mute) {
      // repère / slash muet : uniquement le losange, jamais de hampe ni de crochet — c'est un repère visuel, pas une durée jouée
      grp.append(sv('polygon', { points: pts, fill: col, stroke: col, 'stroke-width': sp * 0.24, 'stroke-linejoin': 'round', 'fill-opacity': 0.62 }));
      return grp;
    }
    grp.append(sv('polygon', { points: pts, fill: d <= 4 || d === 6 || d === 3 ? col : 'none', stroke: col, 'stroke-width': sp * 0.24, 'stroke-linejoin': 'round' }));
    const sx = cx + a - t * 0.5;
    if (d <= 12 && d !== 16) grp.append(sv('line', { x1: sx, y1: cy - b, x2: sx, y2: cy - b - sp * 3.6, stroke: col, 'stroke-width': sp * 0.22 }));
    if (d <= 3) grp.append(sv('path', { d: 'M' + sx + ' ' + (cy - b - sp * 3.6) + 'c0 ' + sp * 1.4 + ' ' + sp * 1.5 + ' ' + sp * 1.5 + ' ' + sp * 1.3 + ' ' + sp * 3.0, fill: 'none', stroke: col, 'stroke-width': sp * 0.3 }));
    if (d === 1) grp.append(sv('path', { d: 'M' + sx + ' ' + (cy - b - sp * 2.4) + 'c0 ' + sp * 1.4 + ' ' + sp * 1.5 + ' ' + sp * 1.5 + ' ' + sp * 1.3 + ' ' + sp * 3.0, fill: 'none', stroke: col, 'stroke-width': sp * 0.3 }));
    if (d === 12 || d === 6 || d === 3) grp.append(sv('circle', { cx: cx + a + sp * 0.9, cy: cy + sp * 0.2, r: sp * 0.22, fill: col }));
    return grp;
  },

  _arrowShape(a, g) {
    const A = g.pgeo[a.from.p], B = g.pgeo[a.to.p], ea = g.emap[a.from.e], eb = g.emap[a.to.e];
    if (!A || !B || !ea || !eb || ea.st.sys !== eb.st.sys) return null;
    const sp = ea.st.sp, dx = B.cx - A.cx, dy = B.cy - A.cy, len = Math.hypot(dx, dy);
    if (len < 2.4 * sp) return null;
    const ux = dx / len, uy = dy / len;
    const x1 = A.cx + ux * sp * 1.0, y1 = A.cy + uy * sp * 1.0, x2 = B.cx - ux * sp * 1.15, y2 = B.cy - uy * sp * 1.15;
    const off = a.curve ? -a.curve * Math.min(sp * 2.6, len * 0.3) : 0;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + off;
    let tx = x2 - mx, ty = y2 - my; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const hl = sp * 0.92, hw = sp * 0.333, bx = x2 - tx * hl, by = y2 - ty * hl;
    const grp = sv('g', { class: 'se-arrow' });
    grp.append(sv('path', { d: 'M' + x1 + ' ' + y1 + ' Q' + mx + ' ' + my + ' ' + bx + ' ' + by, fill: 'none', stroke: a.color, 'stroke-width': sp * 0.24, 'stroke-linecap': 'round', 'stroke-dasharray': a.dashed ? (sp * 0.5) + ' ' + (sp * 0.45) : null }));
    grp.append(sv('polygon', { points: [[x2, y2], [bx - ty * hw, by + tx * hw], [bx + ty * hw, by - tx * hw]].map((q) => q.join(',')).join(' '), fill: a.color }));
    if (a.label) {
      const px = 0.25 * x1 + 0.5 * mx + 0.25 * bx, py = 0.25 * y1 + 0.5 * my + 0.25 * by;
      grp.append(sv('text', { x: px, y: py - sp * (a.curve >= 0 ? 0.3 : -0.6), 'text-anchor': 'middle', 'font-size': sp * 0.5425, 'font-weight': 700, 'font-family': 'system-ui, Arial, sans-serif', fill: a.color, stroke: '#fff', 'stroke-width': sp * 0.175, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, a.label));
    }
    return grp;
  },

  _drawStatic() {
    const g = this.geo, ov = this.$ovS;
    if (!g || !g.ok || !ov) return;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    Object.keys(g.emap).forEach((id) => { const eg = g.emap[id]; if (eg.ev.kind === 'slash') ov.append(this._slashShape(eg)); });
    this.S.arrows.forEach((a) => { const s = this._arrowShape(a, g); if (s) ov.append(s); });
    const selG = sv('g', { class: 'se-sel' });
    this.sel.forEach((it) => {
      const eg = g.emap[it.e]; if (!eg) return;
      const sp = eg.st.sp;
      if (it.p && g.pgeo[it.p]) {
        const q = g.pgeo[it.p];
        selG.append(sv('ellipse', { cx: q.cx, cy: q.cy, rx: sp * 1.15, ry: sp * 0.85, fill: ACCENT, 'fill-opacity': 0.16, stroke: ACCENT, 'stroke-width': sp * 0.26 }));
      } else {
        const r = eg.r, pad = sp * 0.45;
        selG.append(sv('rect', { x: r.x - pad, y: r.y - pad, width: r.w + 2 * pad, height: r.h + 2 * pad, rx: sp * 0.6, fill: ACCENT, 'fill-opacity': 0.12, stroke: ACCENT, 'stroke-width': sp * 0.22, 'stroke-dasharray': eg.ev.kind === 'note' ? null : (sp * 0.6) + ' ' + (sp * 0.4) }));
      }
    });
    ov.append(selG);
  },

  _drawDyn() {
    const g = this.geo, ov = this.$ovD;
    if (!g || !g.ok || !ov) return;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    (this._cursorIds || []).forEach((id) => {
      const eg = g.emap[id]; if (!eg) return;
      const sp = eg.st.sp, r = eg.r;
      ov.append(sv('rect', { x: r.x - sp * 0.5, y: eg.st.top - sp * 1.2, width: r.w + sp, height: eg.st.bot - eg.st.top + sp * 2.4, rx: sp * 0.5, fill: '#ffb703', 'fill-opacity': 0.32 }));
    });
    const it = this.pending || this._ghost;
    if (it) {
      const sp = it.st.sp, x = it.x, diamond = it.type === 'place' && (this.kind === 'slash' || this.kind === 'mark'), y = diamond ? it.st.cy : yOfStaff(it.st, it.dia);
      const strong = !!this.pending;
      if (diamond) ov.append(sv('polygon', { points: [[x - sp, y + sp * 0.95], [x - sp * 0.4, y + sp * 0.95], [x + sp, y - sp * 0.95], [x + sp * 0.4, y - sp * 0.95]].map((q) => q.join(',')).join(' '), fill: ACCENT, 'fill-opacity': strong ? 0.8 : 0.45 }));
      else {
        ov.append(sv('ellipse', { cx: x, cy: y, rx: sp * 0.72, ry: sp * 0.52, transform: 'rotate(-20 ' + x + ' ' + y + ')', fill: this.pen || ACCENT, 'fill-opacity': strong ? 0.85 : 0.5 }));
        // traits supplémentaires si hors portée
        const top = it.st.top, bot = it.st.bot;
        for (let yy = bot + sp; yy <= y + 0.1; yy += sp) ov.append(sv('line', { x1: x - sp * 1.1, x2: x + sp * 1.1, y1: yy, y2: yy, stroke: ACCENT, 'stroke-opacity': 0.55, 'stroke-width': sp * 0.18 }));
        for (let yy = top - sp; yy >= y - 0.1; yy -= sp) ov.append(sv('line', { x1: x - sp * 1.1, x2: x + sp * 1.1, y1: yy, y2: yy, stroke: ACCENT, 'stroke-opacity': 0.55, 'stroke-width': sp * 0.18 }));
        ov.append(sv('text', { x: x + sp * 1.4, y: y - sp * 0.7, 'font-size': sp * 1.5, 'font-weight': 700, 'font-family': 'system-ui, Arial, sans-serif', fill: ACCENT, stroke: '#fff', 'stroke-width': sp * 0.5, 'paint-order': 'stroke' }, pitchName(it.pitch)));
      }
    }
  },

  /* ---------- clic → intention ---------- */
  _pitchFromDia(dia) {
    const step = mod(dia, 7), oct = Math.floor(dia / 7);
    const alt = this.acc === 'auto' ? keyAlts(keyFifths(this.S.key))[step] : this.acc;
    return mkPitch(step, alt, oct, this.pen);
  },

  _intent(cx, cy) {
    const g = this.geo;
    if (!g || !g.ok || !this._U) return null;
    const u = this._U(cx, cy), x = u[0], y = u[1];
    let st = null, bd = 1e9;
    g.staves.forEach((s) => { const d = Math.abs(y - s.cy); if (d < bd) { bd = d; st = s; } });
    if (!st) return null;
    const sp = st.sp;
    if (bd > 9 * sp || x < st.x0 - 3 * sp || x > st.x1 + 3 * sp) return null;
    const row = g.rows[st.k];
    if (!row || !row.zones.length) return null;
    const zone = row.zones.find((z) => x >= z.l && x < z.rgt) || row.zones[row.zones.length - 1];
    let eg = null, best = 1e9;
    zone.evs.forEach((id) => {
      const q = g.emap[id], inside = x >= q.r.x && x <= q.r.x + q.r.w;
      const dx = inside ? 0 : Math.min(Math.abs(x - q.r.x), Math.abs(x - q.r.x - q.r.w));
      const sc = dx + Math.abs(x - q.r.cx) * 0.001;
      if (sc < best) { best = sc; eg = q; }
    });
    if (!eg) return null;
    const ev = eg.ev, dia = Math.round((st.bot - y) / (sp / 2)) + CLEF_D0[st.clef];
    const base = { st, si: eg.si, mi: eg.mi, ei: eg.ei, evId: ev.id, ev, dia, eg };
    if (ev.kind === 'note') {
      const on = ev.pitches.find((p) => { const q = g.pgeo[p.id]; return Math.abs(x - q.cx) <= 1.6 * sp && Math.abs(y - q.cy) <= 0.62 * sp; });
      if (on) return Object.assign(base, { type: 'select', item: { e: ev.id, p: on.id } });
      if (Math.abs(x - eg.cx) <= 1.9 * sp) return Object.assign(base, { type: 'chord', x: eg.cx, pitch: this._pitchFromDia(dia) });
      return Object.assign(base, { type: 'select', item: { e: ev.id, p: null } });
    }
    if (ev.kind === 'slash') return Object.assign(base, { type: 'select', item: { e: ev.id, p: null } });
    return Object.assign(base, { type: 'place', x: eg.r.cx, pitch: this._pitchFromDia(dia) });
  },

  _onClick(e) {
    if (this.o.readOnly) return;
    const it = this._intent(e.clientX, e.clientY);
    const multi = e.shiftKey || e.ctrlKey || e.metaKey || this.multi;
    if (!it) { this._setPending(null); if (!multi) this.clearSelection(); return; }
    if (it.type === 'select') { this._setPending(null); this._toggleSel(it.item, multi); this._previewSel(); return; }
    if (this.mode === 'select') { this._setPending(null); this._toggleSel({ e: it.evId, p: null }, multi); return; }
    if (this.confirm) {
      const p = this.pending;
      if (p && p.evId === it.evId && p.type === it.type && p.dia === it.dia) this._commitPending();
      else this._setPending(it);
      return;
    }
    this._doIntent(it);
  },

  _onMove(e) {
    if (this.o.readOnly || (e.pointerType && e.pointerType !== 'mouse') || this.mode !== 'write' || this.pending) return;
    const it = this._intent(e.clientX, e.clientY);
    this._ghost = it && (it.type === 'place' || it.type === 'chord') ? it : null;
    this._drawDyn();
  },

  _setPending(it) { this.pending = it || null; this._ghost = null; this._drawDyn(); this._renderPending(); },
  _nudgePending(d) {
    const p = this.pending; if (!p) return;
    p.dia += d; p.pitch = this._pitchFromDia(p.dia); this._drawDyn(); this._renderPending();
  },
  _commitPending() { const p = this.pending; if (!p) return; this.pending = null; this._doIntent(p); },

  _doIntent(it) {
    if (it.type === 'place') this._placeAt(it);
    else if (it.type === 'chord') this._addPitchAt(it);
  },

  _placeAt(it) {
    const isMark = this.kind === 'mark', kind = isMark ? 'slash' : this.kind;
    const cap = capOf(this.S.meter), want = isMark ? 4 : parseDur(this.dur, this.dotted), p = this._pitchFromDia(it.dia);
    let shortened = false;
    const ok = this._mutate('place', () => {
      const st = this.S.staves[it.si], m = st.measures[it.mi], e = m[it.ei];
      if (!e || e.kind !== 'rest') return false;
      const res = placeInRest(m, it.ei, cap, want, (d) => Object.assign(newRest(d), { kind, pitches: kind === 'note' ? [p] : [], color: kind === 'slash' ? (this.pen || '') : '', mute: isMark ? true : (kind === 'slash' ? this.mute : false) }));
      if (res.dur !== want) shortened = true;
      st.measures[it.mi] = res.m;
      this.sel = [{ e: res.ev.id, p: kind === 'note' ? p.id : null }];
    });
    if (ok === false) return;
    this.acc = 'auto';
    this._updateUI();
    this._emit('select', this.getSelection());
    if (shortened) this._toast('Durée raccourcie pour tenir dans la mesure.');
    if (kind === 'note') this._beep([midiOf(p)]);
  },

  _addPitchAt(it) {
    const p = this._pitchFromDia(it.dia);
    const ok = this._mutate('chord', () => {
      const e = this.S.staves[it.si].measures[it.mi][it.ei];
      if (!e || e.kind !== 'note') return false;
      const dup = e.pitches.find((q) => q.step === p.step && q.oct === p.oct);
      if (dup) { this.sel = [{ e: e.id, p: dup.id }]; return false; }
      e.pitches.push(p);
      this.sel = [{ e: e.id, p: p.id }];
    });
    if (ok === false) { this._afterSel(); return; }
    this.acc = 'auto';
    this._updateUI();
    this._emit('select', this.getSelection());
    this._beep([midiOf(p)]);
  },

  _previewSel() {
    const ps = this._pitchTargets();
    if (ps.length && ps.length <= 6) this._beep(ps.map(midiOf));
  },

  /* ---------- événements ---------- */
  _bindEvents() {
    this.$score.addEventListener('click', (e) => this._onClick(e));
    this.$score.addEventListener('pointermove', (e) => this._onMove(e));
    this.$score.addEventListener('pointerleave', () => { if (this._ghost) { this._ghost = null; this._drawDyn(); } });
    this.$root.addEventListener('keydown', (e) => this._onKey(e));
  },

  _onKey(e) {
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key, mod_ = e.ctrlKey || e.metaKey;
    let used = true;
    if (mod_ && (k === 'z' || k === 'Z')) { if (e.shiftKey) this.redo(); else this.undo(); }
    else if (mod_ && (k === 'y' || k === 'Y')) this.redo();
    else if (mod_ && (k === 'a' || k === 'A')) this.selectAll();
    else if (k === 'Delete' || k === 'Backspace') this.remove();
    else if (k === 'ArrowUp') this.transpose(e.shiftKey ? 12 : 1);
    else if (k === 'ArrowDown') this.transpose(e.shiftKey ? -12 : -1);
    else if (k === 'ArrowLeft') this.moveSelection(-1);
    else if (k === 'ArrowRight') this.moveSelection(1);
    else if (k === 'Escape') { this._setPending(null); this.clearSelection(); }
    else if (k === ' ') this.togglePlay();
    else if (k === '.') this.setInputDotted(!this.dotted);
    else if ('12345'.indexOf(k) >= 0 && k.length === 1) this.setInputDur([16, 8, 4, 2, 1][+k - 1]);
    else used = false;
    if (used) e.preventDefault();
  }
});

/* =====================================================================
 * 9. LECTURE AUDIO (Web Audio, sans dépendance) ET EXPORTS
 * ===================================================================== */
const ABCJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.5.2/abcjs-basic-min.js';
ScoreEditor.ABCJS_CDN = ABCJS_CDN;

Object.assign(ScoreEditor.prototype, {
  _audio() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    const ctx = this._ac || (this._ac = new AC());
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  },
  _tone(ctx, midi, t0, dur, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const end = t0 + dur;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.setValueAtTime(vol * 0.8, Math.max(t0 + 0.03, end - 0.09)); g.gain.linearRampToValueAtTime(0, end);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(end + 0.03);
    return o;
  },
  _beep(midis) {
    if (!this.o.sound || this._playing) return;
    const ctx = this._audio(); if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    midis.forEach((m) => this._tone(ctx, m, t, 0.55, 0.16 / Math.sqrt(midis.length)));
  },
  togglePlay() { if (this._playing) this.stop(); else this.play(); },
  play() {
    const ctx = this._audio(); if (!ctx) { this._toast('Audio indisponible sur cet appareil.'); return; }
    this.stop();
    const S = this.S, cap = capOf(S.meter), u = 60 / (S.tempo * 4), t0 = ctx.currentTime + 0.15;
    const items = [];
    S.staves.forEach((st, si) => st.measures.forEach((m, mi) => { let p = 0; m.forEach((e) => { items.push({ t: mi * cap + p, d: e.dur, e, clef: st.clef, si }); p += e.dur; }); }));
    const nodes = [];
    // notes liées (tie) : fusionne les notes tenues en un seul son, pour ne pas rejouer l'attaque à chaque note
    S.staves.forEach((st, si) => {
      const open = {}, segs = [];
      items.filter((it) => it.si === si && it.e.kind === 'note').forEach((it) => {
        const seen = {};
        it.e.pitches.forEach((pp) => {
          const key = pp.step + ':' + pp.alt + ':' + pp.oct;
          seen[key] = 1;
          if (open[key]) open[key].end = it.t + it.d;
          else { const seg = { midi: midiOf(pp), start: it.t, end: it.t + it.d }; segs.push(seg); open[key] = seg; }
        });
        Object.keys(open).forEach((k) => { if (!seen[k]) delete open[k]; });
        if (!it.e.tie) Object.keys(seen).forEach((k) => delete open[k]);
      });
      const startN = {}; segs.forEach((s) => { startN[s.start] = (startN[s.start] || 0) + 1; });
      segs.forEach((s) => nodes.push(this._tone(ctx, s.midi, t0 + s.start * u, Math.max(0.12, (s.end - s.start) * u * 0.96), 0.14 / Math.sqrt(startN[s.start]))));
    });
    // silences, slashs et accords en rythme (symbole d'accord) : indépendants des liaisons, coupés par un slash muet
    items.forEach((it) => {
      if (it.e.kind === 'note' || it.e.mute) return;
      if (!it.e.chord) return;
      const v = voiceChord(it.e.chord, it.clef === 'bass' ? 40 : 55);
      if (!v) return;
      v.forEach((pp) => nodes.push(this._tone(ctx, midiOf(pp), t0 + it.t * u, Math.max(0.12, it.d * u * 0.96), 0.14 / Math.sqrt(v.length))));
    });
    const total = S.staves[0].measures.length * cap * u;
    this._playing = { ctx, nodes, t0, u, items, total };
    const tick = () => {
      const pl = this._playing; if (!pl) return;
      const now = ctx.currentTime - pl.t0;
      if (now > pl.total + 0.2) { this.stop(); return; }
      const ids = pl.items.filter((it) => it.t * pl.u <= now && now < (it.t + it.d) * pl.u && it.e.kind !== 'rest').map((it) => it.e.id);
      const key = ids.join(',');
      if (key !== this._cursorKey) { this._cursorKey = key; this._cursorIds = ids; this._drawDyn(); }
      pl.raf = root.requestAnimationFrame(tick);
    };
    this._playing.raf = root.requestAnimationFrame(tick);
    this._updateUI(); this._emit('play');
  },
  stop() {
    const pl = this._playing;
    if (!pl) return;
    this._playing = null;
    if (pl.raf && root.cancelAnimationFrame) root.cancelAnimationFrame(pl.raf);
    pl.nodes.forEach((o) => { try { o.stop(); } catch (e) { /* déjà arrêté */ } });
    this._cursorIds = []; this._cursorKey = ''; this._drawDyn(); this._updateUI(); this._emit('stop');
  },

  /* ---------- exports ---------- */
  toSVG() {
    const svg = this.svg;
    if (!svg) return '';
    const c = svg.cloneNode(true);
    [].slice.call(c.querySelectorAll('.se-dyn, .se-sel')).forEach((n) => n.remove());
    const b = svg.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const vw = vb.length === 4 ? vb[2] : b.width, vh = vb.length === 4 ? vb[3] : b.height;
    c.setAttribute('xmlns', SVGNS); c.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    c.setAttribute('width', Math.round(b.width)); c.setAttribute('height', Math.round(b.height));
    if (vb.length !== 4) c.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
    c.removeAttribute('style');
    c.insertBefore(sv('rect', { x: 0, y: 0, width: vw, height: vh, fill: '#ffffff' }), c.firstChild);
    return new root.XMLSerializer().serializeToString(c);
  },
  toPNG(pxScale) {
    pxScale = pxScale || 2;
    const svgStr = this.toSVG();
    return new Promise((res, rej) => {
      const url = root.URL.createObjectURL(new root.Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new root.Image();
      img.onload = () => {
        const w = img.naturalWidth || 800, hgt = img.naturalHeight || 300;
        const cv = root.document.createElement('canvas'); cv.width = w * pxScale; cv.height = hgt * pxScale;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        root.URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG impossible'))), 'image/png');
      };
      img.onerror = () => { root.URL.revokeObjectURL(url); rej(new Error('Image SVG illisible')); };
      img.src = url;
    });
  },
  async _libSource() {
    const d = root.document;
    const inl = d.querySelector('script[data-score-editor]:not([src])');
    if (inl && inl.textContent.trim()) return inl.textContent;
    const ext = [].find.call(d.scripts, (s) => s.src && /score-?editor/i.test(s.src));
    if (ext) { try { const r = await root.fetch(ext.src); if (r.ok) return await r.text(); } catch (e) { /* hors ligne */ } }
    return null;
  },
  /** mode : 'light' (référence abc-score-editor.js) | 'standalone' (bibliothèque incluse) */
  async toHTML(mode) {
    const data = JSON.stringify(this.toJSON()).replace(/</g, '\\u003c');
    const opts = '{ scale: ' + this.scale + ', player: true }';
    const boot = '<div id="partition"></div>\n<script>\n  ScoreEditor.render("#partition", ' + data + ', ' + opts + ');\n<\/script>';
    const abcjs = '<script src="' + ABCJS_CDN + '"><\/script>';
    if (mode === 'standalone') {
      const src = await this._libSource();
      if (!src) throw new Error('Source de la bibliothèque introuvable');
      return '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
        (this.S.title || 'Partition').replace(/[<&]/g, '') + '</title></head>\n<body style="margin:0;padding:12px;background:#fff">\n' +
        abcjs + '\n<script>\n' + src.replace(/<\/script/gi, '<\\/script') + '\n<\/script>\n' + boot + '\n</body></html>\n';
    }
    return abcjs + '\n<script src="abc-score-editor.js"><\/script>\n' + boot + '\n';
  },
  async _download(name, mime, data) {
    if (this.o.download) return this.o.download(name, mime, data);
    const d = root.document, blob = data instanceof root.Blob ? data : new root.Blob([data], { type: mime });
    const url = root.URL.createObjectURL(blob), a = h('a', { href: url, download: name });
    d.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => root.URL.revokeObjectURL(url), 4000);
  },

  /* ---------- fenêtre d'export / import ---------- */
  openExport(tab) {
    const self = this;
    this.stop();
    const close = () => { modal.remove(); self.$root.focus(); };
    const modal = h('div', { class: 'se-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Exporter', onclick: (e) => { if (e.target === modal) close(); }, onkeydown: (e) => { if (e.key === 'Escape') close(); } });
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:10px' });
    const tabsEl = h('div', { class: 'se-seg' });
    const tabs = [['abc', 'ABC'], ['svg', 'Image'], ['html', 'Page HTML'], ['json', 'JSON']];
    const btns = tabs.map(([k, l]) => { const b = h('button', { type: 'button', class: 'se-btn', 'aria-pressed': 'false', onclick: () => show(k) }, l); b.dataset.k = k; tabsEl.append(b); return b; });
    const flash = (b, txt) => { const o = b.textContent; b.textContent = txt; setTimeout(() => { b.textContent = o; }, 1600); };
    const copy = async (ta, b) => {
      let ok = false;
      try { await root.navigator.clipboard.writeText(ta.value); ok = true; } catch (e) { try { ta.select(); ok = root.document.execCommand('copy'); } catch (e2) { ok = false; } }
      flash(b, ok ? 'Copié ✓' : 'Sélectionnez puis copiez');
      if (!ok) ta.select();
    };
    const actions = (ta, name, mime, extra) => {
      const c = h('button', { type: 'button', class: 'se-btn se-primary' }, 'Copier'); c.onclick = () => copy(ta, c);
      const d = h('button', { type: 'button', class: 'se-btn' }, 'Télécharger ' + name); d.onclick = async () => { try { await self._download(name, mime, ta.value); } catch (e) { flash(d, 'Non disponible ici'); } };
      return h('div', { class: 'se-row' }, c, d, extra || []);
    };
    const note = (t) => h('div', { class: 'se-hint' }, t);
    const show = async (k) => {
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
      body.innerHTML = '';
      if (k === 'abc') {
        const ta = h('textarea', { class: 'se-ta', readonly: true, spellcheck: 'false' }); ta.value = self.getABC();
        body.append(note('Notation ABC : notes, accords, symboles d\'accord et textes. Compatible abcjs, EasyABC, etc. Les couleurs et flèches n\'existent pas en ABC : utilisez « Image » ou « JSON ».'), ta, actions(ta, 'partition.abc', 'text/plain'));
      } else if (k === 'svg') {
        const ta = h('textarea', { class: 'se-ta', readonly: true, spellcheck: 'false' }); ta.value = self.toSVG();
        const prev = h('div', { class: 'se-prev', html: ta.value });
        const png = h('button', { type: 'button', class: 'se-btn' }, 'Télécharger PNG');
        png.onclick = async () => { try { await self._download('partition.png', 'image/png', await self.toPNG(2)); } catch (e) { flash(png, 'Non disponible ici'); } };
        body.append(note('Image vectorielle fidèle à l\'écran (couleurs, flèches, slashs). À coller dans un document ou une page web.'), prev, ta, actions(ta, 'partition.svg', 'image/svg+xml', png));
      } else if (k === 'html') {
        const ta = h('textarea', { class: 'se-ta', readonly: true, spellcheck: 'false' });
        const mk = (m) => h('button', { type: 'button', class: 'se-btn', 'aria-pressed': 'false' }, m === 'light' ? 'Léger (charge abc-score-editor.js)' : 'Autonome (tout inclus)');
        const bl = mk('light'), bs = mk('standalone');
        const load = async (m) => {
          bl.setAttribute('aria-pressed', String(m === 'light')); bs.setAttribute('aria-pressed', String(m === 'standalone'));
          try { ta.value = await self.toHTML(m); } catch (e) { ta.value = '⚠ ' + e.message + '\nUtilisez le mode « Léger » et placez abc-score-editor.js à côté de votre page.'; }
        };
        bl.onclick = () => load('light'); bs.onclick = () => load('standalone');
        body.append(note('Affiche la partition (lecture seule, avec bouton Écouter) dans une page web. Le mode autonome inclut la bibliothèque ; le mode léger la référence.'), h('div', { class: 'se-seg' }, bl, bs), ta, actions(ta, 'partition.html', 'text/html'));
        load('light');
      } else {
        const ta = h('textarea', { class: 'se-ta', spellcheck: 'false' }); ta.value = JSON.stringify(self.toJSON(), null, 1);
        const ld = h('button', { type: 'button', class: 'se-btn se-primary' }, 'Charger dans l\'éditeur');
        ld.onclick = () => { try { self.loadJSON(ta.value); close(); } catch (e) { flash(ld, 'JSON invalide'); } };
        body.append(note('Sauvegarde complète (couleurs et flèches incluses). Collez ici un JSON exporté pour le recharger.'), ta, actions(ta, 'partition.json', 'application/json', ld));
      }
    };
    modal.append(h('div', { class: 'se-dlg' }, h('div', { class: 'se-row', style: 'justify-content:space-between' }, h('h3', null, 'Exporter / intégrer'), h('button', { type: 'button', class: 'se-btn', onclick: close }, 'Fermer')), tabsEl, body));
    this.$root.append(modal);
    show(tab || 'abc');
  }
});

return ScoreEditor;
});
