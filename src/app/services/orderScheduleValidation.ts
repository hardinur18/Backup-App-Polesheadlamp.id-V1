import type { Order, ProspectBooking, User } from "@/app/pages/master-data/data";
import { normalizeOrderTime } from "@/app/services/orderTime";
import { supabase } from "@/lib/supabaseClient";

const INACTIVE_ORDER_SCHEDULE_STATUSES = new Set<Order["status"]>([
  "cancelled",
  "reschedule",
]);

const INACTIVE_BOOKING_SCHEDULE_STATUSES = new Set<ProspectBooking["status"]>([
  "cancelled",
  "reschedule",
]);

const NON_BLOCKING_BOOKING_LEAD_STATUSES = new Set(["Cancel", "Closing"]);

export interface TechnicianScheduleLike {
  userId: string;
  date: string;
  type?: string;
  reason?: string;
}

export type ScheduleConflictSource = "order" | "booking";

export interface ScheduleConflictInfo {
  key: string;
  count: number;
  sources: ScheduleConflictSource[];
  itemKeys: string[];
}

export interface ScheduleValidationOptions {
  ignoredBookingLeadIds?: ReadonlySet<string>;
}

function normalizeScheduleValue(value?: string | null) {
  return typeof value === "string" ? value.trim() : "";
}

function hasScheduleSignature(order: Partial<Order>) {
  return Boolean(
    normalizeScheduleValue(order.technicianId) &&
      normalizeScheduleValue(order.serviceDate) &&
      normalizeOrderTime(order.serviceTime)
  );
}

function hasBookingScheduleSignature(booking: Partial<ProspectBooking>) {
  return Boolean(
    normalizeScheduleValue(booking.technicianId) &&
      normalizeScheduleValue(booking.scheduleDate) &&
      normalizeOrderTime(booking.scheduleTime)
  );
}

function bookingToOrderScheduleLike(booking: Partial<ProspectBooking>): Partial<Order> {
  return {
    id: booking.id,
    customerName: booking.customerName,
    branchId: booking.branchId,
    technicianId: booking.technicianId,
    serviceDate: booking.scheduleDate,
    serviceTime: booking.scheduleTime,
    status: booking.status === "cancelled" || booking.status === "reschedule"
      ? booking.status
      : "waiting",
  };
}

export function getTechnicianDaySchedule(
  technicianId: string | undefined | null,
  serviceDate: string | undefined | null,
  technicianSchedules: TechnicianScheduleLike[],
) {
  const normalizedTechnicianId = normalizeScheduleValue(technicianId);
  const normalizedServiceDate = normalizeScheduleValue(serviceDate);

  if (!normalizedTechnicianId || !normalizedServiceDate) {
    return null;
  }

  return (
    technicianSchedules.find(
      (schedule) =>
        normalizeScheduleValue(schedule.userId) === normalizedTechnicianId &&
        normalizeScheduleValue(schedule.date) === normalizedServiceDate,
    ) || null
  );
}

export function isInactiveOrderScheduleStatus(status?: Order["status"]) {
  return Boolean(status && INACTIVE_ORDER_SCHEDULE_STATUSES.has(status));
}

export function isInactiveProspectBookingScheduleStatus(status?: ProspectBooking["status"]) {
  return Boolean(status && INACTIVE_BOOKING_SCHEDULE_STATUSES.has(status));
}

async function getNonBlockingBookingLeadIds(
  bookingRows: Array<{ lead_id?: string | null }>,
) {
  const leadIds = Array.from(
    new Set(
      bookingRows
        .map((row) => normalizeScheduleValue(row.lead_id))
        .filter(Boolean),
    ),
  );

  if (leadIds.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from("leads")
    .select("id, status")
    .in("id", leadIds);

  if (error) {
    throw error;
  }

  return new Set(
    (data || [])
      .filter((lead) => NON_BLOCKING_BOOKING_LEAD_STATUSES.has(String(lead.status)))
      .map((lead) => normalizeScheduleValue(lead.id))
      .filter(Boolean),
  );
}

function isNonBlockingBookingLead(
  leadId: string | null | undefined,
  nonBlockingLeadIds: ReadonlySet<string>,
  options?: ScheduleValidationOptions,
) {
  const normalizedLeadId = normalizeScheduleValue(leadId);
  return Boolean(
    normalizedLeadId &&
      (options?.ignoredBookingLeadIds?.has(normalizedLeadId) ||
        nonBlockingLeadIds.has(normalizedLeadId)),
  );
}

function isActiveProspectBookingSchedule(booking: ProspectBooking) {
  return !booking.orderId && !isInactiveProspectBookingScheduleStatus(booking.status);
}

export function getScheduleConflictItemKey(source: ScheduleConflictSource, id: string) {
  return `${source}:${id}`;
}

export function getScheduleSlotConflictKey(input: {
  technicianId?: string | null;
  serviceDate?: string | null;
  serviceTime?: string | null;
}) {
  const technicianId = normalizeScheduleValue(input.technicianId);
  const serviceDate = normalizeScheduleValue(input.serviceDate);
  const serviceTime = normalizeOrderTime(input.serviceTime);

  if (!technicianId || !serviceDate || !serviceTime) {
    return null;
  }

  return `${technicianId}|${serviceDate}|${serviceTime}`;
}

export function buildActiveScheduleConflictMap(
  orders: Order[],
  bookings: ProspectBooking[],
) {
  const slotMap = new Map<
    string,
    Array<{ itemKey: string; source: ScheduleConflictSource }>
  >();

  const pushSlotItem = (
    key: string | null,
    source: ScheduleConflictSource,
    id: string,
  ) => {
    if (!key) return;

    const items = slotMap.get(key) || [];
    items.push({ itemKey: getScheduleConflictItemKey(source, id), source });
    slotMap.set(key, items);
  };

  orders.forEach((order) => {
    if (isInactiveOrderScheduleStatus(order.status)) return;

    pushSlotItem(
      getScheduleSlotConflictKey({
        technicianId: order.technicianId,
        serviceDate: order.serviceDate,
        serviceTime: order.serviceTime,
      }),
      "order",
      order.id,
    );
  });

  bookings.forEach((booking) => {
    if (!isActiveProspectBookingSchedule(booking)) return;

    pushSlotItem(
      getScheduleSlotConflictKey({
        technicianId: booking.technicianId,
        serviceDate: booking.scheduleDate,
        serviceTime: booking.scheduleTime,
      }),
      "booking",
      booking.id,
    );
  });

  const conflictMap = new Map<string, ScheduleConflictInfo>();

  slotMap.forEach((items, key) => {
    if (items.length <= 1) return;

    const info: ScheduleConflictInfo = {
      key,
      count: items.length,
      sources: Array.from(new Set(items.map((item) => item.source))),
      itemKeys: items.map((item) => item.itemKey),
    };

    items.forEach((item) => {
      conflictMap.set(item.itemKey, info);
    });
  });

  return conflictMap;
}

export function getOrderScheduleConflicts(
  targetOrder: Partial<Order>,
  orders: Order[],
) {
  if (!hasScheduleSignature(targetOrder)) {
    return {
      activeConflicts: [] as Order[],
      inactiveConflicts: [] as Order[],
    };
  }

  const matchingOrders = orders.filter((order) => {
    return (
      order.id !== targetOrder.id &&
      normalizeScheduleValue(order.technicianId) ===
        normalizeScheduleValue(targetOrder.technicianId) &&
      normalizeScheduleValue(order.serviceDate) ===
        normalizeScheduleValue(targetOrder.serviceDate) &&
      normalizeOrderTime(order.serviceTime) ===
        normalizeOrderTime(targetOrder.serviceTime)
    );
  });

  return {
    activeConflicts: matchingOrders.filter(
      (order) => !isInactiveOrderScheduleStatus(order.status),
    ),
    inactiveConflicts: matchingOrders.filter((order) =>
      isInactiveOrderScheduleStatus(order.status),
    ),
  };
}

export function getOrderProspectBookingScheduleConflicts(
  targetOrder: Partial<Order>,
  bookings: ProspectBooking[],
) {
  if (!hasScheduleSignature(targetOrder)) {
    return [] as ProspectBooking[];
  }

  const targetLeadId = normalizeScheduleValue(targetOrder.leadId);

  return bookings.filter((booking) => {
    if (
      targetLeadId &&
      normalizeScheduleValue(booking.leadId) === targetLeadId
    ) {
      return false;
    }

    return (
      isActiveProspectBookingSchedule(booking) &&
      normalizeScheduleValue(booking.technicianId) ===
        normalizeScheduleValue(targetOrder.technicianId) &&
      normalizeScheduleValue(booking.scheduleDate) ===
        normalizeScheduleValue(targetOrder.serviceDate) &&
      normalizeOrderTime(booking.scheduleTime) ===
        normalizeOrderTime(targetOrder.serviceTime)
    );
  });
}

export function getProspectBookingScheduleConflicts(
  targetBooking: Partial<ProspectBooking>,
  bookings: ProspectBooking[],
  orders: Order[],
) {
  if (!hasBookingScheduleSignature(targetBooking)) {
    return {
      activeOrderConflicts: [] as Order[],
      inactiveOrderConflicts: [] as Order[],
      activeBookingConflicts: [] as ProspectBooking[],
      inactiveBookingConflicts: [] as ProspectBooking[],
    };
  }

  const matchingOrders = orders.filter((order) => {
    return (
      normalizeScheduleValue(order.technicianId) ===
        normalizeScheduleValue(targetBooking.technicianId) &&
      normalizeScheduleValue(order.serviceDate) ===
        normalizeScheduleValue(targetBooking.scheduleDate) &&
      normalizeOrderTime(order.serviceTime) ===
        normalizeOrderTime(targetBooking.scheduleTime)
    );
  });

  const matchingBookings = bookings.filter((booking) => {
    return (
      booking.id !== targetBooking.id &&
      !booking.orderId &&
      normalizeScheduleValue(booking.technicianId) ===
        normalizeScheduleValue(targetBooking.technicianId) &&
      normalizeScheduleValue(booking.scheduleDate) ===
        normalizeScheduleValue(targetBooking.scheduleDate) &&
      normalizeOrderTime(booking.scheduleTime) ===
        normalizeOrderTime(targetBooking.scheduleTime)
    );
  });

  return {
    activeOrderConflicts: matchingOrders.filter(
      (order) => !isInactiveOrderScheduleStatus(order.status),
    ),
    inactiveOrderConflicts: matchingOrders.filter((order) =>
      isInactiveOrderScheduleStatus(order.status),
    ),
    activeBookingConflicts: matchingBookings.filter(
      (booking) => !isInactiveProspectBookingScheduleStatus(booking.status),
    ),
    inactiveBookingConflicts: matchingBookings.filter((booking) =>
      isInactiveProspectBookingScheduleStatus(booking.status),
    ),
  };
}

export function shouldValidateOrderScheduleOnSave(
  previousOrder: Order | null | undefined,
  nextOrder: Partial<Order>,
) {
  if (!hasScheduleSignature(nextOrder)) {
    return false;
  }

  if (isInactiveOrderScheduleStatus(nextOrder.status)) {
    return false;
  }

  if (!previousOrder) {
    return true;
  }

  const previousWasInactive = isInactiveOrderScheduleStatus(previousOrder.status);
  const nextIsInactive = isInactiveOrderScheduleStatus(nextOrder.status);

  return (
    normalizeScheduleValue(previousOrder.technicianId) !==
      normalizeScheduleValue(nextOrder.technicianId) ||
    normalizeScheduleValue(previousOrder.serviceDate) !==
      normalizeScheduleValue(nextOrder.serviceDate) ||
    normalizeOrderTime(previousOrder.serviceTime) !==
      normalizeOrderTime(nextOrder.serviceTime) ||
    previousWasInactive !== nextIsInactive
  );
}

export function shouldValidateProspectBookingScheduleOnSave(
  previousBooking: ProspectBooking | null | undefined,
  nextBooking: Partial<ProspectBooking>,
) {
  if (!hasBookingScheduleSignature(nextBooking)) {
    return false;
  }

  if (nextBooking.orderId || isInactiveProspectBookingScheduleStatus(nextBooking.status)) {
    return false;
  }

  if (!previousBooking) {
    return true;
  }

  const previousWasInactive =
    Boolean(previousBooking.orderId) ||
    isInactiveProspectBookingScheduleStatus(previousBooking.status);
  const nextIsInactive =
    Boolean(nextBooking.orderId) ||
    isInactiveProspectBookingScheduleStatus(nextBooking.status);

  return (
    normalizeScheduleValue(previousBooking.technicianId) !==
      normalizeScheduleValue(nextBooking.technicianId) ||
    normalizeScheduleValue(previousBooking.scheduleDate) !==
      normalizeScheduleValue(nextBooking.scheduleDate) ||
    normalizeOrderTime(previousBooking.scheduleTime) !==
      normalizeOrderTime(nextBooking.scheduleTime) ||
    previousWasInactive !== nextIsInactive
  );
}

export function shouldValidateTechnicianAvailabilityOnSave(
  previousOrder: Order | null | undefined,
  nextOrder: Partial<Order>,
) {
  return shouldValidateOrderScheduleOnSave(previousOrder, nextOrder);
}

export function shouldValidateProspectBookingTechnicianAvailabilityOnSave(
  previousBooking: ProspectBooking | null | undefined,
  nextBooking: Partial<ProspectBooking>,
) {
  return shouldValidateProspectBookingScheduleOnSave(previousBooking, nextBooking);
}

function getTechnicianName(
  technicianId: string | undefined,
  users: Pick<User, "id" | "name">[],
) {
  return (
    users.find((user) => user.id === technicianId)?.name ||
    "teknisi terpilih"
  );
}

function formatCustomerNames(conflicts: Order[]) {
  const customerNames = conflicts
    .map((order) => order.customerName)
    .filter(Boolean);

  if (customerNames.length === 0) {
    return "order lain";
  }

  if (customerNames.length === 1) {
    return customerNames[0];
  }

  if (customerNames.length === 2) {
    return `${customerNames[0]} dan ${customerNames[1]}`;
  }

  return `${customerNames[0]}, ${customerNames[1]}, dan ${
    customerNames.length - 2
  } order lainnya`;
}

export function formatOrderScheduleConflictMessage(
  targetOrder: Partial<Order>,
  conflicts: Order[],
  users: Pick<User, "id" | "name">[],
) {
  const technicianName = getTechnicianName(targetOrder.technicianId, users);
  const customerSummary = formatCustomerNames(conflicts);
  const serviceTime = normalizeOrderTime(targetOrder.serviceTime);

  return `Jadwal bentrok. Teknisi ${technicianName} sudah punya order aktif pada ${targetOrder.serviceDate} ${serviceTime} untuk ${customerSummary}.`;
}

export function formatOrderBookingScheduleConflictMessage(
  targetOrder: Partial<Order>,
  conflicts: ProspectBooking[],
  users: Pick<User, "id" | "name">[],
) {
  const technicianName = getTechnicianName(targetOrder.technicianId, users);
  const customerSummary = formatCustomerNames(
    conflicts.map(bookingToOrderScheduleLike) as Order[],
  );
  const serviceTime = normalizeOrderTime(targetOrder.serviceTime);

  return `Jadwal bentrok. Teknisi ${technicianName} sudah punya booking prospek aktif pada ${targetOrder.serviceDate} ${serviceTime} untuk ${customerSummary}.`;
}

export function formatProspectBookingScheduleConflictMessage(
  targetBooking: Partial<ProspectBooking>,
  conflicts: Array<Order | ProspectBooking>,
  users: Pick<User, "id" | "name">[],
) {
  const technicianName = getTechnicianName(targetBooking.technicianId, users);
  const customerSummary = formatCustomerNames(
    conflicts.map((conflict) =>
      "scheduleDate" in conflict ? bookingToOrderScheduleLike(conflict) : conflict,
    ) as Order[],
  );
  const scheduleTime = normalizeOrderTime(targetBooking.scheduleTime);

  return `Jadwal bentrok. Teknisi ${technicianName} sudah punya jadwal aktif pada ${targetBooking.scheduleDate} ${scheduleTime} untuk ${customerSummary}.`;
}

export function formatOrderScheduleInactiveWarning(
  targetOrder: Partial<Order>,
  conflicts: Order[],
  users: Pick<User, "id" | "name">[],
) {
  const technicianName = getTechnicianName(targetOrder.technicianId, users);
  const serviceTime = normalizeOrderTime(targetOrder.serviceTime);
  const cancelledCount = conflicts.filter(
    (order) => order.status === "cancelled",
  ).length;
  const rescheduleCount = conflicts.filter(
    (order) => order.status === "reschedule",
  ).length;

  const reasonParts: string[] = [];
  if (cancelledCount > 0) {
    reasonParts.push(`${cancelledCount} batal`);
  }
  if (rescheduleCount > 0) {
    reasonParts.push(`${rescheduleCount} jadwal ulang`);
  }

  const reasonSummary =
    reasonParts.length > 0 ? reasonParts.join(" dan ") : "riwayat nonaktif";

  return `Slot ${targetOrder.serviceDate} ${serviceTime} untuk ${technicianName} punya riwayat ${reasonSummary}. Order baru tetap bisa disimpan.`;
}

export function formatTechnicianUnavailableMessage(
  targetOrder: Partial<Order>,
  technicianSchedule: TechnicianScheduleLike,
  users: Pick<User, "id" | "name">[],
) {
  const technicianName = getTechnicianName(targetOrder.technicianId, users);
  const scheduleType = technicianSchedule.type || "OFF";
  const reason = normalizeScheduleValue(technicianSchedule.reason);
  const reasonSuffix = reason ? ` (${reason})` : "";

  return `Teknisi ${technicianName} sedang ${scheduleType} pada ${targetOrder.serviceDate}. Pilih teknisi lain atau ubah tanggal pesanan.${reasonSuffix}`;
}

/**
 * Fresh DB validation to prevent double-booking caused by stale React context.
 * Queries Supabase directly for technician schedules, existing orders, and prospect bookings.
 * Returns an error message string if conflict found, or null if slot is available.
 */
export async function validateOrderScheduleFromDB(
  order: Partial<Order>,
  users: Pick<User, "id" | "name">[],
  options?: ScheduleValidationOptions,
): Promise<string | null> {
  if (!order.technicianId || !order.serviceDate || !order.serviceTime) {
    return null;
  }

  if (isInactiveOrderScheduleStatus(order.status)) {
    return null;
  }

  const normalizedTime = normalizeOrderTime(order.serviceTime);
  if (!normalizedTime) {
    return null;
  }

  try {
    const [
      { data: offSchedules, error: offError },
      { data: orderRows, error: orderError },
      { data: bookingRows, error: bookingError },
    ] = await Promise.all([
      supabase
        .from("technician_schedules")
        .select("type, reason")
        .eq("user_id", order.technicianId)
        .eq("date", order.serviceDate)
        .limit(1),
      supabase
        .from("orders")
        .select("id, service_time, status, customer_name")
        .eq("technician_id", order.technicianId)
        .eq("service_date", order.serviceDate),
      supabase
        .from("prospect_bookings")
        .select("id, schedule_time, status, order_id, customer_name, lead_id")
        .eq("technician_id", order.technicianId)
        .eq("schedule_date", order.serviceDate),
    ]);

    if (offError) throw offError;
    if (orderError) throw orderError;
    if (bookingError) throw bookingError;

    // 1. Check technician off-schedule
    const offSchedule = offSchedules?.[0];
    if (offSchedule) {
      const technicianName = getTechnicianName(order.technicianId, users);
      const scheduleType = offSchedule.type || "OFF";
      const reason = offSchedule.reason ? ` (${offSchedule.reason})` : "";
      return `Teknisi ${technicianName} sedang ${scheduleType} pada ${order.serviceDate}.${reason} Pilih teknisi lain atau ubah tanggal pesanan.`;
    }

    // 2. Check existing order conflicts
    const conflictingOrders = (orderRows || []).filter((row) => {
      if (order.id && row.id === order.id) return false;
      if (INACTIVE_ORDER_SCHEDULE_STATUSES.has(row.status)) return false;
      return normalizeOrderTime(row.service_time) === normalizedTime;
    });

    if (conflictingOrders.length > 0) {
      const customerNames = conflictingOrders
        .map((r) => r.customer_name)
        .filter(Boolean)
        .join(", ") || "order lain";
      const technicianName = getTechnicianName(order.technicianId, users);
      return `Jadwal bentrok. Teknisi ${technicianName} sudah punya order aktif pada ${order.serviceDate} ${normalizedTime} untuk ${customerNames}.`;
    }

    // 3. Check existing prospect booking conflicts
    const normalizedLeadId = normalizeScheduleValue(order.leadId);
    const nonBlockingBookingLeadIds = await getNonBlockingBookingLeadIds(bookingRows || []);
    const conflictingBookings = (bookingRows || []).filter((row) => {
      if (row.order_id) return false;
      if (INACTIVE_BOOKING_SCHEDULE_STATUSES.has(row.status)) return false;
      if (normalizedLeadId && normalizeScheduleValue(row.lead_id) === normalizedLeadId) return false;
      if (isNonBlockingBookingLead(row.lead_id, nonBlockingBookingLeadIds, options)) return false;
      return normalizeOrderTime(row.schedule_time) === normalizedTime;
    });

    if (conflictingBookings.length > 0) {
      const customerNames = conflictingBookings
        .map((r) => r.customer_name)
        .filter(Boolean)
        .join(", ") || "booking lain";
      const technicianName = getTechnicianName(order.technicianId, users);
      return `Jadwal bentrok. Teknisi ${technicianName} sudah punya booking prospek aktif pada ${order.serviceDate} ${normalizedTime} untuk ${customerNames}.`;
    }

    return null;
  } catch (error) {
    console.error("Error validating order schedule from DB:", error);
    return "Gagal memverifikasi jadwal terbaru. Coba simpan ulang beberapa detik lagi.";
  }
}

export async function validateProspectBookingScheduleFromDB(
  booking: Partial<ProspectBooking>,
  users: Pick<User, "id" | "name">[],
  options?: ScheduleValidationOptions,
): Promise<string | null> {
  if (booking.orderId || isInactiveProspectBookingScheduleStatus(booking.status)) {
    return null;
  }

  if (!booking.technicianId || !booking.scheduleDate || !booking.scheduleTime) {
    return null;
  }

  const normalizedTime = normalizeOrderTime(booking.scheduleTime);
  if (!normalizedTime) {
    return null;
  }

  try {
    const [
      { data: offSchedules, error: offError },
      { data: orderRows, error: orderError },
      { data: bookingRows, error: bookingError },
    ] = await Promise.all([
      supabase
        .from("technician_schedules")
        .select("type, reason")
        .eq("user_id", booking.technicianId)
        .eq("date", booking.scheduleDate)
        .limit(1),
      supabase
        .from("orders")
        .select("id, service_time, status, customer_name")
        .eq("technician_id", booking.technicianId)
        .eq("service_date", booking.scheduleDate),
      supabase
        .from("prospect_bookings")
        .select("id, schedule_time, status, order_id, customer_name, lead_id")
        .eq("technician_id", booking.technicianId)
        .eq("schedule_date", booking.scheduleDate),
    ]);

    if (offError) throw offError;
    if (orderError) throw orderError;
    if (bookingError) throw bookingError;

    const offSchedule = offSchedules?.[0];
    if (offSchedule) {
      const technicianName = getTechnicianName(booking.technicianId, users);
      const scheduleType = offSchedule.type || "OFF";
      const reason = offSchedule.reason ? ` (${offSchedule.reason})` : "";
      return `Teknisi ${technicianName} sedang ${scheduleType} pada ${booking.scheduleDate}.${reason} Pilih teknisi lain atau ubah tanggal booking.`;
    }

    const conflictingOrders = (orderRows || []).filter((row) => {
      if (INACTIVE_ORDER_SCHEDULE_STATUSES.has(row.status)) return false;
      return normalizeOrderTime(row.service_time) === normalizedTime;
    });

    if (conflictingOrders.length > 0) {
      const customerNames = conflictingOrders
        .map((row) => row.customer_name)
        .filter(Boolean)
        .join(", ") || "order lain";
      const technicianName = getTechnicianName(booking.technicianId, users);
      return `Jadwal bentrok. Teknisi ${technicianName} sudah punya order aktif pada ${booking.scheduleDate} ${normalizedTime} untuk ${customerNames}.`;
    }

    const nonBlockingBookingLeadIds = await getNonBlockingBookingLeadIds(bookingRows || []);
    const conflictingBookings = (bookingRows || []).filter((row) => {
      if (booking.id && row.id === booking.id) return false;
      if (row.order_id) return false;
      if (INACTIVE_BOOKING_SCHEDULE_STATUSES.has(row.status)) return false;
      if (isNonBlockingBookingLead(row.lead_id, nonBlockingBookingLeadIds, options)) return false;
      return normalizeOrderTime(row.schedule_time) === normalizedTime;
    });

    if (conflictingBookings.length > 0) {
      const customerNames = conflictingBookings
        .map((row) => row.customer_name)
        .filter(Boolean)
        .join(", ") || "booking lain";
      const technicianName = getTechnicianName(booking.technicianId, users);
      return `Jadwal bentrok. Teknisi ${technicianName} sudah punya booking prospek aktif pada ${booking.scheduleDate} ${normalizedTime} untuk ${customerNames}.`;
    }

    return null;
  } catch (error) {
    console.error("Error validating prospect booking schedule from DB:", error);
    return "Gagal memverifikasi jadwal booking terbaru. Coba simpan ulang beberapa detik lagi.";
  }
}
