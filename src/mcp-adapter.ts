/**
 * Adapter for MCP tool execution results
 *
 * MCP tools return: { isError: boolean, result: { content?: Array<{type: string, text?: string}>, structuredContent?: any } }
 * This adapter normalizes the result based on the tool's output schema.
 */

export interface MCPToolResult {
    isError: boolean;
    content?: Array<{
        type: string;
        text?: string;
        [key: string]: any;
    }>;
    structuredContent?: any;
}

/**
 * Check if a result matches the MCP tool result format
 */
export function isMCPToolResult(result: any): result is MCPToolResult {
    return (
        result !== null &&
        typeof result === 'object' &&
        'isError' in result &&
        typeof result.isError === 'boolean' &&
        ('content' in result || 'structuredContent' in result)
    );
}

/**
 * Adapts MCP tool execution results to a normalized format
 *
 * @param mcpResult - The raw result from MCP tool execution
 * @param outputSchema - The tool's output schema (if any)
 * @returns Adapted result based on the following rules:
 *   - If isError is true, returns unchanged
 *   - If structuredContent exists, returns it
 *   - If no content, returns undefined
 *   - If multiple content entries, returns all
 *   - If single text content entry, tries to parse as JSON (regardless of output schema)
 *   - Otherwise returns the content entry itself
 */
export function adaptMCPToolResult(result: MCPToolResult, outputSchema?: any): any {
    // If isError is true, return unchanged
    if (result.isError) {
        return result;
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
