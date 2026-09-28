import mongoose from 'mongoose';
const { Schema, Types } = mongoose;

const base = {
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
};

const Organization = new Schema(
  { name: String, slug: { type: String, unique: true }, plan: { type: String, default: 'free' } },
  { timestamps: true }
);

const Store = new Schema(
  {
    ...base,
    name: String,
    timezone: { type: String, default: 'Asia/Shanghai' },
    printerConfig: { type: Object, default: {} },
    taxRate: { type: Number, default: 0 },
    currency: { type: String, default: 'CNY' },
  },
  { timestamps: true }
);

const User = new Schema(
  {
    ...base,
    name: String,
    phone: { type: String, unique: true, sparse: true },
    email: String,
    passwordHash: String,
    role: { type: String, enum: ['admin', 'manager', 'cashier', 'waiter', 'kitchen'], default: 'cashier' },
    pin: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const MenuCategory = new Schema(
  { ...base, name: String, sortOrder: Number, isActive: { type: Boolean, default: true } },
  { timestamps: true }
);

const MenuItem = new Schema(
  {
    ...base,
    categoryId: { type: Schema.Types.ObjectId, ref: 'MenuCategory' },
    name: String,
    price: Number,
    imageUrl: String,
    modifierGroups: { type: Array, default: [] },
    trackInventory: { type: Boolean, default: false },
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem' },
    isSoldOut: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Table = new Schema(
  {
    ...base,
    number: String,
    zone: String,
    seats: Number,
    status: { type: String, enum: ['free', 'occupied', 'needs_clean'], default: 'free' },
    currentOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true }
);

const Order = new Schema(
  {
    ...base,
    orderNo: String,
    type: { type: String, enum: ['dine_in', 'takeaway'] },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table' },
    customerName: String,
    phone: String,
    status: { type: String, enum: ['open', 'kitchen', 'paid', 'void_pending', 'void'], default: 'open' },
    items: { type: Array, default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    shiftId: { type: Schema.Types.ObjectId, ref: 'Shift' },
    voidRequestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    voidReason: String,
  },
  { timestamps: true }
);

const Payment = new Schema(
  {
    ...base,
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    method: { type: String, enum: ['cash', 'tab'], default: 'cash' },
    amount: Number,
    tip: { type: Number, default: 0 },
    status: { type: String, default: 'paid' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const InventoryItem = new Schema(
  {
    ...base,
    name: String,
    unit: String,
    quantity: { type: Number, default: 0 },
    threshold: { type: Number, default: 0 },
    costPrice: Number,
  },
  { timestamps: true }
);

const StockMovement = new Schema(
  {
    ...base,
    itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem' },
    type: { type: String, enum: ['sale', 'restock', 'adjust', 'count'] },
    delta: Number,
    before: Number,
    after: Number,
    refOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const Shift = new Schema(
  {
    ...base,
    cashierId: { type: Schema.Types.ObjectId, ref: 'User' },
    openAmount: Number,
    closeAmount: Number,
    expectedAmount: Number,
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
  },
  { timestamps: true }
);

export const Models = {
  Organization: mongoose.model('Organization', Organization),
  Store: mongoose.model('Store', Store),
  User: mongoose.model('User', User),
  MenuCategory: mongoose.model('MenuCategory', MenuCategory),
  MenuItem: mongoose.model('MenuItem', MenuItem),
  Table: mongoose.model('Table', Table),
  Order: mongoose.model('Order', Order),
  Payment: mongoose.model('Payment', Payment),
  InventoryItem: mongoose.model('InventoryItem', InventoryItem),
  StockMovement: mongoose.model('StockMovement', StockMovement),
  Shift: mongoose.model('Shift', Shift),
};
