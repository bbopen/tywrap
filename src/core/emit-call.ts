/**
 * Shared call-emission helpers for the TypeScript wrapper generator.
 *
 * The function, method, and constructor wrappers all emit the same runtime
 * prelude (assemble `__args`, fold a trailing object into `__kwargs`, unpack
 * `*args`) and the same argument guards (reject positional-only-as-keyword,
 * require keyword-only arguments). They differ only by indentation, the error
 * label used in thrown messages, and the terminal RPC verb (which the call
 * sites still emit themselves).
 *
 * The emitted strings MUST stay byte-identical to the previous inline copies.
 */

import type { Parameter } from '../types/index.js';

/** Describes one call site for prelude/guard emission. */
export interface CallDescriptor {
  /** Positional parameters (no *args/**kwargs/keyword-only). */
  positionalParams: readonly Parameter[];
  /** The `*args` parameter, if any. */
  varArgsParam?: Parameter;
  /** Whether `*args` is modeled as an array param (true when kwargs coexist). */
  needsVarArgsArray: boolean;
  /** Whether the wrapper takes a `kwargs` parameter. */
  hasKwArgs: boolean;
  /** Whether the callee declares `**kwargs`. */
  hasVarKwArgs: boolean;
  /** Names of keyword-only parameters. */
  keywordOnlyNames: readonly string[];
  /** Names of required keyword-only parameters. */
  requiredKwOnlyNames: readonly string[];
  /** Names of positional-only parameters. */
  positionalOnlyNames: readonly string[];
  /** Number of leading required positional parameters. */
  requiredPosCount: number;
  /** Base indentation (e.g. '  ' for functions, '    ' for methods/ctors). */
  indent: string;
  /** Error label used in thrown messages (function/method name or '__init__'). */
  errorLabel: string;
}

/** Helpers wired from the generator instance (they depend on `this`). */
export interface CallEmitHelpers {
  escapeIdentifier(name: string): string;
  renderLooksLikeKwargsExpr(
    valueExpr: string,
    options: {
      keywordOnlyNames: string[];
      requiredKwOnlyNames: string[];
      hasVarKwArgs: boolean;
    }
  ): string;
}

/**
 * Emit the runtime prelude lines that build the `__args` array, fold a trailing
 * plain object into `__kwargs`, and unpack `*args`.
 */
export function emitCallPrelude(desc: CallDescriptor, helpers: CallEmitHelpers): string[] {
  const {
    positionalParams,
    varArgsParam,
    needsVarArgsArray,
    hasKwArgs,
    hasVarKwArgs,
    keywordOnlyNames,
    requiredKwOnlyNames,
    requiredPosCount,
    indent: i,
    errorLabel,
  } = desc;
  const i2 = `${i}  `;
  const i3 = `${i2}  `;

  const lines: string[] = [];
  if (hasKwArgs) {
    lines.push(`${i}let __kwargs = kwargs;`);
  }
  const positionalArgExprs = positionalParams.map(p => helpers.escapeIdentifier(p.name));
  lines.push(`${i}const __args: unknown[] = [${positionalArgExprs.join(', ')}];`);
  if (requiredPosCount < positionalParams.length) {
    lines.push(
      `${i}while (__args.length > ${requiredPosCount} && __args[__args.length - 1] === undefined) {`
    );
    lines.push(`${i2}__args.pop();`);
    lines.push(`${i}}`);
  }
  if (hasKwArgs && requiredPosCount < positionalParams.length) {
    const looksLikeKwargs = helpers.renderLooksLikeKwargsExpr('__candidate', {
      keywordOnlyNames: [...keywordOnlyNames],
      requiredKwOnlyNames: [...requiredKwOnlyNames],
      hasVarKwArgs,
    });
    lines.push(`${i}if (__kwargs === undefined && __args.length > ${requiredPosCount}) {`);
    lines.push(`${i2}const __candidate = __args[__args.length - 1];`);
    lines.push(`${i2}if (${looksLikeKwargs}) {`);
    lines.push(`${i3}__kwargs = __candidate as any;`);
    lines.push(`${i3}__args.pop();`);
    lines.push(`${i2}}`);
    lines.push(`${i}}`);
  }
  if (varArgsParam) {
    const vname = helpers.escapeIdentifier(varArgsParam.name);
    if (needsVarArgsArray) {
      const looksLikeKwargs = helpers.renderLooksLikeKwargsExpr(vname, {
        keywordOnlyNames: [...keywordOnlyNames],
        requiredKwOnlyNames: [...requiredKwOnlyNames],
        hasVarKwArgs,
      });
      lines.push(`${i}let __varargs: unknown[] = [];`);
      lines.push(`${i}if (${vname} !== undefined) {`);
      lines.push(`${i2}if (globalThis.Array.isArray(${vname})) {`);
      lines.push(`${i3}__varargs = ${vname};`);
      lines.push(`${i2}} else if (__kwargs === undefined && ${looksLikeKwargs}) {`);
      lines.push(`${i3}__kwargs = ${vname} as any;`);
      lines.push(`${i2}} else {`);
      lines.push(
        `${i3}throw new Error(\`${errorLabel} expected ${varArgsParam.name} to be an array\`);`
      );
      lines.push(`${i2}}`);
      lines.push(`${i}}`);
      lines.push(`${i}__args.push(...__varargs);`);
    } else {
      lines.push(`${i}__args.push(...${vname});`);
    }
  }
  return lines;
}

/**
 * Emit the argument guard lines that reject positional-only arguments passed as
 * keywords and enforce required keyword-only arguments.
 */
export function emitArgGuards(desc: CallDescriptor): string[] {
  const { hasKwArgs, positionalOnlyNames, requiredKwOnlyNames, indent: i, errorLabel } = desc;
  const i2 = `${i}  `;
  const i3 = `${i2}  `;

  const lines: string[] = [];
  if (hasKwArgs && positionalOnlyNames.length > 0) {
    lines.push(`${i}const __positionalOnly = ${JSON.stringify(positionalOnlyNames)} as const;`);
    lines.push(`${i}for (const key of __positionalOnly) {`);
    lines.push(`${i2}if (__kwargs && Object.prototype.hasOwnProperty.call(__kwargs, key)) {`);
    lines.push(
      `${i3}throw new Error(\`${errorLabel} does not accept positional-only argument "\${key}" as a keyword argument\`);`
    );
    lines.push(`${i2}}`);
    lines.push(`${i}}`);
  }
  if (hasKwArgs && requiredKwOnlyNames.length > 0) {
    lines.push(`${i}const __requiredKwOnly = ${JSON.stringify(requiredKwOnlyNames)} as const;`);
    lines.push(`${i}const __missing: string[] = [];`);
    lines.push(`${i}for (const key of __requiredKwOnly) {`);
    lines.push(`${i2}if (!__kwargs || !Object.prototype.hasOwnProperty.call(__kwargs, key)) {`);
    lines.push(`${i3}__missing.push(key);`);
    lines.push(`${i2}}`);
    lines.push(`${i}}`);
    lines.push(`${i}if (__missing.length > 0) {`);
    lines.push(
      `${i2}throw new Error(\`Missing required keyword-only arguments for ${errorLabel}: \${__missing.join(', ')}\`);`
    );
    lines.push(`${i}}`);
  }
  return lines;
}
