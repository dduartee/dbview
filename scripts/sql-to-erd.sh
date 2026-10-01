#!/usr/bin/env bash
# sql-to-erd — um comando para ir de SQL (ou DBML) até o ERD.
#
#   sql-to-erd schema.sql                  # converte, desenha, abre
#   sql-to-erd schema.sql saida.html       # escolhendo a saída
#   sql-to-erd schema.dbml                 # já é DBML: só desenha
#   sql-to-erd -d postgres schema.sql      # outro dialeto
#   sql-to-erd -n schema.sql               # não abre o navegador
#
# Sem perguntas, sem config. Saída padrão: <entrada>.html ao lado da entrada.
# O .dbml intermediário fica ao lado do .sql e é reusado se mais novo.

set -euo pipefail

usage() {
  cat <<'EOF'
uso: sql-to-erd [-d dialeto] [-n] <schema.sql|schema.dbml> [saida.html|saida.svg]

  -d, --dialect  dialeto do .sql: mysql (padrão), postgres, mssql, oracle
  -n, --no-open  não abre o navegador
  saída padrão   <entrada>.html ao lado da entrada
EOF
  exit "${1:-0}"
}

DBVIEW_HOME="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
CLI="$DBVIEW_HOME/src/cli.js"
[[ -f "$CLI" ]] || { echo "erro: nao achei $CLI (este script vive dentro do repo dbview)" >&2; exit 1; }

DIALECT=mysql; OPEN=1; IN=""; OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--dialect) DIALECT="${2:?falta o dialeto}"; shift 2;;
    -n|--no-open) OPEN=0; shift;;
    -h|--help) usage 0;;
    -*) echo "flag desconhecida: $1 (veja sql-to-erd --help)" >&2; exit 2;;
    *) if [[ -z "$IN" ]]; then IN="$1"
       elif [[ -z "$OUT" ]]; then OUT="$1"
       else echo "argumento demais: $1" >&2; exit 2; fi
       shift;;
  esac
done
[[ -n "$IN" ]] || usage 2
IN="${IN/#\~/$HOME}"; OUT="${OUT/#\~/$HOME}"
[[ -f "$IN" ]] || { echo "erro: nao achei $IN" >&2; exit 1; }
IN="$(readlink -f "$IN")"

case "$IN" in
  *.dbml) DBML="$IN";;
  *.sql)
    DBML="${IN%.*}.dbml"
    if [[ -f "$DBML" && "$DBML" -nt "$IN" ]]; then
      echo "dbml: reusando $DBML (mais novo que o .sql)"
    else
      echo "dbml: convertendo $IN ($DIALECT) -> $DBML"
      # roda num temp para o dbml-error.log do @dbml/cli nascer lá, não no cwd
      TMPD="$(mktemp -d)"
      DBMLABS="$(readlink -f "$DBML" 2>/dev/null || printf '%s' "$DBML")"
      (cd "$TMPD" && npx -y -p @dbml/cli sql2dbml "--$DIALECT" "$IN" -o "$DBMLABS")
      rm -rf "$TMPD"
    fi
    ;;
  *) echo "erro: a entrada deve ser .sql ou .dbml (recebi: $IN)" >&2; exit 2;;
esac

[[ -n "$OUT" ]] || OUT="${DBML%.*}.html"
node "$CLI" "$DBML" --out "$OUT"

# privacidade: schema/saída dentro de repo git e fora do .gitignore?
for f in "$DBML" "$OUT"; do
  fabs="$(readlink -f "$f" 2>/dev/null || printf '%s' "$f")"
  root="$(git -C "$(dirname "$fabs")" rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$root" ]] || continue
  rel="${fabs#"$root"/}"
  git -C "$root" check-ignore -q -- "$rel" \
    || echo "aviso: $rel nao esta no .gitignore de $root (schema de cliente nao se versiona)"
done

echo "erd: $OUT"
if (( OPEN )); then
  OUTABS="$(readlink -f "$OUT")"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "file://$OUTABS" >/dev/null 2>&1 &
  fi
fi
