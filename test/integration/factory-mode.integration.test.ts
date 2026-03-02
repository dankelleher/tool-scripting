import 'dotenv/config';
import assert from 'node:assert';
import { before, describe, test } from 'node:test';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { createCodeMode } from '../../dist/index.js';

describe('createCodeMode integration', () => {
  before(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        'Missing ANTHROPIC_API_KEY in environment. Skipping integration test.',
      );
      process.exit(1);
    }
  });

  const initialTools = {
    getUserLocation: tool({
      description: 'Get user current location',
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute: async () => 'San Francisco, CA',
    }),
    getWeather: tool({
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string(),
      }),
      outputSchema: z.object({
        location: z.string(),
        temperature: z.number(),
        condition: z.string(),
      }),
      execute: async ({ location }: { location: string }) => ({
        location,
        temperature: 65,
        condition: 'foggy',
      }),
    }),
  };

  test('factory mode works with real model', async () => {
    const codeMode = createCodeMode({ logEnhancedSystemPrompt: true });
    const codeModeTools = codeMode.createTool(initialTools);
    const systemPrompt = codeMode.generateSystemPrompt(initialTools);

    const result = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      tools: codeModeTools,
      system: `You are a helpful assistant.\n\n${systemPrompt}`,
      messages: [{ role: 'user', content: 'What is the weather like today?' }],
      stopWhen: stepCountIs(5),
    });

    assert.ok(result.response, 'Should receive a response');
    console.log('Response:', JSON.stringify(result.response, null, 2));
  });

  test('simulates tool refresh with different tool sets', async () => {
    const codeMode = createCodeMode();

    // Step 1: Initial tool set (weather only)
    const v1Tools = codeMode.createTool(initialTools);
    const v1Prompt = codeMode.generateSystemPrompt(initialTools);

    const result1 = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      tools: v1Tools,
      system: `You are a helpful assistant.\n\n${v1Prompt}`,
      messages: [{ role: 'user', content: 'What is the weather like today?' }],
      stopWhen: stepCountIs(5),
    });

    assert.ok(result1.response, 'Step 1 should receive a response');

    // Step 2: Refreshed tool set (weather + new getLocalTime tool)
    const refreshedToolDefs = {
      ...initialTools,
      getLocalTime: tool({
        description: 'Get local time for a location',
        inputSchema: z.object({
          location: z.string().describe('Location to get time for'),
        }),
        outputSchema: z.object({
          time: z.string(),
          timezone: z.string(),
        }),
        execute: async () => ({
          time: '3:45 PM',
          timezone: 'America/Los_Angeles',
        }),
      }),
    };

    const v2Tools = codeMode.createTool(refreshedToolDefs);
    const v2Prompt = codeMode.generateSystemPrompt(refreshedToolDefs);

    // Verify the prompt now includes the new tool
    assert.ok(
      v2Prompt.includes('getLocalTime'),
      'Refreshed prompt should include getLocalTime',
    );
    assert.ok(
      v2Prompt.includes('getWeather'),
      'Refreshed prompt should still include getWeather',
    );

    const result2 = await generateText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      tools: v2Tools,
      system: `You are a helpful assistant.\n\n${v2Prompt}`,
      messages: [
        { role: 'user', content: 'What is the weather and local time today?' },
      ],
      stopWhen: stepCountIs(5),
    });

    assert.ok(result2.response, 'Step 2 should receive a response');
    console.log(
      'Refreshed response:',
      JSON.stringify(result2.response, null, 2),
    );
  });
});
