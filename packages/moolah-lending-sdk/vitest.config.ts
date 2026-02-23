import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

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
                'src/types.ts',

                // Chain read functions (require mocking blockchain, integration test territory)
                'src/read/**',
            ],
        },
    },
    resolve: {
        alias: {
            '@lista-dao/moolah-sdk-core': resolve(__dirname, '../moolah-sdk-core/src'),
        },
    },
});
