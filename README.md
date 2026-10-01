# laya lab

A small web app for testing a decision API. Each page is an experiment that asks the backend to pick an answer from a fixed set of options, or to score text against criteria.

The pages work with either of two backends:

- **Laya** (`laya-serve`), the reference server
- **Kev**, a compatible server that uses an OpenAI-style LLM behind the same API

## Quick start

1. Start a backend (see [Backends](#backends)).
2. Start the web server:

   ```sh
   node server.mjs
   ```

3. Open <http://localhost:8000>.
4. In the header, enter the backend URL (for example `http://localhost:8100` for Laya or `http://localhost:3000` for Kev). The status pill shows whether the backend is reachable and which kind it is.

`server.mjs` has no dependencies and needs Node 18 or later.

### Configuration

| Variable    | Default                     | Purpose                                                 |
| ----------- | --------------------------- | ------------------------------------------------------- |
| `PORT`      | `8000`                      | Port for the web UI (binds to `127.0.0.1` only)         |
| `LAYA_BASE` | `http://localhost:8100` | Backend used when the browser doesn't send a backend URL |

```sh
PORT=9000 LAYA_BASE=http://localhost:8100 node server.mjs
```

## How it works

`server.mjs` does two things:

- **Serves static files** (HTML, CSS, JS) from the project root.
- **Proxies `/api/*`** to the chosen backend. laya-serve sends no CORS headers, so the browser can't call it directly. The browser sends the backend URL in the `X-Backend` header, and the proxy forwards the request there. Only these paths are forwarded:
  - `GET /health`
  - `POST /v1/systemone`
  - `POST /v1/systemone/batch`

`laya.js` is the shared client that every page imports. It checks `/health` to tell the two backends apart (Kev includes a `backend` field) and changes the batch request format to match. It also adds the nav bar, the backend URL field, the model picker (`multilingual`, `english`, `typed-decisions`, `auto`) and the status pill. Settings are saved in `localStorage`.

## Experiments

| Page            | File            | What it does                                                         |
| --------------- | --------------- | -------------------------------------------------------------------- |
| Task Router     | `index.html`    | Ranks departments or people by how well they fit a task, and scores urgency |
| Triage Board    | `triage.html`   | Sorts support tickets into lanes (bug, outage, billing, …)           |
| Tone Radar      | `tone.html`     | Scores a message on tone (polite, empathetic, clear, …)              |
| Laya vs Laya    | `go.html`       | The model plays 9×9 Go against itself, picking from candidate moves  |
| Snake           | `snake.html`    | The model steers a snake                                             |
| Wiki Race       | `wiki.html`     | Follows Wikipedia links toward a target article                      |
| Firewall        | `firewall.html` | Checks text for prompt-injection signals                             |
| Citations       | `cite.html`     | Checks whether a source supports a claim                             |

## Backends

Both backends come with a Dockerfile and a `compose.yml`, which work with Docker or Podman. Both bind to `127.0.0.1` only.

### Laya

```sh
cd laya-server/laya-server
docker compose up -d --build
```

- Runs on <http://localhost:8100> (set `LAYA_HOST_PORT` to change it).
- Uses CPU-only PyTorch. The first start downloads model checkpoints, which are kept in the `laya-hf-cache` volume.
- Optional: `LAYA_VERSION` (default `0.3.22`), `LAYA_API_KEY`, `LAYA_PRELOAD`, `LAYA_LOG_LEVEL`.

### Kev

```sh
cd kev-server
docker compose up -d --build
```

- Runs on <http://localhost:3000>.
- Expects an OpenAI-compatible LLM on the host. The default is LM Studio at `http://host.containers.internal:1234/v1` with model `qwen3.5-2b-mtp`.
- Optional: `KEV_VERSION` (default `1.0.0`), `KEV_OPENAI_BASE_URL`, `KEV_OPENAI_MODEL`, `KEV_OPENAI_API_KEY`, `KEV_STRATEGY`, `KEV_API_KEY`.
- The Dockerfile turns off Kev's JSON mode by default, because LM Studio rejects `response_format: {type: "json_object"}`.

## Notes

- Results get worse when a question has more than about 20 options. Some pages warn about this or limit the number of options.
- The proxy rejects request bodies over 1 MB and gives up on the backend after 90 seconds.
