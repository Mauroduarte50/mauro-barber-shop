import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date as pgDate,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Multi-barber / future SaaS ready: every business entity carries a
 * `barberId` foreign key. A future `business_id` can be added to `barbers`
 * to group multiple barbers under one shop without reworking the tables.
 */

export const USER_ROLES = ["admin", "barbero"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("admin"),
    // Which barber this login belongs to. Admins may or may not have one
    // (set when the admin is also a working barber, e.g. today's sole
    // account); barbero accounts always have exactly one, enforced in
    // application code (not a DB constraint, to keep admin optional).
    barberId: uuid("barber_id").references(() => barbers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_barber_idx").on(t.barberId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const barbers = pgTable("barbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  bio: text("bio"),
  photo: text("photo"),
  phone: text("phone"),
  instagram: text("instagram"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull().default(0),
    durationMin: integer("duration_min").notNull().default(30),
    image: text("image"),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("services_barber_idx").on(t.barberId)],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    notes: text("notes"),
    totalVisits: integer("total_visits").notNull().default(0),
    totalSpent: integer("total_spent").notNull().default(0),
    firstVisit: timestamp("first_visit", { withTimezone: true }),
    lastVisit: timestamp("last_visit", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clients_barber_idx").on(t.barberId), index("clients_phone_idx").on(t.phone)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    serviceName: text("service_name").notNull(),
    price: integer("price").notNull().default(0),
    durationMin: integer("duration_min").notNull().default(30),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pendiente"),
    notes: text("notes"),
    createdBy: text("created_by").notNull().default("cliente"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    rescheduledFrom: timestamp("rescheduled_from", { withTimezone: true }),
    paymentMethod: text("payment_method"),
    paid: boolean("paid").notNull().default(false),
    // Set once the 30-min-before push reminder has fired for this
    // appointment's current startTime, so the reminder cron never double-sends.
    // Reset to null whenever startTime changes (reschedule) so the new time
    // gets its own reminder.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("appointments_barber_start_idx").on(t.barberId, t.startTime),
    index("appointments_status_idx").on(t.status),
  ],
);

export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    // 1 = Lunes ... 7 = Domingo
    weekday: integer("weekday").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
  },
  (t) => [index("bh_barber_weekday_idx").on(t.barberId, t.weekday)],
);

export const breaks = pgTable(
  "breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    label: text("label"),
  },
  (t) => [index("breaks_barber_weekday_idx").on(t.barberId, t.weekday)],
);

export const blockedSlots = pgTable(
  "blocked_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    date: pgDate("date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    reason: text("reason"),
    allDay: boolean("all_day").notNull().default(false),
  },
  (t) => [index("blocked_barber_date_idx").on(t.barberId, t.date)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("system"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notif_barber_read_idx").on(t.barberId, t.read)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_sub_barber_idx").on(t.barberId)],
);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  barberId: uuid("barber_id")
    .notNull()
    .references(() => barbers.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  method: text("method").notNull().default("efectivo"),
  status: text("status").notNull().default("pagado"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id").references(() => barbers.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
  },
  (t) => [uniqueIndex("settings_barber_key_idx").on(t.barberId, t.key)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name"),
    action: text("action").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

// ---- Shared types ----
export type User = typeof users.$inferSelect;
export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const APPOINTMENT_STATUSES = [
  "pendiente",
  "confirmada",
  "en_espera",
  "atendida",
  "cancelada",
  "no_asistio",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  "efectivo",
  "nequi",
  "daviplata",
  "transferencia",
  "tarjeta",
  "otro",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  en_espera: "En espera",
  atendida: "Atendida",
  cancelada: "Cancelada",
  no_asistio: "No asistió",
};
