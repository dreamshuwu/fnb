import bcrypt from 'bcryptjs';
import {
  pool, query, insert, stringifyJSON,
  DEFAULT_MEMBER_TIERS, DEFAULT_MEMBER_SETTINGS,
  DEFAULT_MAIN_GROUPS, DEFAULT_PRINT_GROUPS, DEFAULT_DEPARTMENTS, DEFAULT_UOMS, DEFAULT_PRICE_LEVELS,
  CATEGORY_MASTER_MAP, CATEGORY_UOM_MAP,
} from './db.js';
import { ROLES, defaultPermissions } from './permissions.js';

const DEMO_USERS = [
  { phone: '1000000000', name: 'Admin', role: 'admin', password: 'admin123', employeeNo: 'EMP-0001', joinDate: '2023-01-01' },
  { phone: '1000000001', name: 'Manager', role: 'manager', password: 'manager123', employeeNo: 'EMP-0002', joinDate: '2023-02-01' },
  { phone: '1000000002', name: 'Cashier', role: 'cashier', password: 'cashier123', employeeNo: 'EMP-0003', joinDate: '2023-03-01' },
  { phone: '1000000003', name: 'Waiter', role: 'waiter', password: 'waiter123', employeeNo: 'EMP-0004', joinDate: '2023-04-01' },
  { phone: '1000000004', name: 'Kitchen', role: 'kitchen', password: 'kitchen123', employeeNo: 'EMP-0005', joinDate: '2023-05-01' },
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

  let adminId = null;
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const uid = await insert(
      `INSERT INTO users (org_id, store_id, name, phone, role, employee_no, join_date, password_hash, is_active)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [orgId, storeId, u.name, u.phone, u.role, u.employeeNo, u.joinDate, passwordHash]
    );
    if (u.role === 'admin' && adminId == null) adminId = uid;
  }

  // 角色权限矩阵:把默认值落库一份,后台改动就覆盖这些行。
  for (const role of ROLES) {
    await insert(
      `INSERT INTO role_permissions (org_id, store_id, role, permissions)
       VALUES (?,?,?,?)`,
      [orgId, storeId, role, stringifyJSON(defaultPermissions(role))]
    );
  }

  // ---- 会员等级 + 会员设置 + 一个演示会员(新库开箱可用,不必手工建等级) ----
  const tierIds = {};
  for (const [code, name, disc, minSpend, minPoints, isDefault, sortOrder] of DEFAULT_MEMBER_TIERS) {
    tierIds[code] = await insert(
      `INSERT INTO member_tiers
         (org_id, store_id, code, name, discount_percent, min_spend, min_points, is_default, sort_order, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
      [orgId, storeId, code, name, disc, minSpend, minPoints, isDefault, sortOrder]
    );
  }
  for (const [key, value] of Object.entries(DEFAULT_MEMBER_SETTINGS)) {
    await insert(
      'INSERT INTO app_settings (org_id, store_id, setting_key, setting_value) VALUES (?,?,?,?)',
      [orgId, storeId, key, JSON.stringify(value)]
    );
  }
  await insert(
    `INSERT INTO members
       (org_id, store_id, member_no, name, phone, email, tier_id, credit_limit,
        credit_balance, rebate_balance, points, total_spend, points_earned_total, joined_at, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),'active')`,
    [orgId, storeId, 'M0001', 'Demo Member', '0123456789', 'demo@member.com', tierIds.MEMBER,
      0, 0, 0, 120, 0, 120]
  );

  // ---- Smcin 主数据:商品大类 / 打印分组 / 部门 / 计量单位 ----
  // 前三张表都是「编码 + 名称 + 排序」,id 存进 map 供分类与商品引用。
  const insertMaster = async (table, rows) => {
    const ids = {};
    for (const [code, name, sort] of rows) {
      ids[code] = await insert(
        `INSERT INTO ${table} (org_id, store_id, code, name, sort_order) VALUES (?,?,?,?,?)`,
        [orgId, storeId, code, name, sort]
      );
    }
    return ids;
  };
  const mainGroupIds = await insertMaster('main_groups', DEFAULT_MAIN_GROUPS);
  const printGroupIds = await insertMaster('print_groups', DEFAULT_PRINT_GROUPS);
  const deptIds = await insertMaster('departments', DEFAULT_DEPARTMENTS);
  const uomIds = {};
  for (const [code, name, dimension, factor, isBase, sort] of DEFAULT_UOMS) {
    uomIds[code] = await insert(
      'INSERT INTO uoms (org_id, store_id, code, name, dimension, factor, is_base, sort_order) VALUES (?,?,?,?,?,?,?,?)',
      [orgId, storeId, code, name, dimension, factor, isBase, sort]
    );
  }
  // 价格级别(价目表):RETAIL 是默认级别,它的价格就存在 menu_variants.price 里
  const priceLevelIds = {};
  for (const [code, name, sort, isDefault] of DEFAULT_PRICE_LEVELS) {
    priceLevelIds[code] = await insert(
      'INSERT INTO price_levels (org_id, store_id, code, name, sort_order, is_default) VALUES (?,?,?,?,?,?)',
      [orgId, storeId, code, name, sort, isDefault]
    );
  }

  const catIds = {};
  for (const [name, color, sort] of CATS) {
    const map = CATEGORY_MASTER_MAP[name] || {};
    const id = await insert(
      `INSERT INTO menu_categories (org_id, store_id, name, color, sort_order, main_group_id, department_id)
       VALUES (?,?,?,?,?,?,?)`,
      [orgId, storeId, name, color, sort,
        map.mainGroup ? mainGroupIds[map.mainGroup] ?? null : null,
        map.department ? deptIds[map.department] ?? null : null]
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

  // 变体(产品主档 SKU):分组/部门/打印组/单位按分类继承,分类没配就留空
  // MEMBER 级价目按 95% 预置,演示「非默认级别存覆盖行」;
  // WHOLESALE / STAFF 故意留空,演示「没有覆盖行 = 回落基础价」。
  let vsort = 1;
  const addVariant = async (bname, baseId, cat, code, name, price) => {
    const map = CATEGORY_MASTER_MAP[cat] || {};
    const vid = await insert(
      `INSERT INTO menu_variants
        (org_id, store_id, base_id, category_id, code, name, modifier_ids, price, cost, stock_qty, stock_threshold, sort_order,
         main_group_id, print_group_id, department_id, uom)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        orgId, storeId, baseId, catIds[cat], code, name, stringifyJSON([]),
        price, +(price * 0.4).toFixed(2), 50, 10, vsort++,
        map.mainGroup ? mainGroupIds[map.mainGroup] ?? null : null,
        map.printGroup ? printGroupIds[map.printGroup] ?? null : null,
        map.department ? deptIds[map.department] ?? null : null,
        CATEGORY_UOM_MAP[cat] || null,
      ]
    );
    await insert(
      'INSERT INTO variant_prices (org_id, store_id, variant_id, level_code, price) VALUES (?,?,?,?,?)',
      [orgId, storeId, vid, 'MEMBER', +(price * 0.95).toFixed(2)]
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

  // ---- 供应商主档 + 原料库存（演示 InventoryPage / SupplierPanel / 库存估值报表） ----
  const SUPPLIERS = [
    ['SUP-001', 'Demo Supplier', '03-1234 5678', 'Ah Hock', 'sales@demosupplier.com',
      '12 Jalan Industri 3, 50000 Kuala Lumpur', 'GST-SUP-0001', 'Net 30', 30],
    ['SUP-002', 'Kedai Borong Segar', '03-8765 4321', 'Siti', 'order@borongsegar.com',
      '88 Jalan Pasar, 50000 Kuala Lumpur', 'GST-SUP-0002', 'Net 14', 14],
    ['SUP-003', 'Tobacco Wholesale Sdn Bhd', '03-2222 3333', 'Ravi', 'sales@twb.com.my',
      '5 Jalan Perdagangan, 50000 Kuala Lumpur', 'GST-SUP-0003', 'COD', 0],
  ];
  const supIds = [];
  for (const [code, name, phone, person, email, address, taxNo, terms, days] of SUPPLIERS) {
    supIds.push(await insert(
      `INSERT INTO suppliers
         (org_id, store_id, code, name, phone, contact, contact_person, email, address, tax_no, payment_terms, credit_terms_days, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active')`,
      [orgId, storeId, code, name, phone, person, person, email, address, taxNo, terms, days],
    ));
  }

  // 成品库存由 menu_variants 自身承载；这里是原料/耗材级库存
  // [code, name, category, unit, qty, threshold, avgCost, lastCost, location, supplierIdx]
  const ITEMS = [
    ['RAW-001', '咖啡豆 Robusta', 'Coffee Bean', 'kg', 12.5, 5, 80.0, 82.0, 'Dry Store', 0],
    ['RAW-002', '红茶粉', 'Tea', 'kg', 6.0, 3, 22.0, 22.0, 'Dry Store', 0],
    ['RAW-003', 'Milo 粉', 'Malt', 'kg', 8.0, 3, 28.0, 27.5, 'Dry Store', 0],
    ['RAW-004', '白糖', 'Sugar', 'kg', 30.0, 10, 2.8, 2.8, 'Dry Store', 0],
    ['RAW-005', '淡奶 Evaporated', 'Dairy', '罐', 24.0, 8, 3.2, 3.3, 'Chiller', 1],
    ['RAW-006', '炼乳 Condensed', 'Dairy', '罐', 18.0, 8, 3.6, 3.6, 'Chiller', 1],
    ['PKG-001', '纸杯 8oz', 'Packaging', '个', 800.0, 200, 0.12, 0.12, 'Counter Store', 0],
    ['PKG-002', '杯盖 8oz', 'Packaging', '个', 600.0, 200, 0.05, 0.05, 'Counter Store', 0],
    ['RTD-001', '100plus 罐装', 'Can Drink', '罐', 120.0, 48, 1.9, 1.95, 'Chiller', 0],
    ['TOB-001', 'Marlboro', 'Tobacco', '包', 40.0, 20, 12.5, 12.8, 'Counter Store', 2],
  ];
  for (const [code, name, category, unit, qty, threshold, avgCost, lastCost, location, si] of ITEMS) {
    const itemId = await insert(
      `INSERT INTO inventory_items
         (org_id, store_id, code, name, category, unit, quantity, threshold,
          cost_price, avg_cost, last_cost, location, supplier_id, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [orgId, storeId, code, name, category, unit, qty, threshold, avgCost, avgCost, lastCost, location, supIds[si]],
    );
    // 期初台账:库存估值报表从第一天就有据可查
    await insert(
      `INSERT INTO stock_movements
         (org_id, store_id, item_id, item_code, item_name, type, delta, before, after,
          unit_cost, amount, avg_cost_after, ref_type, location, note, created_by, created_by_name)
       VALUES (?,?,?,?,?,'opening',?,?,?,?,?,?,'opening',?,?,?,?)`,
      [orgId, storeId, itemId, code, name, qty, 0, qty, avgCost,
        Math.round(qty * avgCost * 100) / 100, avgCost, location, '期初库存', adminId, 'Admin'],
    );
  }

  console.log('[seed] org/store + 5 users + kopitiam menu (categories/bases/modifiers/variants) + tables + 3 suppliers + 10 inventory items + opening ledger + 4 member tiers + 1 demo member + Smcin master data (main groups/print groups/departments/uoms) created');
}

// 单独运行:node src/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await seedIfEmpty();
    await pool.end();
    process.exit(0);
  })();
}
