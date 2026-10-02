import { existsSync } from 'node:fs';

// E2E connects to the Neon dev branch
if (existsSync('.env')) process.loadEnvFile('.env');
