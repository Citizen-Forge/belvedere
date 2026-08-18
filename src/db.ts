import { readFile } from "node:fs/promises";
import neo4j, { type Driver, type Session } from "neo4j-driver";

const uri = process.env.BELVEDERE_NEO4J_URI ?? "bolt://localhost:7687";
const user = process.env.BELVEDERE_NEO4J_USER ?? "neo4j";
const password = process.env.BELVEDERE_NEO4J_PASSWORD ?? "belvedere-dev";

let driver: Driver | undefined;

/** The process-wide driver for Belvedere's own Neo4j (instance graph + settings — not a library source). */
export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  await driver?.close();
  driver = undefined;
}

/** Runs `work` in a fresh session, always closing it afterwards — even if `work` throws. */
export async function withSession<T>(
  driver: Driver,
  work: (session: Session) => Promise<T>,
): Promise<T> {
  const session = driver.session();
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

/** Runs every constraint/index statement in a schema.cypher file. Safe to call repeatedly (all IF NOT EXISTS). */
export async function applySchemaFile(driver: Driver, schemaPath: string): Promise<void> {
  const raw = await readFile(schemaPath, "utf-8");
  const statements = raw
    .split(";")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0);

  await withSession(driver, async (session) => {
    for (const statement of statements) {
      await session.run(statement);
    }
  });
}
