import type { PythonType } from '../types/index.js';

export interface AnnotationParserOptions {
  onUnknownTypeName?: (name: string) => void;
  knownTypeVarNames?: Iterable<string>;
}

export function parseAnnotationToPythonType(
  annotation: unknown,
  options: AnnotationParserOptions = {}
): PythonType {
  const onUnknownTypeName = options.onUnknownTypeName;
  const knownTypeVarNames = new Set(options.knownTypeVarNames ?? []);
  const modulePrefixes = ['', 'typing.', 'typing_extensions.', 'collections.abc.'] as const;

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

  const parseTypingFactoryName = (text: string, name: string): string | null => {
    for (const prefix of modulePrefixes) {
      const start = `${prefix}${name}(`;
      if (!text.startsWith(start) || !text.endsWith(')')) {
        continue;
      }

      const inner = text.slice(start.length, -1).trim();
      if (inner.length < 2) {
        return null;
      }

      const quote = inner[0];
      if ((quote !== "'" && quote !== '"') || inner[inner.length - 1] !== quote) {
        return null;
      }

      const commaIndex = inner.indexOf(',');
      const quoted = commaIndex === -1 ? inner : inner.slice(0, commaIndex).trimEnd();

      if (quoted.length < 2 || quoted[quoted.length - 1] !== quote) {
        return null;
      }

      return quoted.slice(1, -1);
    }

    return null;
  };

  const matchBracketedAlias = (
    text: string,
    aliases: readonly string[]
  ): { alias: string; inner: string } | null => {
    for (const prefix of modulePrefixes) {
      for (const alias of aliases) {
        const start = `${prefix}${alias}[`;
        if (!text.startsWith(start) || !text.endsWith(']')) {
          continue;
        }
        return {
          alias,
          inner: text.slice(start.length, -1),
        };
      }
    }
    return null;
  };

  const mapSimpleName = (name: string): PythonType => {
    const n = name
      .replace(/^~/, '')
      .replace(/^(typing\.|typing_extensions\.|collections\.abc\.)/, '')
      .trim();

    if (knownTypeVarNames.has(n)) {
      return { kind: 'typevar', name: n };
    }

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
      /^(typing\.|typing_extensions\.)?(List|Dict|Tuple|Set|FrozenSet|list|dict|tuple|set|frozenset)\[(.*)\]$/
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
    const rawText = String(ann).trim();
    const raw = rawText.startsWith('~') ? rawText.slice(1).trim() : rawText;

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) && rawText.startsWith('~')) {
      return { kind: 'typevar', name: raw };
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*\.args$/.test(raw)) {
      return { kind: 'collection', name: 'list', itemTypes: [unknownType()] };
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*\.kwargs$/.test(raw)) {
      return {
        kind: 'collection',
        name: 'dict',
        itemTypes: [{ kind: 'primitive', name: 'str' }, unknownType()],
      };
    }

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
    const optionalAlias = matchBracketedAlias(raw, ['Optional']);
    if (optionalAlias) {
      const base = parse(optionalAlias.inner, depth + 1);
      return { kind: 'optional', type: base };
    }

    const sequenceAlias = matchBracketedAlias(raw, ['Sequence']);
    if (sequenceAlias) {
      return {
        kind: 'collection',
        name: 'list',
        itemTypes: [parse(sequenceAlias.inner, depth + 1)],
      };
    }

    const mappingAlias = matchBracketedAlias(raw, ['Mapping']);
    if (mappingAlias) {
      const parts = splitTopLevel(mappingAlias.inner, ',');
      const itemTypes = parts.map(p => parse(p.trim(), depth + 1));
      return { kind: 'collection', name: 'dict', itemTypes } as PythonType;
    }

    const iteratorAlias = matchBracketedAlias(raw, [
      'Iterator',
      'AsyncIterator',
      'Iterable',
      'AsyncIterable',
    ]);
    if (iteratorAlias) {
      const parts = splitTopLevel(iteratorAlias.inner, ',');
      return {
        kind: 'generic',
        name: iteratorAlias.alias,
        typeArgs: parts.map(p => parse(p.trim(), depth + 1)),
      };
    }

    const awaitableAlias = matchBracketedAlias(raw, ['Awaitable']);
    if (awaitableAlias) {
      return {
        kind: 'generic',
        name: 'Promise',
        typeArgs: [parse(awaitableAlias.inner, depth + 1)],
      };
    }

    const coroutineAlias = matchBracketedAlias(raw, ['Coroutine']);
    if (coroutineAlias) {
      const parts = splitTopLevel(coroutineAlias.inner, ',');
      return {
        kind: 'generic',
        name: 'Promise',
        typeArgs: [parse(parts[parts.length - 1] ?? 'Any', depth + 1)],
      };
    }

    const literalAlias = matchBracketedAlias(raw, ['Literal']);
    if (literalAlias) {
      const parts = splitTopLevel(literalAlias.inner, ',');
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

    const typeVarName = parseTypingFactoryName(raw, 'TypeVar');
    if (typeVarName) {
      return { kind: 'typevar', name: typeVarName };
    }

    const paramSpecName = parseTypingFactoryName(raw, 'ParamSpec');
    if (paramSpecName) {
      return { kind: 'custom', name: paramSpecName, module: 'typing' };
    }

    const typeVarTupleName = parseTypingFactoryName(raw, 'TypeVarTuple');
    if (typeVarTupleName) {
      return { kind: 'custom', name: typeVarTupleName, module: 'typing' };
    }

    // LiteralString
    if (raw === 'typing.LiteralString' || raw === 'LiteralString') {
      return { kind: 'primitive', name: 'str' } as PythonType;
    }

    const callableAlias = matchBracketedAlias(raw, ['Callable']);
    if (callableAlias) {
      const parts = splitTopLevel(callableAlias.inner, ',');
      if (parts.length >= 2) {
        const paramsPart = (parts[0] ?? '').trim();
        const returnPart = parts.slice(1).join(',').trim();
        const paramInner =
          paramsPart.startsWith('[') && paramsPart.endsWith(']') ? paramsPart.slice(1, -1) : '';
        const paramTypes = ((): PythonType[] => {
          // Callable[..., R] uses a top-level Ellipsis.
          if (paramsPart === '...' || paramsPart === 'Ellipsis') {
            return [{ kind: 'custom', name: '...' } as PythonType];
          }
          const trimmed = paramInner.trim();
          if (trimmed === '...' || trimmed === 'Ellipsis') {
            return [{ kind: 'custom', name: '...' } as PythonType];
          }
          if (!paramsPart.startsWith('[') || !paramsPart.endsWith(']')) {
            return [{ kind: 'custom', name: '...' } as PythonType];
          }
          return trimmed ? splitTopLevel(trimmed, ',').map(p => parse(p.trim(), depth + 1)) : [];
        })();
        const returnType = parse(returnPart, depth + 1);
        return { kind: 'callable', parameters: paramTypes, returnType } as PythonType;
      }
    }

    const unpackAlias = matchBracketedAlias(raw, ['Unpack']);
    if (unpackAlias) {
      return unknownType();
    }

    const annotatedAlias = matchBracketedAlias(raw, ['Annotated']);
    if (annotatedAlias) {
      const parts = splitTopLevel(annotatedAlias.inner, ',');
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
