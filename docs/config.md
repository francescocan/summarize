# Config

`summarize` supports an optional JSON config file for defaults.

## Location

Default path:

- `~/.summarize/config.json`

Fallback (legacy):

- `~/.config/summarize/config.json` (or `$XDG_CONFIG_HOME/summarize/config.json`)

Override:

- `--config <path>`
- `SUMMARIZE_CONFIG=<path>`
- `SUMMARIZE_HOME_DIR=<dir>` (uses `<dir>/config.json` as the default)

## Precedence

For `model`:

1. CLI flag `--model`
2. Env `SUMMARIZE_MODEL`
3. Config file `model`
4. Built-in default (`xai/grok-4-fast-non-reasoning`)

## Format

`~/.summarize/config.json`:

```json
{
  "model": "xai/grok-4-fast-non-reasoning"
}
```
