import type { ErrorCode, ResourceKey } from './constants';
import type { PlanDef, PlanFeatures, PlanId, PlanLimits, PlanStatus, PricingCurrency } from './plans';

export type ProjectRole = 'manager' | 'contributor' | 'viewer';
export type OrgRole = 'owner' | 'admin' | 'member';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---------------------------------------------------------------- account

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  createdAt: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  role: OrgRole;
  /** Plan the workspace is entitled to right now (after trial/lapse resolution). */
  plan: PlanId;
  planStatus: PlanStatus;
  trialEndsAt: string | null;
}

export interface MeResponse {
  user: User;
  orgs: OrgSummary[];
}

export interface AuthResponse extends MeResponse {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface OrgDetail {
  id: string;
  name: string;
  defaultCurrency: string;
  role: OrgRole;
  plan: PlanId;
  effectivePlan: PlanId;
  planStatus: PlanStatus;
  planInterval: 'month' | 'year' | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  billingProvider: string | null;
  hasSubscription: boolean;
  usage: { projects: number; members: number; storageMb: number };
  limits: PlanLimits;
  features: PlanFeatures;
}

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  projects: number;
  joinedAt: string;
}

export interface PlansResponse {
  currency: PricingCurrency;
  provider: string;
  trialDays: number;
  plans: PlanDef[];
}

// ---------------------------------------------------------------- projects

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  status: string;
  currency: string;
  totalBudget: number;
  plotArea: number | null;
  builtUpArea: number | null;
  areaUnit: string;
  floors: number | null;
  startDate: string | null;
  targetEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItem extends Project {
  role: ProjectRole;
  orgName: string;
  stats: { spent: number; due: number; progress: number; openTasks: number };
}

export interface ProjectDetail extends Project {
  role: ProjectRole;
  orgName: string;
  orgPlan: PlanId;
  features: PlanFeatures;
}

export interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  /** Workspace owners/admins manage every project implicitly. */
  viaWorkspace: boolean;
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: ProjectRole;
  createdAt: string;
  expiresAt: string;
}

export interface InvitePreview {
  email: string;
  role: ProjectRole;
  projectName: string | null;
  orgName: string;
  invitedBy: string | null;
  expired: boolean;
  accepted: boolean;
}

// ---------------------------------------------------------------- tracked entities

export interface BaseEntity {
  id: string;
  projectId: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  serverSeq: number;
}

export interface Category extends BaseEntity {
  name: string;
  plannedAmount: number;
  color: string | null;
  icon: string | null;
  sortOrder: number;
}

export interface Phase extends BaseEntity {
  name: string;
  description: string | null;
  status: string;
  progress: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  sortOrder: number;
}

export interface Vendor extends BaseEntity {
  name: string;
  type: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  contractAmount: number | null;
  notes: string | null;
}

export interface Material extends BaseEntity {
  name: string;
  unit: string;
  category: string;
  minStock: number | null;
  estimatedQty: number | null;
  notes: string | null;
}

export interface Movement extends BaseEntity {
  materialId: string;
  type: 'in' | 'out';
  quantity: number;
  rate: number | null;
  date: string;
  vendorId: string | null;
  phaseId: string | null;
  expenseId: string | null;
  notes: string | null;
}

export interface Worker extends BaseEntity {
  name: string;
  phone: string | null;
  trade: string;
  dailyWage: number;
  vendorId: string | null;
  active: boolean;
  notes: string | null;
}

export interface Attendance extends BaseEntity {
  workerId: string;
  date: string;
  status: 'present' | 'half' | 'absent';
  overtimeHours: number;
  notes: string | null;
}

export interface Expense extends BaseEntity {
  date: string;
  title: string;
  amount: number;
  categoryId: string | null;
  phaseId: string | null;
  vendorId: string | null;
  workerId: string | null;
  paymentMode: string;
  status: 'paid' | 'due';
  dueDate: string | null;
  reference: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  taxAmount: number | null;
  paidBy: string | null;
  notes: string | null;
}

export interface Task extends BaseEntity {
  title: string;
  description: string | null;
  phaseId: string | null;
  status: string;
  priority: string;
  assignee: string | null;
  dueDate: string | null;
  completedAt: string | null;
}

export interface DailyLog extends BaseEntity {
  date: string;
  weather: string | null;
  workDone: string;
  labourCount: number | null;
  issues: string | null;
  notes: string | null;
}

export interface Fund extends BaseEntity {
  date: string;
  source: string;
  description: string | null;
  amount: number;
  reference: string | null;
  notes: string | null;
}

export interface Issue extends BaseEntity {
  title: string;
  description: string | null;
  severity: string;
  status: string;
  phaseId: string | null;
  assignee: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
}

export interface FileItem extends BaseEntity {
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  entityType: string | null;
  entityId: string | null;
  expiresOn: string | null;
  notes: string | null;
  /** Short-lived signed URL for viewing/downloading. */
  url: string;
}

export interface EntityMap {
  categories: Category;
  phases: Phase;
  vendors: Vendor;
  materials: Material;
  workers: Worker;
  expenses: Expense;
  movements: Movement;
  attendance: Attendance;
  tasks: Task;
  logs: DailyLog;
  funds: Fund;
  issues: Issue;
  files: FileItem;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------- analytics

export type AlertSeverity = 'critical' | 'serious' | 'warning' | 'info';

export interface Alert {
  kind:
    | 'over_budget'
    | 'category_over_budget'
    | 'overdue_payment'
    | 'payment_due_soon'
    | 'low_stock'
    | 'overdue_task'
    | 'document_expiring'
    | 'critical_issue';
  severity: AlertSeverity;
  title: string;
  detail?: string;
  entityType?: ResourceKey;
  entityId?: string;
}

export interface ProjectTotals {
  budget: number;
  /** Paid expenses. */
  spent: number;
  /** Billed but unpaid expenses. */
  due: number;
  overdue: number;
  /** Spent + due. */
  committed: number;
  /** Budget - committed. */
  remaining: number;
  fundsReceived: number;
  /** Funds received - spent. */
  cashInHand: number;
  labourEarned: number;
  labourPaid: number;
  materialsValue: number;
  costPerArea: number | null;
  /** Average phase progress, 0-100. */
  progress: number;
  daysElapsed: number | null;
  daysTotal: number | null;
}

export interface CategoryBreakdown {
  id: string | null;
  name: string;
  icon: string | null;
  planned: number;
  spent: number;
  due: number;
}

export interface MonthlyPoint {
  month: string; // yyyy-mm
  amount: number;
}

export interface Dashboard {
  project: ProjectDetail;
  totals: ProjectTotals;
  categories: CategoryBreakdown[];
  monthly: MonthlyPoint[];
  phases: Pick<Phase, 'id' | 'name' | 'status' | 'progress' | 'plannedStart' | 'plannedEnd'>[];
  recentExpenses: (Expense & { categoryName: string | null; vendorName: string | null })[];
  alerts: Alert[];
  counts: {
    openTasks: number;
    overdueTasks: number;
    openIssues: number;
    criticalIssues: number;
    activeWorkers: number;
    presentToday: number;
    lowStock: number;
    vendors: number;
  };
}

export interface VendorBalance {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  contractAmount: number | null;
  paid: number;
  due: number;
  /** contractAmount - paid, when a contract amount is set. */
  balance: number | null;
}

export interface MaterialStock {
  id: string;
  name: string;
  unit: string;
  category: string;
  received: number;
  used: number;
  stock: number;
  value: number;
  avgRate: number | null;
  minStock: number | null;
  estimatedQty: number | null;
}

export interface LabourSummary {
  workerId: string;
  name: string;
  trade: string;
  dailyWage: number;
  active: boolean;
  presentDays: number;
  halfDays: number;
  overtimeHours: number;
  earned: number;
  paid: number;
  balance: number;
}

export interface ProjectReport {
  generatedAt: string;
  project: ProjectDetail;
  totals: ProjectTotals;
  categories: CategoryBreakdown[];
  monthly: MonthlyPoint[];
  vendors: VendorBalance[];
  materials: MaterialStock[];
  labour: LabourSummary[];
  paymentModes: { mode: string; amount: number }[];
  funds: { source: string; amount: number }[];
}

export interface ActivityItem {
  id: number;
  action: 'create' | 'update' | 'delete';
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

// ---------------------------------------------------------------- sync

export interface SyncPullResponse {
  cursor: number;
  hasMore: boolean;
  /** Current project metadata (budget, name, role...) so clients refresh it in the same round-trip. */
  project: ProjectDetail;
  changes: Partial<Record<ResourceKey, unknown[]>>;
}

export interface SyncPushResult {
  id: string;
  entity: string;
  status: 'ok' | 'error';
  /** Set when the server merged the record into an existing one (e.g. same worker + date attendance). */
  canonicalId?: string;
  error?: string;
  /** False when the change can never succeed as-is (validation/permission) - clients should stop retrying it. */
  retryable?: boolean;
}

export interface SyncPushResponse {
  results: SyncPushResult[];
}
