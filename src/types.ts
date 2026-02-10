/**
 * Result of a tool execution that can be inspected by the circuit breaker callback.
 */
export type ToolResultValue = unknown;

/**
 * Signal returned by the onToolResult callback to control script execution.
 * - "continue": Continue script execution with the (possibly modified) result
 * - "abort": Stop script execution immediately and return the result to the LLM
 */
export interface ResultSignal {
  signal: 'continue' | 'abort';
  result: ToolResultValue;
}

/**
 * Callback invoked after each tool execution completes.
 * Use this to inspect results and optionally abort script execution early.
 *
 * @param toolName - The name of the tool that was executed
 * @param result - The result returned by the tool (after MCP adaptation)
 * @returns A signal indicating whether to continue or abort, along with the result
 */
export type OnToolResultCallback = (
  toolName: string,
  result: ToolResultValue
) => ResultSignal;

export interface CodeModeOptions {
  timeout?: number;
  sandbox?: {
    allowConsole?: boolean;
    maxMemory?: number;
  };
  logEnhancedSystemPrompt?: boolean;
  /**
   * Customize the code mode system prompt.
   *
   * Receives the generated TypeScript tool descriptions and the fully-assembled
   * default prompt (with tool descriptions already interpolated).
   *
   * - **Append** to the default prompt:
   *   `(tools, defaultPrompt) => `${defaultPrompt}\n\nAlways return dates in ISO format.``
   * - **Replace** the default prompt entirely:
   *   `(toolDescriptions) => `My custom prompt\n\n${toolDescriptions}``
   */
  customToolSdkPrompt?: (toolDescriptions: string, defaultPrompt: string) => string;
  onCodeGenerated?: (code: string) => void;
  onCodeExecuted?: (result: any) => void;
  onError?: (error: Error) => void;
  /**
   * Circuit breaker callback invoked after each tool execution.
   * Allows inspecting tool results and aborting script execution early.
   *
   * Use this to detect special responses (like auth-required) and stop
   * the script before it continues with invalid data.
   *
   * @example
   * ```typescript
   * onToolResult: (toolName, result) => {
   *   if (isAuthRequired(result)) {
   *     return { signal: 'abort', result };
   *   }
   *   return { signal: 'continue', result };
   * }
   * ```
   */
  onToolResult?: OnToolResultCallback;
}

export type ToolResult = {
  isError: boolean;
  content?: any[];
  structuredContent?: Record<string, any>;
}

export interface ToolDefinition {
  description?: string;
  inputSchema: any;
  outputSchema?: any;
  execute?: (...args: any[]) => Promise<ToolResult> | ToolResult;
}

export interface Tools {
  [key: string]: ToolDefinition;
}

export interface ToolScriptingConfig {
  tools?: Tools;
  system?: string;
  scriptMetadataCallback?: (metadata: { description: string; script: string }) => void;
  scriptResultCallback?: (result: any) => void;
  [key: string]: any; // Allow other properties to pass through to the AI function
}
