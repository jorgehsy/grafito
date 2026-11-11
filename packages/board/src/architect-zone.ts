// The id of architect mode's one system zone, on its own so the model and architect.ts can both import it.

/** Id of the one system zone of an architect board; Claude's `add_component` names it as its zone. */
export const ARCHITECT_ZONE_ID = "system";

/** Id of the data zone of an architect board, which the app makes before the first entity; `add_entity` names it as its zone. */
export const ARCHITECT_DATA_ZONE_ID = "data";
