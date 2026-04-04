// Vitest setup — mocks external services used in salary controller tests
export const mockSendNotificationEmail = vi.fn().mockResolvedValue(undefined);
export const mockSendFeeReminderBeforeEmail = vi.fn().mockResolvedValue(undefined);
export const mockSendFeeReminderDueTodayEmail = vi.fn().mockResolvedValue(undefined);
export const mockSendFeeReminderOverdueEmail = vi.fn().mockResolvedValue(undefined);
export const mockSendFeeOverdueAdminEmail = vi.fn().mockResolvedValue(undefined);
export const mockSendDraftCleanupReminderEmail = vi.fn().mockResolvedValue(undefined);

// Suppress console output during tests
// global.console = {
//   ...console,
//   log: vi.fn(),
//   warn: vi.fn(),
//   error: vi.fn(),
// };
