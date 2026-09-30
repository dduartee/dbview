# dbview

Lê um schema DBML e desenha um ERD interativo.

## O que faz

Quatro trabalhos, uma ferramenta:

| trabalho | o que entrega |
|---|---|
| **ver** | lê DBML → desenha o ERD |
| **entender** | mostra hubs, eixos, clusters, graus |
| **arrumar** | calcula posições boas sozinho |
| **exportar** | grava SVG (estático) ou HTML (interativo) |

## Uso

```sh
# SQL -> DBML (usa o @dbml/cli, uma vez, offline)
npx -y -p @dbml/cli sql2dbml --mysql schema.sql -o schema.dbml

# desenhar
node src/cli.js schema.dbml --out out.html

# só analisar
node src/cli.js schema.dbml --analyze

# só medir um desenho existente
node src/cli.js schema.dbml --check
```

## Filosofia

Sem bloat: feature sim, excesso não. Ver `CONSTRAINTS.md`.

- 1 arquivo por responsabilidade
- stdlib/JS puro primeiro
- flags de linha de comando, não arquivo de config
- 1 dependência direta (`@dbml/cli`), nenhuma em runtime

## Estrutura

```
src/
  cli.js        entrada, flags, orquestra
  dbml.js       lê .dbml -> modelo interno
  analyze.js    graus, hubs, clusters, eixos
  measure.js    razão, Spearman, sobreposição
  layout.js     motor de posições (mola + grupo + colisão AABB)
  render.js     SVG + HTML interativo
sample/
  ctrlanimal.dbml   caso de teste real
```

## Licença

A definir.
