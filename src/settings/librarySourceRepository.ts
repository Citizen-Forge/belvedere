import type { Driver } from "neo4j-driver";
import { withSession } from "../db.js";
import type { LibrarySourceConfig, NewLibrarySourceConfig } from "./types.js";

export class LibrarySourceNotFoundError extends Error {
  constructor(id: string) {
    super(`No library source configured with id ${id}`);
  }
}

export class LibrarySourceAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`A library source with id ${id} is already configured`);
  }
}

const CONSTRAINT_VIOLATION_CODE = "Neo.ClientError.Schema.ConstraintValidationFailed";

export class LibrarySourceRepository {
  constructor(private readonly driver: Driver) {}

  async add(input: NewLibrarySourceConfig, isDefault = false): Promise<LibrarySourceConfig> {
    const config: LibrarySourceConfig = {
      id: input.id,
      name: input.name,
      location: input.location,
      ref: input.ref ?? null,
      isDefault,
      addedAt: new Date().toISOString(),
    };

    try {
      await withSession(this.driver, (session) =>
        session.run(
          `CREATE (s:LibrarySourceConfig {
             id: $id, name: $name, location: $location, ref: $ref,
             isDefault: $isDefault, addedAt: $addedAt
           })`,
          config,
        ),
      );
    } catch (cause) {
      if (isConstraintViolation(cause)) throw new LibrarySourceAlreadyExistsError(input.id);
      throw cause;
    }

    return config;
  }

  async list(): Promise<LibrarySourceConfig[]> {
    return withSession(this.driver, async (session) => {
      const result = await session.run(`MATCH (s:LibrarySourceConfig) RETURN s ORDER BY s.addedAt`);
      return result.records.map((record) => toConfig(record.get("s").properties));
    });
  }

  async remove(id: string): Promise<void> {
    await withSession(this.driver, async (session) => {
      const result = await session.run(
        `MATCH (s:LibrarySourceConfig {id: $id}) DETACH DELETE s RETURN count(s) AS deleted`,
        { id },
      );
      if (result.records[0].get("deleted").toNumber() === 0) {
        throw new LibrarySourceNotFoundError(id);
      }
    });
  }

  /**
   * Seeds the default source if no sources are configured yet — the fresh-install path. Relies on
   * the unique constraint on `id` (not a list-then-add check) to stay correct if two processes
   * race to seed the same fresh database: the loser's `add` throws AlreadyExists, which is
   * expected here and swallowed rather than crashing startup.
   */
  async seedDefaultIfEmpty(defaultSource: NewLibrarySourceConfig): Promise<void> {
    const existing = await this.list();
    if (existing.length > 0) return;

    try {
      await this.add(defaultSource, true);
    } catch (cause) {
      if (!(cause instanceof LibrarySourceAlreadyExistsError)) throw cause;
    }
  }
}

function isConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === CONSTRAINT_VIOLATION_CODE
  );
}

function toConfig(properties: Record<string, unknown>): LibrarySourceConfig {
  return {
    id: properties.id as string,
    name: properties.name as string,
    location: properties.location as string,
    ref: (properties.ref as string | undefined) ?? null,
    isDefault: properties.isDefault as boolean,
    addedAt: properties.addedAt as string,
  };
}
