import bcrypt from 'bcryptjs';
import { Models } from './models.js';

const DEMO_USERS = [
  { phone: '1000000000', name: 'Admin', role: 'admin', password: 'admin123' },
  { phone: '1000000001', name: 'Manager', role: 'manager', password: 'manager123' },
  { phone: '1000000002', name: 'Cashier', role: 'cashier', password: 'cashier123' },
  { phone: '1000000003', name: 'Waiter', role: 'waiter', password: 'waiter123' },
  { phone: '1000000004', name: 'Kitchen', role: 'kitchen', password: 'kitchen123' },
];

export async function seedIfEmpty() {
  const orgCount = await Models.Organization.countDocuments();
  if (orgCount > 0) return;

  const org = await Models.Organization.create({ name: 'Demo Brand', slug: 'demo' });
  const store = await Models.Store.create({ orgId: org._id, name: 'Demo Store', currency: 'CNY' });

  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await Models.User.create({
      orgId: org._id, storeId: store._id, name: u.name, phone: u.phone, role: u.role, passwordHash,
    });
  }

  const cat = await Models.MenuCategory.create({ orgId: org._id, storeId: store._id, name: '饮品', sortOrder: 1 });
  const food = await Models.MenuCategory.create({ orgId: org._id, storeId: store._id, name: '主食', sortOrder: 2 });
  const coffee = await Models.MenuItem.create({
    orgId: org._id, storeId: store._id, categoryId: cat._id, name: '美式咖啡', price: 18,
    modifierGroups: [{ name: '杯型', type: 'single', required: true, options: [{ label: '大杯', priceDelta: 3 }, { label: '小杯', priceDelta: 0 }] }],
  });
  await Models.MenuItem.create({ orgId: org._id, storeId: store._id, categoryId: food._id, name: '牛肉饭', price: 38 });

  for (const n of ['A1', 'A2', 'B1']) {
    await Models.Table.create({ orgId: org._id, storeId: store._id, number: n, zone: '大厅', seats: 4 });
  }

  const inv = await Models.InventoryItem.create({ orgId: org._id, storeId: store._id, name: '咖啡豆', unit: 'kg', quantity: 5, threshold: 2 });
  await Models.MenuItem.findByIdAndUpdate(coffee._id, { trackInventory: true, inventoryItemId: inv._id });

  console.log('[seed] org/store + 5 users + sample menu/tables/inventory created');
}

// 单独运行:node src/seed.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fnbpos');
  await seedIfEmpty();
  process.exit(0);
}
