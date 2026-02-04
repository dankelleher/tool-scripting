import { describe, test } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import {
  toPascalCase,
  jsonSchemaToTypeString,
  getSchemaDescription,
  toJsonSchema,
  getParamEntries,
  getOutputSchemaInfo,
  generateTypeDefinition,
  generateFunctionTypeDeclaration,
} from '../../src/codegen';
import type { ToolDefinition } from '../../src/types';

describe('toPascalCase', () => {
  test('converts simple snake_case to PascalCase', () => {
    assert.strictEqual(toPascalCase('get_user_location'), 'GetUserLocation');
  });

  test('converts kebab-case to PascalCase', () => {
    assert.strictEqual(toPascalCase('get-user-location'), 'GetUserLocation');
  });

  test('handles mixed case and special characters', () => {
    assert.strictEqual(toPascalCase('getUserLocation_v2'), 'GetuserlocationV2');
  });

  test('handles multiple special characters', () => {
    assert.strictEqual(toPascalCase('get__user___location'), 'GetUserLocation');
  });
});

describe('jsonSchemaToTypeString - Primitives', () => {
  test('handles string type', () => {
    assert.strictEqual(jsonSchemaToTypeString({ type: 'string' }), 'string');
  });

  test('handles number type', () => {
    assert.strictEqual(jsonSchemaToTypeString({ type: 'number' }), 'number');
  });

  test('handles boolean type', () => {
    assert.strictEqual(jsonSchemaToTypeString({ type: 'boolean' }), 'boolean');
  });

  test('handles null type', () => {
    assert.strictEqual(jsonSchemaToTypeString({ type: 'null' }), 'null');
  });

  test('handles integer type as number', () => {
    assert.strictEqual(jsonSchemaToTypeString({ type: 'integer' }), 'number');
  });

  test('handles unknown schema', () => {
    assert.strictEqual(jsonSchemaToTypeString(null), 'unknown');
  });

  test('handles undefined schema', () => {
    assert.strictEqual(jsonSchemaToTypeString(undefined), 'unknown');
  });
});

describe('jsonSchemaToTypeString - Enums', () => {
  test('handles string enum', () => {
    const result = jsonSchemaToTypeString({
      type: 'string',
      enum: ['red', 'green', 'blue'],
    });
    assert.strictEqual(result, '"red" | "green" | "blue"');
  });
});

describe('jsonSchemaToTypeString - Arrays', () => {
  test('handles array type (JSON Schema)', () => {
    assert.strictEqual(
      jsonSchemaToTypeString({ type: 'array', items: { type: 'string' } }),
      'string[]'
    );
  });

  test('handles nested arrays', () => {
    assert.strictEqual(
      jsonSchemaToTypeString({
        type: 'array',
        items: { type: 'array', items: { type: 'number' } },
      }),
      'number[][]'
    );
  });
});

describe('jsonSchemaToTypeString - Objects', () => {
  test('handles object type (JSON Schema)', () => {
    const result = jsonSchemaToTypeString({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    });
    assert.strictEqual(result, '{ name: string, age: number }');
  });

  test('handles nested objects', () => {
    const result = jsonSchemaToTypeString({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    });
    assert.strictEqual(result, '{ user: { name: string } }');
  });
});

describe('jsonSchemaToTypeString - Zod schemas', () => {
  test('handles Zod string', () => {
    const zodSchema = z.string();
    assert.strictEqual(jsonSchemaToTypeString(zodSchema), 'string');
  });

  test('handles Zod number', () => {
    const zodSchema = z.number();
    assert.strictEqual(jsonSchemaToTypeString(zodSchema), 'number');
  });

  test('handles Zod boolean', () => {
    const zodSchema = z.boolean();
    assert.strictEqual(jsonSchemaToTypeString(zodSchema), 'boolean');
  });

  test('handles Zod array', () => {
    const zodSchema = z.array(z.string());
    assert.strictEqual(jsonSchemaToTypeString(zodSchema), 'string[]');
  });

  test('handles Zod object', () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = jsonSchemaToTypeString(zodSchema);
    assert.strictEqual(result, '{ name: string, age: number }');
  });

  test('handles Zod optional', () => {
    const zodSchema = z.string().optional();
    assert.strictEqual(jsonSchemaToTypeString(zodSchema), 'string');
  });

  test('handles Zod nullable', () => {
    const zodSchema = z.string().nullable();
    assert.strictEqual(jsonSchemaToTypeString(zodSchema), 'string');
  });
});

describe('jsonSchemaToTypeString - Union types', () => {
  test('handles anyOf', () => {
    const result = jsonSchemaToTypeString({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
    assert.strictEqual(result, 'string | number');
  });

  test('handles oneOf', () => {
    const result = jsonSchemaToTypeString({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    });
    assert.strictEqual(result, 'string | number');
  });

  test('handles anyOf with null (filters null)', () => {
    const result = jsonSchemaToTypeString({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
    assert.strictEqual(result, 'string');
  });

  test('handles array of types', () => {
    const result = jsonSchemaToTypeString({
      type: ['string', 'number'],
    });
    assert.strictEqual(result, 'string | number');
  });

  test('handles array of types with null', () => {
    const result = jsonSchemaToTypeString({
      type: ['string', 'null'],
    });
    assert.strictEqual(result, 'string');
  });
});

describe('getSchemaDescription', () => {
  test('extracts description from JSON Schema', () => {
    const schema = {
      type: 'string',
      description: 'User name',
    };
    assert.strictEqual(getSchemaDescription(schema), 'User name');
  });

  test('extracts description from Zod schema', () => {
    const zodSchema = z.string().describe('User name');
    assert.strictEqual(getSchemaDescription(zodSchema), 'User name');
  });

  test('returns undefined for no description', () => {
    assert.strictEqual(getSchemaDescription({ type: 'string' }), undefined);
  });

  test('returns undefined for null schema', () => {
    assert.strictEqual(getSchemaDescription(null), undefined);
  });
});

describe('toJsonSchema', () => {
  test('returns null for null schema', () => {
    assert.strictEqual(toJsonSchema(null), null);
  });

  test('returns JSON Schema as-is', () => {
    const schema = { type: 'string' };
    const result = toJsonSchema(schema);
    assert.deepStrictEqual(result, schema);
  });

  test('converts Zod to JSON Schema', () => {
    const zodSchema = z.string();
    const result = toJsonSchema(zodSchema);
    assert.ok(result !== null && result.type === 'string');
  });
});

describe('getParamEntries', () => {
  test('extracts parameters from Zod object', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      inputSchema: z.object({
        name: z.string().describe('User name'),
        age: z.number().describe('User age'),
      }),
      execute: async () => {},
    };

    const params = getParamEntries(tool);
    assert.strictEqual(params.length, 2);

    const nameParam = params.find((p) => p.name === 'name');
    assert.ok(nameParam);
    assert.strictEqual(nameParam.type, 'string');
    assert.strictEqual(nameParam.description, 'User name');
    assert.strictEqual(nameParam.optional, false);

    const ageParam = params.find((p) => p.name === 'age');
    assert.ok(ageParam);
    assert.strictEqual(ageParam.type, 'number');
    assert.strictEqual(ageParam.description, 'User age');
    assert.strictEqual(ageParam.optional, false);
  });

  test('handles optional parameters', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      inputSchema: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
      execute: async () => {},
    };

    const params = getParamEntries(tool);
    const requiredParam = params.find((p) => p.name === 'required');
    const optionalParam = params.find((p) => p.name === 'optional');

    assert.strictEqual(requiredParam?.optional, false);
    assert.strictEqual(optionalParam?.optional, true);
  });

  test('handles empty schema', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      inputSchema: z.object({}),
      execute: async () => {},
    };

    const params = getParamEntries(tool);
    assert.strictEqual(params.length, 0);
  });

  test('handles missing schema', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      execute: async () => {},
    };

    const params = getParamEntries(tool);
    assert.strictEqual(params.length, 0);
  });
});

describe('getOutputSchemaInfo', () => {
  test('handles string output', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      outputSchema: z.string().describe('User location'),
      execute: async () => 'San Francisco',
    };

    const info = getOutputSchemaInfo(tool);
    assert.ok(info);
    assert.strictEqual(info.type, 'string');
    assert.strictEqual(info.description, 'User location');
    assert.strictEqual(info.isObject, false);
    assert.strictEqual(info.properties, undefined);
  });

  test('handles object output with properties', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      outputSchema: z.object({
        temperature: z.number().describe('Temperature in Fahrenheit'),
        condition: z.string().describe('Weather condition'),
      }),
      execute: async () => ({ temperature: 65, condition: 'foggy' }),
    };

    const info = getOutputSchemaInfo(tool);
    assert.ok(info);
    assert.strictEqual(info.isObject, true);
    assert.ok(info.properties);
    assert.strictEqual(info.properties.length, 2);

    const tempProp = info.properties.find((p) => p.name === 'temperature');
    assert.ok(tempProp);
    assert.strictEqual(tempProp.type, 'number');
    assert.strictEqual(tempProp.description, 'Temperature in Fahrenheit');
  });

  test('handles missing output schema', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      execute: async () => {},
    };

    const info = getOutputSchemaInfo(tool);
    assert.strictEqual(info, null);
  });

  test('handles array output', () => {
    const tool: ToolDefinition = {
      description: 'Test tool',
      outputSchema: z.array(z.string()),
      execute: async () => ['a', 'b'],
    };

    const info = getOutputSchemaInfo(tool);
    assert.ok(info);
    assert.strictEqual(info.type, 'string[]');
    assert.strictEqual(info.isObject, false);
  });
});

describe('generateTypeDefinition', () => {
  test('generates type with properties', () => {
    const result = generateTypeDefinition('Weather', [
      { name: 'temperature', type: 'number', description: 'Temperature in Fahrenheit' },
      { name: 'condition', type: 'string', description: 'Weather condition' },
    ]);

    const expected = `type Weather = {
  /** Temperature in Fahrenheit */
  temperature: number;
  /** Weather condition */
  condition: string;
};`;

    assert.strictEqual(result, expected);
  });

  test('handles properties without descriptions', () => {
    const result = generateTypeDefinition('Point', [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
    ]);

    const expected = `type Point = {
  x: number;
  y: number;
};`;

    assert.strictEqual(result, expected);
  });
});

describe('generateFunctionTypeDeclaration', () => {
  test('generates function with no parameters', () => {
    const result = generateFunctionTypeDeclaration(
      'getUserLocation',
      'Get user current location',
      [],
      'string'
    );

    const expected = `// Get user current location
getUserLocation: () => Promise<string>;`;

    assert.strictEqual(result, expected);
  });

  test('generates function with parameters', () => {
    const result = generateFunctionTypeDeclaration(
      'getWeather',
      'Get weather for a location',
      [
        {
          name: 'location',
          type: 'string',
          description: 'Location to get weather for',
          optional: false,
        },
      ],
      'Weather'
    );

    const expected = `// Get weather for a location
getWeather: ({
  // Location to get weather for
  location: string
}) => Promise<Weather>;`;

    assert.strictEqual(result, expected);
  });

  test('handles optional parameters', () => {
    const result = generateFunctionTypeDeclaration(
      'search',
      'Search for items',
      [
        { name: 'query', type: 'string', optional: false },
        { name: 'limit', type: 'number', optional: true },
      ],
      'SearchResult[]'
    );

    const expected = `// Search for items
search: ({
  query: string,
  limit?: number
}) => Promise<SearchResult[]>;`;

    assert.strictEqual(result, expected);
  });

  test('handles multiline descriptions', () => {
    const result = generateFunctionTypeDeclaration(
      'complexOperation',
      'This is a complex operation\nthat does multiple things\nand needs explanation',
      [
        {
          name: 'input',
          type: 'string',
          description: 'The input value\nwhich can be multiline',
          optional: false,
        },
      ],
      'Result'
    );

    const expected = `// This is a complex operation
// that does multiple things
// and needs explanation
complexOperation: ({
  // The input value
  // which can be multiline
  input: string
}) => Promise<Result>;`;

    assert.strictEqual(result, expected);
  });

  test('handles multiple parameters', () => {
    const result = generateFunctionTypeDeclaration(
      'createUser',
      'Create a new user',
      [
        { name: 'name', type: 'string', description: 'User name', optional: false },
        { name: 'email', type: 'string', description: 'User email', optional: false },
        { name: 'age', type: 'number', description: 'User age', optional: true },
      ],
      'User'
    );

    const expected = `// Create a new user
createUser: ({
  // User name
  name: string,
  // User email
  email: string,
  // User age
  age?: number
}) => Promise<User>;`;

    assert.strictEqual(result, expected);
  });
});

describe('Integration: full tool definition conversion', () => {
  test('converts complete tool definition', () => {
    const tool: ToolDefinition = {
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string().describe('Location to get weather for'),
      }),
      outputSchema: z.object({
        location: z.string().describe('The location of the weather report'),
        temperature: z.number().describe('The current temperature in Fahrenheit'),
        condition: z.string().describe('The current weather conditions'),
      }),
      execute: async () => ({
        location: 'San Francisco, CA',
        temperature: 65,
        condition: 'foggy',
      }),
    };

    // Test parameter extraction
    const params = getParamEntries(tool);
    assert.strictEqual(params.length, 1);
    assert.strictEqual(params[0].name, 'location');
    assert.strictEqual(params[0].type, 'string');

    // Test output schema info
    const outputInfo = getOutputSchemaInfo(tool);
    assert.ok(outputInfo);
    assert.strictEqual(outputInfo.isObject, true);
    assert.ok(outputInfo.properties);
    assert.strictEqual(outputInfo.properties.length, 3);

    // Test type definition generation
    const typeDef = generateTypeDefinition('GetWeatherResult', outputInfo.properties);
    const expectedTypeDef = `type GetWeatherResult = {
  /** The location of the weather report */
  location: string;
  /** The current temperature in Fahrenheit */
  temperature: number;
  /** The current weather conditions */
  condition: string;
};`;
    assert.strictEqual(typeDef, expectedTypeDef);

    // Test function declaration generation
    const funcDecl = generateFunctionTypeDeclaration(
      'getWeather',
      tool.description,
      params,
      'GetWeatherResult'
    );
    const expectedFuncDecl = `// Get weather for a location
getWeather: ({
  // Location to get weather for
  location: string
}) => Promise<GetWeatherResult>;`;
    assert.strictEqual(funcDecl, expectedFuncDecl);
  });

  test('generates correct signature for tools with no parameters', () => {
    const tool: ToolDefinition = {
      description: 'Get user current location',
      inputSchema: z.object({}),
      outputSchema: z.string(),
      execute: async () => 'San Francisco, CA',
    };

    // Test parameter extraction - should be empty
    const params = getParamEntries(tool);
    assert.strictEqual(params.length, 0);

    // Test function declaration generation - should have no parameters
    const funcDecl = generateFunctionTypeDeclaration(
      'getUserLocation',
      tool.description,
      params,
      'string'
    );
    const expectedFuncDecl = `// Get user current location
getUserLocation: () => Promise<string>;`;
    assert.strictEqual(funcDecl, expectedFuncDecl);
  });
});
