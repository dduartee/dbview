# dbview

Lê um schema DBML e desenha um ERD interativo.

Behavior: entrada DBML, saída SVG ou HTML. Um arquivo, sem build.

## Motivação

O [dbdiagram.io](https://dbdiagram.io) é prático: você cola um DBML e ele
desenha o ERD na hora. Duas coisas incomodam:

1. **Não é localhost.** Seu schema vai para o servidor deles.
2. **Sem build próprio.** Você fica preso ao editor deles.

O dbview faz o mesmo trabalho — DBML entra, ERD sai — mas roda **na sua
máquina**, guarda o arquivo que quiser e não manda schema pra ninguém.

O que o dbview **não** faz, e nem pretende:

- editar DBML no navegador (o arquivo é a fonte; use seu editor)
- colaboração em tempo real
- conta, login, nuvem, histórico

Interatividade sim (zoom, pan, arrastar, sliders); servidor não.

## Quick start

```sh
git clone <este repo> && cd dbview
node src/cli.js sample/schema.dbml --out out.html
```

Sem build, sem install, sem config. Só Node >= 20.

Dá para instalar como comando (`npm link`), aí vira `dbview schema.dbml --out out.html`.

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

### SQL → DBML (opcional)

O dbview só lê DBML. Se sua fonte é SQL, converta antes — detalhes e
alternativas na seção [Dependências](#dependências).

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

## Dependências

Sem `node_modules`, sem lockfile, sem `npm install`.

**O núcleo** (DBML → ERD → SVG/HTML) tem **zero dependências**: só Node >= 20
e os módulos internos. Importa apenas `node:fs`, `node:path`, `node:url`.

**A entrada é DBML. Ponto.** O dbview não lê SQL, MySQL, Postgres nem nada
além de `.dbml`. Se você já tem o `.dbml`, nenhuma ferramenta externa entra.

### Converter SQL → DBML (opcional, sua escolha)

O dbview **não converte SQL**. Isso é um passo separado, que você faz **antes**
de usar a ferramenta — com a ferramenta que quiser:

- **recomendado:** `@dbml/cli` (parser oficial da linguagem DBML)
- ou qualquer outra que produza DBML válido

```sh
# recomendado: parser oficial, avulso, nunca é dependência do dbview
npx -y -p @dbml/cli sql2dbml --mysql schema.sql -o schema.dbml
```

O `npx` baixa o pacote na hora e não instala nada no projeto. Depois disso o
dbview roda 100% offline. Se preferir, instale o `@dbml/cli` do jeito que
quiser — é decisão sua, não requisito nosso.

### O HTML gerado

Self-contained: CSS inline, JS inline, fontes do sistema, SVG embutido.
Abre offline, num pendrive, em qualquer navegador. Não busca nada na rede.
O SVG estático nem JS precisa.

### Por que não usar lib

| lib recusada | o que faria | por que não |
|---|---|---|
| d3 | layout + força | ~300 KB para 2 forças e colisão AABB (~150 LOC) |
| react/vue/svelte | interface | página estática; DOM direto basta |
| electron | app desktop | HTML puro abre no navegador sem runtime |
| express | servir | geramos arquivo, não servimos |
| typescript | tipos | transpilação proibida; JSDoc cobre |

Critério: uma lib entra se **paga sua complexidade**. Nenhuma pagou.

## Filosofia

Sem bloat: feature sim, excesso não. Constraints em `CONSTRAINTS.md`.

- 1 arquivo por responsabilidade
- stdlib antes de lib; JS puro primeiro
- flags na linha de comando, não arquivo de config

## Limites conhecidos

- arestas longas no ranking (sem dummy nodes): uma FK pode saltar camadas
- sem testes automatizados

## Licença

MIT.
