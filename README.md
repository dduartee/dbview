# dbview

Lê um schema DBML e desenha um ERD interativo.

Behavior: entrada DBML, saída SVG ou HTML. Um arquivo, zero runtime.

## Quick start

```sh
git clone <este repo> && cd dbview
node src/cli.js sample/schema.dbml --out out.html
```

Sem build, sem install, sem config. Só Node >= 20.

## Uso

```sh
# desenhar (abre out.html no navegador)
node src/cli.js schema.dbml --out out.html

# só o SVG estático
node src/cli.js schema.dbml --out out.svg

# só analisar: hubs, eixos, clusters, graus
node src/cli.js schema.dbml --analyze

# medir um desenho: razão, overlap, Spearman, hierarquia
node src/cli.js schema.dbml --check
```

### SQL → DBML

Uma vez, offline, com o parser oficial:

```sh
npx -y -p @dbml/cli sql2dbml --mysql schema.sql -o schema.dbml
```

### Flags de layout

```
--algo mola|ranking   motor: forças (padrão) ou camadas
--gap N               folga mínima entre cards (padrão 26)
--gapx N  --gapy N    folga horizontal / vertical no ranking
--kout N  --kbw N     multiplicadores de força por grau
--iters N  --seed N   simulação: passos e semente
--hub N               quantos hubs ancoram o desenho
```

## O que faz

Quatro trabalhos, uma ferramenta:

| trabalho | entrega |
|---|---|
| **ver** | DBML → ERD (SVG ou HTML interativo) |
| **entender** | hubs, eixos, clusters, graus, betweenness |
| **arrumar** | posições pelo motor de layout |
| **medir** | razão, sobreposição, Spearman, hierarquia |

Dois motores de layout:

- **mola** — forças por FK + grupos + colisão AABB. Bom para grafos densos.
- **ranking** — camadas (Sugiyama simplificado). Pai sempre acima do filho.

## Estrutura

```
src/
  cli.js        entrada, flags, orquestra
  dbml.js       .dbml -> modelo interno
  analyze.js    graus, hubs, clusters, eixos
  metrics.js    betweenness, articulação, clustering
  measure.js    razão, Spearman, sobreposição, hierarquia
  layout.js     mola + ranking (motor único, inlineado no HTML)
  render.js     SVG + HTML interativo
```

O motor (`layout.js`) é injetado no HTML gerado: o painel de sliders
re-simula no navegador com o mesmo código que a CLI usa.

## Filosofia

Sem bloat: feature sim, excesso não. Constraints em `CONSTRAINTS.md`.

- 1 arquivo por responsabilidade
- JS puro primeiro, stdlib antes de lib
- flags na linha de comando, não arquivo de config
- 0 dependências em runtime

## Limites conhecidos

- arestas longas no ranking (sem dummy nodes): uma FK pode saltar camadas
- sem testes automatizados

## Licença

MIT.
