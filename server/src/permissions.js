// 按键级权限目录(action catalog)+ 各角色默认权限。
//
// 为什么要单独一个模块:
//   1. 后端路由校验(requirePermission 中间件)
//   2. 前端按钮 gate(usePermission / <Gate>)
//   3. 后台权限矩阵面板(渲染行=按键、列=角色)
//   4. devMode 内存种子 + 生产 role_permissions 表初始化
// 四处必须口径一致,否则「后台能勾但服务端拒绝」或「界面藏了但接口能调」。
// 所以这里只放纯数据 + 纯函数,不 import 任何后端依赖(与 reportCatalog 同一思路)。

export const ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];

export const ROLE_LABELS = {
  admin: 'Admin 管理员',
  manager: 'Manager 店长',
  cashier: 'Cashier 收银员',
  waiter: 'Waiter 服务员',
  kitchen: 'Kitchen 厨房',
};

// 分组是为了后台矩阵面板好读,不参与权限判定。
export const PERMISSION_GROUPS = [
  {
    group: 'order',
    label: 'Order 订单操作',
    actions: [
      { key: 'order.create', label: 'New Order', desc: '开新单' },
      { key: 'order.hold', label: 'Hold / Recall', desc: '挂单与取单' },
      { key: 'order.send', label: 'Send to Kitchen', desc: '送厨房' },
      { key: 'order.transfer', label: 'Transfer Table', desc: '转台' },
      { key: 'order.merge', label: 'Merge Table', desc: '并台' },
      { key: 'order.split', label: 'Split Bill', desc: '拆单' },
      { key: 'order.discount', label: 'Discount', desc: '折扣' },
      { key: 'order.edit_price', label: 'Edit Price', desc: '改价' },
      { key: 'order.sales_person', label: 'Assign Sales Person', desc: '指派销售员' },
      { key: 'order.void', label: 'Void Order', desc: '作废订单' },
      { key: 'order.void_approve', label: 'Approve Void', desc: '审批作废' },
      { key: 'order.unsettle', label: 'Unsettle Sales', desc: '反结算' },
    ],
  },
  {
    group: 'payment',
    label: 'Payment 结账收款',
    actions: [
      { key: 'payment.settle', label: 'Settlement', desc: '结账收款' },
      { key: 'payment.refund', label: 'Refund', desc: '退款' },
      { key: 'payment.credit_note', label: 'Credit Note', desc: '开具贷项单' },
      { key: 'payment.open_drawer', label: 'Open Cash Drawer', desc: '开钱箱' },
      { key: 'payment.cash_move', label: 'Cash In / Out', desc: '现金出入' },
    ],
  },
  {
    group: 'member',
    label: 'Member 会员与礼券',
    actions: [
      { key: 'member.view', label: 'View Member', desc: '查看会员' },
      { key: 'member.create', label: 'Add Member', desc: '新增会员' },
      { key: 'member.topup', label: 'Member Top Up', desc: '会员充值' },
      { key: 'member.points', label: 'Adjust Points', desc: '调整积分' },
      { key: 'member.rebate', label: 'Adjust Rebate', desc: '调整返利' },
      { key: 'member.voucher_issue', label: 'Issue Voucher', desc: '发放礼券' },
      { key: 'member.voucher_void', label: 'Void Voucher', desc: '作废礼券' },
    ],
  },
  {
    group: 'backoffice',
    label: 'Back Office 后台管理',
    actions: [
      { key: 'menu.view', label: 'View Menu', desc: '查看菜单' },
      { key: 'menu.edit', label: 'Edit Menu', desc: '维护菜单与价格' },
      { key: 'menu.cost', label: 'View Cost', desc: '查看成本' },
      { key: 'stock.view', label: 'View Stock', desc: '查看库存' },
      { key: 'stock.take', label: 'Stock Take', desc: '库存盘点' },
      { key: 'stock.purchase', label: 'Purchase Order', desc: '采购订单' },
      { key: 'report.view', label: 'View Reports', desc: '查看报表' },
      { key: 'report.export', label: 'Export Reports', desc: '导出报表' },
      { key: 'report.design', label: 'Report Designer', desc: '报表设计器' },
      { key: 'shift.manage', label: 'Shift / Attendance', desc: '班次与考勤' },
      { key: 'day_end', label: 'Day End', desc: '日结' },
      { key: 'reprint', label: 'Reprint', desc: '重打中心' },
      { key: 'printer.manage', label: 'Printer Setup', desc: '打印机设置' },
      { key: 'settings.edit', label: 'Settings', desc: '系统设置' },
      { key: 'staff.manage', label: 'Staff Management', desc: '员工管理' },
      { key: 'permission.manage', label: 'Permission Matrix', desc: '权限矩阵' },
    ],
  },
  {
    group: 'kitchen',
    label: 'Kitchen KDS 厨房出品',
    actions: [
      { key: 'kds.view', label: 'View KDS', desc: '查看厨房屏' },
      { key: 'kds.update', label: 'Update Item Status', desc: '更新出品状态' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => a.key));

// 按键 -> 中文/英文名,用于拒绝时的报错文案
export const PERMISSION_LABELS = PERMISSION_GROUPS.reduce((acc, g) => {
  for (const a of g.actions) acc[a.key] = a.label;
  return acc;
}, {});

const CASHIER = [
  'order.create', 'order.hold', 'order.send', 'order.split', 'order.sales_person',
  'payment.settle', 'payment.open_drawer',
  'member.view', 'member.create', 'member.topup',
  'menu.view', 'stock.view', 'report.view', 'reprint',
  'kds.view',
];

const WAITER = [
  'order.create', 'order.hold', 'order.send', 'order.transfer', 'order.merge',
  'member.view', 'menu.view', 'kds.view',
];

const KITCHEN = ['kds.view', 'kds.update', 'menu.view'];

// admin 用 '*' 通配,新增按键时自动拥有,不需要改这里。
export const ROLE_DEFAULTS = {
  admin: ['*'],
  manager: ALL_PERMISSIONS.filter((k) => k !== 'permission.manage'),
  cashier: CASHIER,
  waiter: WAITER,
  kitchen: KITCHEN,
};

/** 某角色的默认权限(副本,避免调用方改到常量)。 */
export function defaultPermissions(role) {
  return [...(ROLE_DEFAULTS[role] || [])];
}

/** 权限判定:'*' 通配 + 精确匹配。perms 为数组。 */
export function hasPermission(perms, key) {
  if (!Array.isArray(perms)) return false;
  return perms.includes('*') || perms.includes(key);
}

/**
 * 把 role_permissions 表读出的「按角色的覆盖值」与默认值合并。
 * overrides 形如 { manager: [...], cashier: [...] };某角色没有记录就用默认值。
 * admin 永远返回 ['*'],不允许被降权(否则会把自己锁在门外)。
 */
export function resolveRolePermissions(role, overrides) {
  if (role === 'admin') return ['*'];
  const ov = overrides && overrides[role];
  if (Array.isArray(ov)) return ov;
  return defaultPermissions(role);
}
