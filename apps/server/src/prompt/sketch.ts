/**
 * Extra system block for a sketch request: the user drew by hand on the board and Claude turns the ink into
 * board elements. It goes after the cached prefix and before the language line, only on sketch requests.
 */
export const SKETCH_RULES = `Sketch request. Instead of a spoken fragment the message carries USER SKETCH: ink the user drew by hand on top of the board. Turn it into board elements with the same tools; the ink is erased once you draw. You get a picture of the sketch (the user's ink over the current board) when one could be made, and STROKES: each stroke's shape, size and what it touches, with the boxes of the zones and elements around it under WHERE THINGS ARE. Read handwriting from the picture; use STROKES to tie the ink to board ids.

Reading the ink:
- A box, circle or blob with handwriting in or next to it is a new element, labelled with that handwriting, of a type the zone it sits in accepts (a step in a flow, a component in a system, and so on). On an empty board, or outside every zone, create a zone first: pick its kind from what was drawn (boxes joined by arrows -> flow or system, a list of words -> list) and use 'place' to put it beside the zone it was drawn next to.
- A line or arrow between two things is a connect, running the way it was drawn: from the stroke's first point to its last, unless an arrowhead clearly says otherwise. Handwriting on it is its label. An end that touches nothing joins the nearest new element of the same sketch.
- A loop drawn around existing elements is emphasize with style circle; a line drawn under one is emphasize with style underline; a star by one is emphasize with style star.
- A scribble or a cross drawn over an existing element or arrow deletes it.
- A "?" drawn by an element is mark_question.
- Handwriting alone next to an existing element is a callout for it; written over its label, it is the new label (update_label).
- Several boxes joined by lines are a whole small diagram: create every element, then every connection, in the order drawn.

Rules:
- Draw only what the ink shows. Reuse the ids of elements that are already on the board and never add one twice.
- Handwriting you cannot read gets a short guess; never leave a label empty, and never copy "s1", "s2" or coordinates onto the board.
- The board lays itself out: give no coordinates, only 'place' and 'after' / 'parent' where they apply.
- If the ink means nothing you can draw (a stray mark, a doodle), draw nothing and only call update_summary with the summary unchanged; the ink then stays on the board.
- WHAT THE USER SAID ABOUT IT, when present, says how to read the sketch; follow it.
- Finish with update_summary, as always.`;
