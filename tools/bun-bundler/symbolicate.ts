// `/symbolicate` of the Bun dev server, after Metro's Server._symbolicate + Server/symbolicate.js:
//   request  {stack: [{file, lineNumber, column, methodName}], extraData?} - columns 0-based (React Native sends
//            `column1Based - 1`), `file` the bundle URL
//   response {codeFrame: {content, location: {row, column}, fileName} | null, stack} - original files (absolute),
//            0-based columns, function names from the function maps (x_facebook_sources), then the Metro config's
//            symbolicator.customizeFrame / customizeStack (Expo collapses internal frames)
//   errors   400 for invalid input, 500 otherwise, `{error}`
// The code frame comes from the first frame that is not collapsed (unless all are), has a line, is not a bundle URL
// and belongs to a module of a dev graph (Metro: depGraph.doesFileExist).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface SymbolicateDeps {
  projectRoot: string;
  /** trace map (original positions) + the served map (x_facebook_sources) of a bundle URL, null when unknown */
  mapsFor: (url: string) => { trace: any; served: any } | null;
  /** whether a file is a module of one of the dev graphs */
  isGraphFile: (file: string) => boolean;
  symbolicator: { customizeFrame?: (frame: any) => any; customizeStack?: (stack: any[], extraData: any) => any };
}

export async function symbolicateRequest(body: unknown, deps: SymbolicateDeps): Promise<{ status: number; body: object }> {
  const req = createRequire(path.join(deps.projectRoot, 'package.json'));
  let inputValidated = false;
  try {
    if (body == null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray((body as any).stack)) {
      throw new Error(`Bad symbolication input, expected object with stack array, got: ${JSON.stringify(body)}`);
    }
    const stack = (body as any).stack.map((frame: any, i: number) => {
      if (frame == null || typeof frame !== 'object' || Array.isArray(frame)) throw new Error(`Bad frame at line ${i}: Expected frame to be a JSON object`);
      for (const [key, type] of [['file', 'string'], ['methodName', 'string'], ['lineNumber', 'number'], ['column', 'number']] as const) {
        if (frame[key] != null && typeof frame[key] !== type) throw new Error(`Bad frame at line ${i}: Expected ${key} to be ${type} or nullish`);
      }
      return { ...frame };
    });
    inputValidated = true;
    const { originalPositionFor } = req('@jridgewell/trace-mapping');
    const { SourceMetadataMapConsumer } = req('metro-symbolicate/private/Symbolication');
    const urls = new Set<string>(stack.map((f: any) => f.file).filter((f: any) => typeof f === 'string' && f.startsWith('http') && !f.endsWith('/debuggerWorker.js')));
    const consumers = new Map<string, any>();

    const symbolicated = stack.map((frame: any) => {
      if (!urls.has(frame.file) || frame.lineNumber == null || frame.column == null) return { ...frame };
      const maps = deps.mapsFor(frame.file);
      if (!maps) return { ...frame };
      const pos = originalPositionFor(maps.trace, { line: frame.lineNumber, column: frame.column });
      if (pos.source == null || pos.line == null) return { ...frame };
      const file = path.resolve(deps.projectRoot, pos.source);
      let consumer = consumers.get(frame.file);
      if (!consumer && maps.served?.x_facebook_sources) consumers.set(frame.file, (consumer = new SourceMetadataMapConsumer(maps.served, (n: string) => n)));
      const methodName = consumer?.functionNameFor({ line: pos.line, column: pos.column, source: file }) ?? frame.methodName;
      return { ...frame, methodName, file, lineNumber: pos.line, column: pos.column };
    });
    const customized = await Promise.all(symbolicated.map(async (frame: any) => ({ ...frame, ...((await deps.symbolicator.customizeFrame?.(frame)) || {}) })));
    const finalStack = deps.symbolicator.customizeStack ? await deps.symbolicator.customizeStack(customized, (body as any).extraData ?? {}) : customized;
    return { status: 200, body: { codeFrame: codeFrameOf(finalStack, urls, deps, req), stack: finalStack } };
  } catch (error: any) {
    return { status: inputValidated ? 500 : 400, body: { error: String(error?.message ?? error) } };
  }
}

function codeFrameOf(stack: any[], urls: Set<string>, deps: SymbolicateDeps, req: NodeRequire) {
  const allCollapsed = stack.every((f) => f.collapse);
  for (const { collapse, column, file, lineNumber } of stack) {
    if ((!allCollapsed && collapse) || lineNumber == null || (file != null && urls.has(file))) continue;
    const absolute = path.resolve(deps.projectRoot, file ?? '');
    if (!deps.isGraphFile(absolute)) continue;
    try {
      const content = req('@babel/code-frame').codeFrameColumns(fs.readFileSync(absolute, 'utf8'), { start: { column: column + 1, line: lineNumber } }, { forceColor: true });
      return { content, location: { row: lineNumber, column }, fileName: file };
    } catch {}
  }
  return null;
}
