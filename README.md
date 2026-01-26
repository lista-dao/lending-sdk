# Lending SDK

Monorepo for Moolah lending protocol SDK packages.

## Packages

- **@lista-dao/moolah-sdk-core**: Core types and calculation functions
- **@lista-dao/moolah-sdk-read**: Read methods for on-chain and API data (planned)
- **@lista-dao/moolah-sdk-write**: Write methods for executing transactions (planned)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm build:core

# Type check
pnpm check:types

# Lint
pnpm lint

# Test
pnpm test
```

## Publishing

### Quick Start

1. **Create changeset** (after code changes):
   ```bash
   pnpm changeset
   # 选择包、版本类型（patch/minor/major）、输入描述
   ```

2. **Publish** (automatically updates version):
   ```bash
   pnpm release
   # 这会自动：
   # - 更新版本号（基于 changesets）
   # - 构建所有包
   # - 发布到 npm
   ```

## Usage in lista-mono

### Option 1: Local file reference (development)

```json
{
  "dependencies": {
    "@lista-dao/moolah-sdk-core": "file:../../lending-sdk/packages/moolah-sdk-core"
  }
}
```

### Option 2: Published package (production)

After publishing to npm:

```json
{
  "dependencies": {
    "@lista-dao/moolah-sdk-core": "^0.1.0"
  }
}
```
