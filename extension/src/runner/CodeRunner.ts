import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

type OutputCallback = (chunk: string, isError: boolean) => void;
type DoneCallback = () => void;

export function runFile(
  filePath: string,
  onOutput: OutputCallback,
  onDone: DoneCallback
): () => void {
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);

  let proc: ChildProcess;

  const attach = (p: ChildProcess) => {
    p.stdout?.on('data', d => onOutput(d.toString(), false));
    p.stderr?.on('data', d => onOutput(d.toString(), true));
    p.on('close', onDone);
    p.on('error', e => { onOutput(e.message, true); onDone(); });
    return p;
  };

  switch (ext) {
    case '.py':
      proc = attach(spawn('python3', [filePath], { cwd: dir }));
      break;
    case '.js':
      proc = attach(spawn('node', [filePath], { cwd: dir }));
      break;
    case '.ts':
      proc = attach(spawn('npx', ['ts-node', filePath], { cwd: dir }));
      break;
    case '.go':
      proc = attach(spawn('go', ['run', filePath], { cwd: dir }));
      break;
    case '.rb':
      proc = attach(spawn('ruby', [filePath], { cwd: dir }));
      break;
    case '.sh':
      proc = attach(spawn('bash', [filePath], { cwd: dir }));
      break;
    case '.c': {
      const out = filePath.replace(/\.c$/, '');
      const compile = spawn('gcc', [filePath, '-o', out], { cwd: dir });
      compile.stderr?.on('data', d => onOutput(d.toString(), true));
      compile.on('close', code => {
        if (code !== 0) { onDone(); return; }
        proc = attach(spawn(out, [], { cwd: dir }));
      });
      proc = compile;
      break;
    }
    case '.cpp': {
      const out = filePath.replace(/\.cpp$/, '');
      const compile = spawn('g++', [filePath, '-o', out], { cwd: dir });
      compile.stderr?.on('data', d => onOutput(d.toString(), true));
      compile.on('close', code => {
        if (code !== 0) { onDone(); return; }
        proc = attach(spawn(out, [], { cwd: dir }));
      });
      proc = compile;
      break;
    }
    case '.java': {
      const compile = spawn('javac', [filePath], { cwd: dir });
      compile.stderr?.on('data', d => onOutput(d.toString(), true));
      compile.on('close', code => {
        if (code !== 0) { onDone(); return; }
        const className = path.basename(filePath, '.java');
        proc = attach(spawn('java', [className], { cwd: dir }));
      });
      proc = compile;
      break;
    }
    default:
      onOutput(`Cannot run file type: ${ext || '(no extension)'}`, true);
      onDone();
      return () => {};
  }

  return () => { try { proc?.kill(); } catch (_) {} };
}
