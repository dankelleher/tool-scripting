/**
 * Adapter for MCP tool execution results
 *
 * MCP tools return: { content?: Array<{type: string, text?: string}>, structuredContent?: any, isError?: boolean }
 * This adapter normalizes the result based on the tool's output schema.
 */

export interface MCPToolResult {
    isError?: boolean;
    content?: Array<{
        type: string;
        text?: string;
        [key: string]: any;
    }>;
    structuredContent?: Record<string, unknown>;
}

/**
 * Error class for MCP tool errors
 * Contains the original MCP result data for inspection
 */
export class MCPToolError extends Error {
    readonly content?: MCPToolResult['content'];
    readonly structuredContent?: MCPToolResult['structuredContent'];

    constructor(result: MCPToolResult) {
        // Extract error message from content if available
        const message = result.content?.[0]?.text ?? 'MCP tool execution failed';
        super(message);
        this.name = 'MCPToolError';
        this.content = result.content;
        this.structuredContent = result.structuredContent;
    }
}

/**
 * Check if a result matches the MCP tool result format.
 *
 * Detects MCP results by checking for `content` (array of content blocks)
 * or `structuredContent` (object). `isError` is optional per the MCP spec
 * and is often omitted for successful calls.
 */
export function isMCPToolResult(result: any): result is MCPToolResult {
    if (result === null || typeof result !== 'object') {
        return false;
    }

    // If isError is present, it must be a boolean
    if ('isError' in result && typeof result.isError !== 'boolean') {
        return false;
    }

    // Check for structuredContent (must be a plain object)
    if ('structuredContent' in result && result.structuredContent !== null && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) {
        return true;
    }

    // Check for content (must be an array of content blocks with a 'type' field)
    if ('content' in result && Array.isArray(result.content) && result.content.length > 0 && typeof result.content[0]?.type === 'string') {
        return true;
    }

    return false;
}

/**
 * Adapts MCP tool execution results to a normalized format
 *
 * @param mcpResult - The raw result from MCP tool execution
 * @param outputSchema - The tool's output schema (if any)
 * @returns Adapted result based on the following rules:
 *   - If isError is true, throws MCPToolError (allows LLM to self-correct)
 *   - If structuredContent exists, returns it
 *   - If no content, returns undefined
 *   - If multiple content entries, returns all
 *   - If single text content entry, tries to parse as JSON (regardless of output schema)
 *   - Otherwise returns the content entry itself
 * @throws {MCPToolError} When isError is true
 */
export function adaptMCPToolResult(result: MCPToolResult, outputSchema?: any): any {
    // If isError is true, throw an MCPToolError so the LLM can self-correct
    if (result.isError) {
        throw new MCPToolError(result);
    }

    // If structuredContent exists, return it
    if (result?.structuredContent) {
        return result.structuredContent;
    }

    const content = result?.content;

    // If no content, return undefined
    if (!content || content.length === 0) {
        return undefined;
    }

    // If multiple content entries, return all
    if (content.length > 1) {
        return content;
    }

    // Single content entry - extract it intelligently
    const singleContent = content[0];

    // If type is "text", try to parse as JSON (even without output schema)
    if (singleContent.type === 'text' && singleContent.text) {
        try {
            return JSON.parse(singleContent.text);
        } catch (error) {
            // If JSON parsing fails, return the text as-is
            return singleContent.text;
        }
    }

    // For non-text types, return the content entry itself
    return singleContent;
}
