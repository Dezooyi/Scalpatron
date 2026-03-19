import { exec } from 'child_process';
async function test() {
    exec('opencode models', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
        }
        console.log(`Stdout: ${stdout.substring(0, 500)}...`);
        console.error(`Stderr: ${stderr}`);
    });
}
test();
