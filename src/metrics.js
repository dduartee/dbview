// metrics.js — metricas de grafo usadas pelo layout e pela analise.
//
// betweenness  quantos caminhos minimos passam por um no. Mede "ponte":
//              quanto maior, mais o no articula partes do schema.
// articulacao  no cuja remocao divide o grafo em 2+ partes.
// clustering   fracao dos vizinhos de um no que sao vizinhos entre si.
//              1.0 = o no e um dos vertices de um triangulo fechado
//              (tipico de folha de cadeia), ~0 = e uma ponte.
//
// `excluir` remove um no do calculo. Serve para descartar o funil de
// tenancy (Cliente), que infla o IN de quase toda tabela e nao diz nada
// sobre o dominio.

/** Lista de adjacencia nao-direcionada, a partir das refs. */
export function adjacency(model, excluir = []) {
  const fora = new Set(excluir);
  const adj = {};
  for (const t of Object.keys(model.tables)) if (!fora.has(t)) adj[t] = new Set();
  for (const r of model.refs) {
    if (r.child === r.parent) continue;
    if (!adj[r.child] || !adj[r.parent]) continue;
    adj[r.child].add(r.parent);
    adj[r.parent].add(r.child);
  }
  return adj;
}

/** Betweenness centrality (algoritmo de Brandes, nao-ponderado). */
export function betweenness(adj) {
  const nodes = Object.keys(adj);
  const CB = {};
  for (const v of nodes) CB[v] = 0;

  for (const s of nodes) {
    const S = [], P = {}, sigma = {}, d = {};
    for (const v of nodes) { P[v] = []; sigma[v] = 0; d[v] = -1; }
    sigma[s] = 1; d[s] = 0;
    const Q = [s];
    while (Q.length) {
      const v = Q.shift();
      S.push(v);
      for (const w of adj[v]) {
        if (d[w] < 0) { d[w] = d[v] + 1; Q.push(w); }
        if (d[w] === d[v] + 1) { sigma[w] += sigma[v]; P[w].push(v); }
      }
    }
    const delta = {};
    for (const v of nodes) delta[v] = 0;
    while (S.length) {
      const w = S.pop();
      for (const v of P[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) CB[w] += delta[w];
    }
  }
  for (const v of nodes) CB[v] /= 2;
  return CB;
}

/** Pontos de articulacao (Tarjan). */
export function articulacoes(adj) {
  const disc = {}, low = {}, ap = new Set();
  let t = 0;
  const dfs = (u, parent) => {
    disc[u] = low[u] = ++t;
    let filhos = 0;
    for (const v of adj[u]) {
      if (v === parent) continue;
      if (disc[v] === undefined) {
        filhos++;
        dfs(v, u);
        low[u] = Math.min(low[u], low[v]);
        if (parent !== null && low[v] >= disc[u]) ap.add(u);
      } else {
        low[u] = Math.min(low[u], disc[v]);
      }
    }
    if (parent === null && filhos > 1) ap.add(u);
  };
  for (const v of Object.keys(adj)) if (disc[v] === undefined) dfs(v, null);
  return ap;
}

/** Coeficiente de agrupamento local de cada no. */
export function clustering(adj) {
  const out = {};
  for (const v of Object.keys(adj)) {
    const nb = [...adj[v]];
    if (nb.length < 2) { out[v] = 0; continue; }
    let lig = 0;
    for (let i = 0; i < nb.length; i++)
      for (let j = i + 1; j < nb.length; j++)
        if (adj[nb[i]].has(nb[j])) lig++;
    out[v] = (2 * lig) / (nb.length * (nb.length - 1));
  }
  return out;
}

/**
 * Leitura de grafo completa, com o funil de tenancy removido.
 * Devolve o peso de "ancoragem" de cada tabela, normalizado em [0,1].
 */
export function graphMetrics(model, excluir = ['Cliente']) {
  const adj = adjacency(model, excluir);
  const bw = betweenness(adj);
  const cl = clustering(adj);
  const art = articulacoes(adj);
  const maxBw = Math.max(1e-9, ...Object.values(bw));

  const pesos = {};
  for (const t of Object.keys(adj)) {
    pesos[t] = {
      bw: bw[t],
      bwNorm: bw[t] / maxBw,
      clustering: cl[t],
      articulacao: art.has(t),
      grau: adj[t].size,
    };
  }
  return pesos;
}
