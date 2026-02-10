import { describe, test, mock } from 'node:test';
import assert from 'node:assert';
import { toolScripting } from '../../dist/index.js';
import type { OnToolResultCallback } from '../../src/types';
import { generateText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

/**
 * Creates a mock model that returns a tool script on first call
 * and final text on second call.
 */
function createMockModel(script: string) {
  let callCount = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      callCount++;
      if (callCount === 1) {
        return {
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 20 },
          content: [
            {
              type: 'tool-call',
              toolCallType: 'function',
              toolCallId: 'call_1',
              toolName: 'runToolScript',
              input: JSON.stringify({ script, description: 'Test script' }),
            },
          ],
          warnings: [],
        };
      }
      return {
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20 },
        content: [{ type: 'text', text: 'Done.' }],
        warnings: [],
      };
    },
  });
}

describe('onToolResult callback - circuit breaker', () => {
  test('callback is invoked for each tool execution', async () => {
    const toolCallResults: Array<{ toolName: string; result: unknown }> = [];

    const tools = {
      getData: tool({
        description: 'Get some data',
        inputSchema: z.object({}),
        outputSchema: z.object({ value: z.number() }),
        execute: async () => ({ value: 42 }),
      }),
    };

    const onToolResult: OnToolResultCallback = (toolName, result, _toolArgs) => {
      toolCallResults.push({ toolName, result });
      return { signal: 'continue', result };
    };

    const model = createMockModel('return await getData();');

    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Get data' }],
      maxSteps: 5,
    });

    assert.strictEqual(toolCallResults.length, 1);
    assert.strictEqual(toolCallResults[0].toolName, 'getData');
    assert.deepStrictEqual(toolCallResults[0].result, { value: 42 });
  });

  test('callback can modify tool results', async () => {
    const tools = {
      getData: tool({
        description: 'Get some data',
        inputSchema: z.object({}),
        outputSchema: z.object({ value: z.number() }),
        execute: async () => ({ value: 42 }),
      }),
    };

    let scriptResult: string | undefined;
    const onToolResult: OnToolResultCallback = (_toolName, _result, _toolArgs) => {
      // Modify the result
      return { signal: 'continue', result: { value: 100 } };
    };

    const model = createMockModel('const data = await getData(); return data.value;');

    const result = await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Get data' }],
      maxSteps: 5,
      scriptResultCallback: (r: string) => {
        scriptResult = r;
      },
    });

    // The script should receive the modified value (100), not the original (42)
    assert.ok(scriptResult?.includes('100'), `Expected result to contain 100, got: ${scriptResult}`);
  });

  test('abort signal stops script execution and returns result to LLM', async () => {
    const executionOrder: string[] = [];
    const authResponse = {
      _meta: { name: 'authorization_url' },
      url: 'https://auth.example.com/authorize',
    };

    const tools = {
      toolA: tool({
        description: 'First tool - requires auth',
        inputSchema: z.object({}),
        outputSchema: z.object({ data: z.string() }),
        execute: async () => {
          executionOrder.push('toolA');
          // Simulate auth-required response
          return authResponse as any;
        },
      }),
      toolB: tool({
        description: 'Second tool - should not run',
        inputSchema: z.object({}),
        outputSchema: z.object({ data: z.string() }),
        execute: async () => {
          executionOrder.push('toolB');
          return { data: 'from toolB' };
        },
      }),
    };

    const onToolResult: OnToolResultCallback = (toolName, result, _toolArgs) => {
      // Detect auth-required response and abort
      if (
        result &&
        typeof result === 'object' &&
        '_meta' in result &&
        (result as any)._meta?.name === 'authorization_url'
      ) {
        return { signal: 'abort', result };
      }
      return { signal: 'continue', result };
    };

    // Script that calls toolA then toolB
    const model = createMockModel(`
      const a = await toolA();
      const b = await toolB();
      return { a, b };
    `);

    let scriptResult: string | undefined;
    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Run tools' }],
      maxSteps: 5,
      scriptResultCallback: (r: string) => {
        scriptResult = r;
      },
    });

    // toolA should run, but toolB should NOT run due to abort
    assert.deepStrictEqual(executionOrder, ['toolA']);

    // The result should contain the auth response (client controls format)
    assert.ok(scriptResult?.includes('authorization_url'), `Expected auth response, got: ${scriptResult}`);
  });

  test('abort preserves structured auth response for LLM', async () => {
    const authResponse = {
      _meta: { name: 'authorization_url' },
      authUrl: 'https://example.com/auth',
      provider: 'google',
    };

    const tools = {
      authTool: tool({
        description: 'Tool that needs auth',
        inputSchema: z.object({}),
        outputSchema: z.any(),
        execute: async () => authResponse as any,
      }),
    };

    const onToolResult: OnToolResultCallback = (_toolName, result, _toolArgs) => {
      if (
        result &&
        typeof result === 'object' &&
        '_meta' in result &&
        (result as any)._meta?.name === 'authorization_url'
      ) {
        return { signal: 'abort', result };
      }
      return { signal: 'continue', result };
    };

    const model = createMockModel('return await authTool();');

    let scriptResult: string | undefined;
    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Call auth tool' }],
      maxSteps: 5,
      scriptResultCallback: (r: string) => {
        scriptResult = r;
      },
    });

    // Verify the auth response is preserved in the result
    assert.ok(scriptResult?.includes('authorization_url'));
    assert.ok(scriptResult?.includes('https://example.com/auth'));
    assert.ok(scriptResult?.includes('google'));
  });

  test('continue signal allows normal execution', async () => {
    const executionOrder: string[] = [];

    const tools = {
      toolA: tool({
        description: 'First tool',
        inputSchema: z.object({}),
        outputSchema: z.object({ data: z.string() }),
        execute: async () => {
          executionOrder.push('toolA');
          return { data: 'from toolA' };
        },
      }),
      toolB: tool({
        description: 'Second tool',
        inputSchema: z.object({}),
        outputSchema: z.object({ data: z.string() }),
        execute: async () => {
          executionOrder.push('toolB');
          return { data: 'from toolB' };
        },
      }),
    };

    // Always continue
    const onToolResult: OnToolResultCallback = (_toolName, result, _toolArgs) => ({
      signal: 'continue',
      result,
    });

    const model = createMockModel(`
      const a = await toolA();
      const b = await toolB();
      return { a, b };
    `);

    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Run tools' }],
      maxSteps: 5,
    });

    // Both tools should run
    assert.deepStrictEqual(executionOrder, ['toolA', 'toolB']);
  });

  test('works without onToolResult callback (backwards compatible)', async () => {
    const tools = {
      getData: tool({
        description: 'Get some data',
        inputSchema: z.object({}),
        outputSchema: z.object({ value: z.number() }),
        execute: async () => ({ value: 42 }),
      }),
    };

    const model = createMockModel('return await getData();');

    let scriptResult: string | undefined;
    // No onToolResult callback - should work as before
    await toolScripting(generateText)({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Get data' }],
      maxSteps: 5,
      scriptResultCallback: (r: string) => {
        scriptResult = r;
      },
    });

    assert.ok(scriptResult?.includes('42'));
  });

  test('callback receives tool arguments', async () => {
    const receivedArgs: Record<string, unknown>[] = [];

    const tools = {
      getUser: tool({
        description: 'Get a user by ID',
        inputSchema: z.object({ userId: z.string(), includeEmail: z.boolean() }),
        outputSchema: z.object({ name: z.string() }),
        execute: async ({ userId }: { userId: string; includeEmail: boolean }) => ({ name: `User ${userId}` }),
      }),
    };

    const onToolResult: OnToolResultCallback = (_toolName, result, toolArgs) => {
      receivedArgs.push(toolArgs);
      return { signal: 'continue', result };
    };

    const model = createMockModel('return await getUser({ userId: "abc-123", includeEmail: true });');

    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Get user' }],
      maxSteps: 5,
    });

    assert.strictEqual(receivedArgs.length, 1);
    assert.deepStrictEqual(receivedArgs[0], { userId: 'abc-123', includeEmail: true });
  });

  test('callback receives empty object for no-arg tool calls', async () => {
    let receivedArgs: Record<string, unknown> | undefined;

    const tools = {
      ping: tool({
        description: 'Ping',
        inputSchema: z.object({}),
        outputSchema: z.object({ pong: z.boolean() }),
        execute: async () => ({ pong: true }),
      }),
    };

    const onToolResult: OnToolResultCallback = (_toolName, result, toolArgs) => {
      receivedArgs = toolArgs;
      return { signal: 'continue', result };
    };

    const model = createMockModel('return await ping();');

    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Ping' }],
      maxSteps: 5,
    });

    assert.deepStrictEqual(receivedArgs, {});
  });

  test('callback receives sanitized tool name', async () => {
    let receivedToolName: string | undefined;

    const tools = {
      // Kebab-case tool name (common in MCP)
      'my-special-tool': tool({
        description: 'Tool with kebab-case name',
        inputSchema: z.object({}),
        outputSchema: z.object({ data: z.string() }),
        execute: async () => ({ data: 'result' }),
      }),
    };

    const onToolResult: OnToolResultCallback = (toolName, result, _toolArgs) => {
      receivedToolName = toolName;
      return { signal: 'continue', result };
    };

    // Script uses sanitized name (underscores instead of hyphens)
    const model = createMockModel('return await my_special_tool();');

    await toolScripting(generateText, { onToolResult })({
      model,
      tools,
      system: 'Test',
      messages: [{ role: 'user', content: 'Call tool' }],
      maxSteps: 5,
    });

    // The callback receives the original tool name (not sanitized)
    assert.strictEqual(receivedToolName, 'my-special-tool');
  });
});
