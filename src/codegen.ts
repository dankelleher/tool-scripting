import { z } from 'zod';
import type { ToolDefinition } from './types';

/**
 * Convert a tool name to PascalCase for use in type names
 */
export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, '_')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Convert JSON Schema (or Zod schema) to a TypeScript type string
 */
export function jsonSchemaToTypeString(schema: any): string {
  if (!schema) return 'unknown';

  // Handle Zod v4 toJSONSchema format (has 'def' and 'type' but not standard JSON Schema)
  if (schema.def && schema.type) {
    // Handle Zod optional wrapper - unwrap to innerType
    if (schema.type === 'optional') {
      const innerType = schema.def.innerType || schema.innerType;
      return jsonSchemaToTypeString(innerType);
    }

    // Handle Zod nullable wrapper - unwrap to innerType
    if (schema.type === 'nullable') {
      const innerType = schema.def.innerType || schema.innerType;
      return jsonSchemaToTypeString(innerType);
    }

    // Handle Zod array
    if (schema.type === 'array' && (schema.element || schema.def.element)) {
      const element = schema.element || schema.def.element;
      return `${jsonSchemaToTypeString(element)}[]`;
    }

    // Handle Zod object
    if (schema.type === 'object' && schema.def.shape) {
      const entries = Object.entries(schema.def.shape).map(([k, v]: [string, any]) =>
        `${k}: ${jsonSchemaToTypeString(v)}`
      );
      return `{ ${entries.join(', ')} }`;
    }

    // Handle primitive types
    if (schema.type === 'string') return 'string';
    if (schema.type === 'number') return 'number';
    if (schema.type === 'boolean') return 'boolean';
  }

  // Standard JSON Schema format
  if (schema.type === 'object' && schema.properties) {
    const entries = Object.entries(schema.properties).map(([k, v]: [string, any]) =>
      `${k}: ${jsonSchemaToTypeString(v)}`
    );
    return `{ ${entries.join(', ')} }`;
  }

  if (schema.type === 'array' && schema.items) {
    return `${jsonSchemaToTypeString(schema.items)}[]`;
  }

  if (schema.type === 'string') {
    if (schema.enum) {
      return schema.enum.map((v: string) => JSON.stringify(v)).join(' | ');
    }
    return 'string';
  }

  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';

  if (schema.anyOf) {
    // Filter out null types for cleaner display
    const types = schema.anyOf.filter((s: any) => s.type !== 'null');
    if (types.length === 1) {
      return jsonSchemaToTypeString(types[0]);
    }
    return schema.anyOf.map(jsonSchemaToTypeString).join(' | ');
  }

  if (schema.oneOf) {
    return schema.oneOf.map(jsonSchemaToTypeString).join(' | ');
  }

  // Handle array of types (e.g., ["string", "null"])
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t: string) => t !== 'null');
    if (types.length === 1) return types[0];
    return types.join(' | ');
  }

  return 'unknown';
}

/**
 * Extract description from a JSON schema or Zod schema
 */
export function getSchemaDescription(schema: any): string | undefined {
  if (!schema) return undefined;

  // Standard JSON Schema description field
  if (schema.description) return schema.description;

  // Zod v4 format - description is in def
  if (schema.def?.description) return schema.def.description;

  return undefined;
}

/**
 * Convert a Zod or JSON schema to a properly formatted JSON schema
 */
export function toJsonSchema(schema: any): any {
  if (!schema) return null;

  try {
    // Already a JSON schema
    if (typeof schema === 'object' && 'type' in schema && typeof schema.type === 'string') {
      return schema;
    }
    // Convert Zod to JSON Schema using built-in toJSONSchema (Zod v4+)
    return (z as any).toJSONSchema(schema);
  } catch {
    return null;
  }
}

export interface ParamEntry {
  name: string;
  type: string;
  description?: string;
  optional?: boolean;
}

export interface OutputSchemaInfo {
  type: string;
  description?: string;
  isObject: boolean;
  properties?: Array<{ name: string; type: string; description?: string }>;
}

/**
 * Get parameter entries with descriptions from a tool definition
 */
export function getParamEntries(tool: ToolDefinition): ParamEntry[] {
  const schema = tool.parameters || tool.inputSchema;
  if (!schema) return [];

  try {
    const jsonSchema = toJsonSchema(schema);
    if (!jsonSchema) return [];

    // Extract parameters from Zod v4 toJSONSchema format (has 'def.shape')
    if (jsonSchema.type === 'object' && jsonSchema.def && jsonSchema.def.shape) {
      const shape = jsonSchema.def.shape;
      const required: string[] = Array.isArray(jsonSchema.def.required) ? jsonSchema.def.required : [];
      return Object.entries(shape).map(([key, prop]: [string, any]) => {
        const type = jsonSchemaToTypeString(prop);
        const description = getSchemaDescription(prop);
        const optional = !required.includes(key);
        return { name: key, type, description, optional };
      });
    }

    // Extract parameters from standard JSON Schema format (has 'properties')
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const required: string[] = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
      return Object.entries(jsonSchema.properties).map(([key, prop]: [string, any]) => {
        const type = jsonSchemaToTypeString(prop);
        const description = getSchemaDescription(prop);
        const optional = !required.includes(key);
        return { name: key, type, description, optional };
      });
    }

    return [];
  } catch (err) {
    console.error('[getParamEntries] Error processing schema:', err);
    return [];
  }
}

/**
 * Get output schema information including whether it's an object type
 */
export function getOutputSchemaInfo(tool: ToolDefinition): OutputSchemaInfo | null {
  const schema = tool.outputSchema;
  if (!schema) return null;

  try {
    const jsonSchema = toJsonSchema(schema);
    if (!jsonSchema) return null;

    const description = getSchemaDescription(jsonSchema);
    const typeStr = jsonSchemaToTypeString(jsonSchema);

    // Check if it's an object type with properties
    const isZodObject = jsonSchema.type === 'object' && jsonSchema.def?.shape;
    const isJsonSchemaObject = jsonSchema.type === 'object' && jsonSchema.properties;

    if (isZodObject) {
      const properties = Object.entries(jsonSchema.def.shape).map(([key, prop]: [string, any]) => ({
        name: key,
        type: jsonSchemaToTypeString(prop),
        description: getSchemaDescription(prop),
      }));
      return { type: typeStr, description, isObject: true, properties };
    }

    if (isJsonSchemaObject) {
      const properties = Object.entries(jsonSchema.properties).map(([key, prop]: [string, any]) => ({
        name: key,
        type: jsonSchemaToTypeString(prop),
        description: getSchemaDescription(prop),
      }));
      return { type: typeStr, description, isObject: true, properties };
    }

    return { type: typeStr, description, isObject: false };
  } catch {
    return null;
  }
}

/**
 * Generate TypeScript type definition for an object output schema
 */
export function generateTypeDefinition(
  typeName: string,
  properties: Array<{ name: string; type: string; description?: string }>
): string {
  const lines: string[] = [`type ${typeName} = {`];

  for (const prop of properties) {
    if (prop.description) {
      lines.push(`  /** ${prop.description} */`);
    }
    lines.push(`  ${prop.name}: ${prop.type};`);
  }

  lines.push('};');
  return lines.join('\n');
}

/**
 * Generate TypeScript function type declaration with inline comments
 */
export function generateFunctionTypeDeclaration(
  functionName: string,
  description: string,
  params: ParamEntry[],
  returnType: string
): string {
  const lines: string[] = [];

  // Add description comment
  lines.push(`// ${description}`);

  // Generate function type with inline parameter comments
  if (params.length === 0) {
    lines.push(`${functionName}: () => Promise<${returnType}>;`);
  } else if (params.length === 1 && !params[0].description) {
    // Single param without description - inline format
    const param = params[0];
    const optionalMark = param.optional ? '?' : '';
    lines.push(`${functionName}: (${param.name}${optionalMark}: ${param.type}) => Promise<${returnType}>;`);
  } else {
    // Multiple params or params with descriptions - multiline format
    lines.push(`${functionName}: (`);
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      const optionalMark = param.optional ? '?' : '';
      const comment = param.description ? `  // ${param.description}` : '';
      const comma = i < params.length - 1 ? ',' : '';

      if (comment) {
        lines.push(comment);
      }
      lines.push(`  ${param.name}${optionalMark}: ${param.type}${comma}`);
    }
    lines.push(`) => Promise<${returnType}>;`);
  }

  return lines.join('\n');
}
