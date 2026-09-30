#!/usr/bin/env node
// cli.js — entrada do dbview. Le um .dbml e faz o que a flag pedir.
//
//   dbview schema.dbml                 -> out.html (interativo)
//   dbview schema.dbml --out x.svg     -> SVG estatico
//   dbview schema.dbml --analyze       -> so a leitura estrutural
//   dbview schema.dbml --check         -> so as metricas do arranjo
//
// Flags de layout: --gap N  --iters N  --seed N  --hub N

import { readDbml } from './dbml.js';
import { analyze, formatAnalysis } from './analyze.js';
import { layout, layoutRanking, DEFAULTS, RANK_DEFAULTS } from './layout.js';
import { measure } from './measure.js';
import { graphMetrics } from './metrics.js';
import { renderSvg, renderHtml } from './render.js';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      if (['out', 'gap', 'iters', 'seed', 'hub', 'kout', 'kbw', 'vmax', 'desloc', 'algo', 'gapx', 'gapy'].includes(k)) a[k] = argv[++i];
      else a[k] = true;
    } else a._.push(t);
  }
  return a;
}

function help() {
  console.log(`dbview — le um schema DBML e desenha um ERD.

uso:
  dbview <schema.dbml> [opcoes]

opcoes:
  --out <arquivo>   saida (.html interativo, .svg estatico). padrao: out.html
  --analyze         mostra hubs, clusters e eixos, e sai
  --check           mostra as metricas do arranjo, e sai
  --algo <nome>     motor do arranjo: mola (padrao) ou ranking
  --gap <px>        folga minima entre cards (padrao 26)
  --gapx <px>       --algo ranking: folga horizontal (padrao 40)
  --gapy <px>       --algo ranking: folga vertical entre camadas (padrao 90)
  --iters <n>       iteracoes da simulacao (padrao 2000)
  --seed <n>        semente do layout (padrao 7)
  --hub <n>         quantos hubs ancoram o desenho (padrao 4)
  --kout <f>        multiplicador da forca por OUT (emissor puxa). padrao 0
  --kbw <f>         multiplicador da forca por betweenness (ponte puxa). padrao 0
  --vmax <px>       velocidade maxima por iteracao (padrao 55)
  --desloc <px>     deslocamento maximo desde a origem. 0 = sem teto
  --help            esta ajuda

converter SQL -> DBML:
  npx -y -p @dbml/cli sql2dbml --mysql schema.sql -o schema.dbml`);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a._.length) { help(); return a.help ? 0 : 1; }

  const path = a._[0];
  const model = await readDbml(path);

  if (a.analyze) {
    console.log(formatAnalysis(analyze(model, { hubN: Number(a.hub) || 4 })));
    return 0;
  }

  const an = analyze(model);
  const opt = {
    gap: a.gap !== undefined ? Number(a.gap) : undefined,
    iters: a.iters !== undefined ? Number(a.iters) : undefined,
    seed: a.seed !== undefined ? Number(a.seed) : undefined,
    hubN: a.hub !== undefined ? Number(a.hub) : undefined,
    kOut: a.kout !== undefined ? Number(a.kout) : undefined,
    kBw: a.kbw !== undefined ? Number(a.kbw) : undefined,
    vmax: a.vmax !== undefined ? Number(a.vmax) : undefined,
    maxDesloc: a.desloc !== undefined ? Number(a.desloc) : undefined,
    gapX: a.gapx !== undefined ? Number(a.gapx) : undefined,
    gapY: a.gapy !== undefined ? Number(a.gapy) : undefined,
  };
  for (const k of Object.keys(opt)) if (opt[k] === undefined) delete opt[k];

  // metricas de grafo: IN/OUT (analyze.degrees) e betweenness normalizada
  const gm = graphMetrics(model);
  const metricas = { in: {}, out: {}, bwNorm: {} };
  for (const t of Object.keys(model.tables)) {
    metricas.in[t] = an.degrees[t].in;
    metricas.out[t] = an.degrees[t].out;
    metricas.bwNorm[t] = gm[t] ? gm[t].bwNorm : 0;
  }

  const algo = a.algo || 'mola';
  const { pos, hubs } = algo === 'ranking'
    ? layoutRanking(model, opt)
    : layout(model, an.clusters, opt, metricas);
  // folga efetiva do arranjo: o gap que o motor foi mandado respeitar
  const gapEfetivo = opt.gap !== undefined ? opt.gap : DEFAULTS.gap;
  const m = measure(model, pos, gapEfetivo);
  const realOverlaps = m.overlaps.length;

  if (a.check) {
    console.log(`tabelas: ${an.stats.tables} · colunas: ${an.stats.cols} · FKs: ${an.stats.refs}`);
    console.log(`hubs ancorados: ${hubs.join(', ')}`);
    console.log(`razao relacionados/nao-relacionados: ${m.ratio.razao.toFixed(3)}`);
    console.log(`  distancia media relacionados:  ${m.ratio.distRel.toFixed(1)} px`);
    console.log(`  distancia media sem relacao:   ${m.ratio.distNao.toFixed(1)} px`);
    console.log(`Spearman(hub, perto do centro): ${m.hubCentrality.toFixed(2)}`);
    console.log(`hierarquia (pai acima do filho): ${(m.hierarchy.score * 100).toFixed(0)}% `
      + `(${m.hierarchy.certas}/${m.hierarchy.total})`
      + (m.hierarchy.mediaErro ? ` · erro medio ${m.hierarchy.mediaErro.toFixed(0)} px` : ''));
    console.log(`sobreposicoes: ${realOverlaps}`);
    return realOverlaps ? 1 : 0;
  }

  const out = a.out || 'out.html';
  const title = basename(path).replace(/\.dbml$/i, '');
  const corpo = out.toLowerCase().endsWith('.svg')
    ? renderSvg(model, pos, { title }).svg
    : renderHtml(model, pos, {
        title,
        clusters: an.clusters,
        metricas,
        params: { ...DEFAULTS, ...opt },
      });
  await writeFile(out, corpo, 'utf8');

  console.log(`escrito: ${out}`);
  console.log(`  ${an.stats.tables} tabelas · ${an.stats.cols} colunas · ${an.stats.refs} FKs`);
  console.log(`  razao ${m.ratio.razao.toFixed(3)} · sobreposicoes ${realOverlaps} · `
    + `Spearman ${m.hubCentrality.toFixed(2)} · `
    + `hierarquia ${(m.hierarchy.score * 100).toFixed(0)}%`);
  return realOverlaps ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => {
  console.error('erro:', e.message);
  process.exit(2);
});
