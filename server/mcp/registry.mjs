/**
 * Tool registry.
 *
 * A tool is a name, a description the model reads, a JSON Schema for its arguments
 * and a handler that returns a plain object. The transport does the serializing, so
 * a handler never builds MCP content blocks itself.
 */

import { InvalidInputError } from '../lib/errors.mjs';
import { assertLegacyExecutionAllowed } from '../pipeline/legacy-guard.mjs';

/**
 * @typedef {object} ToolContext
 * @property {import('../workspace/index.mjs').Workspace} workspace
 * @property {AbortSignal} [signal] request cancellation signal
 */

/**
 * @typedef {object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Record<string, unknown>} inputSchema JSON Schema, object type.
 * @property {(args: Record<string, unknown>, context: ToolContext) => Promise<unknown>|unknown} handler
 * @property {(result: unknown) => string} [summary] one line of human readable text.
 */

/**
 * Declare a tool. This is only a validating identity function, which keeps every
 * tool file free of registry bookkeeping.
 * @param {ToolDefinition} definition
 * @returns {ToolDefinition}
 */
export function defineTool(definition) {
  if (!definition || typeof definition.name !== 'string' || definition.name.length === 0) {
    throw new Error('defineTool requires a name');
  }
  if (typeof definition.description !== 'string' || definition.description.length === 0) {
    throw new Error(`Tool ${definition.name} requires a description`);
  }
  if (typeof definition.handler !== 'function') {
    throw new Error(`Tool ${definition.name} requires a handler`);
  }
  const inputSchema = definition.inputSchema ?? { type: 'object', properties: {} };
  return { ...definition, inputSchema };
}

/**
 * A set of tools, keyed by name.
 */
export class ToolRegistry {
  constructor() {
    /** @type {Map<string, ToolDefinition>} */
    this.tools = new Map();
  }

  /**
   * @param {ToolDefinition[]} definitions
   */
  registerAll(definitions) {
    for (const definition of definitions) {
      if (this.tools.has(definition.name)) {
        throw new Error(`Duplicate tool name: ${definition.name}`);
      }
      this.tools.set(definition.name, definition);
    }
  }

  /**
   * @returns {Array<{name: string, description: string, inputSchema: Record<string, unknown>}>}
   */
  list() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * @param {string} name
   * @returns {ToolDefinition}
   */
  get(name) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new InvalidInputError(`There is no Social Campaign action named "${name}".`);
    }
    return tool;
  }

  /**
   * Validate arguments against the shallow parts of the tool schema that matter:
   * required keys and top level types. Deep validation is the handler's business.
   * @param {ToolDefinition} tool
   * @param {Record<string, unknown>} args
   */
  static validate(tool, args) {
    const schema = tool.inputSchema ?? {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null || args[key] === '') {
        throw new InvalidInputError(`The "${key}" value is required.`, { details: { tool: tool.name } });
      }
    }
    const properties = /** @type {Record<string, {type?: string}>} */ (schema.properties ?? {});
    for (const [key, value] of Object.entries(args)) {
      const property = properties[key];
      if (!property || !property.type) continue;
      if (!matchesType(value, property.type)) {
        throw new InvalidInputError(`The "${key}" value should be a ${property.type}.`, {
          details: { tool: tool.name },
        });
      }
    }
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @param {ToolContext} context
   * @returns {Promise<unknown>}
   */
  async call(name, args, context) {
    const tool = this.get(name);
    const safeArgs = args && typeof args === 'object' ? args : {};
    ToolRegistry.validate(tool, safeArgs);
    assertLegacyExecutionAllowed(context.workspace?.root,name,safeArgs);
    return await tool.handler(safeArgs, context);
  }
}

/**
 * @param {unknown} value
 * @param {string} type
 * @returns {boolean}
 */
function matchesType(value, type) {
  if (value === null || value === undefined) return true;
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}
