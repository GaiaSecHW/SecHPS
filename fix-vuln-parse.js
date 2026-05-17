const fs = require('fs');
let content = fs.readFileSync('src/app/api/codeswarm/worker/result/route.ts', 'utf8');

const old = "const args: string[] = ['run', '--agent', 'build', instruction];";
const newStr = "const args: string[] = ['run', '--agent', 'build'];\n      // Read model from workspace opencode.json and clear it to avoid using task-specific model\n      const opencodeJsonPath = require('path').join(projectPath, 'opencode.json');\n      let injectedModel: string | undefined;\n      try {\n        const config = JSON.parse(fs.readFileSync(opencodeJsonPath, 'utf-8'));\n        if (config.model) {\n          injectedModel = config.model;\n          delete config.model;\n          delete config.provider;\n          fs.writeFileSync(opencodeJsonPath, JSON.stringify(config, null, 2));\n          console.log(`[VulnParse:${taskId}] Temporarily removed injected model from opencode.json`);\n        }\n      } catch {}\n      args.push(instruction);";

if (content.includes(old)) {
  content = content.replace(old, newStr);
  fs.writeFileSync('src/app/api/codeswarm/worker/result/route.ts', content);
  console.log('done');
} else {
  console.log('pattern not found');
}
