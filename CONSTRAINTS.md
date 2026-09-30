Projeto: dbview
Descrição: Lê um schema DBML e desenha um ERD interativo.
Nível: 2 (pragmático)

Constraints:
  max_lines_of_code: 1800
  max_dependencies_direct: 0        # @dbml/cli roda via npx, fora do runtime
  allowed_languages: [JavaScript]   # ESM, Node >= 20
  transpilation_allowed: false
  build_tool: none                  # roda direto com node

approved_packages:
  - name: "@dbml/cli"
    reason: Parser real, round-trip provado fiel. Só usado offline na conversão SQL->DBML.

rejected_packages:
  - name: electron
    reason: Bloat. HTML+JS puro abre no navegador sem runtime.
  - name: react
    reason: Framework para uma página estática. DOM direto basta.
  - name: vue
    reason: Mesmo motivo do react.
  - name: svelte
    reason: Mesmo motivo do react.
  - name: d3
    reason: Usamos 2 forças e colisão AABB. ~150 LOC próprias vencem 300KB de lib.
  - name: express
    reason: Geramos arquivo. Não precisamos servir nada.
  - name: typescript
    reason: Transpilação proibida. JSDoc dá o tipo quando importa.

Rationale: 4 trabalhos num só binário (ver, entender, arrumar, exportar).
           1800 LOC cobre leitor + analisador + layout (mola e ranking)
           + metricas de grafo + render + interação, todos em JS puro.
           Teto subiu de 1200 para 1800 em 2026-09-30: o motor de ranking
           (Sugiyama simplificado) e as métricas de grafo (betweenness,
           articulação) somaram ~500 LOC e são features reais, não bloat.
           Real hoje: ~1691 LOC.
