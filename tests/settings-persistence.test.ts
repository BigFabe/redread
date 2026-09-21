import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

test('saved settings survive fresh processes and repeated worker starts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redread-settings-'));
  const env = {...process.env, DATA_DIR: dir, REDREAD_ENV_FILE: '', LLM_MODEL: 'env-model'};
  const run = (code: string) => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {env});
  try {
    run(`const {settings,saveSettings}=await import('./packages/core/src/db.ts');
      saveSettings({...settings(),llmModel:'saved-model',llmKey:'saved-key',theme:'dark',customVoices:[{name:'Voice',voice:'voice-id'}]});`);
    for (let i = 0; i < 2; i++) {
      const worker = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/index.ts'], {env, stdio: ['ignore', 'pipe', 'pipe']});
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Worker startup timed out')), 15000);
          worker.once('error', error => {clearTimeout(timeout);reject(error);});
          worker.once('exit', code => {clearTimeout(timeout);reject(new Error(`Worker exited: ${code}`));});
          let output = '';
          worker.stdout.on('data', chunk => {
            output += chunk;
            if (output.includes('redread worker ready:')) {clearTimeout(timeout);resolve();}
          });
        });
      } finally {
        if (worker.exitCode === null) {const exit = once(worker, 'exit');worker.kill('SIGTERM');await exit;}
      }
      run(`import assert from 'node:assert/strict';
        const {settings,publicSettings}=await import('./packages/core/src/db.ts');
        assert.equal(settings().llmModel,'saved-model');
        assert.equal(settings().llmKey,'saved-key');
        assert.equal(settings().theme,'dark');
        assert.deepEqual(settings().customVoices,[{name:'Voice',voice:'voice-id'}]);
        assert.equal(publicSettings().llmKey,'');`);
    }
    run(`import assert from 'node:assert/strict';
      const {settings,resetSettings}=await import('./packages/core/src/db.ts');
      resetSettings();assert.equal(settings().llmModel,'env-model');`);
  } finally {rmSync(dir, {recursive: true, force: true});}
});
