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

## Colors

- `space-void` and `space-base` are the page shell and map ground.
- `space-panel`, `space-raised`, and `space-high` distinguish persistent CRM regions and controls.
- `space-fg` is primary text; `space-muted` and `space-quiet` carry secondary information and placeholders.
- `space-cyan` marks primary actions, focus, and active navigation. `space-blue` marks in-progress work. `space-pink` marks overdue and high-priority items. `space-green` marks completed or locally saved state.

## Typography

Hanken Grotesk is the only family. Customer names and task titles use 600-700 weight; descriptions use 400 at 1.5 line-height; metadata uses 0.75-0.85rem. Dates and counts use tabular figures. Task descriptions stay within a comfortable reading measure.

## Layout

The home map fills the screen below a compact toolbar. Opening a customer replaces the map with a three-column CRM view: customer navigation, a roomy task ledger, and context/contacts. At tablet widths the context column moves below the ledger. On phones the customer list becomes a horizontal strip and the ledger stacks due date, task details, then status controls. Descriptions remain visible in every layout.

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
