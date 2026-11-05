# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript frontend served by a self-hosted Node server (`server/`) behind oauth2-proxy and Pocket ID. The server implements `/api/data` and stores each signed-in user's data as a JSON file keyed by their Pocket ID `sub`; it can also expose a remote MCP endpoint for Claude. Local Vite development uses localStorage; the packaged Mac app uses an Obsidian vault.

## Users

An individual consultant who works for many customers at once and logs work for each. Single user, no accounts or sharing.

## Product Purpose

A page for logging customer tasks and context. Success: switching between customers takes one click, and capturing a task or note takes seconds.

## Positioning

Customers appear as orbs on the home map. Clicking an orb opens a helpdesk-style customer workspace with a task ledger, due dates, descriptions, contacts, and working notes. The spatial map speeds customer switching; the ledger makes task work scannable.

## Operating Context

Frequent context switching during a workday. Quick capture while on calls or between tasks.

## Capabilities and Constraints

- Orb = customer on the home map; tasks appear in that customer's ledger.
- Customer context holds notes, contacts, status, and a task ledger with titles, descriptions, due dates, priority, and status.
- Production web persistence uses the same-origin `/api/data` on the self-hosted server, with per-user JSON files; localStorage is only the Vite development adapter.
- The server verifies the Pocket ID token on every request; saves are conditional on the ETag, and conflicting edits (another tab, or Claude via MCP) are merged per customer and task.
- The Mac app persists to Obsidian Markdown; it does not use the server.
- JSON export/import, Obsidian Markdown folder import, and customer search are implemented. A quick-add box (⌘K / Ctrl+K) captures a task for any customer from anywhere in the app. Time tracking and due-date reminders remain undecided.

## Evidence on Hand

No real customers or data. Demo data must be labelled synthetic.

## Product Principles

- One click from the map into any customer's context.
- Capture is faster than thinking about where to put it.
- The map must stay legible with many customers.
- Web records are scoped to the authenticated user; the Mac app keeps its records in the user's selected Obsidian vault.

## Accessibility & Inclusion

Every orb is keyboard reachable with a text alternative; motion respects reduced-motion.
