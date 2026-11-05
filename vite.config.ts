import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const staticWebAppConfig = {
	name: 'static-web-app-config',
	apply: 'build' as const,
	generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Buffer }) => void }) {
		this.emitFile({
			type: 'asset',
			fileName: 'staticwebapp.config.json',
			source: readFileSync(new URL('./staticwebapp.config.json', import.meta.url)),
		});
	},
};

export default defineConfig({ plugins: [react(), staticWebAppConfig] });
