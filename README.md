# Incuboot

Incuboot is a private vertical commercial brand intelligence workspace for organizing brand directories, conversations, assets, and strategy work in a desktop-style UI.

This commercial edition keeps the core product focused on brand work: chats, brands, one local brand directory per brand, local event streaming, archive-first history management, settings, and extensible brand workflows. Vertical domain packs can extend the same shell without changing the private core.

## License

This repository is proprietary and private. All rights reserved.

Do not copy, redistribute, sublicense, publish, or use this software outside authorized Incuboot commercial deployments without written permission.

This project is not open source and is not available for public source distribution.

## Requirements

- Node.js and npm
- Rust toolchain for Tauri development
- Local AI runtime installed and logged in

## Development

```bash
npm install
npm run dev
npm run tauri:dev
```

Useful checks:

```bash
npm run test:run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Product Shape

- Chat UI with local event streaming
- Brand-bound local directories
- One brand mapped to one local directory
- Archive-first conversations and brands
- Settings sections for personal, integrations, brand capabilities, and archived content
- Light-first visual design for focused brand operations

## Extension Model

The commercial edition ships with the `brand-system` domain in [`src/domain.ts`](./src/domain.ts). Private vertical packages can extend:

- prompt packs
- navigation entries
- settings sections
- right-side panels
- domain-specific commands or data sources

The private core should stay focused and avoid embedding unrelated vertical logic.

## Notice

Incuboot uses its own brand, text, icons, and assets.
