import 'dotenv/config';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { toolScripting } from '../../dist/index.js';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';

describe('integration', () => {
  before(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Missing ANTHROPIC_API_KEY in environment. Skipping integration test.');
      process.exit(1);
    }
  });

  const tools = {
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

  test('executes tool script with real model', async () => {
    const codeModeOptions = {
      logEnhancedSystemPrompt: true,
    };
    const result = await toolScripting(generateText, codeModeOptions)({
      model: anthropic('claude-sonnet-4-5-20250929'),
      tools,
      system: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'What is the weather like today?' },
      ],
      stopWhen: stepCountIs(5),
    });

    assert.ok(result.response, 'Should receive a response');
    console.log('Response:', JSON.stringify(result.response, null, 2));
  });
});
