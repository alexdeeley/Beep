import { type Kysely, type Migration, type MigrationProvider } from "kysely";

export type Dialect = "sqlite" | "postgres";

/**
 * Migrations live in code (not .sql files) so Kysely's schema builder can
 * translate each one to the right dialect for us - this is the "single
 * storage interface" promise extended to schema changes, not just queries.
 * Autoincrement PKs are the one thing Kysely doesn't paper over between
 * SQLite and Postgres, so those two columns branch on dialect explicitly;
 * everything else is written once.
 */
function buildMigrations(dialect: Dialect): Record<string, Migration> {
  const autoIncPk = (c: any) => (dialect === "sqlite" ? c.primaryKey().autoIncrement() : c.primaryKey());
  const idType = dialect === "sqlite" ? "integer" : "serial";
  // Kysely's dialect-agnostic "binary" type name isn't recognized by the
  // Postgres adapter's DDL compiler - the raw native type name is needed.
  const blobType = dialect === "sqlite" ? "blob" : "bytea";

  return {
    "001_init": {
      async up(db: Kysely<any>) {
        await db.schema
          .createTable("operations")
          .addColumn("seq", idType, autoIncPk)
          .addColumn("id", "text", (c) => c.notNull().unique())
          .addColumn("type", "text", (c) => c.notNull())
          .addColumn("session", "text", (c) => c.notNull())
          .addColumn("color", "integer", (c) => c.notNull())
          .addColumn("ts", "bigint", (c) => c.notNull())
          .addColumn("min_x", "double precision", (c) => c.notNull())
          .addColumn("min_y", "double precision", (c) => c.notNull())
          .addColumn("max_x", "double precision", (c) => c.notNull())
          .addColumn("max_y", "double precision", (c) => c.notNull())
          .addColumn("payload", "text", (c) => c.notNull())
          .execute();

        await db.schema
          .createTable("tile_index")
          .addColumn("seq", "integer", (c) => c.notNull().references("operations.seq"))
          .addColumn("tx", "integer", (c) => c.notNull())
          .addColumn("ty", "integer", (c) => c.notNull())
          .execute();
        await db.schema.createIndex("tile_index_tile_seq").on("tile_index").columns(["tx", "ty", "seq"]).execute();

        await db.schema
          .createTable("tile_cache")
          .addColumn("level", "integer", (c) => c.notNull())
          .addColumn("tx", "integer", (c) => c.notNull())
          .addColumn("ty", "integer", (c) => c.notNull())
          .addColumn("seq", "integer", (c) => c.notNull())
          .addColumn("png", blobType as any, (c) => c.notNull())
          .addPrimaryKeyConstraint("tile_cache_pk", ["level", "tx", "ty"])
          .execute();

        await db.schema
          .createTable("snapshots")
          .addColumn("id", idType, autoIncPk)
          .addColumn("seq", "integer", (c) => c.notNull())
          .addColumn("created_at", "bigint", (c) => c.notNull())
          .execute();
      },
      async down(db: Kysely<any>) {
        await db.schema.dropTable("snapshots").execute();
        await db.schema.dropTable("tile_cache").execute();
        await db.schema.dropTable("tile_index").execute();
        await db.schema.dropTable("operations").execute();
      },
    },
  };
}

export class InlineMigrationProvider implements MigrationProvider {
  constructor(private dialect: Dialect) {}
  async getMigrations() {
    return buildMigrations(this.dialect);
  }
}
