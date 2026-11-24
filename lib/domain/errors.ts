/**
 * Domain errors carry a stable code so UI and API layers can branch on the
 * reason without matching on message text.
 */
export type DomainErrorCode =
  | "sold_out"
  | "not_found"
  | "invalid_state"
  | "forbidden"
  | "amount_mismatch"
  | "expired"
  | "already_paid"
  | "limit_exceeded";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
