// render.js — desenha o modelo num SVG e num HTML interativo.
//
// Camadas, do fundo para a frente:
//   1. arestas (FK)        com marcador de seta no lado do pai
//   2. cards               cabecalho + colunas, PK marcada
//   3. rotulos             nome da tabela, tipo de cada coluna
//
// O HTML embrulha o SVG e adiciona, sem framework:
//   - arrastar cards
//   - destacar as FKs de uma tabela ao passar o mouse
//   - filtrar por nome
//   - recolher/expandir colunas
//
// O painel de sliders re-simula AO VIVO: o texto do layout.js e injetado
// no HTML, entao browser e CLI rodam o MESMO motor (uma fonte).
// O modelo que cruza, porem, e reduzido: so as CONTAGENS de colunas e
// indices (nao nomes/tipos). Como cardSizes mede o card por contagem, o
// arranjo bate; os rotulos so existem no SVG, que o CLI ja desenhou.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const C = {
  bg: '#ffffff',
  cardBg: '#ffffff',
  cardBorder: '#c8ccd4',
  headerBg: '#3d5a80',
  headerText: '#ffffff',
  rowText: '#2b2f38',
  typeText: '#8a9099',
  pk: '#e8a33d',
  edge: '#9aa3b2',
  edgeHot: '#e05c2a',
  grid: '#f0f2f5',
};

/** Escapa texto para XML. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ponto no contorno do card, na direcao de (tx,ty). Para as arestas sairem
 *  da borda e nao do centro. */
function borderPoint(card, tx, ty) {
  const cx = card.x + card.w / 2, cy = card.y + card.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : (card.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (card.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * Gera o SVG. Devolve { svg, width, height }.
 * `pos` vem do layout. `opts` controla rotulos e cores.
 */
export function renderSvg(model, pos, opts = {}) {
  const o = { showTypes: true, headerH: 34, rowH: 20, pad: 200, padBottom: 600, padRight: 600, ...opts };
  const names = Object.keys(pos);

  // espaco de trabalho: conteudo + margem generosa, para ter onde arrastar
  let cw = 0, ch = 0;
  for (const t of names) {
    cw = Math.max(cw, pos[t].x + pos[t].w);
    ch = Math.max(ch, pos[t].y + pos[t].h);
  }
  const padX = o.pad, padY = o.pad;
  const W = cw + padX + Math.max(padX, o.padRight);
  const H = ch + padY + Math.max(padY, o.padBottom);
  // desloca o conteudo para dentro da margem
  const OFFX = padX, OFFY = padY;
  // area util do conteudo (sem a folga), para o "ajustar" enquadrar so ele
  const cbox = { x: OFFX - 20, y: OFFY - 20, w: cw + 40, h: ch + 40 };

  const edges = model.refs.filter(r =>
    r.child !== r.parent && pos[r.child] && pos[r.parent]);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" `
    + `viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" `
    + `data-cbox="${cbox.x},${cbox.y},${cbox.w},${cbox.h}" `
    + `font-family="ui-sans-serif,system-ui,sans-serif">`);
  parts.push(`<defs><marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" `
    + `markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + `<path d="M0,0 L10,5 L0,10 z" fill="${C.edge}"/></marker></defs>`);
  parts.push(`<rect width="${Math.round(W)}" height="${Math.round(H)}" fill="${C.bg}"/>`);

  // 1) arestas
  parts.push(`<g id="edges" fill="none" stroke="${C.edge}" stroke-width="1.2">`);
  for (const e of edges) {
    const p = pos[e.parent], c = pos[e.child];
    const pc = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
    const a = borderPoint(c, pc.x, pc.y);      // sai do filho
    const b = borderPoint(p, cc.x, cc.y);      // chega no pai
    parts.push(`<line data-child="${esc(e.child)}" data-parent="${esc(e.parent)}" `
      + `x1="${(a.x + OFFX).toFixed(1)}" y1="${(a.y + OFFY).toFixed(1)}" `
      + `x2="${(b.x + OFFX).toFixed(1)}" y2="${(b.y + OFFY).toFixed(1)}" `
      + `marker-end="url(#arw)"/>`);
  }
  parts.push('</g>');

  // 2) cards
  parts.push('<g id="cards">');
  for (const t of names) {
    const b = pos[t];
    const tab = model.tables[t];
    parts.push(`<g class="card" data-table="${esc(t)}" `
      + `data-w="${b.w}" data-h="${b.h}" data-cx="${(b.x + OFFX).toFixed(1)}" data-cy="${(b.y + OFFY).toFixed(1)}" `
      + `transform="translate(${(b.x + OFFX).toFixed(1)},${(b.y + OFFY).toFixed(1)})">`);
    parts.push(`<rect class="cardbox" width="${b.w}" height="${b.h}" rx="6" `
      + `fill="${C.cardBg}" stroke="${C.cardBorder}" stroke-width="1.4"/>`);
    parts.push(`<path d="M0,6 a6,6 0 0 1 6,-6 h${b.w - 12} a6,6 0 0 1 6,6 v${o.headerH - 6} h${-b.w} z" `
      + `fill="${C.headerBg}"/>`);
    parts.push(`<text x="10" y="${(o.headerH / 2 + 5).toFixed(0)}" fill="${C.headerText}" `
      + `font-size="13" font-weight="600">${esc(t)}</text>`);

    let y = o.headerH + 14;
    for (const col of tab.cols) {
      const isPk = col.pk || tab.pk.includes(col.name);
      parts.push(`<circle cx="13" cy="${(y - 4).toFixed(0)}" r="3.2" `
        + `fill="${isPk ? C.pk : C.cardBorder}"/>`);
      parts.push(`<text x="23" y="${y.toFixed(0)}" font-size="12" fill="${C.rowText}" `
        + `font-weight="${isPk ? 600 : 400}">${esc(col.name)}</text>`);
      if (o.showTypes) {
        parts.push(`<text data-type="1" x="${b.w - 10}" y="${y.toFixed(0)}" font-size="10" `
          + `fill="${C.typeText}" text-anchor="end">${esc(col.type)}</text>`);
      }
      y += o.rowH;
    }
    // indices (abaixo das colunas, discreto)
    for (const ix of tab.indexes) {
      parts.push(`<text x="13" y="${y.toFixed(0)}" font-size="10" fill="${C.typeText}">`
        + `${ix.unique ? 'UQ' : 'IX'} ${esc(ix.cols.join(', '))}</text>`);
      y += o.rowH - 4;
    }
    parts.push('</g>');
  }
  parts.push('</g>');
  parts.push('</svg>');

  return { svg: parts.join('\n'), width: Math.round(W), height: Math.round(H) };
}

// ---------------------------------------------------------------- HTML
// Embrulha o SVG numa pagina interativa. Zero framework: o JS da pagina
// usa so DOM direto. Recursos: arrastar card, filtrar, destacar FKs.

const PAGE_CSS = `
:root { --bg:#eef1f5; --fg:#1c1f26; --acc:#3d5a80; --hot:#e05c2a; }
* { box-sizing:border-box; }
html,body { margin:0; height:100%; background:var(--bg); color:var(--fg);
  font:14px/1.4 ui-sans-serif,system-ui,sans-serif; }
body > header { position:fixed; inset:0 0 auto 0; height:52px; display:flex; align-items:center;
  gap:10px; padding:0 14px; background:#fff; border-bottom:1px solid #d6dae1; z-index:10; }
body > header h1 { font-size:15px; margin:0 8px 0 0; font-weight:650; }
body > header .meta { color:#6b7280; font-size:12px; }
body > header input { margin-left:auto; padding:7px 11px; border:1px solid #c8ccd4; border-radius:7px;
  font-size:13px; width:220px; }
body > header button { padding:7px 11px; border:1px solid #c8ccd4; background:#fff; border-radius:7px;
  font-size:13px; cursor:pointer; }
body > header button:hover { background:#f3f5f8; }
body > header .zoom { display:flex; align-items:center; gap:6px; margin-left:8px; }
body > header .zoom b { min-width:44px; text-align:center; font-weight:600; font-size:12px;
  color:#4b5563; font-variant-numeric:tabular-nums; }
#stage { position:absolute; inset:52px 0 0 0; overflow:hidden; cursor:grab; }
#stage.pan { cursor:grabbing; }
#stage svg { display:block; transform-origin:0 0; }
.card { cursor:grab; }
.card.drag { cursor:grabbing; }
.card.hot .cardbox { stroke:var(--hot); stroke-width:2.2; }
.card.dim { opacity:.42; }
.card.filtered { opacity:.14; }
line.hot { stroke:var(--hot) !important; stroke-width:2.4 !important; }
line.dim { opacity:.22; }

#panel { position:fixed; left:12px; bottom:12px; width:250px; background:#fff;
  border:1px solid #d6dae1; border-radius:10px; box-shadow:0 4px 18px rgba(0,0,0,.12);
  font-size:12px; z-index:20; max-height:calc(100vh - 90px); overflow:auto; }
#panel > header { position:static; inset:auto; height:auto; display:flex; align-items:center; gap:6px;
  padding:8px 10px; background:#3d5a80; color:#fff; border:0; border-radius:9px 9px 0 0; z-index:auto; }
#panel > header b { flex:1; font-size:12px; font-weight:650; }
#panel > header button { background:rgba(255,255,255,.15); border:0; color:#fff; padding:3px 9px;
  border-radius:6px; font-size:12px; cursor:pointer; }
#panel #pbody { padding:6px 10px 10px; }
#panel.collapsed #pbody { display:none; }
#panel .grp { margin:8px 0 2px; font-weight:650; color:#3d5a80; font-size:11px;
  text-transform:uppercase; letter-spacing:.4px; }
#panel .row { display:grid; grid-template-columns:1fr auto; gap:2px 8px; align-items:center;
  margin:5px 0; }
#panel .row label { font-size:11.5px; color:#4b5563; }
#panel .row output { font-variant-numeric:tabular-nums; color:#1c1f26; font-weight:600;
  font-size:11.5px; }
#panel input[type=range] { grid-column:1 / -1; width:100%; height:16px; margin:0; accent-color:#3d5a80; }
#panel .acts { display:flex; gap:6px; margin-top:10px; }
#panel .acts button { flex:1; padding:6px; border:1px solid #c8ccd4; background:#fff;
  border-radius:6px; font-size:11.5px; cursor:pointer; }
#panel .acts button:hover { background:#f3f5f8; }
#panel .note { color:#8a9099; font-size:10.5px; margin-top:8px; line-height:1.35; }
`;

const PAGE_JS = `
const stage = document.getElementById('stage');
const svg = stage.querySelector('svg');
const cards = [...svg.querySelectorAll('.card')];
const lines = [...svg.querySelectorAll('#edges line')];
const byTable = {}; cards.forEach(c => byTable[c.dataset.table] = c);

// ponto no contorno do card, na direcao de (tx,ty) — mesma formula do render.
function borderPoint(box, tx, ty) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

// caixa atual de um card (posicao vinda do dataset, atualizada ao arrastar)
function boxOf(name) {
  const c = byTable[name];
  return {
    x: Number(c.dataset.cx), y: Number(c.dataset.cy),
    w: Number(c.dataset.w), h: Number(c.dataset.h),
  };
}

// recalcula todas as arestas a partir das posicoes atuais dos cards
function rewriteEdges() {
  lines.forEach(l => {
    const pc = boxOf(l.dataset.parent), cc = boxOf(l.dataset.child);
    const p = { x: pc.x + pc.w / 2, y: pc.y + pc.h / 2 };
    const c = { x: cc.x + cc.w / 2, y: cc.y + cc.h / 2 };
    const a = borderPoint(cc, p.x, p.y);
    const b = borderPoint(pc, c.x, c.y);
    l.setAttribute('x1', a.x.toFixed(1));
    l.setAttribute('y1', a.y.toFixed(1));
    l.setAttribute('x2', b.x.toFixed(1));
    l.setAttribute('y2', b.y.toFixed(1));
  });
}

// ---- zoom & pan ----
// view: escala + deslocamento, aplicados como transform no SVG.
const view = { k: 1, x: 0, y: 0 };
const MIN = 0.1, MAX = 4;
const zoomLabel = document.getElementById('zl');

function apply() {
  svg.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
  zoomLabel.textContent = Math.round(view.k * 100) + '%';
}

/** Ajusta o CONTEUDO (nao o canvas inteiro) dentro da janela, com folga. */
function fit() {
  const cb = (svg.dataset.cbox || '').split(',').map(Number);
  const bx = cb[0] || 0, by = cb[1] || 0, bw = cb[2] || svg.viewBox.baseVal.width, bh = cb[3] || svg.viewBox.baseVal.height;
  const rw = stage.clientWidth, rh = stage.clientHeight;
  const k = Math.min(rw / bw, rh / bh) * 0.96;
  view.k = Math.max(MIN, Math.min(MAX, k));
  // centraliza o conteudo na janela
  view.x = (rw - bw * view.k) / 2 - bx * view.k;
  view.y = (rh - bh * view.k) / 2 - by * view.k;
  apply();
}

/** Zoom mantendo fixo o ponto sob o cursor. */
function zoomAt(px, py, fator) {
  const k2 = Math.max(MIN, Math.min(MAX, view.k * fator));
  const r = k2 / view.k;
  view.x = px - (px - view.x) * r;
  view.y = py - (py - view.y) * r;
  view.k = k2;
  apply();
}

stage.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

document.getElementById('zi').addEventListener('click', () => {
  zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25);
});
document.getElementById('zo').addEventListener('click', () => {
  zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25);
});
document.getElementById('zf').addEventListener('click', fit);
document.addEventListener('keydown', (ev) => {
  if (ev.key === '0') fit();
  else if (ev.key === '+' || ev.key === '=') zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25);
  else if (ev.key === '-') zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25);
});

// arrastar o FUNDO move o desenho (pan). Arrastar um card move o card.
let drag = null, pan = null;
svg.addEventListener('mousedown', (ev) => {
  const card = ev.target.closest('.card');
  if (card) {
    const sr = svg.getBoundingClientRect();
    // posicao do cursor no espaco local do SVG (sem escala)
    const lx = (ev.clientX - sr.left) / view.k;
    const ly = (ev.clientY - sr.top) / view.k;
    // posicao atual do card guardada no dataset (evita depender do parse do transform)
    const cx = Number(card.dataset.cx), cy = Number(card.dataset.cy);
    drag = { card, ox: lx - cx, oy: ly - cy };
    card.classList.add('drag');
  } else {
    pan = { x: ev.clientX - view.x, y: ev.clientY - view.y };
    stage.classList.add('pan');
  }
  ev.preventDefault();
});
window.addEventListener('mousemove', (ev) => {
  if (drag) {
    const sr = svg.getBoundingClientRect();
    const lx = (ev.clientX - sr.left) / view.k;
    const ly = (ev.clientY - sr.top) / view.k;
    const x = lx - drag.ox, y = ly - drag.oy;
    drag.card.setAttribute('transform', 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')');
    drag.card.dataset.cx = x.toFixed(1);
    drag.card.dataset.cy = y.toFixed(1);
    rewriteEdges();
  } else if (pan) {
    view.x = ev.clientX - pan.x;
    view.y = ev.clientY - pan.y;
    apply();
  }
});
window.addEventListener('mouseup', () => {
  if (drag) { drag.card.classList.remove('drag'); drag = null; }
  if (pan) { pan = null; stage.classList.remove('pan'); }
});

// destaca as FKs de uma tabela
function highlight(name) {
  cards.forEach(c => c.classList.toggle('dim', !!name && c.dataset.table !== name));
  lines.forEach(l => {
    const on = !name || l.dataset.child === name || l.dataset.parent === name;
    l.classList.toggle('hot', !!name && on);
    l.classList.toggle('dim', !!name && !on);
  });
}
svg.addEventListener('mouseover', (ev) => {
  const card = ev.target.closest('.card');
  if (card) highlight(card.dataset.table);
});
svg.addEventListener('mouseout', (ev) => {
  if (ev.target.closest('.card')) highlight(null);
});

// filtra por nome
document.getElementById('q').addEventListener('input', (ev) => {
  const q = ev.target.value.trim().toLowerCase();
  cards.forEach(c => c.classList.toggle('filtered', q && !c.dataset.table.toLowerCase().includes(q)));
});

// alterna tipos
document.getElementById('tt').addEventListener('click', () => {
  svg.querySelectorAll('text[data-type]').forEach(t => {
    t.style.display = t.style.display === 'none' ? '' : 'none';
  });
});

// ---- painel de sliders: re-simula com o MESMO motor do CLI ----
const D = window.__DBV__;
const sliders = [...document.querySelectorAll('#panel input[type=range]')];
const outOf = id => document.getElementById('o_' + id);

// modelo minimo que o layout() espera
function modeloMin() {
  const tables = {};
  for (const [t, dim] of Object.entries(D.tables))
    tables[t] = {
      cols: Array.from({ length: dim.cols }, (_, i) => ({ name: 'c' + i, type: '' })),
      indexes: Array.from({ length: dim.idx }, () => ({})),
    };
  return { tables, refs: D.refs };
}

// valores iniciais: o que o CLI usou
for (const s of sliders) {
  const p = s.dataset.param;
  const v = D.opts[p];
  s.value = v !== undefined ? v : s.min;
  outOf(p).textContent = fmtSlider(p, Number(s.value));
}
function fmtSlider(p, v) {
  const cfg = { kFk: x => x + 'px', wMola: x => x.toFixed(3),
    kOut: x => '×' + x.toFixed(2), kBw: x => '×' + x.toFixed(2),
    wIrmaos: x => x.toFixed(2), wAncora: x => x.toFixed(2), kGrupo: x => x + 'px',
    vmax: x => x + 'px', maxDesloc: x => x === 0 ? 'livre' : x + 'px', gap: x => x + 'px' };
  return cfg[p] ? cfg[p](v) : String(v);
}

function params() {
  const o = {};
  for (const s of sliders) o[s.dataset.param] = Number(s.value);
  return o;
}

// Duas velocidades: durante o arrasto roda POUCAS iteracoes (preview
// instantaneo); ao soltar, roda a simulacao completa. Evita travar o slider.
const ITERS_PREVIEW = 220;
let rafPend = null, itersPend = null;
function resimular(iters) {
  itersPend = iters;
  if (rafPend) return;
  rafPend = requestAnimationFrame(() => {
    rafPend = null;
    const o = params();
    o.iters = itersPend;
    const base = modeloMin();
    const { pos } = layout(base, D.clusters, o, D.metricas);
    for (const [t, p] of Object.entries(pos)) {
      const c = byTable[t]; if (!c) continue;
      c.dataset.cx = p.x.toFixed(1);
      c.dataset.cy = p.y.toFixed(1);
      c.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
    }
    rewriteEdges();
  });
}

sliders.forEach(s => {
  s.addEventListener('input', () => {
    outOf(s.dataset.param).textContent = fmtSlider(s.dataset.param, Number(s.value));
    resimular(ITERS_PREVIEW);
  });
  // solta o slider: simulacao completa, resultado final estavel
  s.addEventListener('change', () => resimular(Number(D.opts.iters) || 2000));
});

document.getElementById('pcollapse').addEventListener('click', () => {
  const p = document.getElementById('panel');
  p.classList.toggle('collapsed');
  document.getElementById('pcollapse').textContent = p.classList.contains('collapsed') ? '+' : '–';
});
document.getElementById('pfitar').addEventListener('click', fit);
document.getElementById('preset').addEventListener('click', () => {
  for (const s of sliders) {
    const v = D.opts[s.dataset.param];
    s.value = v !== undefined ? v : s.min;
    outOf(s.dataset.param).textContent = fmtSlider(s.dataset.param, Number(s.value));
  }
  resimular(Number(D.opts.iters) || 2000);
});

// abre ajustado a janela
stage.addEventListener('dblclick', fit);
window.addEventListener('resize', fit);
fit();
`;

/** Slider do painel: id, rotulo, min, max, passo, valor inicial. */
const SLIDERS = [
  { id: 'kFk',      grp: 'Mola',      rot: 'dist. FK',        min: 120, max: 700, step: 10,   fmt: v => v + 'px' },
  { id: 'wMola',    grp: 'Mola',      rot: 'mola base',       min: 0,   max: 0.3, step: 0.005, fmt: v => v.toFixed(3) },
  { id: 'kOut',     grp: 'Mola',      rot: 'κ · OUT (emissor)', min: 0, max: 2,   step: 0.05,  fmt: v => '×' + v.toFixed(2) },
  { id: 'kBw',      grp: 'Mola',      rot: 'κ · betweenness', min: 0,   max: 4,   step: 0.05,  fmt: v => '×' + v.toFixed(2) },
  { id: 'wIrmaos',  grp: 'Grupo',     rot: 'irmãos',          min: 0,   max: 0.6, step: 0.01,  fmt: v => v.toFixed(2) },
  { id: 'wAncora',  grp: 'Grupo',     rot: 'âncora',          min: 0,   max: 0.6, step: 0.01,  fmt: v => v.toFixed(2) },
  { id: 'kGrupo',   grp: 'Grupo',     rot: 'dist. grupo',     min: 120, max: 700, step: 10,    fmt: v => v + 'px' },
  { id: 'vmax',     grp: 'Simulação', rot: 'vel. máx',        min: 10,  max: 160, step: 5,     fmt: v => v + 'px' },
  { id: 'maxDesloc',grp: 'Simulação', rot: 'desloc. máx',     min: 0,   max: 1200, step: 25,   fmt: v => v === 0 ? 'livre' : v + 'px' },
  { id: 'gap',      grp: 'Simulação', rot: 'folga',           min: 0,   max: 120, step: 2,     fmt: v => v + 'px' },
];

/** Painel recolhivel com os sliders do motor. */
function panelHtml() {
  const grupos = {};
  for (const s of SLIDERS) (grupos[s.grp] ||= []).push(s);
  const linhas = Object.entries(grupos).map(([g, ss]) => {
    const itens = ss.map(s => `    <div class="row">
      <label for="s_${s.id}">${esc(s.rot)}</label><output id="o_${s.id}"></output>
      <input type="range" id="s_${s.id}" data-param="${s.id}"
        min="${s.min}" max="${s.max}" step="${s.step}">
    </div>`).join('\n');
    return `  <div class="grp">${esc(g)}</div>\n${itens}`;
  }).join('\n');
  return `<div id="panel">
  <header><b>ajuste do layout</b><button id="pcollapse">–</button></header>
  <div id="pbody">
${linhas}
    <div class="acts">
      <button id="pfitar">ajustar</button>
      <button id="preset">reset</button>
    </div>
    <div class="note">Sliders re-simulam ao vivo. mesmo motor do CLI.</div>
  </div>
</div>`;
}

/** Texto do layout.js, com os `export` removidos, para rodar no browser. */
function motorJs() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(dir, 'layout.js'), 'utf8');
  return src.replace(/^export /gm, '');
}

/** Gera a pagina HTML completa (SVG + controles). */
export function renderHtml(model, pos, opts = {}) {
  const { svg, width, height } = renderSvg(model, pos, opts);
  const n = Object.keys(pos).length;
  const title = opts.title || 'dbview';

  // dados que o browser precisa para re-simular sem o CLI:
  // modelo, grupos, parametros iniciais e as metricas de grafo.
  const dados = {
    refs: model.refs.map(r => ({ child: r.child, parent: r.parent })),
    tables: Object.fromEntries(Object.entries(model.tables).map(([t, v]) => [t, { cols: v.cols.length, idx: (v.indexes || []).length }])),
    clusters: opts.clusters || {},
    opts: Object.fromEntries(Object.entries(opts.params || {}).filter(([, v]) => v !== undefined)),
    metricas: opts.metricas || { out: {}, bwNorm: {} },
  };
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ERD</title>
<style>${PAGE_CSS}</style></head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <span class="meta">${n} tabelas · ${model.refs.length} FKs · ${width}×${height}</span>
  <div class="zoom">
    <button id="zo">−</button><b id="zl">100%</b><button id="zi">+</button>
    <button id="zf">ajustar</button>
  </div>
  <button id="tt">tipos</button>
  <input id="q" placeholder="filtrar tabela…" autocomplete="off">
</header>
<div id="stage">${svg}</div>
${panelHtml()}
<script>window.__DBV__ = ${JSON.stringify(dados)};</script>
<script>${motorJs()}</script>
<script>${PAGE_JS}</script>
</body></html>`;
}
