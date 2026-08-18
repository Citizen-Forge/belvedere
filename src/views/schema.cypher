// Belvedere — saved views schema

CREATE CONSTRAINT saved_view_id_unique IF NOT EXISTS
FOR (v:SavedView) REQUIRE v.id IS UNIQUE;
