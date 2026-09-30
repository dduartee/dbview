// dbml.js — le .dbml e devolve o modelo interno.
//
// Modelo (o contrato que o resto do dbview consome):
//   {
//     tables: { Nome: { cols: [{name, type, pk, unique, notNull, default}],
//                       indexes: [{cols, unique, name}],
//                       pk: [nomes de coluna] } },
//     refs:   [{ name, parent, parentCols, child, childCols,
//                onDelete, onUpdate }]
//   }
//
// Orientacao das refs no DBML: no lado esquerdo do `<?` fica o PAI,
// no lado direito fica o FILHO. O `<?` le "muitos -> um".
//   Ref "fk":"Pai"."a" <? "Filho"."b"   ->   Filho.b referencia Pai.a

const RE_TABLE = /^Table\s+(?:"([^"]+)"|(\w+))\s*(?:as\s+\w+)?\s*\{/;
const RE_REF = /^Ref\s*(?:"([^"]+)"|(\w+))?\s*:\s*(.+?)\s*(?:\<?\s*)\s*$/;

/**
 * Quebra uma linha de Ref em pai/filho.
 * Aceita os dois formatos do @dbml/cli:
 *   "Pai"."col" <? "Filho"."col"
 *   "Pai".("a", "b") <? "Filho".("a", "b")
 */
function parseRefLine(line) {
  const arrow = line.includes('<?') ? '<' : line.includes('>') ? '>' : '-';
  const [left, right] = line.split(/<[?>]|--|-|[<>]/).map(s => s.trim());
  if (!left || !right) return null;

  const side = (s) => {
    const m = s.match(/^(?:"([^"]+)"|(\w[\w$]*))\s*\.\s*(?:\(([^)]*)\)|"([^"]+)"|(\w[\w$]*))/);
    if (!m) return null;
    const cols = m[3]
      ? m[3].split(',').map(c => c.trim().replace(/"/g, '')).filter(Boolean)
      : [m[4] || m[5]];
    return { table: m[1] || m[2], cols };
  };

  const a = side(left);
  const b = side(right);
  if (!a || !b) return null;

  // `<` => esquerda e o pai. `>` => esquerda e o filho.
  const [parent, child] = arrow === '>' ? [b, a] : [a, b];
  return { parent, child };
}

/**
 * Extrai os [pk, not null, unique, default: X] de uma linha de coluna.
 */
function parseColAttrs(attrs) {
  const out = { pk: false, unique: false, notNull: false, default: null, increment: false };
  if (!attrs) return out;
  for (const raw of attrs.split(',')) {
    const a = raw.trim();
    if (a === 'pk') out.pk = true;
    else if (a === 'unique') out.unique = true;
    else if (a === 'not null') out.notNull = true;
    else if (a === 'increment') out.increment = true;
    else if (a.startsWith('default')) {
      const d = a.slice(8).replace(/[:=]/, '').trim().replace(/^`|`$/g, '');
      out.default = d || null;
    }
  }
  return out;
}

/**
 * Le um texto DBML e devolve o modelo interno.
 * Nao e um parser completo do DBML: cobre Table, colunas, Indexes e Ref,
 * que e tudo que um ERD precisa. Nomes entre aspas ou nus.
 */
export function parseDbml(text) {
  const tables = {};
  const refs = [];
  const lines = text.split(/\r?\n/);

  let cur = null;        // tabela sendo lida
  let inIndexes = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // inicio de tabela
    const mt = line.match(RE_TABLE);
    if (mt) {
      const name = mt[1] || mt[2];
      cur = { cols: [], indexes: [], pk: [] };
      tables[name] = cur;
      inIndexes = false;
      continue;
    }

    if (!cur) continue;

    // fim de tabela
    if (line === '}') { cur = null; inIndexes = false; continue; }

    // bloco Indexes {
    if (/^Indexes\s*\{/.test(line)) { inIndexes = true; continue; }
    if (inIndexes && line === '}') { inIndexes = false; continue; }

    if (inIndexes) {
      // (a, b) [pk]   |   col [unique, name: "x"]
      const m = line.match(/^\(?([^)\[]+?)\)?\s*\[(.*)\]\s*,?$/);
      if (!m) continue;
      const cols = m[1].split(',').map(c => c.trim().replace(/"/g, '')).filter(Boolean);
      const attrs = m[2];
      const unique = /\bunique\b/.test(attrs);
      const isPk = /\bpk\b/.test(attrs);
      const nm = attrs.match(/name:\s*"([^"]+)"/);
      if (isPk) cur.pk = cols;
      else cur.indexes.push({ cols, unique, name: nm ? nm[1] : null });
      continue;
    }

    // coluna: "nome" TIPO [attrs]   |   nome TIPO [attrs]
    const mc = line.match(/^(?:"([^"]+)"|(\w[\w$]*))\s+([^\[]*?)\s*(?:\[(.*)\])?\s*,?$/);
    if (mc) {
      const attrs = parseColAttrs(mc[4] || '');
      const col = {
        name: mc[1] || mc[2],
        type: mc[3].trim(),
        pk: attrs.pk,
        unique: attrs.unique,
        notNull: attrs.notNull,
        increment: attrs.increment,
        default: attrs.default,
      };
      cur.cols.push(col);
      if (col.pk) cur.pk.push(col.name);
      continue;
    }
  }

  // refs: linhas fora de tabela
  for (const raw of lines) {
    const line = raw.trim();
    const mr = line.match(RE_REF);
    if (!mr) continue;
    const name = mr[1] || mr[2];
    const body = mr[3];
    const parsed = parseRefLine(body);
    if (!parsed) continue;
    const onDelete = (body.match(/delete:\s*(\w+)/) || [])[1] || null;
    const onUpdate = (body.match(/update:\s*(\w+)/) || [])[1] || null;
    refs.push({
      name,
      parent: parsed.parent.table,
      parentCols: parsed.parent.cols,
      child: parsed.child.table,
      childCols: parsed.child.cols,
      onDelete,
      onUpdate,
    });
  }

  // descarta refs cuja tabela nao existe no schema (FK orfa: DBML incompleto
  // ou Ref apontando para fora). Sem isso, os modulos de analise recebem
  // arestas penduradas e quebram.
  const validas = refs.filter(r => tables[r.parent] && tables[r.child]);

  return { tables, refs: validas };
}

/** Le um arquivo .dbml do disco. */
export async function readDbml(path) {
  const { readFile } = await import('node:fs/promises');
  return parseDbml(await readFile(path, 'utf8'));
}
