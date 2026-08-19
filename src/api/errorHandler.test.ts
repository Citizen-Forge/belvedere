import { test } from "node:test";
import assert from "node:assert/strict";
import { statusForError } from "./errors.js";
import { TypeResolutionError } from "../library/resolveType.js";
import { DuplicateTypeIdError } from "../library/registry.js";
import { AssetNotFoundError } from "../instances/assetRepository.js";
import { HostsCycleError, RelationshipEndpointNotFoundError } from "../instances/relationshipRepository.js";
import { AttributeValidationError } from "../instances/validateAttributes.js";
import {
  LibrarySourceNotFoundError,
  LibrarySourceAlreadyExistsError,
} from "../settings/librarySourceRepository.js";
import { SavedViewNotFoundError } from "../views/savedViewRepository.js";

test("maps known domain errors to their HTTP status", () => {
  assert.equal(statusForError(new AssetNotFoundError("x")), 404);
  assert.equal(statusForError(new RelationshipEndpointNotFoundError("a", "b")), 404);
  assert.equal(statusForError(new LibrarySourceNotFoundError("x")), 404);
  assert.equal(statusForError(new SavedViewNotFoundError("x")), 404);
  assert.equal(statusForError(new TypeResolutionError("x")), 404);
  assert.equal(statusForError(new AttributeValidationError(["x"])), 400);
  assert.equal(statusForError(new DuplicateTypeIdError("x", "a", "b")), 409);
  assert.equal(statusForError(new LibrarySourceAlreadyExistsError("x")), 409);
  assert.equal(statusForError(new HostsCycleError("a", "b")), 409);
});

test("defaults unrecognized errors to 500", () => {
  assert.equal(statusForError(new Error("boom")), 500);
  assert.equal(statusForError("not even an Error"), 500);
});
