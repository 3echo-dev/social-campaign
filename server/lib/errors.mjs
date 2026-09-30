/**
 * Error types.
 *
 * Tool handlers throw. The MCP transport turns a throw into a tool result with
 * isError true and a friendly message, so nothing in this server writes an error
 * to stdout and nothing crashes the process on a bad tool call.
 */

/**
 * An error whose message is safe and useful to show to a non technical user.
 */
export class UserFacingError extends Error {
  /**
   * @param {string} message plain language, no jargon.
   * @param {{code?: string, fix?: string, details?: Record<string, unknown>}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.code = options.code ?? 'social_campaign_error';
    this.fix = options.fix ?? null;
    this.details = options.details ?? null;
  }
}

/**
 * The caller passed arguments the tool cannot work with.
 */
export class InvalidInputError extends UserFacingError {
  /**
   * @param {string} message
   * @param {{fix?: string, details?: Record<string, unknown>}} [options]
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: 'invalid_input' });
    this.name = 'InvalidInputError';
  }
}

/**
 * The workspace has not been set up yet, so the tool cannot run.
 */
export class WorkspaceNotConfiguredError extends UserFacingError {
  constructor() {
    super('No workspace has been set up yet.', {
      code: 'workspace_not_configured',
      fix: 'Run the Social Campaign setup and choose a folder.',
    });
    this.name = 'WorkspaceNotConfiguredError';
  }
}

/**
 * Convert any thrown value into a shape the transport can serialize.
 * @param {unknown} error
 * @returns {{message: string, code: string, fix: string|null}}
 */
export function toErrorPayload(error) {
  if (error instanceof UserFacingError) {
    return { message: error.message, code: error.code, fix: error.fix };
  }
  if (error instanceof Error) {
    return { message: error.message, code: 'internal_error', fix: null };
  }
  return { message: String(error), code: 'internal_error', fix: null };
}
