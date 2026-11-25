// SPDX-License-Identifier: AGPL-3.0-or-later
import { Effect } from "effect";

export const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const attempt = <A>(operation: () => A) => Effect.try({ try: operation, catch: asError });

export const task = <A>(operation: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({ try: operation, catch: asError });
