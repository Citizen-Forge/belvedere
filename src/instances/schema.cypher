// Belvedere — instance graph schema
//
// Assets are instances of a type defined in a configured library (see
// ../library). typeId is a foreign key into that external catalog, not a
// graph relationship — Belvedere's own Neo4j only stores instance data.

CREATE CONSTRAINT asset_id_unique IF NOT EXISTS
FOR (a:Asset) REQUIRE a.id IS UNIQUE;

CREATE INDEX asset_type_idx IF NOT EXISTS
FOR (a:Asset) ON (a.typeId);

CREATE INDEX asset_layer_idx IF NOT EXISTS
FOR (a:Asset) ON (a.layer);
