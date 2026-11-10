---
name: MyWork
description: A spacewave customer map that opens into a practical helpdesk task workspace.
colors:
  space-void: "#080b1b"
  space-base: "#0c1027"
  space-panel: "#111832"
  space-raised: "#182240"
  space-high: "#202c4d"
  space-line: "#2a385d"
  space-fg: "#f0f3ff"
  space-muted: "#a4afcf"
  space-quiet: "#7d89ae"
  space-cyan: "#74deee"
  space-blue: "#9aa8ff"
  space-pink: "#ff91bf"
  space-coral: "#ff8e9b"
  space-green: "#87dfc2"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1.34rem"
    fontWeight: 700
    lineHeight: 1.25
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lamp: "50%"
spacing:
  sm: "8px"
  md: "14px"
  lg: "22px"
components:
  crm-primary:
    backgroundColor: "{colors.space-cyan}"
    textColor: "{colors.space-void}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 13px"
  task-row:
    backgroundColor: "{colors.space-base}"
    textColor: "{colors.space-fg}"
    rounded: "0"
    padding: "18px 4px"
---

# Design System: MyWork

## Overview

Spacewave is a quiet, high-contrast work surface: deep indigo fields, layered ink-blue panels, cyan navigation and focused magenta urgency marks. Fine diagonal wave lines belong to the customer map; the CRM record uses flat panels and dividers so tasks stay easy to scan. Hanken Grotesk carries both interface and long-form task descriptions.

## Home themes

- **Spacewave** is the default: the existing dark map, star field, and bright status lamps.
- **Drift** is an optional monochrome theme with a near-black canvas, suspended underwater starlight, white hierarchy, translucent glass panels, blurred menus, and floating glass customer lamps. Lamp texture supplies depth; whitespace and thin borders supply structure.
- Drift's underwater star field drifts slowly and continuously with depth, faint short trails, and subtle shimmer. Pointer movement gently pushes nearby particles away from the cursor; clicks never create expanding rings. Glass highlights follow the pointer across lamps, menus, and context panels without moving content. The decorative canvas is input-transparent, capped at 360 stars, 1.5x pixel density and roughly 30 fps, and pauses while hidden. Reduced motion keeps static stars and glass with normal focus feedback.
- Drift context menus and rails carry a thin Spacewave gradient rim (violet, blue, cyan) over the monochrome glass. Lamps use fewer inner rings and a softer glint so they read calmer while keeping the translucent glass look.
- **Paper** is a warm light theme, for daylight work: warm paper (`#f3eee3` ground, `#fbf8f1` sheets), iron-gall ink text (`#1f1b16`), ink blue (`#1f4c8f`) for action and focus, violet ink (`#57479c`) for in-progress, vermilion (`#b3301d`) for overdue, and green ink (`#2d6a4c`) for done. The map is faint graph paper (24px minor, 120px major grid). Customers are rubber stamps: a paper disc with a double ink ring. Doing stamps are dashed, overdue stamps are solid vermilion with paper text, and clear stamps are a thin pencil ring. The workspace stays flat, with hairline dividers and soft, warm, downward shadows.
- **Vivicta** is a polar-night theme: near-black blue ground (`#050b15`), aurora green (`#62efb8`) for action and focus, violet (`#b7a2ff`) for in-progress, rose (`#ff8fab`) for overdue, and ice blue (`#9cd3ff`) for done. A canvas (`AuroraSurface`) paints slow aurora curtains over a fixed CSS star field on the map. The canvas renders at quarter resolution, is upscaled with a light blur, runs at roughly 24 fps, pauses while hidden, and holds a static frame under reduced motion. Customers are dark ice discs lit from above in their status colour. A faint aurora wash sits over the top of the ledger.
- **Porcelain** is a cool light theme combining Paper's tactile depth with Drift's quiet responsiveness. Mineral white surfaces, deep green-grey text, teal actions, plum in-progress work, oxide-red overdue states, and muted green completion carry through maps, tasks, Today, forms, and menus. Customer discs have a fine inset rim, a fixed directional glaze, and soft downward shadows; open discs are satin blue. The map uses a fine neutral grid and a subtle low-poly aurora in slate-grey. Fields are subtly inset; task rows remain flat. Map discs settle once over 520ms and lift 2px on hover with a 280ms ease-out. No reflections or blur are used. Reduced motion disables entrance and hover movement; the aurora holds a static frame. On phones, record controls sit below the customer name and the map reserves a separate legend area.
- **Porcelain Dark** shares Porcelain's ceramic status discs, low-poly aurora, grid, motion, and phone layout, adapted to a near-black ground with brighter silver facets. Open customers are satin blue-glazed discs; plum marks in-progress work and oxide red marks overdue work. Both maps use the same canvas resolution and 45%-faster aurora motion, pause while hidden, and hold a static frame under reduced motion.
- The theme is selected in the toolbar's More (⋯) menu and saved locally in the browser. Theme overrides for Paper, Vivicta, and Porcelain variants live in `src/themes.css`. Spacewave remains the default; Drift carries through the map, customer context workspace, and menus.

## Colors

- `space-void` and `space-base` are the page shell and map ground.
- `space-panel`, `space-raised`, and `space-high` distinguish persistent CRM regions and controls.
- `space-fg` is primary text; `space-muted` and `space-quiet` carry secondary information and placeholders.
- `space-cyan` marks primary actions, focus, and active navigation. `space-blue` marks in-progress work. `space-pink` marks overdue and high-priority items. `space-green` marks completed or locally saved state.

## Typography

Hanken Grotesk is the only family. Customer names and task titles use 600-700 weight; descriptions use 400 at 1.5 line-height; metadata uses 0.75-0.85rem. Dates and counts use tabular figures. Task descriptions stay within a comfortable reading measure.

## Layout

The home map fills the screen below a compact toolbar: wordmark, open/customer counts, search, Today (its badge carries the overdue signal), Quick add, Add customer, and a More (⋯) menu holding theme, MCP connection, and import/export. Shortcut hints live in tooltips, not on the buttons. Below about 1180px, Quick add (bolt) and Add customer (person-plus) collapse to icon buttons rather than wrapping. Opening a customer replaces the map with a three-column CRM view: customer navigation, a roomy task ledger, and context/contacts. At tablet widths the context column moves below the ledger. On phones the customer list becomes a horizontal strip and the ledger stacks due date, task details, then status controls. Descriptions remain visible in every layout.

## Elevation & Depth

The CRM stays mostly flat and uses thin blue dividers to separate work regions. Customer orbs use a single soft downward shadow for depth. Avoid glow, glass, and nested surfaces.

## Shapes

Controls and panels use 4-6px corners. Customer orbs and contact initials are circular. Task entries remain open ledger rows rather than cards.

## Components

- **Customer orb**: a map button; open task count sets size, overdue state uses pink, active state uses cyan, and clear state uses green-blue.
- **Task composer**: title, multiline description, due date, priority, and add action.
- **Task row**: due date and relative urgency, title, always-visible description, priority control, status select, and delete action.
- **Customer navigation**: persistent on desktop; active record is marked with a cyan inset and current-state semantics.
- **Context rail**: editable working notes, contacts, local-save state, and customer removal.

## Do's and Don'ts

- Keep due date, task title, and description visible without opening a detail modal.
- Reserve cyan for action/focus, pink for urgency, and green for completion/save state.
- Keep the map pattern quiet enough that labels and counts remain the focal content.
- Don't reintroduce the narrow paper drawer, nested cards, decorative glow, or heavy borders.
- Respect reduced motion and keyboard focus.
