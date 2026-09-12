import { z } from 'zod';
export const text = (max: number) => z.string().trim().min(1).max(max);
export const coord = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .strict();
export const phone = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Use an international phone number beginning with + and a country code.',
  );
export const language = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/);
export const profileSchema = z
  .object({
    language,
    medical: z.string().max(2000),
    emergencyContact: z.string().max(100),
    theme: z.enum(['dark', 'light', 'system']),
    notifications: z.boolean(),
    networkConsent: z.boolean(),
    simulator: z.boolean().optional(),
  })
  .strict();
export const defaultProfile = {
  language: 'en',
  medical: '',
  emergencyContact: '',
  theme: 'dark',
  notifications: false,
  networkConsent: false,
};
