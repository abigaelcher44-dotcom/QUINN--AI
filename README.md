# QUINN AI

QUINN AI is a desktop-oriented AI application built with React, TypeScript, Vite and Electron.

## Requirements
- Node.js
- npm
- Git

## Setup
Clone the repository:

    git clone https://github.com/abigaelcher44-dotcom/QUINN--AI.git
    cd QUINN--AI

Install dependencies:

    npm ci

Create a local environment file:

    cp .env.example .env

Edit `.env` and add the API provider credentials required for your setup. Never commit or share this file.

Start the development server:

    npm run dev

Build the application:

    npm run build

Launch the Electron application:

    npm run electron

## Project structure
- `src/` — React application and interface
- `electron/` — Electron desktop integration
- `local/` — Local application services
- `public/` and `assets/` — Static assets
- `scripts/` — Development and build scripts
- `supabase/` — Supabase-related files
- `test/` — Test files
- `design/` — Design resources

## Security notes
- Keep credentials in your local `.env` file.
- Do not commit `.env`, local backups or private credentials.
- API credentials are currently stored in a local environment file; do not assume they are encrypted at rest.
- Review local service network exposure before using QUINN AI outside your own computer.

## Handover status
This repository is intended for continued development. Review the source code, dependency warnings and build behavior before preparing a release.

## License
Add the applicable project license before distributing QUINN AI.

---

## Exile Organization

<p align="center">
  <img src="docs/assets/exile-organization-logo.png" alt="Exile Organization" width="140">
</p>

<p align="center">
  **Developed and maintained by Exile Organization**
</p>

<p align="center">
  © 2026 Exile Organization. All rights reserved.
</p>
