import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError } from "@/lib/errors/domain-error";

/** Centralized error -> HTTP response mapping for API route handlers.
 * Never leaks internal error messages or stack traces for unexpected errors. */
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request.", details: error.flatten() },
      { status: 400 },
    );
  }

  if (error instanceof DomainError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}
