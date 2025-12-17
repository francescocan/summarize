# Extract-only mode

`--extract-only` prints the extracted content and exits.

## Notes

- No OpenAI call happens in this mode.
- `--length` is intended for summarization guidance; extraction prints full content.
- For non-YouTube URLs, the CLI prefers Firecrawl Markdown by default when `FIRECRAWL_API_KEY` is configured.
  - Force plain HTML extraction with `--firecrawl off`.
