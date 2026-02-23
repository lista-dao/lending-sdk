import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: [
                // Test files
                'src/**/*.test.ts',
                'src/__tests__/**',

                // Re-export files (no logic)
                'src/**/index.ts',

                // Type definitions only (no runtime code)
                'src/types/**',
                'src/contracts/types.ts',

                // ABI constants (auto-generated from contracts, no logic)
                'src/contracts/abis/**',

                // Static config (addresses/constants, no logic to test)
                'src/contracts/config.ts',

                // Chain read helpers (require mocking blockchain, integration test territory)
                'src/read/**',

                // API client (requires mocking fetch, integration test territory)
                'src/api/**',

                // Simple utilities (one-liner mappings)
                'src/utils/network.ts',
                'src/utils/apiChain.ts',
            ],
        },
    },
});
