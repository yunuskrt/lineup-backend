import { generateGuestHandle } from '@/auth/guest-handle.js';
import { handleSchema } from '@/contract/auth.js';

describe('generateGuestHandle', () => {
  const handles = Array.from({ length: 200 }, generateGuestHandle);

  it('passes the contract handle rule', () => {
    for (const handle of handles) {
      expect(handleSchema.parse(handle)).toBe(handle);
    }
  });

  it('is guest- plus 8 lowercase base-36 characters', () => {
    for (const handle of handles) {
      expect(handle).toMatch(/^guest-[0-9a-z]{8}$/);
    }
  });

  it('varies between calls', () => {
    expect(new Set(handles).size).toBe(handles.length);
  });
});
