---
name: architecture-diagram
description: Create or update architecture and flow diagrams for relay's docs. Use when a docs page needs a diagram of components, data flow, or a pipeline, or when an existing diagram in docs/public/diagrams changes.
metadata:
  internal: true
---

# Architecture diagram

Diagrams are standalone HTML files that the docs embed with the `Diagram` component. Follow the technical-writer skill for any prose.

## Folder convention

- One folder per diagram: `docs/public/diagrams/<name>/index.html`. `<name>` is a short kebab-case slug.
- The file is standalone: inline CSS, one inline SVG, no external requests. Start from [references/template.html](references/template.html).
- The visual tokens are in [references/style.md](references/style.md). Reuse them so every diagram looks the same.
- The theme comes from `?theme=light` or `?theme=dark`. Without the parameter the diagram follows `prefers-color-scheme` and defaults to dark.
- Give the SVG a `<title>` and a `<desc>` that states the whole flow in words.

## Draw the real mechanism

1. Read the code before drawing. For the engine, read `src/engine/` and the Architecture page. Draw only components, names, and directions you can point to in source.
2. Use the identifiers from the code as labels (`CaptureSource`, `InputBackend`) and put the mechanism in the gray second line (`XDamage, MIT-SHM`).
3. Draw one arrow per real data path. Label arrows that cross a boundary with the route or protocol (`/stream`).
4. Group components by where they run: an outer dashed container for a machine, a nested panel for a process. Put the client outside.
5. Mark the entry point of the flow with the highlighted circle node. Use it once.
6. Lay it out for the 720px docs column at 1:1 scale (see style.md) and keep it to 12 nodes or fewer. Move detail to the page text.

## Embed it

```mdx
<Diagram name="architecture" title="Relay architecture" aspectRatio="720 / 448" />
```

`aspectRatio` is the SVG `viewBox` width and height. The component passes the site theme to the iframe.

## Text version

Keep a text version of the flow next to the diagram on the page, such as a short list or code block with the same components and order. Readers of the `.md` route and screen readers depend on it.

## Check it

1. In `docs/`, run `pnpm dev`.
2. Open `/diagrams/<name>/index.html` and `/diagrams/<name>/index.html?theme=light` at 1440x900. Look for clipped text, overlapping labels, arrows that miss their node, and unreadable gray text.
3. Open the docs page and check the diagram in both site themes.
4. Run `pnpm build` in `docs/`.
5. Stop the dev server and close the browser session.
