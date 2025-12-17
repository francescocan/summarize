# OpenAI mode

If `OPENAI_API_KEY` is set (or provided via the environment), the CLI calls OpenAI and prints the model output.

## Env

- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; default is `gpt-5.2`)

## Flags

- `--model <model>` (overrides `OPENAI_MODEL`)
- `--length short|medium|long|xl|xxl|<chars>`
  - This is a *soft guidance* instruction to the model (no hard truncation).
- `--prompt` (print prompt and exit)
- `--json` (includes prompt + summary in one JSON object)
