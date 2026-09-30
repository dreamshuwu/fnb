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
      status ENUM('open','kitchen','paid','void_pending','void') DEFAULT 'open',
      items TEXT,
      subtotal DECIMAL(12,2) DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      tax DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      created_by INT,
      shift_id INT,
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
      method ENUM('cash','tab') DEFAULT 'cash',
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
      status ENUM('open','closed') DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (org_id, store_id), INDEX (cashier_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];
  for (const s of stmts) await query(s);
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
  tax: Number(r.tax || 0), total: Number(r.total || 0),
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
