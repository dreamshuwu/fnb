import bcrypt from 'bcryptjs';
import { pool, query, insert, stringifyJSON } from './db.js';

const DEMO_USERS = [
  { phone: '1000000000', name: 'Admin', role: 'admin', password: 'admin123' },
  { phone: '1000000001', name: 'Manager', role: 'manager', password: 'manager123' },
  { phone: '1000000002', name: 'Cashier', role: 'cashier', password: 'cashier123' },
  { phone: '1000000003', name: 'Waiter', role: 'waiter', password: 'waiter123' },
  { phone: '1000000004', name: 'Kitchen', role: 'kitchen', password: 'kitchen123' },
];

// ---- 菜单种子数据（kopitiam 风格，演示用；后台可改） ----
const CATS = [
  ['KOPI', '#7c3aed', 1],
  ['TEH', '#f97316', 2],
  ['SUSU', '#eab308', 3],
  ['MILO', '#ec4899', 4],
  ['NESCAFE', '#14b8a6', 5],
  ['OTHER', '#64748b', 6],
  ['FRESH', '#06b6d4', 7],
  ['CAN DRINK', '#3b82f6', 8],
  ['BEER', '#d97706', 9],
];

// 饮料基底（有修饰后缀）
const DRINK_BASES = [
  ['Kopi', 'KOPI', 3.0],
  ['Teh', 'TEH', 3.0],
  ['Susu', 'SUSU', 2.4],
  ['Milo', 'MILO', 3.8],
  ['Nescafe', 'NESCAFE', 3.8],
];
const BASE_SHORT = { Kopi: 'KOPI', Teh: 'TEH', Susu: 'SUSU', Milo: 'MILO', Nescafe: 'NESCAFE' };

// 无修饰单品（香烟/啤酒/鲜饮/罐装），每个基底=一个原味变体
const SINGLE_BASES = [
  ['Dunhill PROMO', 'OTHER', 18.2],
  ['Marlboro', 'OTHER', 14.2],
  ['Mevius', 'OTHER', 18.4],
  ['Heineken', 'BEER', 9.0],
  ['Tiger tin', 'BEER', 8.0],
  ['Carlsberg Big', 'BEER', 16.0],
  ['Honey Lemongrass', 'FRESH', 2.5],
  ['Cucumber Juice', 'FRESH', 6.0],
  ['100plus', 'CAN DRINK', 3.2],
  ['Cola', 'CAN DRINK', 3.2],
  ['Sarsi', 'CAN DRINK', 3.2],
];

const MODIFIERS = [
  ['O', 'Kosong 无糖', -0.4, 1],
  ['KOS', '无奶', -0.3, 2],
  ['C', 'Kurang 少糖', -0.2, 3],
  ['P', 'Peng 冰', 0.5, 4],
  ['K', 'Kow 浓', 0.1, 5],
  ['SP', 'Special', 0.6, 6],
  ['SUSU', '加奶', 0.3, 7],
  ['Tarik', '拉', 0.4, 8],
  ['DANGGUT', '', 0.1, 9],
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

  const catIds = {};
  for (const [name, color, sort] of CATS) {
    const id = await insert(
      'INSERT INTO menu_categories (org_id, store_id, name, color, sort_order) VALUES (?,?,?,?,?)',
      [orgId, storeId, name, color, sort]
    );
    catIds[name] = id;
  }

  const baseIds = {};
  for (const [name, cat, price] of DRINK_BASES) {
    const id = await insert(
      'INSERT INTO menu_bases (org_id, store_id, category_id, name, base_price, sort_order) VALUES (?,?,?,?,?,?)',
      [orgId, storeId, catIds[cat], name, price, 1]
    );
    baseIds[name] = id;
  }
  for (const [name, cat, price] of SINGLE_BASES) {
    const id = await insert(
      'INSERT INTO menu_bases (org_id, store_id, category_id, name, base_price) VALUES (?,?,?,?,?)',
      [orgId, storeId, catIds[cat], name, price]
    );
    baseIds[name] = id;
  }

  const modIds = {};
  for (const [code, label, delta, sort] of MODIFIERS) {
    const id = await insert(
      'INSERT INTO menu_modifiers (org_id, store_id, code, label, default_delta, sort_order) VALUES (?,?,?,?,?,?)',
      [orgId, storeId, code, label, delta, sort]
    );
    modIds[code] = id;
  }

  // 饮料基底挂全部修饰
  for (const [bname] of DRINK_BASES) {
    for (const [code] of MODIFIERS) {
      await insert(
        'INSERT INTO menu_base_modifiers (org_id, store_id, base_id, modifier_id) VALUES (?,?,?,?)',
        [orgId, storeId, baseIds[bname], modIds[code]]
      );
    }
  }

  // 变体
  let vsort = 1;
  const addVariant = async (bname, baseId, cat, code, name, price) => {
    await insert(
      `INSERT INTO menu_variants
        (org_id, store_id, base_id, category_id, code, name, modifier_ids, price, cost, stock_qty, stock_threshold, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        orgId, storeId, baseId, catIds[cat], code, name, stringifyJSON([]),
        price, +(price * 0.4).toFixed(2), 50, 10, vsort++,
      ]
    );
  };
  for (const [name, cat, price] of DRINK_BASES) {
    const baseId = baseIds[name];
    const short = BASE_SHORT[name];
    await addVariant(name, baseId, cat, short, name, price); // 原味
    for (const [code, label, delta] of MODIFIERS) {
      const vprice = +(price + delta).toFixed(2);
      const vcode = `${short} ${code}`;
      const vname = label ? `${name} ${label}` : `${name} ${code}`;
      await addVariant(name, baseId, cat, vcode, vname, vprice);
    }
  }
  for (const [name, cat, price] of SINGLE_BASES) {
    await addVariant(name, baseIds[name], cat, name, name, price);
  }

  for (const n of ['A1', 'A2', 'B1']) {
    await insert(
      'INSERT INTO tables (org_id, store_id, number, zone, seats) VALUES (?,?,?,?,?)',
      [orgId, storeId, n, '大厅', 4]
    );
  }

  // 原料库存（演示 InventoryPage；成品库存由 menu_variants 自身承载）
  await insert(
    'INSERT INTO inventory_items (org_id, store_id, name, unit, quantity, threshold) VALUES (?,?,?,?,?,?)',
    [orgId, storeId, '咖啡豆', 'kg', 5, 2]
  );
  await insert(
    'INSERT INTO inventory_items (org_id, store_id, name, unit, quantity, threshold) VALUES (?,?,?,?,?,?)',
    [orgId, storeId, '杯子', '个', 200, 50]
  );

  console.log('[seed] org/store + 5 users + kopitiam menu (categories/bases/modifiers/variants) + tables + inventory created');
}

// 单独运行:node src/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await seedIfEmpty();
    await pool.end();
    process.exit(0);
  })();
}
