# A room reaches the internet through a tunnel, behind an invite token and limits

Status: accepted

A room was for a team's own network ([ADR 0008](0008-rooms-server-keeps-the-log.md)): the server had no login, and whoever had `?room=<id>` was in. The owner now wants people outside their network in a room. The room lives in the memory of the server on the owner's machine and that server calls Claude with the owner's API key, so opening it to the internet means anyone who reaches it spends the owner's money and can read the owner's saved sessions.

## Threat model

What is protected: the owner's API key spend, the owner's files (`apps/server/sessions/`, `apps/server/rooms/`, anything on disk), the server's memory and CPU, and the content of a room from people who were not invited to it.

Who attacks: anyone on the internet who finds the tunnel's address (it is random, but it is not a secret: it shows up in the guests' browsers, in Cloudflare, in any chat it was pasted in); a guest of one room who wants another room, another participant's identity, or more than a guest gets; a web page open in the owner's browser that talks to `localhost`; a guest who floods; someone who sees the owner's terminal (a screen share, a screenshot) and is not at the machine.

Out of scope: an attacker on the owner's machine; Cloudflare itself, which ends the TLS and sees everything, token included; a guest who is in the room legitimately and writes text meant to steer Claude (prompt injection). That last one is real and not addressed: what a participant says goes into the prompt as their words, Claude's only tools are the board ops and `say`, so the worst outcome is a wrecked or misleading board and spent requests, bounded by the caps below. A participant's name cannot fake another speaker's line (see below).

## We decided

- **A tunnel from the owner's machine, opened by `pnpm share`.** `scripts/share.mjs` builds the front, starts the server in **share mode** (`GRAFITO_SHARE=1`) on one local port, default 8790, checks that the server answering on that port is the one it started (a request only that server can answer, with a control secret passed in its environment), and only then opens a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`, free, no account) and tells the server the tunnel's address (`PUT /api/share/public-url`, this machine and the control secret only). The tunnel is never opened onto a port another program holds. Nothing is deployed and the link dies with the process: the script closes the tunnel on Ctrl+C, SIGTERM, SIGHUP, an error of its own or its exit, and a watcher outside it (and the server itself) stops the children if the script is killed outright. The script installs nothing: without `cloudflared` it prints `brew install cloudflared` and stops.
- **One port.** In share mode Express serves the built front (`apps/web/dist`, `apps/server/src/static.ts`) with the page as fallback for anything that is not a file or `/api`, so the page, the API and the WebSocket share one origin and one tunnel. A file is served only if its real path is inside the real `dist`: a link pointing out of it is not followed. Dev is unchanged: Vite serves the page and proxies `/api`.
- **Share mode listens on 127.0.0.1 only.** The tunnel connects from this machine; the local network no longer reaches the server directly.
- **Every room has an invite token.** 24 bytes from `crypto.randomBytes` (192 bits), base64url, made with the room and saved with it (the room's file is written 0600 in a 0700 folder). `POST /api/rooms` answers `{ id, token }`. The room id is only a name now: it grants nothing.
- **The link carries the token in the fragment**: `?room=<id>#k=<token>`. A browser never sends the fragment, so the token is not in the server's or the tunnel's request line, not in a `Referer`, and not in an access log. The server also answers every page with `Referrer-Policy: no-referrer`. The page moves the token to the tab's `sessionStorage` and removes the fragment from the address bar (`history.replaceState`), so it does not stay in the history or on a shared screen; a reload reads it back, and Share rebuilds the full link.
- **The browser presents the token as a WebSocket subprotocol** (`grafito.room.v1`, `k.<token>`), because a browser cannot set headers on a WebSocket and a query parameter would put the token back in the URL. The server answers with `grafito.room.v1` only. It compares the token in constant time (`safeEqual`: SHA-256 of both sides, then `timingSafeEqual`, so length does not leak either).
- **Refusal comes before any state, and a refused socket cannot be held.** A wrong or missing token, and a room that does not exist, get the same answer: the handshake completes and the socket is closed with code 4403, with no `hello`, no log and no presence change. The handshake is completed only so the browser can read the reason (it cannot read an HTTP status on a failed upgrade) and stop retrying. A room id cannot be probed: both cases cost the same comparison and look the same. A refused connection is handled by a WebSocket server of its own that takes frames of at most 256 bytes, and its socket is cut one second later whether or not the other end answered. An upgrade that does not offer the protocol at all gets HTTP 401.
- **The server says who each connection is.** A participant id is made by the server; the browser does not send one. With `hello` the server gives the browser a resume secret, which the tab keeps in `sessionStorage` and presents on its next connection (a third subprotocol, `r.<secret>`) to be the same participant after a drop or a reload. Without it a connection is a new participant, so nobody can join as someone else, rename them or log under their id. Names are cleaned on the server: control characters, line breaks and square brackets are removed (the prompt writes each line as `[name] text`), and no participant may be called Claude.
- **Owner and guest.** In share mode the server makes two secrets at startup. The **owner link** it prints to this machine's terminal, `http://localhost:<port>/api/owner?k=<secret>`, carries the first; opening it sets an `HttpOnly; SameSite=Strict` cookie that holds the second, which is never printed. The link works once: after the first use it is dead, and a new one needs a restart. A request is the owner's only if it carries the cookie **and** was made on this machine, straight to the server (`isLocalRequest`). Any other request is a guest's, including one that carries the right cookie through the tunnel.
- **A guest can do exactly this**: read the page and its files, `GET /api/health`, `GET /api/share`, and join a room with its token. Every other request under `/api`, and every request that is not a GET or HEAD anywhere, is refused with 403. That covers `POST /api/board`, `POST /api/architect`, the saved-session routes and room creation, and any route added later: the guard (`apps/server/src/share.ts`) is mounted in `index.ts` in front of all of them and allows by list, it does not deny by list. It compares paths in lower case, as Express's router does. No guest request has its body read: the JSON parser runs after the guard and only for a POST, PUT or PATCH under `/api`. A failed request is answered with its status and one word, never a stack trace.
- **What "made on this machine" means.** The tunnel also connects from 127.0.0.1, so the socket address proves nothing. `isLocalRequest` requires three things at once: a loopback socket, a `Host` of `localhost`/`127.0.0.1`/`[::1]`, and none of the headers a proxy adds (`Cf-Connecting-Ip`, `Cf-Ray`, `Cdn-Loop`, `X-Forwarded-For` and the rest). A remote sender cannot fake the second (Cloudflare routes on the host name, so a request with `Host: localhost` never reaches this tunnel) and cannot undo the third (it can add headers; the edge sets its own). Being the owner therefore takes two independent things: a secret that never left the owner's browser, and a request that did not come through the tunnel. Seeing the terminal gives neither: the link is spent once the owner used it, and its secret is not the cookie.
- **The owner's browser is protected from other sites.** The cookie is `SameSite=Strict`; a write also needs an `Origin` equal to the server's own; and in share mode a request whose `Host` is neither this machine's nor the tunnel's is refused with 421 (DNS rebinding). The WebSocket upgrade checks `Host` and `Origin` the same way.
- **Plan models are off in share mode.** A room would run guests' requests on the owner's Claude subscription, which ADR 0004 keeps to the owner.

## Limits

Defaults, each overridable in `apps/server/.env` (`apps/server/src/rooms/limits.ts`):

| What | Default | Variable |
| --- | --- | --- |
| Rooms in memory | 20 | `GRAFITO_MAX_ROOMS` |
| People in a room | 12 (4 connections each) | `GRAFITO_ROOM_MAX_PEOPLE` |
| Largest WebSocket frame | 8 MiB (a sketch's picture) | `GRAFITO_WS_MAX_BYTES` |
| Messages per connection | 60/s, burst 120 | `GRAFITO_WS_RATE`, `GRAFITO_WS_BURST` |
| Bytes per connection | 1 MiB/s, burst one frame | `GRAFITO_WS_BYTES_PER_SEC` |
| Messages for Claude per connection | 1/s, burst 5 | `GRAFITO_WS_TURN_RATE`, `GRAFITO_WS_TURN_BURST` |
| The same three per client address | four connections' worth | (derived) |
| Messages per room, everyone together | 240/s | `GRAFITO_ROOM_WS_RATE` |
| Bytes per room, everyone together | 4 MiB/s | `GRAFITO_ROOM_WS_BYTES_PER_SEC` |
| Joins per room | 60/min, burst 24 | `GRAFITO_ROOM_JOINS_PER_MIN` |
| Joins per client address | 20/min, burst 8 | `GRAFITO_CLIENT_JOINS_PER_MIN` |
| Waiting to be sent on a connection | 16 MiB, then it is cut; no cursors or drafts past 1 MiB | `GRAFITO_WS_MAX_BUFFERED` |
| Claude requests per room per minute | 12 | `GRAFITO_ROOM_CALLS_PER_MIN` |
| Claude requests per room, ever | 300 | `GRAFITO_ROOM_MAX_CALLS` |
| Spend per room, ever | 5 USD | `GRAFITO_ROOM_MAX_USD` |
| Waiting for Claude | 12 fragments, 48 000 characters (text and sketch descriptions) | `GRAFITO_ROOM_QUEUE_MAX`, `GRAFITO_ROOM_QUEUE_CHARS` |
| Strokes on the board | 3000, 3000 points each | `GRAFITO_ROOM_MAX_STROKES` |
| A room's log | 20 000 events, 8 MiB as JSON | `GRAFITO_ROOM_MAX_EVENTS`, `GRAFITO_ROOM_MAX_LOG_BYTES` |
| Idle room expiry | 12 h in share mode, never otherwise | `GRAFITO_ROOM_IDLE_MIN` |

- Every inbound frame is parsed with `parseClientMessage` (the zod schema in `packages/contract/src/room.ts`), which already bounded text (8000 characters), strokes, erases and sketches; a frame that does not parse is answered with an error and dropped. A frame over the size limit closes the connection before it is parsed. A sketch goes through the same `parseSketch` as `POST /api/board`: a description, and a picture that is base64 or absent.
- **Three layers of rate limit**, all token buckets. A connection has its own. Through the tunnel its client address (`Cf-Connecting-Ip`, which the edge sets and a sender cannot choose) has one shared by all its connections, worth four connections because several people can sit behind one address; reconnecting does not refill it. The room has one for everyone in it together, so twelve participants with four tabs each cannot multiply a budget by 48. A message over budget is dropped and answered with one `rate` error a second; a connection that keeps going over its own or its address's budget (400 drops) is closed with 4429. Joins are limited per address and per room, after the token check, because each join is sent the whole log; a wrong token does not use up the room's joins.
- **Outbound.** A browser that stops reading does not make the server hold its messages without limit: past 1 MiB waiting on a connection it is no longer sent cursors and strokes in progress, and past 16 MiB the connection is cut.
- **The caps on Claude** are checked when a message arrives, before it is logged or queued and counting what is already waiting, and again before every request starts: what was waiting behind the request that reached the cap is dropped and everyone is told. The sender of a refused message gets an error with a code (`calls_per_minute`, `room_cap`, `busy`, `log_full`), which the browser shows in its language. Every request that was sent is billed to the room, on every way out: one cut short by a reset counts what the model had reported, or, if it had reported nothing yet, the most the request could cost (the whole prompt as input and `maxTokens` as output). The request and spend counters are saved with the room, including when a request is cut, and a reset does not clear them.
- **The log stays the size of what is on the board.** An erase is sent to everyone connected but not kept, and the strokes it removed are taken out of the log, so drawing and erasing for hours leaves nothing behind. The log also has a hard size (events and bytes): past it the room takes no more ink or messages until it is cleared. The room's file is the log, so it has the same ceiling.
- A room past its idle limit cannot be joined; its file stays on disk. A room with someone in it never expires and is never dropped to make space.

## Tunnel choice and its limits

Considered: deploying the server (a stable link, but `Room` is in-memory state behind a WebSocket: it does not fit Lambda as it is, and needs a container or a rewrite of the state); ngrok or a named Cloudflare tunnel (an account and a token to manage); tunnelling Vite's port (a dev server on the internet, and two origins). The quick tunnel needs nothing and is enough for "work with me for an hour".

From Cloudflare's documentation ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), read 2026-11-11):

- "Each Quick Tunnel supports up to 200 in-flight requests. Additional requests return a `429` response." An open WebSocket is one in-flight request, so this is far above 12 people in a few rooms.
- "Quick Tunnels do not support Server-Sent Events (SSE)." `POST /api/board` and `POST /api/architect` stream over SSE. **Guests never use them**: in a room the server makes the Claude calls and everything reaches the browser over the WebSocket, and those two routes are owner-only anyway. The owner uses them at `http://localhost:<port>`, which does not go through the tunnel. The owner must work on localhost in any case: through the tunnel the owner is a guest. The script says so.
- "Quick Tunnels have no uptime guarantee", they "are for testing and development", and "the hostname changes each time you create a Quick Tunnel". A room link from one run does not work in the next.
- That page does not mention WebSockets. Cloudflare Tunnel proxies them, and the design depends on it, including the `Sec-WebSocket-Protocol` header and the 44xx close codes arriving intact. This has not been tried through a real tunnel yet.

## Consequences

- A room saved before tokens existed gets a new token when it is loaded: no old link opens it.
- Two tabs of one browser are two participants (each tab has its own resume secret), and after a server restart everyone comes back as a new participant with the name they had.
- An erase is no longer in a room's log or file. A file saved with erases in it is compacted when it is loaded.
- The board a room was made from (request 0) is an entry in the browser's request log, so an export from a room carries it.
- `ARCHITECTURE.md` and the README describe share mode; ADR 0008's "meant for a team's own network" now points here.
- Outside share mode nothing is guarded, as before: `pnpm dev` with `GRAFITO_HOST=1` still trusts the local network with every route. Rooms need their token there too, and their limits apply.

## What is still not protected

- **The link is the only credential.** There are no accounts. Whoever has a room link is a participant: they see the whole board and log, can reset the room, and can spend up to the room's caps (5 USD and 300 requests by default) on the owner's key, on the model they choose. A forwarded link works for whoever receives it. A link cannot be revoked short of stopping the server or letting the room expire.
- **The caps are per room, not global.** 20 rooms could each spend their cap. Only the owner can open rooms, so this is the owner's own doing.
- **The spend cap can be passed by one request.** The request in flight when the cap is reached finishes. A request cut by a reset is billed by estimate, which is high on purpose and is not what the API charged.
- **The token is in the clear at Cloudflare and on disk** (`apps/server/rooms/<id>.json`, readable by the owner's user only), in the tab's `sessionStorage`, and in whatever the link was pasted into. It is in the browser history only until the page has loaded.
- **The owner link is one-time, not secret before use.** Whoever is at the machine and opens it first is the owner; if that was not the owner, the owner's own attempt fails, which is the signal to restart.
- **Unauthenticated load.** Anyone can fetch the page and open handshakes that are refused (each is cut within a second); nothing limits how many but the tunnel's 200 in-flight requests.
- **Addresses are shared.** People behind one address (an office, a mobile carrier) share that address's budget and its joins a minute.
- **A guest outside a room sees the whole app.** Its live and architect modes fail with 403 instead of being hidden.
- **Prompt injection by a participant**, as said above.
