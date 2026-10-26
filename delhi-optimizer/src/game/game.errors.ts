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

export class SessionEndedError extends DomainError {
  constructor(sessionId: number) {
    super(`Session ${sessionId} has ended.`, 409);
  }
}

export class PlayerFinishedError extends DomainError {
  constructor(playerId: number) {
    super(`Player ${playerId} has already finished and cannot collect more nodes.`, 409);
  }
}

/** Thrown when the server determines a requested visit is not actually
 * feasible (Section 36 -- client-claimed feasibility is never trusted). */
export class InfeasibleVisitError extends DomainError {
  constructor(nodeId: string) {
    super(`${nodeId} cannot be reached and collected from the player's current state.`, 409);
  }
}

export class UnknownNodeError extends DomainError {
  constructor(nodeId: string) {
    super(`Unknown node: ${nodeId}`, 400);
  }
}

/** Thrown when an atomic, session-wide capacity reservation loses the race
 * -- the node looked feasible when the server checked moments earlier, but
 * another player's concurrent collect already filled the shelter's
 * remaining capacity first. The client should just refresh its state;
 * nothing was double-booked. */
export class CapacityExceededError extends DomainError {
  constructor(nodeId: string) {
    super(`${nodeId} could not be collected: the shelter's remaining capacity was just claimed by another player.`, 409);
  }
}
