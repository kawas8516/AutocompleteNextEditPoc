# Landing page

Static landing page for **Continue (OpenRouter)**. No build step, no framework,
no dependencies. Copy this folder into a repo and it works.

## Publish on GitHub Pages

1. Copy this folder's **contents** into the repo you want to publish from.
2. Repo → **Settings → Pages**.
3. Source: **Deploy from a branch**. Branch: `main`, folder: `/ (root)` (or
   `/docs` if you put the files in a `docs/` folder).
4. Save. The site goes live in a minute or two, and republishes on every push.

`.nojekyll` is included so GitHub serves the files as-is instead of running
Jekyll over them.

## Links

All links point at
[kawas8516/AutocompleteNextEditPoc](https://github.com/kawas8516/AutocompleteNextEditPoc).
Nothing needs editing before publishing the page.

One caveat: the **Marketplace** link and the `code --install-extension
kawas8516.continue-openrouter` command in the first install tab resolve only
once the extension is published to the VS Code Marketplace. The publisher id and
extension name already match `extension/package.json`, so they will start
working the moment `vsce publish` succeeds, with no edit here. Until then, the
other two install tabs (download the `.vsix`, or build from source) work.

The **Releases** link expects a published release. Create one, attach the
`.vsix`, and it resolves.

## Files

```
index.html          the page
assets/styles.css   tokens + layout (dark and light themes)
assets/main.js      theme toggle, install tabs, copy buttons
assets/fonts.css    @font-face declarations
assets/fonts/       self-hosted woff2 (160 KB total)
.nojekyll           tells GitHub Pages to skip Jekyll
```

Fonts are self-hosted rather than loaded from Google's CDN: it keeps the folder
portable, and a page whose pitch is "nothing phones home" shouldn't hand every
visitor's IP to a third party.
