/** Base class for all expected, user-facing application errors. Anything
 * else (unexpected exceptions) is treated as an internal error and never
 * has its message/stack exposed to the client. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class InfeasibleActionError extends DomainError {
  constructor(node: number) {
    super(`Node ${node} is not a feasible next stop from the run's current position.`, 409);
  }
}

export class RunAlreadyCompletedError extends DomainError {
  constructor(runId: number) {
    super(`Run ${runId} has already completed and cannot accept further steps.`, 409);
  }
}

export class SessionEndedError extends DomainError {
  constructor(sessionId: number) {
    super(`Session ${sessionId} has ended.`, 409);
  }
}

export class PlayerAlreadyFinishedError extends DomainError {
  constructor(playerId: number) {
    super(`Player ${playerId} has already finished and cannot accept further steps.`, 409);
  }
}
