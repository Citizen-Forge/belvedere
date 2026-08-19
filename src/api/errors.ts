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

/** Maps a thrown domain error to an HTTP status code. Unrecognized errors default to 500. */
export function statusForError(error: unknown): number {
  if (error instanceof AssetNotFoundError) return 404;
  if (error instanceof RelationshipEndpointNotFoundError) return 404;
  if (error instanceof LibrarySourceNotFoundError) return 404;
  if (error instanceof SavedViewNotFoundError) return 404;
  if (error instanceof TypeResolutionError) return 404;
  if (error instanceof AttributeValidationError) return 400;
  if (error instanceof DuplicateTypeIdError) return 409;
  if (error instanceof LibrarySourceAlreadyExistsError) return 409;
  if (error instanceof HostsCycleError) return 409;
  return 500;
}
