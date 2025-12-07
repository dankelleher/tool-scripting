import ivm from 'isolated-vm';
import { z } from 'zod';
import {
  toPascalCase,
  getParamEntries,
  getOutputSchemaInfo,
  generateTypeDefinition,
  generateFunctionTypeDeclaration,
} from './codegen';
import type { CodeModeOptions, ToolDefinition, Tools } from './types';

export type { CodeModeOptions, ToolDefinition, Tools };

class CodeExecutionSandbox {
  private timeout: number;
  private allowConsole: boolean;
  private maxMemory: number;

  constructor(options: CodeModeOptions = {}) {
    this.timeout = options.timeout || 30000;
    this.allowConsole = options.sandbox?.allowConsole ?? true;
    this.maxMemory = options.sandbox?.maxMemory || 128 * 1024 * 1024; // 128MB
  }

  async execute(code: string, bindings: Record<string, Function>): Promise<any> {
    const memoryLimitMb = Math.max(8, Math.ceil(this.maxMemory / (1024 * 1024)));
    
    return new Promise(async (resolve, reject) => {
      const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
      let finished = false;
      
      // Execution log to capture function calls
      const executionLog: Array<{ fn: string; args: any; result: any }> = [];
      
      const cleanup = () => {
        try { isolate.dispose(); } catch {}
      };
      const wallTimer = setTimeout(() => {
        if (!finished) {
          finished = true;
          cleanup();
          reject(new Error('Code execution timed out'));
        }
      }, this.timeout);

      try {
        const context = await isolate.createContext();
        const jail = context.global;
        await jail.set('global', jail.derefInto());

        // Console bridging
        if (this.allowConsole) {
          await context.evalClosure(
            `global.console = {
              log: (...args) => $0.apply(undefined, args, { arguments: { copy: true } }),
              error: (...args) => $1.apply(undefined, args, { arguments: { copy: true } }),
              warn: (...args) => $2.apply(undefined, args, { arguments: { copy: true } })
            };`,
            [
              new ivm.Reference((...args: any[]) => console.log('[sandbox]', ...args)),
              new ivm.Reference((...args: any[]) => console.error('[sandbox]', ...args)),
              new ivm.Reference((...args: any[]) => console.warn('[sandbox]', ...args)),
            ],
          );
        } else {
          await context.eval(`global.console = { log: () => {}, error: () => {}, warn: () => {} };`);
        }

        // Timers bridging (basic)
        await context.evalClosure(
          `global.setTimeout = (fn, ms, ...args) => {
             return $0.apply(undefined, [fn, ms, args], { arguments: { reference: true, copy: true } });
           };
           global.clearTimeout = (id) => $1.apply(undefined, [id], { arguments: { copy: true } });`,
          [
            new ivm.Reference((fnRef: any, ms: number, args: any[]) => {
              const id = setTimeout(() => {
                try {
                  fnRef.apply(undefined, args, { arguments: { copy: true } });
                } catch {}
              }, ms);
              return id as unknown as number;
            }),
            new ivm.Reference((id: any) => clearTimeout(id)),
          ],
        );

        // Bridge tool bindings into isolate with logging
        for (const [name, fn] of Object.entries(bindings)) {
          await context.evalClosure(
            `global[${JSON.stringify(name)}] = (...args) => $0.apply(undefined, args, { arguments: { copy: true }, result: { promise: true, copy: true } });`,
            [ new ivm.Reference(async (...args: any[]) => {
              try {
                const result = await fn(...args);
                executionLog.push({ fn: name, args, result });
                return result;
              } catch (error: any) {
                const errorMsg = error?.message || String(error);
                executionLog.push({ fn: name, args, result: `Error: ${errorMsg}` });
                throw error;
              }
            }) ],
          );
        }

        // Execute wrapped async code and pipe result/errors to host
        const runPromise = context.evalClosure(
          `;(async () => {
              try {
                const __result = await (async () => { ${code} })();
                $0.applyIgnored(undefined, [ __result ], { arguments: { copy: true } });
              } catch (e) {
                const msg = e && e.message ? e.message : String(e);
                $1.applyIgnored(undefined, [ msg ], { arguments: { copy: true } });
              }
            })();`,
          [
            new ivm.Reference((res: any) => { 
              if (!finished) { 
                finished = true; 
                clearTimeout(wallTimer); 
                cleanup(); 
                // Format execution log and final result
                const formattedResult = this.formatExecutionResult(executionLog, res);
                resolve(formattedResult); 
              } 
            }),
            new ivm.Reference((msg: string) => { 
              if (!finished) { 
                finished = true; 
                clearTimeout(wallTimer); 
                cleanup(); 
                // Include execution log even on error
                const formattedError = this.formatExecutionResult(executionLog, null, msg);
                reject(new Error(formattedError)); 
              } 
            }),
          ],
          { timeout: this.timeout },
        );
        Promise.resolve(runPromise).catch(() => {});
      } catch (err: any) {
        if (!finished) {
          finished = true;
          clearTimeout(wallTimer);
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  /**
   * Format execution log and final result in an LLM-friendly format
   */
  private formatExecutionResult(log: Array<{ fn: string; args: any; result: any }>, finalResult: any, error?: string): string {
    const lines: string[] = [];
    
    // Add execution log
    if (log.length > 0) {
      lines.push('Execution trace:');
      for (const entry of log) {
        const argsStr = JSON.stringify(entry.args);
        const resultStr = typeof entry.result === 'string' 
          ? entry.result 
          : JSON.stringify(entry.result);
        lines.push(`  ${entry.fn}(${argsStr}) → ${resultStr}`);
      }
      lines.push('');
    }
    
    // Add final result or error
    if (error) {
      lines.push(`Script error: ${error}`);
    } else if (finalResult !== undefined && finalResult !== null) {
      const resultStr = typeof finalResult === 'string'
        ? finalResult
        : JSON.stringify(finalResult);
      lines.push(`Final result: ${resultStr}`);
    }
    
    return lines.join('\n');
  }
}

/**
 * Sanitize tool name to be a valid JavaScript identifier
 * Converts kebab-case and other non-JS-friendly characters to underscores
 * This is needed for MCP tools which often use kebab-case naming
 */
function sanitizeToolName(name: string): string {
  // Replace any character that's not alphanumeric, underscore, or dollar sign with underscore
  return name.replace(/[^a-zA-Z0-9_$]/g, '_');
}

function extractToolBindings(tools: Tools): Record<string, Function> {
  const bindings: Record<string, Function> = {};

  for (const [name, tool] of Object.entries(tools)) {
    // Sanitize tool name to ensure it's a valid JavaScript identifier
    const sanitizedName = sanitizeToolName(name);
    bindings[sanitizedName] = tool.execute;
  }

  return bindings;
}

function generateCodeSystemPrompt(tools: Tools): string {
  const toolDescriptions = Object.entries(tools)
    .map(([name, tool]) => {
      // Use sanitized name in documentation to match what's available in the sandbox
      const sanitizedName = sanitizeToolName(name);
      const pascalName = toPascalCase(sanitizedName);
      const params = getParamEntries(tool);
      const outputInfo = getOutputSchemaInfo(tool);

      const lines: string[] = [];

      // Generate type definition if output is an object with properties
      const resultTypeName = `${pascalName}Result`;
      let returnType = 'void';

      if (outputInfo) {
        if (outputInfo.isObject && outputInfo.properties && outputInfo.properties.length > 0) {
          lines.push(generateTypeDefinition(resultTypeName, outputInfo.properties));
          lines.push('');
          returnType = resultTypeName;
        } else {
          returnType = outputInfo.type;
        }
      }

      // Generate function type declaration with inline comments
      lines.push(generateFunctionTypeDeclaration(sanitizedName, tool.description, params, returnType));

      return lines.join('\n');
    })
    .join('\n\n');

  const prompt = `

<Tool Calling SDK>
You can take action by writing server-side JavaScript using the following SDK.

## Runtime Environment

- NodeJS V8 isolate secure sandboxed environment
- \`document\` and \`window\` are undefined.
- This is not a browser environment, so DOM APIs are NOT available
- The context is async, so you can use \`await\` directly

## Available Functions

The following functions are **directly available in scope** - no imports or destructuring needed.
These functions have bindings to the runtime environment.

\`\`\`typescript
${toolDescriptions}
\`\`\`

## Usage Notes

- **Functions are in scope**: Call them directly (e.g. \`await click(...)\`). Do NOT destructure from \`globalThis\` or \`global\`.
- **Already async**: Your script runs in an async context. Use \`await\` directly. Do NOT wrap in \`(async () => { ... })()\`.
- **Return values**: Use \`return\` to return data from your script.
- **Don't use try/catch**: We want original errors to be thrown. Use \`.catch()\` to handle errors only if errors are expected and you want to handle them gracefully.

# Example

\`\`\`yaml
toolName: runToolScript
args:
  description: Getting user location and fetching weather...
  script: const location = await getUserLocation();\\nconst weather = await getWeather({ location });\\nreturn { location, weather };
\`\`\`
</Tool Calling SDK>
`;

  return prompt;
}

export function toolScripting(aiFunction: Function, options: CodeModeOptions = {}) {
  return async function(config: any) {
    const { tools, system = '', scriptMetadataCallback, scriptResultCallback, logEnhancedSystemPrompt = false, ...restConfig } = config;
    const toolsObj: Tools = tools || {} as Tools;

    // Extract tool bindings
    const bindings = extractToolBindings(toolsObj);
    
    // Create execution sandbox
    const sandbox = new CodeExecutionSandbox(options);
    
    // Enhanced system prompt (omit Tool Calling SDK if there are no tools)
    const hasTools = Object.keys(toolsObj).length > 0;
    const codeSystemPrompt = hasTools ? generateCodeSystemPrompt(toolsObj) : '';
    const enhancedSystem = hasTools
      ? (system ? `${system}\n\n${codeSystemPrompt}` : codeSystemPrompt)
      : system;

    if (logEnhancedSystemPrompt) {
      console.log('[toolScripting] Enhanced System Prompt:\n', enhancedSystem);
    }

    // Provide exactly one tool to the SDK: runToolScript
    const singleTool = {
      runToolScript: {
        description: 'Execute the provided tool script with available functions',
        inputSchema: z.object({ 
          description: z.string().describe('Brief human-friendly description of what this script does'),
          script: z.string().describe('The JavaScript code to execute')
        }),
        execute: async ({ description, script }: { description: string; script: string }) => {
          // Notify about script execution start with description
          if (scriptMetadataCallback) {
            scriptMetadataCallback({ description, script });
          }
          
          const result = await sandbox.execute(script, bindings);
          
          // Debug logging
          console.log('[toolScripting] Script execution complete, result type:', typeof result, result === undefined ? 'UNDEFINED!' : result === null ? 'NULL!' : `length: ${(result as any)?.length || 'N/A'}`);
          
          // Notify about script execution result
          if (scriptResultCallback) {
            scriptResultCallback(result);
          }
          
          // Return just the execution result (description already streamed to client)
          return result;
        }
      }
    } as Tools;

    // Call original AI function with enhanced system prompt and single tool
    return aiFunction({
      ...restConfig,
      tools: singleTool,
      system: enhancedSystem,
    });
  };
}
