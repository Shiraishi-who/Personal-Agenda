# Personal Agenda

A standalone, browser-only task dashboard made with plain HTML, CSS, and
JavaScript. There are no packages, external services, or backend.

## Run

Open `index.html` in a browser. Enter an email and any non-empty password to
open a local workspace. The password is not checked or stored.

## Includes

- Overview with open, completed, upcoming, and overdue task counts
- Calendar for due dates and editable plans
- Task creation with date/time deadlines (time is required when a date is set), details, priorities, notes, filtering, and status changes
- Checklist items with completion tracking, task tags and tag filtering, and daily/weekly/monthly task recurrence
- JSON workspace backup export and validated restore from Settings
- Drag-and-drop To do / In progress / Done board
- Weekly monitoring, search/action bar, profile settings, and dark appearance
- Browser-local data separated by account email

Workspaces are stored in this browser's `localStorage`; they do not sync across
devices. This demo login is not authentication. Do not store sensitive
information or rely on it for account security.

Recurring tasks need a deadline date and time. Completing one creates its next
occurrence; checklist items are reset for the new occurrence. Export a JSON
backup before changing devices or browsers, and keep the downloaded file
somewhere safe.

## Publish with GitHub Pages

This folder is ready to host as a static site. Create a public GitHub
repository, upload `index.html`, `styles.css`, and `app.js` to its root, then
open **Settings → Pages** and deploy from the `main` branch and `/ (root)`.
GitHub will provide a URL that works from any network. Each device still has
separate browser-local data; publishing the site does not sync tasks.
