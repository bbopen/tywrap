import type { PythonGenericParameter, PythonType } from '../types/index.js';

export interface AnnotationParserOptions {
  onUnknownTypeName?: (name: string) => void;
  knownTypeVarNames?: Iterable<string>;
  typeParameters?: readonly PythonGenericParameter[];
}

export function parseAnnotationToPythonType(
  annotation: unknown,
  options: AnnotationParserOptions = {}
): PythonType {
  const onUnknownTypeName = options.onUnknownTypeName;
  const knownTypeVarNames = new Set(options.knownTypeVarNames ?? []);
  const knownTypeParameters = new Map(
    (options.typeParameters ?? []).map(param => [param.name, param] as const)
  );
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
    if (t !== '' && !Number.isNaN(num)) {
      return { kind: 'literal', value: num } as PythonType;
    }
    return { kind: 'custom', name: t } as PythonType;
  };

  const mapKnownTypeParameter = (name: string): PythonType | null => {
    const normalized = name.replace(/^~/, '').trim();
    const param = knownTypeParameters.get(normalized);
    if (!param) {
      return null;
    }
    switch (param.kind) {
      case 'typevar':
        return {
          kind: 'typevar',
          name: param.name,
          bound: param.bound,
          constraints: param.constraints,
          variance: param.variance,
        } satisfies PythonType;
      case 'paramspec':
        return { kind: 'paramspec', name: param.name } satisfies PythonType;
      case 'typevartuple':
        return { kind: 'typevartuple', name: param.name } satisfies PythonType;
    }
  };

  const mapSimpleName = (name: string): PythonType => {
    const n = name.replace(/^(typing\.|typing_extensions\.|collections\.abc\.)/, '').trim();
    const known = mapKnownTypeParameter(n);
    if (known) {
      return known;
    }
    if (knownTypeVarNames.has(n)) {
      return { kind: 'typevar', name: n };
    }

    if (n === 'int' || n === 'float' || n === 'str' || n === 'bool' || n === 'bytes') {
      return { kind: 'primitive', name: n };
    }

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
    if (n.startsWith('~')) {
      return { kind: 'typevar', name: n.slice(1) };
    }
    return { kind: 'custom', name: n };
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

  const splitQualifiedName = (raw: string): { name: string; module?: string } => {
    const trimmed = raw.trim();
    const parts = trimmed.split('.').filter(Boolean);
    if (parts.length <= 1) {
      return { name: trimmed };
    }
    const name = parts[parts.length - 1] ?? trimmed;
    return { name, module: parts.slice(0, -1).join('.') || undefined };
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

  const splitGenericInvocation = (raw: string): { name: string; inner: string } | null => {
    if (!raw.endsWith(']')) {
      return null;
    }
    const bracketStart = raw.indexOf('[');
    if (bracketStart <= 0) {
      return null;
    }

    let depth = 0;
    for (let i = bracketStart; i < raw.length; i++) {
      const ch = raw.charAt(i);
      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0 && i !== raw.length - 1) {
          return null;
        }
      }
    }

    if (depth !== 0) {
      return null;
    }

    return {
      name: raw.slice(0, bracketStart).trim(),
      inner: raw.slice(bracketStart + 1, -1),
    };
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
    if (raw === '') {
      return unknownType();
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) && rawText.startsWith('~')) {
      return mapKnownTypeParameter(raw) ?? { kind: 'typevar', name: raw };
    }

    const paramspecArgsMatch = rawText.match(/^~?([A-Za-z_][A-Za-z0-9_]*)\.(args|kwargs)$/);
    if (paramspecArgsMatch?.[1] && paramspecArgsMatch[2]) {
      const baseName = paramspecArgsMatch[1];
      const known = mapKnownTypeParameter(baseName);
      if (known?.kind === 'paramspec' || rawText.startsWith('~')) {
      if (known?.kind === 'paramspec' || rawText.startsWith('~')) {
        return paramspecArgsMatch[2] === 'args'
          ? ({ kind: 'paramspec_args', name: baseName } satisfies PythonType)
          : ({ kind: 'paramspec_kwargs', name: baseName } satisfies PythonType);
      }
    }

    const builtInClassMatch = raw.match(/^<class ['"][^'"]+['"]>$/);
    if (builtInClassMatch) {
      const inner = (raw.match(/^<class ['"]([^'"]+)['"]>$/) ?? [])[1] ?? '';
      const name = (inner.split('.').pop() ?? '').toString();
      return mapSimpleName(name);
    }

    if (raw.includes('|')) {
      const parts = splitTopLevel(raw, '|');
      if (parts.length > 1) {
        const types = parts.map(p => parse(p.trim(), depth + 1));
        return { kind: 'union', types };
      }
    }

    if (
      raw.startsWith('typing.Union[') ||
      raw.startsWith('typing_extensions.Union[') ||
      raw.startsWith('Union[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      const types = parts.map(p => parse(p.trim(), depth + 1));
      return { kind: 'union', types };
    }

    if (
      raw.startsWith('typing.Optional[') ||
      raw.startsWith('typing_extensions.Optional[') ||
      raw.startsWith('Optional[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      return { kind: 'optional', type: parse(inner, depth + 1) };
    }

    if (
      raw.startsWith('typing.Literal[') ||
      raw.startsWith('typing_extensions.Literal[') ||
      raw.startsWith('Literal[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      if (parts.length === 1) {
        return mapLiteral(String(parts[0] ?? '').trim());
      }
      return { kind: 'union', types: parts.map(p => mapLiteral(String(p).trim())) };
    }

    const extMatch = raw.match(
      /^(typing\.|typing_extensions\.)?(ClassVar|Final|Required|NotRequired)\[(.*)\]$/
    );
    if (extMatch) {
      return parse(extMatch[3] ?? '', depth + 1);
    }

    const typeVarName = parseTypingFactoryName(rawText, 'TypeVar');
    if (typeVarName) {
      return mapKnownTypeParameter(typeVarName) ?? { kind: 'typevar', name: typeVarName };
    }

    const paramSpecName = parseTypingFactoryName(rawText, 'ParamSpec');
    if (paramSpecName) {
      return mapKnownTypeParameter(paramSpecName) ?? { kind: 'paramspec', name: paramSpecName };
    }

    const typeVarTupleName = parseTypingFactoryName(rawText, 'TypeVarTuple');
    if (typeVarTupleName) {
      return (
        mapKnownTypeParameter(typeVarTupleName) ?? {
          kind: 'typevartuple',
          name: typeVarTupleName,
        }
      );
    }
    if (
      raw === 'typing.LiteralString' ||
      raw === 'typing_extensions.LiteralString' ||
      raw === 'LiteralString'
    ) {
      return { kind: 'primitive', name: 'str' };
    }

    if (
      raw.startsWith('typing.Callable[') ||
      raw.startsWith('typing_extensions.Callable[') ||
      raw.startsWith('Callable[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      if (parts.length >= 2) {
        const paramsPart = (parts[0] ?? '').trim();
        const returnPart = parts.slice(1).join(',').trim();
        const returnType = parse(returnPart, depth + 1);

        if (paramsPart === '...' || paramsPart === 'Ellipsis') {
          return {
            kind: 'callable',
            parameters: [{ kind: 'custom', name: '...' }],
            returnType,
          };
        }

        const directParamSpec = parse(paramsPart, depth + 1);
        if (directParamSpec.kind === 'paramspec') {
          return {
            kind: 'callable',
            parameters: [],
            parameterSpec: directParamSpec,
            returnType,
          };
        }

        const paramInner =
          paramsPart.startsWith('[') && paramsPart.endsWith(']') ? paramsPart.slice(1, -1) : '';
        const trimmed = paramInner.trim();
        if (trimmed === '...' || trimmed === 'Ellipsis') {
          return {
            kind: 'callable',
            parameters: [{ kind: 'custom', name: '...' }],
            returnType,
          };
        }

        const parameters = trimmed
          ? splitTopLevel(trimmed, ',').map(p => parse(p.trim(), depth + 1))
          : [];
        return { kind: 'callable', parameters, returnType };
      }
    }

    if (
      raw.startsWith('typing.Mapping[') ||
      raw.startsWith('typing_extensions.Mapping[') ||
      raw.startsWith('Mapping[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      return {
        kind: 'collection',
        name: 'dict',
        itemTypes: parts.map(p => parse(p.trim(), depth + 1)),
      };
    }

    if (
      raw.startsWith('typing.Annotated[') ||
      raw.startsWith('typing_extensions.Annotated[') ||
      raw.startsWith('Annotated[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      const parts = splitTopLevel(inner, ',');
      if (parts.length > 0) {
        return {
          kind: 'annotated',
          base: parse(parts[0] ?? '', depth + 1),
          metadata: parts.slice(1).map(p => String(p).trim()),
        };
      }
    }

    if (
      raw.startsWith('typing.Unpack[') ||
      raw.startsWith('typing_extensions.Unpack[') ||
      raw.startsWith('Unpack[')
    ) {
      const inner = raw.slice(raw.indexOf('[') + 1, raw.lastIndexOf(']'));
      return { kind: 'unpack', type: parse(inner, depth + 1) };
    }

    const coll = normalizeCollectionName(raw);
    if (coll) {
      const itemParts = splitTopLevel(coll.inner ?? '', ',');
      const itemTypes = (coll.inner ? itemParts : []).map(p => parse(p.trim(), depth + 1));
      return { kind: 'collection', name: coll.name, itemTypes };
    }

    const generic = splitGenericInvocation(raw);
    if (generic) {
      const typeArgs = splitTopLevel(generic.inner, ',').map(part => parse(part.trim(), depth + 1));
      const qualified = splitQualifiedName(generic.name);
      return {
        kind: 'generic',
        name: qualified.name,
        module: qualified.module,
        typeArgs,
      };
    }

    return mapSimpleName(raw);
  };

  return parse(annotation, 0);
}
