// Belvedere — settings schema
//
// LibrarySourceConfig nodes are the persisted "Libraries" settings: every
// source Belvedere loads type definitions from on startup.

CREATE CONSTRAINT library_source_id_unique IF NOT EXISTS
FOR (s:LibrarySourceConfig) REQUIRE s.id IS UNIQUE;
