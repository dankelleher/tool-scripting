import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  isMCPToolResult,
  adaptMCPToolResult,
  MCPToolError,
} from '../../src/mcp-adapter';

describe('isMCPToolResult', () => {
  test('returns true for valid MCP result with content', () => {
    const result = {
      isError: false,
      content: [{ type: 'text', text: 'hello' }],
    };
    assert.strictEqual(isMCPToolResult(result), true);
  });

  test('returns true for valid MCP result with structuredContent', () => {
    const result = {
      isError: false,
      structuredContent: { foo: 'bar' },
    };
    assert.strictEqual(isMCPToolResult(result), true);
  });

  test('returns true for error MCP result', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'Something went wrong' }],
    };
    assert.strictEqual(isMCPToolResult(result), true);
  });

  test('returns false for non-object', () => {
    assert.strictEqual(isMCPToolResult('string'), false);
    assert.strictEqual(isMCPToolResult(123), false);
    assert.strictEqual(isMCPToolResult(null), false);
  });

  test('returns false for object without isError', () => {
    const result = { content: [{ type: 'text', text: 'hello' }] };
    assert.strictEqual(isMCPToolResult(result), false);
  });

  test('returns false for object without content or structuredContent', () => {
    const result = { isError: false };
    assert.strictEqual(isMCPToolResult(result), false);
  });
});

describe('adaptMCPToolResult - success cases', () => {
  test('returns structuredContent when available', () => {
    const result = {
      isError: false,
      structuredContent: { foo: 'bar', count: 42 },
      content: [{ type: 'text', text: 'ignored' }],
    };
    const adapted = adaptMCPToolResult(result);
    assert.deepStrictEqual(adapted, { foo: 'bar', count: 42 });
  });

  test('returns undefined for empty content', () => {
    const result = {
      isError: false,
      content: [],
    };
    const adapted = adaptMCPToolResult(result);
    assert.strictEqual(adapted, undefined);
  });

  test('returns all content entries for multiple entries', () => {
    const result = {
      isError: false,
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    };
    const adapted = adaptMCPToolResult(result);
    assert.deepStrictEqual(adapted, [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]);
  });

  test('parses JSON from single text content', () => {
    const result = {
      isError: false,
      content: [{ type: 'text', text: '{"name":"John","age":30}' }],
    };
    const adapted = adaptMCPToolResult(result);
    assert.deepStrictEqual(adapted, { name: 'John', age: 30 });
  });

  test('returns text as-is when JSON parsing fails', () => {
    const result = {
      isError: false,
      content: [{ type: 'text', text: 'plain text result' }],
    };
    const adapted = adaptMCPToolResult(result);
    assert.strictEqual(adapted, 'plain text result');
  });

  test('returns non-text content entry as-is', () => {
    const result = {
      isError: false,
      content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
    };
    const adapted = adaptMCPToolResult(result);
    assert.deepStrictEqual(adapted, { type: 'image', data: 'base64data', mimeType: 'image/png' });
  });
});

describe('adaptMCPToolResult - error cases', () => {
  test('throws MCPToolError when isError is true', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'Tool execution failed: invalid input' }],
    };

    assert.throws(
      () => adaptMCPToolResult(result),
      MCPToolError
    );
  });

  test('MCPToolError message is extracted from content text', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'Invalid parameter: location is required' }],
    };

    try {
      adaptMCPToolResult(result);
      assert.fail('Expected MCPToolError to be thrown');
    } catch (error) {
      assert.ok(error instanceof MCPToolError);
      assert.strictEqual(error.message, 'Invalid parameter: location is required');
    }
  });

  test('MCPToolError contains content from result', () => {
    const result = {
      isError: true,
      content: [
        { type: 'text', text: 'Error message' },
        { type: 'text', text: 'Additional details' },
      ],
    };

    try {
      adaptMCPToolResult(result);
      assert.fail('Expected MCPToolError to be thrown');
    } catch (error) {
      assert.ok(error instanceof MCPToolError);
      assert.deepStrictEqual(error.content, result.content);
    }
  });

  test('MCPToolError contains structuredContent from result', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'Error' }],
      structuredContent: { errorCode: 'INVALID_INPUT', field: 'location' },
    };

    try {
      adaptMCPToolResult(result);
      assert.fail('Expected MCPToolError to be thrown');
    } catch (error) {
      assert.ok(error instanceof MCPToolError);
      assert.deepStrictEqual(error.structuredContent, { errorCode: 'INVALID_INPUT', field: 'location' });
    }
  });

  test('MCPToolError uses default message when no content text', () => {
    const result = {
      isError: true,
      content: [],
    };

    try {
      adaptMCPToolResult(result);
      assert.fail('Expected MCPToolError to be thrown');
    } catch (error) {
      assert.ok(error instanceof MCPToolError);
      assert.strictEqual(error.message, 'MCP tool execution failed');
    }
  });

  test('MCPToolError has correct name property', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'Error' }],
    };

    try {
      adaptMCPToolResult(result);
      assert.fail('Expected MCPToolError to be thrown');
    } catch (error) {
      assert.ok(error instanceof MCPToolError);
      assert.strictEqual(error.name, 'MCPToolError');
    }
  });
});

describe('MCPToolError', () => {
  test('is instanceof Error', () => {
    const error = new MCPToolError({
      isError: true,
      content: [{ type: 'text', text: 'test error' }],
    });
    assert.ok(error instanceof Error);
  });

  test('can be caught as Error', () => {
    const result = {
      isError: true,
      content: [{ type: 'text', text: 'test error' }],
    };

    try {
      adaptMCPToolResult(result);
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.strictEqual((error as Error).message, 'test error');
    }
  });
});
