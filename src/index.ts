import ivm from 'isolated-vm';
import { z } from 'zod';
import {
  toPascalCase,
  getParamEntries,
  getOutputSchemaInfo,
  generateTypeDefinition,
  generateFunctionTypeDeclaration,
} from './codegen';
import { DEFAULT_CODE_MODE_PROMPT } from './prompt';
import { isMCPToolResult, adaptMCPToolResult, MCPToolError } from './mcp-adapter';
import type {
  CodeModeOptions,
  ToolDefinition,
  Tools,
  ToolScriptingConfig,
  ToolResult,
  ResultSignal,
  ToolResultValue,
  OnToolResultCallback,
} from './types';
import type { MCPToolResult } from './mcp-adapter';

export type {
  CodeModeOptions,
  ToolDefinition,
  Tools,
  ToolScriptingConfig,
  ToolResult,
  MCPToolResult,
  ResultSignal,
  ToolResultValue,
  OnToolResultCallback,
};
export { isMCPToolResult, adaptMCPToolResult, MCPToolError, DEFAULT_CODE_MODE_PROMPT };

/**
 * Sentinel prefix used to signal script abort across the isolate boundary.
 * The abort result is JSON-encoded after this prefix.
 */
const ABORT_SENTINEL = '__CIRCUIT_BREAKER_ABORT__';

/**
 * Creates an abort error with the result encoded in the message.
 * Format: ABORT_SENTINEL + JSON.stringify(result)
 */
const createAbortError = (result: ToolResultValue): Error => {
  const encoded = JSON.stringify(result);
  return new Error(`${ABORT_SENTINEL}${encoded}`);
};

/**
 * Checks if an error message is an abort signal and extracts the result.
 * Returns the decoded result if it's an abort, or null otherwise.
 */
const parseAbortError = (message: string): ToolResultValue | null => {
  if (!message.startsWith(ABORT_SENTINEL)) {
    return null;
  }
  try {
    return JSON.parse(message.slice(ABORT_SENTINEL.length));
  } catch {
    return null;
  }
};

class CodeExecutionSandbox {
  private timeout: number;
  private allowConsole: boolean;
  private maxMemory: number;

  constructor(options: CodeModeOptions = {}) {
    this.timeout = options.timeout || 30000;
    this.allowConsole = options.sandbox?.allowConsole ?? true;
    this.maxMemory = options.sandbox?.maxMemory || 128 * 1024 * 1024; // 128MB
  }

  async execute(
    code: string,
    bindings: Record<string, Function>,
    includeExecutionTrace = false
  ): Promise<any> {
    // Always log the script to console for debugging
    console.log('[toolScripting] Executing script:');
    console.log(code);
    console.log('---');

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
                const formattedResult = this.formatExecutionResult(executionLog, res, undefined, includeExecutionTrace);
                resolve(formattedResult);
              }
            }),
            new ivm.Reference((msg: string) => {
              if (!finished) {
                finished = true;
                clearTimeout(wallTimer);
                cleanup();

                // Check if this is a circuit breaker abort signal
                const abortResult = parseAbortError(msg);
                if (abortResult !== null) {
                  // Return abort result directly - client controls the format
                  const abortResultStr =
                    typeof abortResult === 'string'
                      ? abortResult
                      : JSON.stringify(abortResult);
                  resolve(abortResultStr);
                  return;
                }

                // Include execution log even on error
                const formattedError = this.formatExecutionResult(executionLog, null, msg, includeExecutionTrace);
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
  private formatExecutionResult(log: Array<{ fn: string; args: any; result: any }>, finalResult: any, error?: string, includeExecutionTrace = false): string {
    // Always log execution trace to console for debugging
    if (log.length > 0) {
      console.log('[toolScripting] Execution trace:');
      for (const entry of log) {
        const argsStr = JSON.stringify(entry.args);
        const resultStr = typeof entry.result === 'string'
          ? entry.result
          : JSON.stringify(entry.result);
        console.log(`  ${entry.fn}(${argsStr}) → ${resultStr}`);
      }
    }

    const lines: string[] = [];

    // Add execution log to result only if requested
    if (includeExecutionTrace && log.length > 0) {
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

/**
 * Extract tool bindings from tool definitions, wrapping each execute function
 * to handle MCP adaptation and circuit breaker callbacks.
 *
 * @param tools - Tool definitions to extract bindings from
 * @param onToolResult - Optional callback to inspect/modify results and signal abort
 */
function extractToolBindings(
  tools: Tools,
  onToolResult?: OnToolResultCallback
): Record<string, Function> {
  const bindings: Record<string, Function> = {};

  for (const [name, tool] of Object.entries(tools)) {
    // Sanitize tool name to ensure it's a valid JavaScript identifier
    const sanitizedName = sanitizeToolName(name);

    if (!tool.execute) {
      throw new Error(`Tool "${name}" must have an execute function for code mode`);
    }

    const wrappedExecute = async (...args: any[]) => {
      // If no arguments provided, pass empty object {} to match AI SDK tool expectations
      // This handles the case where LLM calls getData() but tool expects getData({})
      const executeArgs = args.length === 0 ? [{}] : args;
      let result: any = await tool.execute!(...executeArgs);

      // Apply MCP adapter if result matches MCP tool result format
      if (isMCPToolResult(result)) {
        result = adaptMCPToolResult(result, tool.outputSchema);
      }

      // Circuit breaker callback - inspect result and optionally abort
      if (onToolResult) {
        const signal = onToolResult(name, result);
        if (signal.signal === 'abort') {
          // Throw error with result encoded in message - sandbox will detect and handle
          throw createAbortError(signal.result);
        }
        // Allow callback to modify result
        return signal.result;
      }

      return result;
    };

    bindings[sanitizedName] = wrappedExecute;
  }

  return bindings;
}

function generateCodeSystemPrompt(tools: Tools, customPrompt?: (toolDescriptions: string, defaultPrompt: string) => string): string {
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
      let returnType = 'unknown';

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
      lines.push(generateFunctionTypeDeclaration(sanitizedName, tool.description || '', params, returnType));

      return lines.join('\n');
    })
    .join('\n\n');

  const defaultPrompt = DEFAULT_CODE_MODE_PROMPT(toolDescriptions);

  if (customPrompt) {
    return customPrompt(toolDescriptions, defaultPrompt);
  }

  return defaultPrompt;
}

export function toolScripting(aiFunction: Function, options: CodeModeOptions = {}) {
  return async function(config: ToolScriptingConfig) {
    const { tools, system = '', scriptMetadataCallback, scriptResultCallback, ...restConfig } = config;
    const toolsObj: Tools = tools || {} as Tools;

    // Extract tool bindings with circuit breaker callback
    const bindings = extractToolBindings(toolsObj, options.onToolResult);

    // Create execution sandbox
    const sandbox = new CodeExecutionSandbox(options);

    // Enhanced system prompt (omit Tool Calling SDK if there are no tools)
    const hasTools = Object.keys(toolsObj).length > 0;
    const codeSystemPrompt = hasTools ? generateCodeSystemPrompt(toolsObj, options.customToolSdkPrompt) : '';
    const enhancedSystem = hasTools
      ? (system ? `${system}\n\n${codeSystemPrompt}` : codeSystemPrompt)
      : system;

    if (options.logEnhancedSystemPrompt) {
      console.log('[toolScripting] Enhanced System Prompt:\n', enhancedSystem);
    }

    // Provide exactly one tool to the SDK: runToolScript
    const singleTool = {
      runToolScript: {
        description: 'Execute the provided tool script with available functions',
        inputSchema: z.object({
          description: z.string().describe('Brief human-friendly description of what this script does'),
          script: z.string().describe('The JavaScript code to execute'),
          includeExecutionTrace: z.boolean().optional().describe('Set to true ONLY when debugging to see each function call and result. Omit or set to false by default to reduce token usage and allow efficient extraction of data from large responses')
        }),
        execute: async ({ description, script, includeExecutionTrace }: { description: string; script: string; includeExecutionTrace?: boolean }) => {
          // Notify about script execution start with description
          if (scriptMetadataCallback) {
            scriptMetadataCallback({ description, script });
          }

          const result = await sandbox.execute(script, bindings, includeExecutionTrace);

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
