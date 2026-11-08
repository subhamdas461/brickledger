import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Every write to a synced table takes a fresh value from this sequence. Clients
 * pull "everything with server_seq > my cursor", which gives a total order of
 * changes across all tables of a project, including soft-deletes (tombstones).
 */
export const syncSeq = pgSequence('sync_seq', { startWith: 1, increment: 1 });

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

// ---------------------------------------------------------------- identity & tenancy

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    phone: text('phone'),
    emailVerifiedAt: tsz('email_verified_at'),
    lastLoginAt: tsz('last_login_at'),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    plan: text('plan').notNull().default('free'),
    planStatus: text('plan_status').notNull().default('active'),
    planInterval: text('plan_interval'),
    trialEndsAt: tsz('trial_ends_at'),
    currentPeriodEnd: tsz('current_period_end'),
    billingProvider: text('billing_provider'),
    billingCustomerId: text('billing_customer_id'),
    billingSubscriptionId: text('billing_subscription_id'),
    defaultCurrency: text('default_currency').notNull().default('INR'),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('organizations_subscription_idx').on(t.billingSubscriptionId),
    index('organizations_customer_idx').on(t.billingCustomerId),
  ],
);

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('org_members_user_idx').on(t.userId)],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    address: text('address'),
    city: text('city'),
    status: text('status').notNull().default('in_progress'),
    currency: text('currency').notNull().default('INR'),
    totalBudget: money('total_budget').notNull().default(0),
    plotArea: numeric('plot_area', { precision: 12, scale: 2, mode: 'number' }),
    builtUpArea: numeric('built_up_area', { precision: 12, scale: 2, mode: 'number' }),
    areaUnit: text('area_unit').notNull().default('sqft'),
    floors: integer('floors'),
    startDate: date('start_date', { mode: 'string' }),
    targetEndDate: date('target_end_date', { mode: 'string' }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
    deletedAt: tsz('deleted_at'),
  },
  (t) => [index('projects_org_idx').on(t.orgId)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_idx').on(t.userId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: tsz('expires_at').notNull(),
    acceptedAt: tsz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invitations_token_uq').on(t.tokenHash), index('invitations_project_idx').on(t.projectId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: tsz('expires_at').notNull(),
    revokedAt: tsz('revoked_at'),
    replacedById: uuid('replaced_by_id'),
    createdAt: tsz('created_at').notNull().defaultNow(),
    lastUsedAt: tsz('last_used_at'),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
  ],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tsz('expires_at').notNull(),
    usedAt: tsz('used_at'),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('password_resets_token_uq').on(t.tokenHash)],
);

export const activities = pgTable(
  'activities',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    summary: text('summary').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [index('activities_project_idx').on(t.projectId, t.id)],
);

/** Processed webhook events, for idempotency. */
export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload'),
  createdAt: tsz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- synced project data

/** Columns shared by every offline-syncable, project-scoped table. */
function syncColumns() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
    deletedAt: tsz('deleted_at'),
    serverSeq: bigint('server_seq', { mode: 'number' })
      .notNull()
      .default(sql`nextval('sync_seq')`),
  };
}

export const categories = pgTable(
  'categories',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    plannedAmount: money('planned_amount').notNull().default(0),
    color: text('color'),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('categories_sync_idx').on(t.projectId, t.serverSeq)],
);

export const phases = pgTable(
  'phases',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('not_started'),
    progress: integer('progress').notNull().default(0),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    actualStart: date('actual_start', { mode: 'string' }),
    actualEnd: date('actual_end', { mode: 'string' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('phases_sync_idx').on(t.projectId, t.serverSeq)],
);

export const vendors = pgTable(
  'vendors',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    type: text('type').notNull().default('supplier'),
    contactPerson: text('contact_person'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    taxId: text('tax_id'),
    contractAmount: money('contract_amount'),
    notes: text('notes'),
  },
  (t) => [index('vendors_sync_idx').on(t.projectId, t.serverSeq)],
);

export const materials = pgTable(
  'materials',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    category: text('category').notNull().default('other'),
    minStock: qty('min_stock'),
    estimatedQty: qty('estimated_qty'),
    notes: text('notes'),
  },
  (t) => [index('materials_sync_idx').on(t.projectId, t.serverSeq)],
);

export const movements = pgTable(
  'material_movements',
  {
    ...syncColumns(),
    materialId: uuid('material_id').notNull(),
    type: text('type').notNull(),
    quantity: qty('quantity').notNull(),
    rate: money('rate'),
    date: date('date', { mode: 'string' }).notNull(),
    vendorId: uuid('vendor_id'),
    phaseId: uuid('phase_id'),
    expenseId: uuid('expense_id'),
    notes: text('notes'),
  },
  (t) => [
    index('movements_sync_idx').on(t.projectId, t.serverSeq),
    index('movements_material_idx').on(t.materialId),
  ],
);

export const workers = pgTable(
  'workers',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    phone: text('phone'),
    trade: text('trade').notNull().default('helper'),
    dailyWage: money('daily_wage').notNull().default(0),
    vendorId: uuid('vendor_id'),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
  },
  (t) => [index('workers_sync_idx').on(t.projectId, t.serverSeq)],
);

export const attendance = pgTable(
  'attendance',
  {
    ...syncColumns(),
    workerId: uuid('worker_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status').notNull(),
    overtimeHours: numeric('overtime_hours', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    notes: text('notes'),
  },
  (t) => [
    index('attendance_sync_idx').on(t.projectId, t.serverSeq),
    index('attendance_date_idx').on(t.projectId, t.date),
    uniqueIndex('attendance_worker_date_uq')
      .on(t.workerId, t.date)
      .where(sql`deleted_at is null`),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    ...syncColumns(),
    date: date('date', { mode: 'string' }).notNull(),
    title: text('title').notNull(),
    amount: money('amount').notNull(),
    categoryId: uuid('category_id'),
    phaseId: uuid('phase_id'),
    vendorId: uuid('vendor_id'),
    workerId: uuid('worker_id'),
    paymentMode: text('payment_mode').notNull().default('cash'),
    status: text('status').notNull().default('paid'),
    dueDate: date('due_date', { mode: 'string' }),
    reference: text('reference'),
    quantity: qty('quantity'),
    unit: text('unit'),
    rate: money('rate'),
    taxAmount: money('tax_amount'),
    paidBy: text('paid_by'),
    notes: text('notes'),
  },
  (t) => [
    index('expenses_sync_idx').on(t.projectId, t.serverSeq),
    index('expenses_date_idx').on(t.projectId, t.date),
    index('expenses_vendor_idx').on(t.vendorId),
    index('expenses_category_idx').on(t.categoryId),
    index('expenses_worker_idx').on(t.workerId),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    ...syncColumns(),
    title: text('title').notNull(),
    description: text('description'),
    phaseId: uuid('phase_id'),
    status: text('status').notNull().default('todo'),
    priority: text('priority').notNull().default('medium'),
    assignee: text('assignee'),
    dueDate: date('due_date', { mode: 'string' }),
    completedAt: tsz('completed_at'),
  },
  (t) => [index('tasks_sync_idx').on(t.projectId, t.serverSeq)],
);

export const dailyLogs = pgTable(
  'daily_logs',
  {
    ...syncColumns(),
    date: date('date', { mode: 'string' }).notNull(),
    weather: text('weather'),
    workDone: text('work_done').notNull(),
    labourCount: integer('labour_count'),
    issues: text('issues'),
    notes: text('notes'),
  },
  (t) => [index('daily_logs_sync_idx').on(t.projectId, t.serverSeq), index('daily_logs_date_idx').on(t.projectId, t.date)],
);

export const funds = pgTable(
  'funds',
  {
    ...syncColumns(),
    date: date('date', { mode: 'string' }).notNull(),
    source: text('source').notNull(),
    description: text('description'),
    amount: money('amount').notNull(),
    reference: text('reference'),
    notes: text('notes'),
  },
  (t) => [index('funds_sync_idx').on(t.projectId, t.serverSeq)],
);

export const issues = pgTable(
  'issues',
  {
    ...syncColumns(),
    title: text('title').notNull(),
    description: text('description'),
    severity: text('severity').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    phaseId: uuid('phase_id'),
    assignee: text('assignee'),
    dueDate: date('due_date', { mode: 'string' }),
    resolvedAt: tsz('resolved_at'),
  },
  (t) => [index('issues_sync_idx').on(t.projectId, t.serverSeq)],
);

export const files = pgTable(
  'files',
  {
    ...syncColumns(),
    name: text('name').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    category: text('category').notNull().default('other'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    expiresOn: date('expires_on', { mode: 'string' }),
    notes: text('notes'),
  },
  (t) => [
    index('files_sync_idx').on(t.projectId, t.serverSeq),
    index('files_entity_idx').on(t.projectId, t.entityType, t.entityId),
  ],
);
