# Hand drawing lives beside the board, and Claude turns it into ops

Status: accepted

People want to draw on the board themselves, next to Claude, and have Grafito understand what they drew. The board holds no coordinates (the layout owns every position), so hand-drawn ink cannot be a board element: it has a place, and nothing on the board does.

We decided:

- **The sketch is a separate layer.** Pen strokes are kept in board coordinates in a sketch store, beside the board, and the engine draws them on top. The board model, the layout and the ops stay coordinate-free.
- **Recognition is one more kind of request.** Handing in a sketch sends Claude the board text, a description of the strokes in text (`describeSketch`: each stroke's shape, size and what it touches, with board ids) and, when the model can see pictures, a PNG of that part of the board with the ink on it. Claude answers with the same ops as always. The picture carries the handwriting; the text ties the ink to ids.
- **Ink that became a drawing is erased.** When the request draws something, the strokes it covered fade out and the clean elements are drawn where the layout puts them, not where the hand was. When Claude draws nothing, the strokes stay as plain ink and are not sent again.
- **Gestures are prompt rules, not code.** A loop around an element, a line under it, a scribble over it, an arrow between two: the sketch rules tell Claude what each one means. The browser only classifies strokes roughly (dot, line, closed, scribble) to describe them.

Considered: making strokes a board element with coordinates (breaks the one rule every part of the pipeline relies on); recognising shapes in the browser with geometry alone (cannot read handwriting or intent, and would need its own rules for every zone kind); sending only the picture (Claude cannot tie pixels to board ids reliably).

## Consequences

- A request's `mode` gains `sketch`. Its record keeps the stroke description as the batch; the picture is not stored, so replaying a record redraws the result, not the ink.
- The sketch rules are a system block of their own, added only to sketch requests after the cached prefix, so live requests keep their cache.
- Where a hand-drawn box sat is lost: the element lands where the layout decides. That is the price of a board with no coordinates, and the reason the result is always tidy.
