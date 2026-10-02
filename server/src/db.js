import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fnbpos',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
export async function getRow(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}
export async function insert(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

// ---- JSON column helpers (stored as TEXT for broad MySQL compatibility) ----
export function stringifyJSON(v) {
  if (v == null) return null;
  return JSON.stringify(v);
}
export function parseJSON(v) {
  if (v == null || v === '') return [];
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return []; }
}
function dt(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ---- Schema bootstrap ----
export async function initSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS organizations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE,
      plan VARCHAR(50) DEFAULT 'free',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS stores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      timezone VARCHAR(64) DEFAULT 'Asia/Shanghai',
      tax_rate DECIMAL(5,2) DEFAULT 0,
      currency VARCHAR(8) DEFAULT 'CNY',
      printer_config TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      name VARCHAR(255),
      phone VARCHAR(64) UNIQUE,
      email VARCHAR(255),
      password_hash VARCHAR(255),
      role ENUM('admin','manager','cashier','waiter','kitchen') DEFAULT 'cashier',
      pin VARCHAR(32),
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id), INDEX (store_id), INDEX (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS menu_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(32),
      sort_order INT,
      station VARCHAR(32) DEFAULT 'Kitchen',
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS menu_bases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      category_id INT,
      name VARCHAR(255) NOT NULL,
      base_price DECIMAL(10,2) DEFAULT 0,
      sort_order INT,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS menu_modifiers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      code VARCHAR(32) NOT NULL,
      label VARCHAR(255),
      default_delta DECIMAL(10,2) DEFAULT 0,
      sort_order INT,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS menu_base_modifiers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      base_id INT NOT NULL,
      modifier_id INT NOT NULL,
      delta DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY (base_id, modifier_id),
      INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS menu_variants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      base_id INT NOT NULL,
      category_id INT,
      code VARCHAR(32) NOT NULL,
      name VARCHAR(255) NOT NULL,
      modifier_ids TEXT,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      cost DECIMAL(10,2) DEFAULT 0,
      stock_qty DECIMAL(12,3) DEFAULT 0,
      stock_threshold DECIMAL(12,3) DEFAULT 0,
      barcode VARCHAR(64),
      sort_order INT,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (base_id), INDEX (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS tables (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      number VARCHAR(32) NOT NULL,
      zone VARCHAR(64),
      seats INT,
      status ENUM('free','occupied','needs_clean') DEFAULT 'free',
      current_order_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      order_no VARCHAR(64),
      type ENUM('dine_in','takeaway'),
      table_id INT,
      customer_name VARCHAR(255),
      phone VARCHAR(64),
      status ENUM('open','hold','kitchen','preparing','ready','served','paid','void_pending','void','refunded','split','merged') DEFAULT 'open',
      items TEXT,
      subtotal DECIMAL(12,2) DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      service_charge DECIMAL(12,2) DEFAULT 0,
      tax DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      refunded_amount DECIMAL(12,2) DEFAULT 0,
      invoice_no VARCHAR(64),
      split_from_order_id INT,
      split_group_no INT,
      hold_label VARCHAR(64),
      held_at TIMESTAMP NULL,
      reprint_count INT DEFAULT 0,
      unsettled_at TIMESTAMP NULL,
      created_by INT,
      shift_id INT,
      member_id INT,
      sales_person_id INT,
      discount_type VARCHAR(64),
      void_requested_by INT,
      void_approved_by INT,
      void_reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (status), INDEX (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      order_id INT,
      method ENUM('cash','card','tab','cheque','credit') DEFAULT 'cash',
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      tip DECIMAL(12,2) DEFAULT 0,
      status VARCHAR(32) DEFAULT 'paid',
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS inventory_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      unit VARCHAR(32),
      quantity DECIMAL(12,3) DEFAULT 0,
      threshold DECIMAL(12,3) DEFAULT 0,
      cost_price DECIMAL(12,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      item_id INT,
      type ENUM('sale','restock','adjust','count'),
      delta DECIMAL(12,3) DEFAULT 0,
      before DECIMAL(12,3) DEFAULT 0,
      after DECIMAL(12,3) DEFAULT 0,
      ref_order_id INT,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS shifts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      store_id INT NOT NULL,
      cashier_id INT,
      open_amount DECIMAL(12,2) DEFAULT 0,
      close_amount DECIMAL(12,2) DEFAULT 0,
      expected_amount DECIMAL(12,2) DEFAULT 0,
      difference_amount DECIMAL(12,2) DEFAULT 0,
      status ENUM('open','closed') DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (cashier_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL, store_id INT NOT NULL,
      member_no VARCHAR(64), name VARCHAR(255) NOT NULL, phone VARCHAR(64),
      credit_balance DECIMAL(12,2) DEFAULT 0, points INT DEFAULT 0,
      status VARCHAR(32) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (member_no), INDEX (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS member_topups (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      member_id INT NOT NULL, receipt_no VARCHAR(64), amount DECIMAL(12,2) NOT NULL,
      created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (member_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS points_ledger (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      member_id INT NOT NULL, delta INT NOT NULL, reason VARCHAR(255), created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (member_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS cash_movements (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      type VARCHAR(32) NOT NULL, voucher_no VARCHAR(64), pay_to VARCHAR(255),
      amount DECIMAL(12,2) NOT NULL, reason TEXT, method VARCHAR(32) DEFAULT 'cash',
      created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (type), INDEX (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS credit_notes (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      credit_no VARCHAR(64), customer_name VARCHAR(255), order_no VARCHAR(64),
      reason TEXT, gst TINYINT(1) DEFAULT 0, items TEXT, status VARCHAR(32) DEFAULT 'open',
      include_gst TINYINT(1) DEFAULT 0, subtotal DECIMAL(12,2) DEFAULT 0, gst_amount DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0, tax_rate DECIMAL(6,2) DEFAULT 0, restock TINYINT(1) DEFAULT 1,
      posted_at TIMESTAMP NULL,
      created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS attendance_records (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      user_id INT, user_name VARCHAR(255), action VARCHAR(32), code VARCHAR(64), note TEXT,
      event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (org_id, store_id), INDEX (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS suppliers (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      code VARCHAR(64), name VARCHAR(255) NOT NULL, phone VARCHAR(64), contact VARCHAR(255),
      status VARCHAR(32) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      po_no VARCHAR(64), supplier_id INT, items TEXT, total DECIMAL(12,2) DEFAULT 0,
      status VARCHAR(32) DEFAULT 'open', received_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (supplier_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS order_splits (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      parent_order_id INT NOT NULL, mode VARCHAR(32), split_count INT DEFAULT 0, created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (parent_order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS refunds (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      refund_no VARCHAR(64), order_id INT, order_no VARCHAR(64), amount DECIMAL(12,2) NOT NULL,
      method VARCHAR(32) DEFAULT 'cash', reason TEXT, items TEXT, restock TINYINT(1) DEFAULT 1,
      created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      order_id INT, invoice_no VARCHAR(64), amount DECIMAL(12,2) DEFAULT 0, tax DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (order_id), INDEX (invoice_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS promotions (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      code VARCHAR(64), name VARCHAR(255), type VARCHAR(32) DEFAULT 'percent', value DECIMAL(12,2) DEFAULT 0,
      min_spend DECIMAL(12,2) DEFAULT 0, valid_from DATE NULL, valid_until DATE NULL,
      is_active TINYINT(1) DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS customer_stock (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      member_id INT, member_no VARCHAR(64), item_name VARCHAR(255), qty DECIMAL(12,2) DEFAULT 0,
      unit VARCHAR(32) DEFAULT 'pcs', note TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (member_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS stock_takes (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      take_no VARCHAR(64), status VARCHAR(32) DEFAULT 'draft', lines TEXT, created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, posted_at TIMESTAMP NULL, INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS report_templates (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      type VARCHAR(64), name VARCHAR(255), columns TEXT, is_system TINYINT(1) DEFAULT 0,
      filters TEXT, sort TEXT, format VARCHAR(16) DEFAULT 'csv',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS printers (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      name VARCHAR(255), target VARCHAR(32) DEFAULT 'receipt', connection VARCHAR(32) DEFAULT 'usb',
      width INT DEFAULT 80, is_default TINYINT(1) DEFAULT 0, is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS print_jobs (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      target VARCHAR(32), printer_id INT, order_id INT, payload TEXT, status VARCHAR(32) DEFAULT 'queued',
      created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (org_id, store_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      setting_key VARCHAR(64), setting_value TEXT, UNIQUE KEY uniq_setting (org_id, store_id, setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS unsettles (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      order_id INT, order_no VARCHAR(64), invoice_no VARCHAR(64), amount DECIMAL(12,2) DEFAULT 0,
      payments TEXT, reason TEXT, created_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS reprint_logs (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      order_id INT, order_no VARCHAR(64), kind VARCHAR(32) DEFAULT 'bill', created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX (org_id, store_id), INDEX (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS day_ends (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      end_date DATE NOT NULL, snapshot TEXT, counted_cash DECIMAL(12,2) DEFAULT 0,
      expected_cash DECIMAL(12,2) DEFAULT 0, difference DECIMAL(12,2) DEFAULT 0,
      note TEXT, closed_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), UNIQUE KEY uniq_day (org_id, store_id, end_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS order_transfers (
      id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, store_id INT NOT NULL,
      type VARCHAR(32) NOT NULL, order_id INT, order_no VARCHAR(64),
      from_table_id INT, from_table_no VARCHAR(64), to_table_id INT, to_table_no VARCHAR(64),
      merged_order_ids TEXT, merged_order_nos TEXT,
      amount DECIMAL(12,2) DEFAULT 0, reason VARCHAR(255),
      created_by INT, created_by_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (order_id), INDEX (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];
  for (const s of stmts) await query(s);

  // ---- 增量迁移：给既有库补列（尽力而为，失败忽略） ----
  const alters = [
    "ALTER TABLE orders ADD COLUMN service_charge DECIMAL(12,2) DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN refunded_amount DECIMAL(12,2) DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN invoice_no VARCHAR(64)",
    "ALTER TABLE orders ADD COLUMN split_from_order_id INT",
    "ALTER TABLE orders ADD COLUMN split_group_no INT",
    "ALTER TABLE orders ADD COLUMN hold_label VARCHAR(64)",
    "ALTER TABLE orders ADD COLUMN held_at TIMESTAMP NULL",
    "ALTER TABLE orders ADD COLUMN reprint_count INT DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN unsettled_at TIMESTAMP NULL",
    "ALTER TABLE credit_notes ADD COLUMN include_gst TINYINT(1) DEFAULT 0",
    "ALTER TABLE credit_notes ADD COLUMN subtotal DECIMAL(12,2) DEFAULT 0",
    "ALTER TABLE credit_notes ADD COLUMN gst_amount DECIMAL(12,2) DEFAULT 0",
    "ALTER TABLE credit_notes ADD COLUMN total DECIMAL(12,2) DEFAULT 0",
    "ALTER TABLE credit_notes ADD COLUMN tax_rate DECIMAL(6,2) DEFAULT 0",
    "ALTER TABLE credit_notes ADD COLUMN restock TINYINT(1) DEFAULT 1",
    "ALTER TABLE credit_notes ADD COLUMN posted_at TIMESTAMP NULL",
    "ALTER TABLE orders MODIFY COLUMN status ENUM('open','hold','kitchen','preparing','ready','served','paid','void_pending','void','refunded','split','merged') DEFAULT 'open'",
    // 报表增强:会员/销售员/折扣类型 + 出品部门 + 报表模板筛选条件
    "ALTER TABLE orders ADD COLUMN member_id INT",
    "ALTER TABLE orders ADD COLUMN sales_person_id INT",
    "ALTER TABLE orders ADD COLUMN discount_type VARCHAR(64)",
    "ALTER TABLE menu_categories ADD COLUMN station VARCHAR(32) DEFAULT 'Kitchen'",
    "ALTER TABLE report_templates ADD COLUMN filters TEXT",
    "ALTER TABLE report_templates ADD COLUMN sort TEXT",
    "ALTER TABLE report_templates ADD COLUMN format VARCHAR(16) DEFAULT 'csv'",
    // 转台 / 并台审计
    "ALTER TABLE order_transfers ADD COLUMN from_table_no VARCHAR(64)",
    "ALTER TABLE order_transfers ADD COLUMN to_table_no VARCHAR(64)",
    "ALTER TABLE order_transfers ADD COLUMN created_by_name VARCHAR(255)",
    "ALTER TABLE orders ADD COLUMN merged_into_order_id INT",
  ];
  for (const a of alters) {
    try { await query(a); } catch { /* 列已存在或不支持，忽略 */ }
  }
}

// ---- Mappers: DB row -> API object (camelCase + _id string) ----
export function normalizeUser(r) {
  if (!r) return null;
  return {
    _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
    name: r.name, phone: r.phone, role: r.role, email: r.email, pin: r.pin,
    isActive: !!r.is_active, passwordHash: r.password_hash,
  };
}
export const toOrganization = (r) => ({
  _id: r.id, id: r.id, name: r.name, slug: r.slug, plan: r.plan,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toStore = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, name: r.name, timezone: r.timezone,
  taxRate: Number(r.tax_rate || 0), currency: r.currency,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toUser = (r) => ({
  id: r.id, _id: r.id, name: r.name, phone: r.phone, role: r.role,
  orgId: r.org_id, storeId: r.store_id,
});
export const toMenuCategory = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id, name: r.name,
  color: r.color || null,
  station: r.station || 'Kitchen',
  sortOrder: r.sort_order, isActive: !!r.is_active,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toMenuBase = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  categoryId: r.category_id == null ? null : String(r.category_id),
  name: r.name, basePrice: Number(r.base_price || 0),
  sortOrder: r.sort_order, isActive: !!r.is_active,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toModifier = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  code: r.code, label: r.label, defaultDelta: Number(r.default_delta || 0),
  sortOrder: r.sort_order, isActive: !!r.is_active,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toBaseModifier = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  baseId: String(r.base_id), modifierId: String(r.modifier_id),
  delta: r.delta == null ? null : Number(r.delta),
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toVariant = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  baseId: String(r.base_id), categoryId: r.category_id == null ? null : String(r.category_id),
  code: r.code, name: r.name, modifierIds: parseJSON(r.modifier_ids),
  price: Number(r.price || 0), cost: r.cost == null ? 0 : Number(r.cost),
  stockQty: Number(r.stock_qty || 0), stockThreshold: Number(r.stock_threshold || 0),
  barcode: r.barcode, sortOrder: r.sort_order, isActive: !!r.is_active,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toTable = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id, number: r.number,
  zone: r.zone, seats: r.seats, status: r.status,
  currentOrderId: r.current_order_id == null ? null : String(r.current_order_id),
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toOrder = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id, orderNo: r.order_no,
  type: r.type, tableId: r.table_id == null ? null : String(r.table_id),
  customerName: r.customer_name, phone: r.phone, status: r.status,
  items: parseJSON(r.items),
  subtotal: Number(r.subtotal || 0), discount: Number(r.discount || 0),
  serviceCharge: Number(r.service_charge || 0),
  tax: Number(r.tax || 0), total: Number(r.total || 0),
  refundedAmount: Number(r.refunded_amount || 0), invoiceNo: r.invoice_no || null,
  splitFromOrderId: r.split_from_order_id == null ? null : String(r.split_from_order_id),
  splitGroupNo: r.split_group_no == null ? null : r.split_group_no,
  holdLabel: r.hold_label || null, heldAt: dt(r.held_at), reprintCount: Number(r.reprint_count || 0),
  unsettledAt: dt(r.unsettled_at),
  createdBy: r.created_by == null ? null : String(r.created_by),
  shiftId: r.shift_id == null ? null : String(r.shift_id),
  voidRequestedBy: r.void_requested_by == null ? null : String(r.void_requested_by),
  voidApprovedBy: r.void_approved_by == null ? null : String(r.void_approved_by),
  voidReason: r.void_reason,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toPayment = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  orderId: r.order_id == null ? null : String(r.order_id), method: r.method,
  amount: Number(r.amount || 0), tip: Number(r.tip || 0), status: r.status,
  createdBy: r.created_by == null ? null : String(r.created_by),
  createdAt: dt(r.created_at),
});
export const toInventoryItem = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id, name: r.name,
  unit: r.unit, quantity: Number(r.quantity || 0), threshold: Number(r.threshold || 0),
  costPrice: r.cost_price == null ? null : Number(r.cost_price),
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});
export const toStockMovement = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  itemId: r.item_id == null ? null : String(r.item_id), type: r.type,
  delta: Number(r.delta || 0), before: Number(r.before || 0), after: Number(r.after || 0),
  refOrderId: r.ref_order_id == null ? null : String(r.ref_order_id),
  createdBy: r.created_by == null ? null : String(r.created_by),
  createdAt: dt(r.created_at),
});
export const toShift = (r) => ({
  _id: r.id, id: r.id, orgId: r.org_id, storeId: r.store_id,
  cashierId: r.cashier_id == null ? null : String(r.cashier_id),
  openAmount: Number(r.open_amount || 0), closeAmount: Number(r.close_amount || 0),
  expectedAmount: Number(r.expected_amount || 0), status: r.status,
  createdAt: dt(r.created_at), updatedAt: dt(r.updated_at),
});

// ---- User lookups (used by auth + sockets) ----
export const getUserById = async (id) => {
  const r = await getRow('SELECT * FROM users WHERE id = ?', [Number(id)]);
  return normalizeUser(r);
};
export const getUserByPhone = async (phone) => {
  const r = await getRow('SELECT * FROM users WHERE phone = ?', [phone]);
  return normalizeUser(r);
};
export const getUserByEmail = async (email) => {
  const r = await getRow('SELECT * FROM users WHERE email = ?', [email]);
  return normalizeUser(r);
};

export default pool;
