import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function test() {
    const model = 'openrouter/qwen/qwen3.5-plus-02-15';
    const tempFile = path.join(os.tmpdir(), `test_prompt_${Date.now()}.txt`);
    const content = "Test analysis request. Please return JSON.";
    
    fs.writeFileSync(tempFile, content, 'utf-8');
    
    const cmd = `opencode run "Test" -m "${model}" -f "${tempFile}"`;
    console.log(`Executing: ${cmd}`);
    
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
        }
        console.log(`Stdout: ${stdout}`);
        console.error(`Stderr: ${stderr}`);
        fs.unlinkSync(tempFile);
    });
}

test();
