# Firecrawl mode

Firecrawl is a fallback for sites that block direct HTML fetching or don’t render meaningful content without JS.

## `--firecrawl off|auto|always`

- `off`: never use Firecrawl.
- `auto` (default): use Firecrawl only when HTML extraction looks blocked/thin.
- `always`: try Firecrawl first (falls back to HTML if Firecrawl is unavailable/empty).

## Extract-only default

When `--extract-only` is used for non-YouTube URLs and `FIRECRAWL_API_KEY` is configured, the CLI defaults to `--firecrawl always` to return Markdown.

## API key

- `FIRECRAWL_API_KEY` (required for Firecrawl requests)
