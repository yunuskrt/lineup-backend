import { existsSync } from 'node:fs';

// E2E connects to the Neon dev branch
if (existsSync('.env')) process.loadEnvFile('.env');
// Never mail from tests: suites get the log mailer
delete process.env.RESEND_API_KEY;
