# Diagram style tokens

The style follows Vercel architecture diagrams: dashed containers, thin gray connectors, small open arrowheads, one highlighted entry node. All tokens are CSS custom properties on `:root` in the template.

## Colors

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#000` | `#fff` | Canvas and outer container fill |
| `--panel` | `#0a0a0a` | `#fafafa` | Nested panel fill |
| `--node` | `#111` | `#fff` | Node fill |
| `--border` | `#5c5c5c` | `#b8b8b8` | Dashed borders |
| `--fg` | `#ededed` | `#171717` | Labels and headers |
| `--muted` | `#8f8f8f` | `#666` | Second line, route labels, icons |
| `--line` | `#8f8f8f` | `#7a7a7a` | Connectors and arrowheads |
| `--line-strong` | `#ededed` | `#171717` | Main flow connectors |
| `--hl-fill` | `#0a2a5e` | `#dbe8ff` | Highlighted node fill |
| `--hl-ring` | `#1e5fd6` | `#2563eb` | Highlighted node ring |
| `--hl-icon` | `#cfe0ff` | `#1d4ed8` | Highlighted node icon |

## Borders and shapes

- Stroke width 1 with `vector-effect: non-scaling-stroke`, so lines stay 1px at any scale.
- Dash pattern `4 4`.
- Outer container radius 8, nested panel radius 8, node radius 6.
- Nodes are 120 x 64 (152 wide for wider labels). Gap between nodes in a row is 32, row gap 52 between a node bottom and the next row.
- Container padding is 20 to 28 from its border to the nearest node. A container header sits 20 from the top, icon first, label 8 to 10 to its right.

## Typography

Font stack `Geist, "Geist Sans", system-ui, -apple-system, "Segoe UI", sans-serif`.

| Element | Size | Weight | Color |
| --- | --- | --- | --- |
| Container header | 16 | 500 | `--fg` |
| Node label | 15 | 400 | `--fg` |
| Node second line | 11.5 | 400 | `--muted` |
| Route label on an arrow | 12.5 | 400 | `--muted` |

Node text is centered, label at the vertical middle minus 6, second line at the middle plus 11. Route labels sit 8 above their connector.

## Connectors

- Straight connectors start and end 6 away from the node edge, except where they cross a container border.
- Elbows use a 14 radius arc: `V…a14 14 0 0 1 -14 14H…`.
- Arrowhead: an open chevron marker, `viewBox 0 0 8 8`, path `M1.5 1.5 L5.5 4 L1.5 6.5`, stroke 1, round caps and joins, `refX 6`, `markerUnits="userSpaceOnUse"`, `orient="auto"`.
- Use `--line-strong` for the main path and `--line` for secondary paths.

## Icons

- Stroke only, `--muted` for node icons and `--fg` for the outer container header icon.
- Stroke width 1.5, round caps and joins, 18 to 28 px.
- Server icon (container header): two stacked rounded rectangles with a dot each. Person icon: a circle, a head circle, and a shoulder arc. Globe: a circle, a vertical ellipse, and a horizontal line.

## Highlighted node

A circle of radius 30 filled with `--hl-fill`, ringed with a 1px `--hl-ring` stroke, with a globe icon drawn at 24 px in `--hl-icon` (1.2 stroke). Place it directly in front of the node it enters. Use it once per diagram.

## Scaling

One SVG with a `viewBox`, `width: 100%`, `height: auto`. The diagram scales to the container width. Keep the `viewBox` size and the `aspectRatio` prop of `<Diagram>` equal.
