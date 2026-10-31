# English code; the drawing follows the user's language

Status: accepted (implementation: #10–#15, #19)

Grafito was written in Spanish: identifiers, files, comments, docs, the CHANGELOG and the prompt to Claude. That keeps out most contributors, and it ties the language Claude draws in to the language of the prompt.

We decided:

- **The codebase is English**: identifiers, file names, comments, docs and the CHANGELOG, history included. `GLOSSARY.md` is the naming source. The only exceptions are the speech-recognition language options and the demos (they stay Spanish; one is translated to English).
- **One language setting** drives the UI, speech recognition and the language Claude writes on the board. It defaults to the browser language. UI strings live in a typed `en`/`es` dictionary, without an i18n library.
- **The prompt to Claude is English**, and ends with an explicit line: write all drawn text in the user's language. The language travels in each request.

Considered: keeping a Spanish prompt and translating only the code. Rejected because the prompt is code that contributors will edit, and a language line works for any language, not only Spanish.

## Consequences

- An English prompt could lower the quality of Spanish labels. An eval baseline is recorded before the refactor (#5) and the same eval is re-run after the English prompt (#19).
- Saved sessions break once (session record v2 with English field names); v1 records are rejected with a clear message.
