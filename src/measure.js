// measure.js — mede a qualidade de um arranjo.
//
// razão        distancia media entre relacionados / entre nao-relacionados.
//              <1 e bom: quem se relaciona fica mais perto.
// sobreposicao pares de cards cujo retangulo se invade (com folga).
// spearman     correlacao de postos entre o grau de uma tabela e a
//              proximidade dela ao centro. +1 = hubs bem no miolo.

import { degrees } from './analyze.js';

/** Distancia entre centros de dois cards. */
function dist(a, b) {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

/** Pares relacionados (por FK) e nao-relacionados, sem auto-referencia. */
function pares(model) {
  const names = Object.keys(model.tables);
  const rel = new Set();
  for (const r of model.refs) {
    if (r.child === r.parent) continue;
    if (!model.tables[r.child] || !model.tables[r.parent]) continue;
    rel.add([r.child, r.parent].sort().join('\u0000'));
  }
  const relacionados = [], naoRelacionados = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const k = [names[i], names[j]].sort().join('\u0000');
      (rel.has(k) ? relacionados : naoRelacionados).push([names[i], names[j]]);
    }
  }
  return { relacionados, naoRelacionados };
}

/** Distancia media relacionados vs nao-relacionados. */
export function distanceRatio(model, pos) {
  const { relacionados, naoRelacionados } = pares(model);
  const media = (ps) => ps.length
    ? ps.reduce((s, [a, b]) => s + dist(pos[a], pos[b]), 0) / ps.length : 0;
  const dRel = media(relacionados);
  const dNao = media(naoRelacionados);
  return {
    relacionados: relacionados.length,
    naoRelacionados: naoRelacionados.length,
    distRel: dRel,
    distNao: dNao,
    razao: dNao ? dRel / dNao : 0,
  };
}

/** Pares de cards cujo retangulo se invade (com folga). */
export function overlaps(pos, gap = 0) {
  const names = Object.keys(pos);
  const out = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = pos[names[i]], b = pos[names[j]];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
      if (ox > 0 && oy > 0)
        out.push({ a: names[i], b: names[j], area: ox * oy });
    }
  }
  return out;
}

/** Correlacao de postos de Spearman entre duas listas. */
function spearman(xs, ys) {
  const rank = (v) => {
    const idx = v.map((_, i) => i).sort((i, j) => v[i] - v[j]);
    const r = new Array(v.length);
    idx.forEach((orig, pos) => { r[orig] = pos + 1; });
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length;
  if (n < 2) return 0;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  return dx2 && dy2 ? num / Math.sqrt(dx2 * dy2) : 0;
}

/**
 * Correlacao entre o grau de entrada de cada tabela e a distancia dela
 * ao centro do desenho. Valores positivos = hubs no miolo.
 * `valor` vai no eixo Y invertido (proximidade), como no script original.
 */
export function hubCentrality(model, pos, invertPerto = true) {
  const names = Object.keys(pos);
  let cx = 0, cy = 0;
  for (const t of names) { cx += pos[t].x + pos[t].w / 2; cy += pos[t].y + pos[t].h / 2; }
  cx /= names.length; cy /= names.length;

  const indeg = {};
  for (const t of names) indeg[t] = 0;
  for (const r of model.refs) {
    if (r.child === r.parent) continue;
    if (indeg[r.parent] !== undefined) indeg[r.parent]++;
  }
  const dists = names.map(t =>
    Math.hypot(pos[t].x + pos[t].w / 2 - cx, pos[t].y + pos[t].h / 2 - cy));

  const grau = names.map(t => indeg[t]);
  const prox = invertPerto ? dists.map(d => -d) : dists;
  return spearman(grau, prox);
}

/**
 * Hierarquia: para cada FK child -> parent, o pai deve ficar ACIMA do filho
 * (y menor). Mede se o arranjo respeita a direcao de leitura do dominio.
 *
 * score = fracao de FKs com o pai acima, em [0,1]. 1 = hierarquia perfeita.
 * mediaErro = quanto (px) as FKs invertidas erram, em media.
 */
export function hierarchyScore(model, pos) {
  const refs = model.refs.filter(r =>
    r.child !== r.parent && pos[r.child] && pos[r.parent]);
  if (!refs.length) return { score: 0, certas: 0, total: 0, mediaErro: 0 };

  let certas = 0, somaErro = 0;
  for (const r of refs) {
    const c = pos[r.child].y + (pos[r.child].h || 0) / 2;
    const p = pos[r.parent].y + (pos[r.parent].h || 0) / 2;
    if (p < c) certas++;                 // pai acima do filho: correto
    else somaErro += p - c;              // empate ou invertido: erro em px
  }
  const invertidas = refs.length - certas;
  return {
    score: certas / refs.length,
    certas,
    total: refs.length,
    mediaErro: invertidas ? somaErro / invertidas : 0,
  };
}

/** Leitura completa de um arranjo. */
export function measure(model, pos, gap = 26) {
  return {
    ratio: distanceRatio(model, pos),
    overlaps: overlaps(pos, gap),
    hubCentrality: hubCentrality(model, pos),
    hierarchy: hierarchyScore(model, pos),
  };
}
