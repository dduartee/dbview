// analyze.js — le o modelo e devolve a leitura estrutural do schema.
//
// O que sai:
//   degrees  { tabela: {in, out} }         quantas FKs chegam / saem
//   hubs     [tabela...]                   quem mais recebe FKs
//   clusters { pai: [filhos...] }          irmaos que apontam para o mesmo pai
//   axes     [{root, chain:[...]}]         cadeias Tipo -> Instancia -> Uso
//   roots    [tabela...]                   sem pai (fora Cliente)
//   leaves   [tabela...]                   ninguem aponta para elas
//   sinks    [tabela...]                   sem FK de saida
//   stats    { tables, cols, refs, ... }   numeros do schema
//
// Toda leitura ignora auto-referencia (Animal -> Animal).
//
// O funil do Cliente (pai universal, nao informa topologia) e ignorado
// apenas por clusters, axes e roots (param ignoreRoot). degrees, hubs,
// leaves e sinks CONTAM o Cliente — por isso "Cliente IN=14" no resumo.

/** Grau de entrada (recebe) e saida (aponta) de cada tabela. */
export function degrees({ tables, refs }) {
  const d = {};
  for (const t of Object.keys(tables)) d[t] = { in: 0, out: 0 };
  for (const r of refs) {
    if (r.child === r.parent) continue;
    if (d[r.parent]) d[r.parent].in++;
    if (d[r.child]) d[r.child].out++;
  }
  return d;
}

/**
 * Hubs = tabelas ordenadas por quantas FKs recebem.
 * O hub e o centro do diagrama: e para onde as setas convergem.
 */
export function hubs(model, n = 4) {
  const d = degrees(model);
  return Object.keys(d)
    .sort((a, b) => d[b].in - d[a].in || a.localeCompare(b))
    .slice(0, n);
}

/**
 * Clusters = irmaos que apontam para o MESMO pai.
 * Ex.: Cor, Porte e Raca apontam so para TipoAnimal -> cluster de TipoAnimal.
 * Pai unico, 2+ filhos. Ignora Cliente (funil universal, nao e cluster real).
 */
export function clusters({ tables, refs }, ignoreRoot = 'Cliente') {
  const pais = {};                      // filho -> Set(pai)
  for (const t of Object.keys(tables)) pais[t] = new Set();
  for (const r of refs) {
    if (r.child === r.parent) continue;
    if (r.parent === ignoreRoot) continue;
    pais[r.child].add(r.parent);
  }
  const porPai = {};
  for (const [t, ps] of Object.entries(pais)) {
    if (ps.size !== 1) continue;        // so irmaos de pai unico
    const pai = [...ps][0];
    (porPai[pai] ||= []).push(t);
  }
  const out = {};
  for (const [pai, filhos] of Object.entries(porPai)) {
    if (filhos.length >= 2) out[pai] = filhos.sort();
  }
  return out;
}

/**
 * Eixos = cadeias Tipo -> Instancia -> ... -> Uso.
 * Desce do no enquanto ele tiver UM so filho nao visitado.
 *
 * Ordem importa: processa os nos em ordem topologica (poucos pais primeiro),
 * assim a cadeia longa (TipoAcaoManejo -> AcaoManejo -> Manejo) e encontrada
 * antes do seu sufixo curto (AcaoManejo -> Manejo). Nos ja cobertos por uma
 * cadeia anterior nao viram eixo proprio.
 */
export function axes(model, ignoreRoot = 'Cliente') {
  const { tables, refs } = model;
  const filhos = {};
  const nPais = {};
  for (const t of Object.keys(tables)) { filhos[t] = []; nPais[t] = 0; }
  for (const r of refs) {
    if (r.child === r.parent || r.parent === ignoreRoot) continue;
    filhos[r.parent].push(r.child);
    nPais[r.child]++;
  }

  const walk = (start) => {
    let cur = start;
    const chain = [start];
    while (true) {
      const fs = filhos[cur].filter(f => !chain.includes(f));
      if (fs.length !== 1) break;       // 0 = fim, 2+ = ramificou
      cur = fs[0];
      chain.push(cur);
    }
    return chain;
  };

  // Um no so inicia eixo se:
  //   (a) nao tem pai (raiz real, fora o funil), ou
  //   (b) seu unico pai tem 2+ filhos (ramificou).
  // Impede que o sufixo de uma cadeia (AcaoManejo -> Manejo) vire eixo
  // proprio quando o prefixo (TipoAcaoManejo -> AcaoManejo) ja existe.
  const pai1 = {};
  for (const r of refs) {
    if (r.child === r.parent || r.parent === ignoreRoot) continue;
    pai1[r.child] = r.parent;
  }
  const inicia = (t) => {
    const p = pai1[t];
    if (p === undefined) return true;
    return filhos[p].length >= 2;
  };

  const out = [];
  for (const t of Object.keys(tables)) {
    if (!inicia(t)) continue;
    const chain = walk(t);
    if (chain.length >= 2) out.push({ root: t, chain });
  }
  return out.sort((a, b) => b.chain.length - a.chain.length);
}

/** Raizes (sem pai, fora o funil). */
export function roots(model, ignoreRoot = 'Cliente') {
  const { tables, refs } = model;
  return Object.keys(tables).filter(t =>
    !refs.some(r => r.child === t && r.parent !== t && r.parent !== ignoreRoot));
}

/** Folhas (ninguem aponta para elas, fora o funil invertido). */
export function leaves(model) {
  const { tables, refs } = model;
  return Object.keys(tables).filter(t =>
    !refs.some(r => r.parent === t && r.child !== t));
}

/** Numeros crus do schema. */
export function stats(model) {
  const names = Object.keys(model.tables);
  return {
    tables: names.length,
    cols: names.reduce((s, t) => s + model.tables[t].cols.length, 0),
    refs: model.refs.length,
    refsSemCliente: model.refs.filter(r => r.parent !== 'Cliente' && r.child !== r.parent).length,
    pkComposta: names.filter(t => model.tables[t].pk.length > 1).length,
  };
}

/** Leitura completa em uma chamada. */
export function analyze(model, { hubN = 4, ignoreRoot = 'Cliente' } = {}) {
  return {
    stats: stats(model),
    degrees: degrees(model),
    hubs: hubs(model, hubN),
    clusters: clusters(model, ignoreRoot),
    axes: axes(model, ignoreRoot),
    roots: roots(model, ignoreRoot),
    leaves: leaves(model), 
  };
}

/** Formata a analise para o terminal. */
export function formatAnalysis(a) {
  const L = [];
  const s = a.stats;
  L.push(`schema: ${s.tables} tabelas · ${s.cols} colunas · ${s.refs} FKs `
    + `(${s.refsSemCliente} fora do funil Cliente) · ${s.pkComposta} PKs compostas`);
  L.push('');
  L.push('hubs (quem mais recebe FK):');
  for (const h of a.hubs) L.push(`  ${h.padEnd(20)} IN=${a.degrees[h].in}  OUT=${a.degrees[h].out}`);
  L.push('');
  L.push('clusters (irmaos do mesmo pai):');
  for (const [pai, filhos] of Object.entries(a.clusters))
    L.push(`  ${pai.padEnd(20)} -> [${filhos.join(', ')}]`);
  L.push('');
  L.push('eixos (cadeias Tipo -> Instancia -> Uso):');
  for (const ax of a.axes) L.push(`  ${ax.chain.join(' -> ')}`);
  L.push('');
  L.push(`raizes: ${a.roots.join(', ')}`);
  L.push(`folhas: ${a.leaves.join(', ')}`);
  return L.join('\n');
}
