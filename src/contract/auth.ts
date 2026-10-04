import { z } from 'zod';
import { idSchema, tierSchema } from '@/contract/common.js';
import {
  MAX_HANDLE_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_HANDLE_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/contract/constants.js';
import { contractRegistry } from '@/contract/registry.js';

export const userSchema = z
  .object({
    id: idSchema,
    handle: z.string().min(1),
    isGuest: z.boolean(),
    // Always false for a guest, who has no email
    emailVerified: z.boolean(),
    // Resolved by the server, never asserted by a client
    tier: tierSchema,
  })
  .register(contractRegistry, { id: 'User' });
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z
  .object({ user: userSchema })
  .register(contractRegistry, { id: 'Session' });
export type Session = z.infer<typeof sessionSchema>;

// GET /auth/session: null when signed out
export const sessionOrNullSchema = sessionSchema
  .nullable()
  .register(contractRegistry, { id: 'SessionOrNull' });

const emailSchema = z.email();

// Length only; B10 owns the password policy
const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH);

// Same rule as the users_handle_check constraint
export const handleSchema = z
  .string()
  .trim()
  .min(MIN_HANDLE_LENGTH)
  .max(MAX_HANDLE_LENGTH)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, digits, _ . - only');

export const signInRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .register(contractRegistry, { id: 'SignInRequest' });
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const signUpRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    handle: handleSchema,
  })
  .register(contractRegistry, { id: 'SignUpRequest' });
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const upgradeGuestRequestSchema = signUpRequestSchema
  .extend({})
  .register(contractRegistry, { id: 'UpgradeGuestRequest' });
export type UpgradeGuestRequest = z.infer<typeof upgradeGuestRequestSchema>;
