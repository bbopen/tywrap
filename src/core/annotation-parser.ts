import type { PythonType } from '../types/index.js';

export interface AnnotationParserOptions {
  onUnknownTypeName?: (name: string) => void;
}

export function parseAnnotationToPythonType(
  annotation: unknown,
  options: AnnotationParserOptions = {}
): PythonType {
  const onUnknownTypeName = options.onUnknownTypeName;

  const unknownType = (): PythonType => ({ kind: 'custom', name: 'Any', module: 'typing' });

  const recordUnknown = (name: string): void => {
    try {
      onUnknownTypeName?.(name);
    } catch {
      // ignore diagnostics hooks
    }
  };

  const mapLiteral = (text: string): PythonType => {
    const t = text.trim();
    if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
      return { kind: 'literal', value: t.slice(1, -1) } as PythonType;
    }
    if (t === 'True' || t === 'False') {
      return { kind: 'literal', value: t === 'True' } as PythonType;
    }
    if (t === 'None') {
      return { kind: 'literal', value: null } as PythonType;
    }
    const num = Number(t);
    // Number('') is 0, so ensure we don't treat empty literals as numeric.
    if (t !== '' && !Number.isNaN(num)) {
      return { kind: 'literal', value: num } as PythonType;
    }
    return { kind: 'custom', name: t } as PythonType;
  };

  const mapSimpleName = (name: string): PythonType => {
    const n = name.replace(/^typing\./, '').trim();
    if (n === 'int' || n === 'float' || n === 'str' || n === 'bool' || n === 'bytes') {
      return { kind: 'primitive', name: n };
    }

    // Track unknown typing-ish names for diagnostics
    if (
      n === 'Any' ||
      n === 'Never' ||
      n === 'LiteralString' ||
      n === 'ClassVar' ||
      n === 'Final' ||
      n === 'TypeAlias' ||
      n === 'Required' ||
      n === 'NotRequired'
    ) {
      recordUnknown(n);
    }

    if (n === 'None' || n.toLowerCase() === 'nonetype') {
      return { kind: 'primitive', name: 'None' };
    }
    if (n === 'list' || n === 'List') {
      return { kind: 'collection', name: 'list', itemTypes: [] };
    }
    if (n === 'dict' || n === 'Dict') {
      return { kind: 'collection', name: 'dict', itemTypes: [] };
    }
    if (n === 'tuple' || n === 'Tuple') {
      return { kind: 'collection', name: 'tuple', itemTypes: [] };
    }
    if (n === 'set' || n === 'Set') {
      return { kind: 'collection', name: 'set', itemTypes: [] };
    }
    if (n === 'frozenset' || n === 'FrozenSet') {
      return { kind: 'collection', name: 'frozenset', itemTypes: [] };
    }
    return { kind: 'custom', name: n };
  };

  const normalizeCollectionName = (
    raw: string
  ): { name: 'list' | 'dict' | 'tuple' | 'set' | 'frozenset'; inner?: string } | null => {
    const m = raw.match(
      /^(typing\.)?(List|Dict|Tuple|Set|FrozenSet|list|dict|tuple|set|frozenset)\[(.*)\]$/
    );
    if (!m) {
      return null;
    }
    const nameRaw = String(m[2] ?? '');
    const nameLower = nameRaw.toLowerCase();
    const name =
      nameLower === 'list'
        ? 'list'
        : nameLower === 'dict'
          ? 'dict'
          : nameLower === 'tuple'
            ? 'tuple'
            : nameLower === 'frozenset'
              ? 'frozenset'
              : 'set';
    return { name, inner: String(m[3] ?? '') };
  };

  const splitTopLevel = (input: string, sep: '|' | ','): string[] => {
    const results: string[] = [];
    let level = 0;
    let cur = '';
    let inQuote: "'" | '"' | null = null;
    let escaped = false;
    let guard = 0;

    for (let i = 0; i < input.length; i++) {
      guard++;
      if (guard > 20000) {
        if (cur.trim()) {
          results.push(cur.trim());
        }
        break;
      }

      const ch = input.charAt(i);

      if (escaped) {
        cur += ch;
        escaped = false;
        continue;
      }

      if (inQuote) {
        cur += ch;
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inQuote) {
          inQuote = null;
        }
        continue;
      }

      if (ch === "'" || ch === '"') {
        inQuote = ch;
        cur += ch;
        continue;
      }

      if (ch === '[' || ch === '(') {
        level++;
      } else if (ch === ']' || ch === ')') {
        level = Math.max(0, level - 1);
      }

      if (level === 0 && ch === sep) {
        results.push(cur.trim());
        cur = '';
        continue;
      }

      cur += ch;
    }

    if (cur.trim()) {
      results.push(cur.trim());
    }
    return results;
  };

  const parse = (ann: unknown, depth = 0): PythonType => {
    if (ann === null || ann === undefined) {
      return unknownType();
    }
    if (depth > 100) {
      return unknownType();
    }
    const raw = String(ann).trim();

    // Handle built-in class repr: <class 'int'>
    const classMatch = raw.match(/^<class ['"][^'"]+['"]>$/);
    if (classMatch) {
      const inner = (raw.match(/^<class ['"]([^'"]+)['"]>$/) ?? [])[1] ?? '';
      const name = (inner.split('.').pop() ?? '').toString();
      return mapSimpleName(name);
    }

    // PEP 604 unions: int | str | None
    // Note: split at top-level only (avoid recursing forever on pipes inside quoted Literals).
    if (raw.includes('|')) {
      const parts = splitTopLevel(raw, '|');
      if (parts.length > 1) {
        const types = parts.map(p => parse(p.trim(), depth + 1));
        return { kind: 'union', types };
      }
    }

    // typing.Union[...]
    if (raw.startsWith('typing.Union[') || raw.startsWith('Union[')) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      const types = parts.map(p => parse(p.trim(), depth + 1));
      return { kind: 'union', types };
    }

    // Optional[T]
    if (raw.startsWith('typing.Optional[') || raw.startsWith('Optional[')) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const base = parse(inner, depth + 1);
      return { kind: 'optional', type: base };
    }

    // Literal[...] -> literal values union
    if (raw.startsWith('typing.Literal[') || raw.startsWith('Literal[')) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      if (parts.length === 1) {
        return mapLiteral(String(parts[0] ?? '').trim());
      }
      return { kind: 'union', types: parts.map(p => mapLiteral(String(p).trim())) } as PythonType;
    }

    // typing_extensions wrappers: ClassVar[T], Final[T], Required[T], NotRequired[T]
    const extMatch = raw.match(
      /^(typing\.|typing_extensions\.)?(ClassVar|Final|Required|NotRequired)\[(.*)\]$/
    );
    if (extMatch) {
      const inner = extMatch[3] ?? '';
      return parse(inner, depth + 1);
    }

    // LiteralString
    if (raw === 'typing.LiteralString' || raw === 'LiteralString') {
      return { kind: 'primitive', name: 'str' } as PythonType;
    }

    // Callable[[...], R]
    if (raw.startsWith('typing.Callable[') || raw.startsWith('Callable[')) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      if (parts.length >= 2) {
        const paramsPart = (parts[0] ?? '').trim();
        const returnPart = parts.slice(1).join(',').trim();
        const paramInner =
          paramsPart.startsWith('[') && paramsPart.endsWith(']') ? paramsPart.slice(1, -1) : '';
        const paramTypes = ((): PythonType[] => {
          const trimmed = paramInner.trim();
          if (trimmed === '...' || trimmed === 'Ellipsis') {
            return [{ kind: 'custom', name: '...' } as PythonType];
          }
          return trimmed ? splitTopLevel(trimmed, ',').map(p => parse(p.trim(), depth + 1)) : [];
        })();
        const returnType = parse(returnPart, depth + 1);
        return { kind: 'callable', parameters: paramTypes, returnType } as PythonType;
      }
    }

    // Mapping[K, V] / Dict[K, V] normalization
    if (raw.startsWith('typing.Mapping[') || raw.startsWith('Mapping[')) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      const itemTypes = parts.map(p => parse(p.trim(), depth + 1));
      return { kind: 'collection', name: 'dict', itemTypes } as PythonType;
    }

    // Annotated[T, ...] -> annotated node with base and metadata
    if (raw.startsWith('typing.Annotated[') || raw.startsWith('Annotated[')) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      if (parts.length > 0) {
        const base = parse((parts[0] ?? '').trim(), depth + 1);
        const metaParts = parts.slice(1).map(p => String(p).trim());
        return { kind: 'annotated', base, metadata: metaParts } as PythonType;
      }
    }

    // Collections: list[T], dict[K,V], tuple[...], set[T], frozenset[T]
    const coll = normalizeCollectionName(raw);
    if (coll) {
      const { name, inner } = coll;
      const itemParts = splitTopLevel(inner ?? '', ',');
      const itemTypes = (inner ? itemParts : []).map(p => parse(p.trim(), depth + 1));
      return { kind: 'collection', name, itemTypes };
    }

    // Bare names like int, str, float, bool, bytes, None
    return mapSimpleName(raw);
  };

  return parse(annotation, 0);
}
