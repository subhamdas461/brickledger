import { z } from 'zod';
import {
  AreaUnits,
  AttendanceStatuses,
  CURRENCY_CODES,
  ExpenseStatuses,
  FileCategories,
  FileEntityTypes,
  FundSources,
  IssueSeverities,
  IssueStatuses,
  MaterialCategories,
  MovementTypes,
  PaymentModes,
  PhaseStatuses,
  Priorities,
  ProjectRoles,
  ProjectStatuses,
  TaskStatuses,
  VendorTypes,
  Weathers,
  WorkerTrades,
} from './constants';

/*
 * Input schemas. They intentionally carry NO `.default()`s: the same shape is
 * used for create (full) and update (`.partial()`), and defaults inside a
 * partial would silently reset fields on PATCH. Column defaults live in the DB.
 */

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const id = z.uuid();
const optId = z.preprocess(emptyToNull, z.uuid().nullable()).optional();
const isoDate = z.iso.date();
const optDate = z.preprocess(emptyToNull, z.iso.date().nullable()).optional();
const name = (max = 120) => z.string().trim().min(1, 'Required').max(max);
const optText = (max = 2000) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();
const money = z.number().finite().min(0).max(999_999_999_999);
const positiveMoney = z.number().finite().positive('Must be greater than 0').max(999_999_999_999);
const optMoney = money.nullable().optional();
const qty = z.number().finite().positive('Must be greater than 0').max(999_999_999);
const optQty = z.number().finite().min(0).max(999_999_999).nullable().optional();

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters');

// ---------------------------------------------------------------- auth & account

export const registerSchema = z.object({
  name: name(80),
  email: emailSchema,
  password: passwordSchema,
  company: optText(120),
  // Nullish: the Android app sends empty optional fields as null.
  inviteToken: z.string().max(200).nullish(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Required').max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(500).optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(500),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: name(80).optional(),
  phone: optText(30),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const updateOrgSchema = z.object({
  name: name(120).optional(),
  defaultCurrency: z.enum(CURRENCY_CODES).optional(),
});

// ---------------------------------------------------------------- projects & team

export const projectSchema = z.object({
  name: name(120),
  description: optText(2000),
  address: optText(300),
  city: optText(120),
  status: z.enum(ProjectStatuses.values).optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
  totalBudget: money.optional(),
  plotArea: optQty,
  builtUpArea: optQty,
  areaUnit: z.enum(AreaUnits.values).optional(),
  floors: z.number().int().min(0).max(200).nullable().optional(),
  startDate: optDate,
  targetEndDate: optDate,
});

export const createProjectSchema = projectSchema.extend({
  orgId: z.uuid().optional(),
  /** Seed default budget categories, phases and materials. */
  useTemplates: z.boolean().optional(),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(ProjectRoles.values),
});

export const updateMemberSchema = z.object({
  role: z.enum(ProjectRoles.values),
});

// ---------------------------------------------------------------- tracked resources

export const categorySchema = z.object({
  id: id.optional(),
  name: name(80),
  plannedAmount: money.optional(),
  color: optText(20),
  icon: optText(40),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export const phaseSchema = z.object({
  id: id.optional(),
  name: name(120),
  description: optText(),
  status: z.enum(PhaseStatuses.values).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  plannedStart: optDate,
  plannedEnd: optDate,
  actualStart: optDate,
  actualEnd: optDate,
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

export const vendorSchema = z.object({
  id: id.optional(),
  name: name(120),
  type: z.enum(VendorTypes.values).optional(),
  contactPerson: optText(120),
  phone: optText(30),
  email: z.preprocess(emptyToNull, z.email().nullable()).optional(),
  address: optText(300),
  taxId: optText(40),
  contractAmount: optMoney,
  notes: optText(),
});

export const materialSchema = z.object({
  id: id.optional(),
  name: name(120),
  unit: name(20),
  category: z.enum(MaterialCategories.values).optional(),
  minStock: optQty,
  estimatedQty: optQty,
  notes: optText(),
});

export const movementSchema = z.object({
  id: id.optional(),
  materialId: id,
  type: z.enum(MovementTypes.values),
  quantity: qty,
  rate: optMoney,
  date: isoDate,
  vendorId: optId,
  phaseId: optId,
  expenseId: optId,
  notes: optText(),
});

export const workerSchema = z.object({
  id: id.optional(),
  name: name(120),
  phone: optText(30),
  trade: z.enum(WorkerTrades.values).optional(),
  dailyWage: money.optional(),
  vendorId: optId,
  active: z.boolean().optional(),
  notes: optText(),
});

export const attendanceSchema = z.object({
  id: id.optional(),
  workerId: id,
  date: isoDate,
  status: z.enum(AttendanceStatuses.values),
  overtimeHours: z.number().min(0).max(24).optional(),
  notes: optText(500),
});

export const bulkAttendanceSchema = z.object({
  date: isoDate,
  entries: z
    .array(
      z.object({
        workerId: id,
        status: z.enum(AttendanceStatuses.values),
        overtimeHours: z.number().min(0).max(24).optional(),
      }),
    )
    .max(500),
});

export const expenseSchema = z.object({
  id: id.optional(),
  date: isoDate,
  title: name(200),
  amount: positiveMoney,
  categoryId: optId,
  phaseId: optId,
  vendorId: optId,
  workerId: optId,
  paymentMode: z.enum(PaymentModes.values).optional(),
  status: z.enum(ExpenseStatuses.values).optional(),
  dueDate: optDate,
  reference: optText(100),
  quantity: optQty,
  unit: optText(20),
  rate: optMoney,
  taxAmount: optMoney,
  paidBy: optText(80),
  notes: optText(),
});

export const taskSchema = z.object({
  id: id.optional(),
  title: name(200),
  description: optText(),
  phaseId: optId,
  status: z.enum(TaskStatuses.values).optional(),
  priority: z.enum(Priorities.values).optional(),
  assignee: optText(80),
  dueDate: optDate,
});

export const logSchema = z.object({
  id: id.optional(),
  date: isoDate,
  weather: z.preprocess(emptyToNull, z.enum(Weathers.values).nullable()).optional(),
  workDone: z.string().trim().min(1, 'Required').max(5000),
  labourCount: z.number().int().min(0).max(10_000).nullable().optional(),
  issues: optText(5000),
  notes: optText(5000),
});

export const fundSchema = z.object({
  id: id.optional(),
  date: isoDate,
  source: z.enum(FundSources.values),
  description: optText(200),
  amount: positiveMoney,
  reference: optText(100),
  notes: optText(),
});

export const issueSchema = z.object({
  id: id.optional(),
  title: name(200),
  description: optText(),
  severity: z.enum(IssueSeverities.values).optional(),
  status: z.enum(IssueStatuses.values).optional(),
  phaseId: optId,
  assignee: optText(80),
  dueDate: optDate,
});

/** Files are created by the upload endpoint; only metadata is editable. */
export const fileSchema = z.object({
  id: id.optional(),
  name: name(200),
  category: z.enum(FileCategories.values).optional(),
  entityType: z.preprocess(emptyToNull, z.enum(FileEntityTypes).nullable()).optional(),
  entityId: optId,
  expiresOn: optDate,
  notes: optText(),
});

// ---------------------------------------------------------------- sync

export const syncPushSchema = z.object({
  mutations: z
    .array(
      z.object({
        entity: z.string().max(40),
        op: z.enum(['upsert', 'delete']),
        id,
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(1000),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type PhaseInput = z.infer<typeof phaseSchema>;
export type VendorInput = z.infer<typeof vendorSchema>;
export type MaterialInput = z.infer<typeof materialSchema>;
export type MovementInput = z.infer<typeof movementSchema>;
export type WorkerInput = z.infer<typeof workerSchema>;
export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type LogInput = z.infer<typeof logSchema>;
export type FundInput = z.infer<typeof fundSchema>;
export type IssueInput = z.infer<typeof issueSchema>;
export type FileInput = z.infer<typeof fileSchema>;
