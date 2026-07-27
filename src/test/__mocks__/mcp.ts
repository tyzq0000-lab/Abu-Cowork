// Stub module for @modelcontextprotocol/sdk (requires Node.js, not available in test env)
export {};

export class CfWorkerJsonSchemaValidator {
  getValidator() {
    return (input: unknown) => ({ valid: true as const, data: input, errorMessage: undefined });
  }
}
