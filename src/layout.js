// layout.js — calcula posicoes para os cards do ERD.
//
// Motor unico: uma so simulacao, tres forcas que nao brigam.
//   1. mola por FK            -> relacionados ficam perto
//   2. restricao de grupo     -> irmaos do mesmo pai ficam lado a lado
//   3. colisao AABB           -> nenhum card invade outro
//
// Sem repulsao global e sem gravidade para o centro: as duas dominavam
// a mola e produziam razao ~0.95 (relacionados tao longe quanto os outros).
// Aqui a distancia entre dois cards e governada pela topologia.

export const DEFAULTS = {
  cardW: 260,
  headerH: 34,
  rowH: 20,
  padBottom: 10,
  gap: 26,
  iters: 2000,
  seed: 7,
  hubN: 4,
  kFk: 340,          // distancia-alvo de uma FK, px
  kGrupo: 380,       // distancia-alvo de um membro ao seu ancora
  wMola: 0.06,       // peso da mola de FK
  wMolaMult: 0.5,    // reforco extra no lado do filho
  wIrmaos: 0.14,     // peso irmao<->irmao dentro do grupo
  wAncora: 0.13,     // peso membro<->ancora
  kOut: 0.0,         // multiplicador da forca por OUT  (emissor puxa)
  kBw: 0.0,          // multiplicador da forca por betweenness (ponte puxa)
  maxDesloc: 0,      // 0 = sem teto; senao limita a distancia da posicao inicial
  damp: 0.72,
  vmax: 55,
  decai: 0.9965,
  alphaMin: 0.03,
};

/** PRNG deterministico (mulberry32). Mesma seed => mesmo desenho. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tamanho do card de cada tabela, em px.
 * A altura cresce com o numero de linhas (colunas + indices + titulo).
 */
export function cardSizes(model, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const out = {};
  for (const [name, t] of Object.entries(model.tables)) {
    const linhas = t.cols.length + t.indexes.length;
    out[name] = {
      w: o.cardW,
      h: o.headerH + linhas * o.rowH + o.padBottom,
    };
  }
  return out;
}

/** Adjacencia: refs validas (sem auto-referencia). */
function edgesOf(model) {
  return model.refs.filter(r =>
    r.child !== r.parent &&
    model.tables[r.child] && model.tables[r.parent]);
}

/**
 * Mapa membro -> ancora, a partir dos clusters.
 * Um membro de cluster segue o pai compartilhado.
 */
function ancoraDe(clusters) {
  const m = {};
  for (const [anc, membros] of Object.entries(clusters))
    for (const x of membros) m[x] = anc;
  return m;
}

/**
 * Resolve colisoes AABB. Cada card acumula os empurroes de TODOS os pares
 * e se move uma vez por rodada — mover dentro do laco fazia um card cercado
 * oscilar entre vizinhos e nunca convergir.
 * Cards em `fixed` nao se movem.
 */
function resolveColisao(P, sizes, names, fixed, gap, rodadas = 4) {
  for (let r = 0; r < rodadas; r++) {
    const dx = {}, dy = {};
    for (const t of names) { dx[t] = 0; dy[t] = 0; }

    for (let i = 0; i < names.length; i++) {
      const a = names[i];
      for (let j = i + 1; j < names.length; j++) {
        const b = names[j];
        const aw = sizes[a].w, ah = sizes[a].h;
        const bw = sizes[b].w, bh = sizes[b].h;
        const ax = P[a].x - aw / 2, ay = P[a].y - ah / 2;
        const bx = P[b].x - bw / 2, by = P[b].y - bh / 2;
        const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx) + gap;
        const oy = Math.min(ay + ah, by + bh) - Math.max(ay, by) + gap;
        if (ox <= 0 || oy <= 0) continue;
        const af = fixed.has(a), bf = fixed.has(b);
        if (af && bf) continue;

        let move;                      // [quanto-a-move, quanto-b-move] num eixo
        if (ox < oy) {                 // separa na horizontal
          const s = (P[a].x >= P[b].x ? 1 : -1) * ox;
          move = af ? [0, -s] : bf ? [s, 0] : [s / 2, -s / 2];
          dx[a] += move[0]; dx[b] += move[1];
        } else {                       // separa na vertical
          const s = (P[a].y >= P[b].y ? 1 : -1) * oy;
          move = af ? [0, -s] : bf ? [s, 0] : [s / 2, -s / 2];
          dy[a] += move[0]; dy[b] += move[1];
        }
      }
    }

    for (const t of names) {
      if (fixed.has(t)) continue;
      P[t].x += dx[t];
      P[t].y += dy[t];
    }
  }
}

/**
 * Arranja os cards. Devolve { tabela: {x, y, w, h} } no primeiro quadrante.
 */
export function layout(model, clusters = {}, opt = {}, metricas = {}) {
  const o = { ...DEFAULTS, ...opt };
  const met = {
    out: metricas.out || null,          // { tabela: OUT }
    in: metricas.in || null,            // { tabela: IN  }
    bwNorm: metricas.bwNorm || null,    // { tabela: betweenness normalizada }
  };
  const sizes = cardSizes(model, o);
  const names = Object.keys(model.tables).sort();
  const edges = edgesOf(model);
  const rnd = rng(o.seed);

  // hubs = quem mais recebe FK; ficam fixos ancorando o desenho.
  // So o primeiro fica realmente preso: dois cards grandes fixos podem
  // se sobrepor sem que nenhuma forca possa separa-los.
  // in-degree: fonte unica quando o chamador injeta (met.in); senao calcula
  // local, para o motor rodar inline no browser sem import.
  const indeg = {};
  for (const t of names) indeg[t] = met.in ? (met.in[t] || 0) : 0;
  if (!met.in) for (const e of edges) indeg[e.parent]++;
  const hubs = [...names]
    .sort((a, b) => indeg[b] - indeg[a] || a.localeCompare(b))
    .slice(0, o.hubN);
  const fixed = new Set([hubs[0]]);

  const anc = ancoraDe(clusters);
  const pai1 = {};
  for (const e of edges) if (!(e.child in pai1)) pai1[e.child] = e.parent;

  // posicoes iniciais: hubs num circulo, o resto ao lado do seu pai/ancora
  const P = {};
  const R = 420;
  hubs.forEach((h, i) => {
    const a = (2 * Math.PI * i) / hubs.length;
    P[h] = { x: Math.cos(a) * R, y: Math.sin(a) * R };
  });
  for (const t of names) {
    if (P[t]) continue;
    const base = P[anc[t]] || P[pai1[t]] || P[hubs[0]] || { x: 0, y: 0 };
    const a = rnd() * 2 * Math.PI;
    P[t] = { x: base.x + Math.cos(a) * 300, y: base.y + Math.sin(a) * 300 };
  }

  const V = {};
  for (const t of names) V[t] = { x: 0, y: 0 };
  // copia das posicoes iniciais, para o teto de deslocamento
  const P0 = {};
  for (const t of names) P0[t] = { x: P[t].x, y: P[t].y };

  let alpha = 1;
  for (let it = 0; it < o.iters; it++) {
    const Fx = {}, Fy = {};
    for (const t of names) { Fx[t] = 0; Fy[t] = 0; }

    // 1) mola por FK
    for (const e of edges) {
      const c = e.child, p = e.parent;
      let dx = P[p].x - P[c].x, dy = P[p].y - P[c].y;
      const d = Math.hypot(dx, dy) || 1;
      // peso base; duas modulacoes opcionais, cada uma com seu coeficiente:
      //   kOut  -> forca x (1 + kOut * OUT)      "quem emite muito puxa"
      //   kBw   -> forca x (1 + kBw * bwNorm)    "quem e ponte puxa"
      const g = met.out ? met.out[c] || 0 : 0;
      const peso = o.wMola
        * (300 / Math.max(sizes[p].h, 120))
        * (1 + o.kOut * g)
        * (1 + o.kBw * (met.bwNorm ? met.bwNorm[c] || 0 : 0));
      const forc = (d - o.kFk) * peso;
      const fx = dx / d * forc, fy = dy / d * forc;
      Fx[c] += fx; Fy[c] += fy;
      Fx[p] -= fx; Fy[p] -= fy;
      Fx[c] += fx * o.wMolaMult; Fy[c] += fy * o.wMolaMult;
    }

    // 2) grupos: irmaos se atraem; cada um fica a kGrupo do ancora
    for (const [ancora, membros] of Object.entries(clusters)) {
      if (!P[ancora]) continue;
      const ms = membros.filter(m => P[m]);
      for (let i = 0; i < ms.length; i++) {
        for (let j = i + 1; j < ms.length; j++) {
          const a = ms[i], b = ms[j];
          let dx = P[b].x - P[a].x, dy = P[b].y - P[a].y;
          const d = Math.hypot(dx, dy) || 1;
          const forc = (d - (sizes[a].w + sizes[b].w) / 2 - 90) * o.wIrmaos;
          const fx = dx / d * forc, fy = dy / d * forc;
          Fx[a] += fx; Fy[a] += fy;
          Fx[b] -= fx; Fy[b] -= fy;
        }
      }
      for (const m of ms) {
        let dx = P[ancora].x - P[m].x, dy = P[ancora].y - P[m].y;
        const d = Math.hypot(dx, dy) || 1;
        const forc = (d - o.kGrupo) * o.wAncora;
        const fx = dx / d * forc, fy = dy / d * forc;
        if (!fixed.has(m)) { Fx[m] += fx; Fy[m] += fy; }
      }
    }

    // 3) integracao
    for (const t of names) {
      if (fixed.has(t)) { V[t].x = V[t].y = 0; continue; }
      V[t].x = (V[t].x + Fx[t] * alpha) * o.damp;
      V[t].y = (V[t].y + Fy[t] * alpha) * o.damp;
      const sp = Math.hypot(V[t].x, V[t].y);
      if (sp > o.vmax) { V[t].x *= o.vmax / sp; V[t].y *= o.vmax / sp; }
      P[t].x += V[t].x;
      P[t].y += V[t].y;
      // teto de deslocamento desde a posicao inicial (0 = sem teto)
      if (o.maxDesloc > 0) {
        const ddx = P[t].x - P0[t].x, ddy = P[t].y - P0[t].y;
        const dd = Math.hypot(ddx, ddy);
        if (dd > o.maxDesloc) {
          P[t].x = P0[t].x + ddx * o.maxDesloc / dd;
          P[t].y = P0[t].y + ddy * o.maxDesloc / dd;
          V[t].x = V[t].y = 0;
        }
      }
    }

    // 4) colisao, a cada 2 iteracoes
    if (it % 2 === 0) resolveColisao(P, sizes, names, fixed, o.gap);
    alpha = Math.max(alpha * o.decai, o.alphaMin);
  }

  // Colisao final: insiste ate zerar. Empurrao iterativo pode oscilar,
  // entao roda em blocos e repete enquanto houver sobreposicao real.
  // A checagem usa o mesmo gap da resolucao: "limpo" = separacao >= gap.
  const limpoComGap = () => {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j];
        const ax = P[a].x - sizes[a].w / 2, ay = P[a].y - sizes[a].h / 2;
        const bx = P[b].x - sizes[b].w / 2, by = P[b].y - sizes[b].h / 2;
        const ox = Math.min(ax + sizes[a].w, bx + sizes[b].w) - Math.max(ax, bx) + o.gap;
        const oy = Math.min(ay + sizes[a].h, by + sizes[b].h) - Math.max(ay, by) + o.gap;
        if (ox > 0.5 && oy > 0.5) return false;
      }
    }
    return true;
  };
  for (let tent = 0; tent < 40 && !limpoComGap(); tent++) {
    resolveColisao(P, sizes, names, fixed, o.gap, 40);
  }

  // normaliza para o primeiro quadrante com margem
  let minx = Infinity, miny = Infinity;
  for (const t of names) {
    minx = Math.min(minx, P[t].x - sizes[t].w / 2);
    miny = Math.min(miny, P[t].y - sizes[t].h / 2);
  }
  const M = o.gap;
  const out = {};
  for (const t of names) {
    out[t] = {
      x: P[t].x - sizes[t].w / 2 - minx + M,
      y: P[t].y - sizes[t].h / 2 - miny + M,
      w: sizes[t].w,
      h: sizes[t].h,
    };
  }
  return { pos: out, hubs };
}

/** Opcoes do layout em camadas (ranking / Sugiyama simplificado). */
export const RANK_DEFAULTS = { gapX: 40, gapY: 90, sweep: 4 };

/**
 * Layout em camadas (Sugiyama simplificado), o que dot/WhoDB/Cacoo usam.
 *
 * Passos:
 *   1. quebra ciclos        aresta que volta no DFS e ignorada no ranking
 *   2. ranking              longest-path: filho = pai + 1 camada
 *   3. ordenacao            mediana/barycenter na camada, cruza menos linhas
 *   4. posicao              Y por camada, X alinhado, colisao AABB
 *
 * Pai fica ACIMA do filho (rank menor = y menor). Devolve { pos, hubs, ranks }.
 */
export function layoutRanking(model, opt = {}) {
  const o = { ...DEFAULTS, ...RANK_DEFAULTS, ...opt };
  const names = Object.keys(model.tables).sort();
  const sizes = cardSizes(model, o);
  const edges = edgesOf(model);

  const succ = {}, pred = {};
  for (const t of names) { succ[t] = []; pred[t] = []; }
  for (const e of edges) { succ[e.parent].push(e.child); pred[e.child].push(e.parent); }

  // 1) quebra de ciclos
  const back = new Set(), state = {};
  const dfs = (u) => {
    state[u] = 1;
    for (const v of succ[u]) {
      const k = u + '>' + v;
      if (state[v] === 1) back.add(k);
      else if (!state[v]) dfs(v);
    }
    state[u] = 2;
  };
  for (const t of names) if (!state[t]) dfs(t);

  // 2) ranking: longest-path nas arestas nao-truncadas
  const rank = {};
  for (const t of names) rank[t] = 0;
  for (let pass = 0; pass < names.length; pass++) {
    let mudou = false;
    for (const e of edges) {
      if (back.has(e.parent + '>' + e.child)) continue;
      if (rank[e.child] < rank[e.parent] + 1) { rank[e.child] = rank[e.parent] + 1; mudou = true; }
    }
    if (!mudou) break;
  }

  // 3) agrupa e ordena dentro de cada camada
  const layers = {};
  for (const t of names) (layers[rank[t]] ||= []).push(t);
  const keys = Object.keys(layers).map(Number).sort((a, b) => a - b);
  const posIdx = {};
  for (const k of keys)
    layers[k].sort((a, b) => {
      const m = (x) => pred[x].length ? pred[x].reduce((s, p) => s + (posIdx[p] ?? 0), 0) / pred[x].length : 0;
      return m(a) - m(b) || a.localeCompare(b);
    }).forEach((t, i) => { posIdx[t] = i; });
  for (let s = 0; s < o.sweep; s++)
    for (const k of keys)
      layers[k].sort((a, b) => {
        const nb = (x) => (pred[x].length ? pred[x] : succ[x]);
        const m = (x) => { const l = nb(x);
          return l.length ? l.reduce((s2, p) => s2 + (posIdx[p] ?? 0), 0) / l.length : posIdx[x]; };
        return m(a) - m(b);
      }).forEach((t, i) => { posIdx[t] = i; });

  // 4) posiciona com centro em P (resolveColisao trabalha com centro)
  const P = {};
  const maxRow = Math.max(...keys.map(k => layers[k].length));
  const rowW = maxRow * (o.cardW + o.gapX);
  const stepY = o.headerH + 10 * o.rowH + o.padBottom + o.gapY;
  for (const k of keys) {
    const row = layers[k];
    const totalW = row.length * o.cardW + (row.length - 1) * o.gapX;
    let x = (rowW - totalW) / 2;
    for (const t of row) {
      P[t] = { x: x + sizes[t].w / 2, y: k * stepY };
      x += sizes[t].w + o.gapX;
    }
  }

  resolveColisao(P, sizes, names, new Set(), o.gap);

  // normaliza para o primeiro quadrante com margem
  let minx = Infinity, miny = Infinity;
  for (const t of names) {
    minx = Math.min(minx, P[t].x - sizes[t].w / 2);
    miny = Math.min(miny, P[t].y - sizes[t].h / 2);
  }
  const M = o.gap, out = {};
  for (const t of names) {
    out[t] = {
      x: P[t].x - sizes[t].w / 2 - minx + M,
      y: P[t].y - sizes[t].h / 2 - miny + M,
      w: sizes[t].w,
      h: sizes[t].h,
    };
  }
  // hubs = nos da camada 0 do ranking (raizes: ninguem aponta para eles).
  // Nao usa grau IN (a mola usa) — aqui "ancora" e a raiz hierarquica.
  const hubs = (layers[keys[0]] || []).slice().sort((a, b) => a.localeCompare(b));
  return { pos: out, hubs, ranks: rank, layers: keys.length };
}
