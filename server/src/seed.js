import bcrypt from 'bcryptjs';
import { pool, query, insert, stringifyJSON } from './db.js';

const DEMO_USERS = [
  { phone: '1000000000', name: 'Admin', role: 'admin', password: 'admin123' },
  { phone: '1000000001', name: 'Manager', role: 'manager', password: 'manager123' },
  { phone: '1000000002', name: 'Cashier', role: 'cashier', password: 'cashier123' },
  { phone: '1000000003', name: 'Waiter', role: 'waiter', password: 'waiter123' },
  { phone: '1000000004', name: 'Kitchen', role: 'kitchen', password: 'kitchen123' },
];

export async function seedIfEmpty() {
  const [{ c }] = await query('SELECT COUNT(*) AS c FROM organizations');
  if (c > 0) return;

  const orgId = await insert(
    'INSERT INTO organizations (name, slug, plan) VALUES (?,?,?)',
    ['Demo Brand', 'demo', 'free']
  );
  const storeId = await insert(
    'INSERT INTO stores (org_id, name, currency, tax_rate) VALUES (?,?,?,?)',
    [orgId, 'Demo Store', 'CNY', 0]
  );

  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await insert(
      `INSERT INTO users (org_id, store_id, name, phone, role, password_hash, is_active)
       VALUES (?,?,?,?,?,?,1)`,
      [orgId, storeId, u.name, u.phone, u.role, passwordHash]
    );
  }

  const catId = await insert(
    'INSERT INTO menu_categories (org_id, store_id, name, sort_order) VALUES (?,?,?,?)',
    [orgId, storeId, '饮品', 1]
  );
  const foodId = await insert(
    'INSERT INTO menu_categories (org_id, store_id, name, sort_order) VALUES (?,?,?,?)',
    [orgId, storeId, '主食', 2]
  );
  const coffeeId = await insert(
    `INSERT INTO menu_items (org_id, store_id, category_id, name, price, modifier_groups)
     VALUES (?,?,?,?,?,?)`,
    [orgId, storeId, catId, '美式咖啡', 18, stringifyJSON([
      { name: '杯型', type: 'single', required: true,
        options: [{ label: '大杯', priceDelta: 3 }, { label: '小杯', priceDelta: 0 }] },
    ])]
  );
  await insert(
    'INSERT INTO menu_items (org_id, store_id, category_id, name, price) VALUES (?,?,?,?,?)',
    [orgId, storeId, foodId, '牛肉饭', 38]
  );

  for (const n of ['A1', 'A2', 'B1']) {
    await insert(
      'INSERT INTO tables (org_id, store_id, number, zone, seats) VALUES (?,?,?,?,?)',
      [orgId, storeId, n, '大厅', 4]
    );
  }

  const invId = await insert(
    'INSERT INTO inventory_items (org_id, store_id, name, unit, quantity, threshold) VALUES (?,?,?,?,?,?)',
    [orgId, storeId, '咖啡豆', 'kg', 5, 2]
  );
  await query(
    'UPDATE menu_items SET track_inventory = 1, inventory_item_id = ? WHERE id = ?',
    [invId, coffeeId]
  );

  console.log('[seed] org/store + 5 users + sample menu/tables/inventory created');
}

// 单独运行:node src/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await seedIfEmpty();
    await pool.end();
    process.exit(0);
  })();
}
