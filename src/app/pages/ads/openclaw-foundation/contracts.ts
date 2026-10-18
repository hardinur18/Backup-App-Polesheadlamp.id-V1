import type { DailyAd, Order } from '@/app/pages/master-data/data';

export const ADS_MONITORING_FEATURE_ID = 'ads-monitoring-openclaw' as const;

export const ADS_MONITORING_CLOSING_STATUSES = [
  'processing',
  'waiting',
  'done',
  'teknisi_completed',
  'otw',
  'working',
  'qc',
] as const;

export type AdsMonitoringSourceLane = 'snapshot' | 'today-live-cache' | 'merged';

export type AdsMonitoringAttributionMode =
  | 'single-account'
  | 'exact'
  | 'primary-cs'
  | 'primary-subchannel'
  | 'historical-set'
  | 'proportional'
  | 'unresolved';

export type AdsMonitoringDiagnosticType =
  | 'attribution-gap'
  | 'burn-risk'
  | 'spend-without-order'
  | 'cs-overload'
  | 'advertiser-concentration';

export type AdsMonitoringDiagnosticSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AdsMonitoringRecommendationPriority = 'p1' | 'p2' | 'p3';

export type AdsMonitoringRecommendationType =
  | 'repair-attribution'
  | 'review-budget'
  | 'rebalance-cs'
  | 'manual-audit'
  | 'watch';

export type AdsMonitoringSandboxActionType =
  | 'request-manual-review'
  | 'repair-attribution'
  | 'pause-account'
  | 'budget-shift'
  | 'reassign-cs';

export type AdsMonitoringSandboxActionStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'rolled-back';

export type AdsMonitoringAuditEventType =
  | 'recommendation-created'
  | 'sandbox-action-proposed'
  | 'sandbox-action-approved'
  | 'sandbox-action-rejected'
  | 'sandbox-action-executed'
  | 'sandbox-action-rolled-back';

export type AdsMonitoringDateRange = {
  from: string;
  to: string;
};

export type AdsMonitoringDiagnostic = {
  id: string;
  type: AdsMonitoringDiagnosticType;
  severity: AdsMonitoringDiagnosticSeverity;
  title: string;
  summary: string;
  evidence: string[];
  relatedEntityIds?: string[];
};

export type AdsMonitoringRecommendation = {
  id: string;
  type: AdsMonitoringRecommendationType;
  priority: AdsMonitoringRecommendationPriority;
  title: string;
  reason: string;
  evidence: string[];
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  approvalRequired: boolean;
  rollbackPlan: string;
  relatedDiagnosticIds: string[];
};

export type AdsMonitoringSandboxAction = {
  id: string;
  type: AdsMonitoringSandboxActionType;
  title: string;
  payload: Record<string, unknown>;
  status: AdsMonitoringSandboxActionStatus;
  recommendationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type AdsMonitoringAuditEvent = {
  id: string;
  type: AdsMonitoringAuditEventType;
  entityId: string;
  occurredAt: string;
  actor: 'system' | 'user';
  payload: Record<string, unknown>;
};

export const CLOSED_PAYMENT_STATUSES = ['Paid', 'Down Payment'] as const;

export const ADS_MONITORING_COMPLETED_STATUSES = ['done'] as const;

export const isClosedOrderLike = (order: Pick<Order, 'status' | 'paymentStatus'>) =>
  ADS_MONITORING_CLOSING_STATUSES.includes(
    order.status as (typeof ADS_MONITORING_CLOSING_STATUSES)[number],
  ) || CLOSED_PAYMENT_STATUSES.includes(order.paymentStatus as (typeof CLOSED_PAYMENT_STATUSES)[number]);

export const isCompletedOrderLike = (order: Pick<Order, 'status' | 'effectiveStatus'>) =>
  ADS_MONITORING_COMPLETED_STATUSES.includes(
    (order.effectiveStatus || order.status) as (typeof ADS_MONITORING_COMPLETED_STATUSES)[number],
  );

export const getOrderCreatedDateKey = (order: Pick<Order, 'created_at' | 'leadDate'>) =>
  order.created_at?.slice(0, 10) || order.leadDate || null;

export const getDailyAdDateKey = (dailyAd: Pick<DailyAd, 'date'>) => dailyAd.date;

export const isDateWithinRange = (dateKey: string | null | undefined, range: AdsMonitoringDateRange) =>
  Boolean(dateKey && dateKey >= range.from && dateKey <= range.to);
