/**
 * Domain vocabularies. Each vocabulary is declared once as `{ value: label }`
 * and exposes `values` (a tuple usable by zod), `labels` and `list` (for selects).
 * The Android app mirrors these values in `domain/Vocab.kt` - keep them in sync.
 */

export const APP_NAME = 'BrickLedger';
export const APP_TAGLINE = 'Every brick, bill and worker of your home build - tracked in one place.';

type Labels = Record<string, string>;

export interface Vocabulary<T extends Labels> {
  labels: T;
  values: [keyof T & string, ...(keyof T & string)[]];
  list: { value: keyof T & string; label: string }[];
  label: (value: string | null | undefined) => string;
}

function vocabulary<const T extends Labels>(labels: T): Vocabulary<T> {
  const values = Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]];
  return {
    labels,
    values,
    list: values.map((value) => ({ value, label: labels[value] as string })),
    label: (value) => (value && value in labels ? (labels[value] as string) : value ?? ''),
  };
}

export const ProjectStatuses = vocabulary({
  planning: 'Planning',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
});

export const ProjectRoles = vocabulary({
  manager: 'Manager',
  contributor: 'Contributor',
  viewer: 'Viewer',
});

export const ProjectRoleDescriptions: Record<keyof typeof ProjectRoles.labels, string> = {
  manager: 'Full control: budget, team, edits and deletes.',
  contributor: 'Adds and edits entries - expenses, attendance, materials, diary.',
  viewer: 'Read-only access. Ideal for family, clients or your bank.',
};

export const OrgRoles = vocabulary({
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
});

export const PaymentModes = vocabulary({
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
});

export const ExpenseStatuses = vocabulary({
  paid: 'Paid',
  due: 'Due',
});

export const VendorTypes = vocabulary({
  supplier: 'Material supplier',
  contractor: 'Contractor',
  labour_contractor: 'Labour contractor',
  consultant: 'Architect / engineer',
  service: 'Service provider',
  other: 'Other',
});

export const MaterialCategories = vocabulary({
  cement: 'Cement',
  steel: 'Steel',
  sand: 'Sand',
  aggregate: 'Aggregate',
  bricks_blocks: 'Bricks & blocks',
  tiles_stone: 'Tiles & stone',
  wood: 'Wood',
  paint: 'Paint',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hardware: 'Hardware',
  other: 'Other',
});

/** Units are free text on the server; these are suggestions shown in pickers. */
export const MATERIAL_UNITS = [
  'bags', 'kg', 'ton', 'cft', 'cum', 'brass', 'nos', 'sqft', 'sqm', 'rft', 'ltr', 'trip', 'box', 'set',
] as const;

export const MovementTypes = vocabulary({
  in: 'Received',
  out: 'Used',
});

export const WorkerTrades = vocabulary({
  mason: 'Mason',
  helper: 'Helper',
  carpenter: 'Carpenter',
  bar_bender: 'Bar bender',
  electrician: 'Electrician',
  plumber: 'Plumber',
  painter: 'Painter',
  tiler: 'Tile layer',
  welder: 'Welder',
  supervisor: 'Supervisor',
  other: 'Other',
});

export const AttendanceStatuses = vocabulary({
  present: 'Present',
  half: 'Half day',
  absent: 'Absent',
});

export const TaskStatuses = vocabulary({
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
});

export const Priorities = vocabulary({
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
});

export const PhaseStatuses = vocabulary({
  not_started: 'Not started',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
});

export const Weathers = vocabulary({
  sunny: 'Sunny',
  cloudy: 'Cloudy',
  rainy: 'Rainy',
  stormy: 'Stormy',
  hot: 'Very hot',
  cold: 'Cold',
});

export const FundSources = vocabulary({
  savings: 'Own savings',
  home_loan: 'Home loan',
  family: 'Family / friends',
  investor: 'Investor / partner',
  client: 'Client payment',
  other: 'Other',
});

export const IssueSeverities = vocabulary({
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
});

export const IssueStatuses = vocabulary({
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
});

export const FileCategories = vocabulary({
  drawing: 'Drawing / plan',
  permit: 'Permit / approval',
  contract: 'Contract / agreement',
  invoice: 'Invoice / bill',
  receipt: 'Receipt',
  photo: 'Site photo',
  warranty: 'Warranty',
  report: 'Report',
  other: 'Other',
});

export const AreaUnits = vocabulary({
  sqft: 'sq ft',
  sqm: 'sq m',
});

/** Entities a file can be attached to. */
export const FileEntityTypes = ['expense', 'log', 'issue', 'task', 'vendor', 'document', 'project'] as const;
export type FileEntityType = (typeof FileEntityTypes)[number];

export interface CurrencyDef {
  code: string;
  symbol: string;
  name: string;
  locale: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'INR', symbol: '₹', name: 'Indian rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE' },
  { code: 'GBP', symbol: '£', name: 'British pound', locale: 'en-GB' },
  { code: 'AED', symbol: 'AED', name: 'UAE dirham', locale: 'en-AE' },
  { code: 'SAR', symbol: 'SAR', name: 'Saudi riyal', locale: 'en-SA' },
  { code: 'QAR', symbol: 'QAR', name: 'Qatari riyal', locale: 'en-QA' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar', locale: 'en-CA' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand dollar', locale: 'en-NZ' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar', locale: 'en-SG' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit', locale: 'en-MY' },
  { code: 'NPR', symbol: 'Rs', name: 'Nepalese rupee', locale: 'en-NP' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan rupee', locale: 'en-LK' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi taka', locale: 'en-BD' },
  { code: 'PKR', symbol: 'Rs', name: 'Pakistani rupee', locale: 'en-PK' },
  { code: 'ZAR', symbol: 'R', name: 'South African rand', locale: 'en-ZA' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian naira', locale: 'en-NG' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan shilling', locale: 'en-KE' },
  { code: 'PHP', symbol: '₱', name: 'Philippine peso', locale: 'en-PH' },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];

export function currencyLocale(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.locale ?? 'en-US';
}

/**
 * Resource keys double as URL segments (`/projects/:id/<key>`) and as keys in the
 * sync payload. The order is the dependency order used when applying a sync push:
 * referenced entities first.
 */
export const RESOURCE_KEYS = [
  'categories',
  'phases',
  'vendors',
  'materials',
  'workers',
  'expenses',
  'movements',
  'attendance',
  'tasks',
  'logs',
  'funds',
  'issues',
  'files',
] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PLAN_LIMIT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'BAD_REQUEST',
  'INTERNAL',
  /** File uploads need S3/R2 on this host (e.g. Vercel). */
  'STORAGE_NOT_CONFIGURED',
  /** The server is missing required settings (sent by the Vercel entry before the app starts). */
  'SETUP_REQUIRED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
