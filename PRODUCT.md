# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript frontend deployed to Azure Static Web Apps (SWA). SWA authentication uses Microsoft Entra ID. The SWA `/api/data` route is linked to an Azure Functions backend, which stores each authenticated user's data in Azure Blob Storage using the server-provided Entra object ID. Local Vite development uses localStorage; the packaged Mac app uses an Obsidian vault.

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
- Production web persistence uses the same-origin SWA API and per-user Azure Blob data; localStorage is only the Vite development adapter.
- The Azure Function is linked to SWA, and direct Function App access is restricted so the SWA-injected identity header is trusted only on the linked route.
- The Mac app persists to Obsidian Markdown; it does not use Azure storage.
- JSON export/import, Obsidian Markdown folder import, and customer search are implemented. The MyWork Sync Obsidian plugin supports automatic two-way note sync with timestamp conflict handling and task-deletion tombstones. Activation requires an Entra public-client app, delegated API scope, and matching Function App settings. Time tracking and due-date reminders remain undecided.

## Evidence on Hand

No real customers or data. Demo data must be labelled synthetic.

## Product Principles

- One click from the map into any customer's context.
- Capture is faster than thinking about where to put it.
- The map must stay legible with many customers.
- Web records are scoped to the authenticated user; the Mac app keeps its records in the user's selected Obsidian vault.

## Accessibility & Inclusion

Every orb is keyboard reachable with a text alternative; motion respects reduced-motion.
