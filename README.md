# Corbanu

Static organization site for [CorbanuCore](https://github.com/CorbanuCore), published with GitHub Pages.

The site is intentionally dependency-free: edit `index.html`, commit, and push to `main`.

Market Lens pages are generated from the local navstrategies spot/perp index
artifacts. Run the generator with the navstrategies Python environment:

```bash
/home/postfiat/repos/navstrategies/.venv/bin/python \
  scripts/build_market_pages.py
```
