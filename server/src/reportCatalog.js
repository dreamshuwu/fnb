// 报表目录:前后端共用的报表元数据(分类 / 名称 / 列定义)。
// 服务端用它驱动 /reports/query 与 /reports/export 的列顺序与表头;
// 前端用它渲染分组下拉、表格表头和导出按钮。
// 新增报表只需在此登记,并在两个后端(devMode.js / routes/business.js)补齐同名 case。

export const REPORT_CATEGORIES = [
  { key: 'sales', label: 'Sales 销售' },
  { key: 'transactions', label: 'Transactions 交易' },
  { key: 'cash', label: 'Cash 现金' },
  { key: 'gst', label: 'GST 税务' },
  { key: 'members', label: 'Members 会员' },
  { key: 'stock', label: 'Stock 库存' },
  { key: 'purchase', label: 'Purchase 采购' },
  { key: 'staff', label: 'Staff 员工' },
  { key: 'dayend', label: 'Day End 日结' },
];

// kind: 'money' 金额列 / 'int' 整数列 / 'text' 文本列 / 'date' 日期列
export const REPORT_CATALOG = [
  // ---------- Sales ----------
  { key: 'sales_by_date', label: 'Sales By Date', category: 'sales', desc: '按日期汇总营业额', columns: [['date', 'Date', 'date'], ['orders', 'Orders', 'int'], ['gross', 'Gross', 'money'], ['discount', 'Discount', 'money'], ['serviceCharge', 'Service', 'money'], ['tax', 'GST', 'money'], ['net', 'Net Sales', 'money']] },
  { key: 'sales_by_product', label: 'Sales By Product', category: 'sales', desc: '单品销量与金额', columns: [['code', 'Code', 'text'], ['name', 'Product', 'text'], ['qty', 'Qty', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'sales_by_category', label: 'Sales By Category', category: 'sales', desc: '按菜单分类汇总', columns: [['category', 'Category', 'text'], ['qty', 'Qty', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'sales_by_department', label: 'Sales By Department', category: 'sales', desc: '按出品部门(厨房/水吧)汇总', columns: [['department', 'Department', 'text'], ['qty', 'Qty', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'sales_by_payment', label: 'Sales By Payment Type', category: 'sales', desc: '按支付方式汇总', columns: [['method', 'Method', 'text'], ['count', 'Count', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'sales_by_hour', label: 'Sales By Hour', category: 'sales', desc: '按小时客流与营业额', columns: [['hour', 'Hour', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },
  { key: 'sales_by_cashier', label: 'Sales By Cashier', category: 'sales', desc: '收银员业绩', columns: [['cashier', 'Cashier', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },
  { key: 'sales_by_salesperson', label: 'Sales By Sales Person', category: 'sales', desc: '销售员业绩', columns: [['salesperson', 'Sales Person', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },
  { key: 'sales_by_table', label: 'Sales By Table', category: 'sales', desc: '按桌位汇总', columns: [['table', 'Table', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },
  { key: 'sales_by_member', label: 'Sales By Member', category: 'sales', desc: '会员消费汇总', columns: [['memberNo', 'Member', 'text'], ['name', 'Name', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },
  { key: 'sales_by_discount', label: 'Sales By Discount Type', category: 'sales', desc: '折扣类型汇总', columns: [['type', 'Discount Type', 'text'], ['orders', 'Orders', 'int'], ['discount', 'Discount', 'money']] },
  { key: 'top_products', label: 'Top 10 Products', category: 'sales', desc: '畅销前十', columns: [['code', 'Code', 'text'], ['name', 'Product', 'text'], ['qty', 'Qty', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'bottom_products', label: 'Bottom 10 Products', category: 'sales', desc: '滞销前十', columns: [['code', 'Code', 'text'], ['name', 'Product', 'text'], ['qty', 'Qty', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'avg_spend', label: 'Average Spend', category: 'sales', desc: '客单价走势', columns: [['date', 'Date', 'date'], ['orders', 'Orders', 'int'], ['net', 'Net Sales', 'money'], ['avgSpend', 'Avg / Order', 'money']] },
  { key: 'sales_trend_7day', label: 'Sales Trend (7 Day)', category: 'sales', desc: '近七天趋势', columns: [['date', 'Date', 'date'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },
  { key: 'monthly_sales', label: 'Monthly Sales', category: 'sales', desc: '按月汇总', columns: [['month', 'Month', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },

  // ---------- Transactions ----------
  { key: 'order_list', label: 'Order List', category: 'transactions', desc: '订单明细列表', columns: [['orderNo', 'Order No.', 'text'], ['date', 'Date', 'date'], ['type', 'Type', 'text'], ['table', 'Table', 'text'], ['status', 'Status', 'text'], ['subtotal', 'Subtotal', 'money'], ['discount', 'Discount', 'money'], ['tax', 'GST', 'money'], ['total', 'Total', 'money']] },
  { key: 'void_report', label: 'Void / Cancellation', category: 'transactions', desc: '取消单记录', columns: [['orderNo', 'Order No.', 'text'], ['date', 'Date', 'date'], ['reason', 'Reason', 'text'], ['status', 'Status', 'text'], ['total', 'Amount', 'money']] },
  { key: 'void_by_user', label: 'Void By User', category: 'transactions', desc: '按人员统计取消', columns: [['cashier', 'User', 'text'], ['count', 'Voids', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'refund_report', label: 'Refund Report', category: 'transactions', desc: '退款记录', columns: [['refundNo', 'Refund No.', 'text'], ['orderNo', 'Order No.', 'text'], ['date', 'Date', 'date'], ['amount', 'Amount', 'money'], ['method', 'Method', 'text'], ['reason', 'Reason', 'text']] },
  { key: 'refund_by_reason', label: 'Refund By Reason', category: 'transactions', desc: '按原因统计退款', columns: [['reason', 'Reason', 'text'], ['count', 'Count', 'int'], ['amount', 'Amount', 'money']] },
  { key: 'discount_report', label: 'Discount Report', category: 'transactions', desc: '折扣明细', columns: [['orderNo', 'Order No.', 'text'], ['date', 'Date', 'date'], ['subtotal', 'Subtotal', 'money'], ['discount', 'Discount', 'money'], ['total', 'Total', 'money']] },
  { key: 'unsettle_report', label: 'Unsettle Report', category: 'transactions', desc: '反结算记录', columns: [['orderNo', 'Order No.', 'text'], ['date', 'Date', 'date'], ['amount', 'Amount', 'money'], ['reason', 'Reason', 'text']] },
  { key: 'reprint_log', label: 'Reprint Log', category: 'transactions', desc: '重打日志', columns: [['orderNo', 'Order No.', 'text'], ['kind', 'Document', 'text'], ['date', 'Date', 'date']] },
  { key: 'credit_note', label: 'Credit Note', category: 'transactions', desc: '贷项凭单汇总', columns: [['creditNo', 'Credit No.', 'text'], ['customerName', 'Customer', 'text'], ['orderNo', 'Invoice No.', 'text'], ['reason', 'Reason', 'text'], ['total', 'Total', 'money'], ['status', 'Status', 'text']] },
  { key: 'credit_note_detail', label: 'Credit Note Detail', category: 'transactions', desc: '贷项凭单行项目', columns: [['creditNo', 'Credit No.', 'text'], ['code', 'Code', 'text'], ['description', 'Description', 'text'], ['qty', 'Qty', 'int'], ['uom', 'UOM', 'text'], ['retail', 'Retail', 'money'], ['subtotal', 'Subtotal', 'money']] },
  { key: 'tax_invoice_list', label: 'Tax Invoice List', category: 'transactions', desc: '税务发票清单', columns: [['invoiceNo', 'Invoice No.', 'text'], ['orderNo', 'Order No.', 'text'], ['date', 'Date', 'date'], ['taxable', 'Taxable', 'money'], ['tax', 'GST', 'money'], ['total', 'Total', 'money']] },

  // ---------- Cash ----------
  { key: 'cash_bill', label: 'Cash Bill', category: 'cash', desc: '现金账单流水', columns: [['orderNo', 'Order No.', 'text'], ['method', 'Method', 'text'], ['amount', 'Amount', 'money'], ['date', 'Date', 'date']] },
  { key: 'payout', label: 'Payout / Withdraw', category: 'cash', desc: '现金支出与提现', columns: [['voucherNo', 'Voucher', 'text'], ['payTo', 'Pay To', 'text'], ['amount', 'Amount', 'money'], ['reason', 'For / Remark', 'text'], ['date', 'Date', 'date']] },
  { key: 'cash_movement', label: 'Cash Movement', category: 'cash', desc: '全部现金流水', columns: [['type', 'Type', 'text'], ['voucherNo', 'Voucher', 'text'], ['amount', 'Amount', 'money'], ['date', 'Date', 'date']] },
  { key: 'close_shift', label: 'Close Shift', category: 'cash', desc: '班结记录', columns: [['shiftId', 'Shift', 'text'], ['openedAt', 'Opened', 'date'], ['closedAt', 'Closed', 'date'], ['openAmount', 'Opening', 'money'], ['expectedAmount', 'Expected', 'money'], ['closeAmount', 'Counted', 'money'], ['difference', 'Difference', 'money'], ['status', 'Status', 'text']] },
  { key: 'shift_variance', label: 'Shift Variance', category: 'cash', desc: '班结差异', columns: [['shiftId', 'Shift', 'text'], ['closedAt', 'Closed', 'date'], ['expectedAmount', 'Expected', 'money'], ['closeAmount', 'Counted', 'money'], ['difference', 'Difference', 'money']] },

  // ---------- GST ----------
  { key: 'gst_summary', label: 'GST Summary', category: 'gst', desc: 'GST 汇总', columns: [['taxableSales', 'Taxable Sales', 'money'], ['taxRate', 'Rate %', 'text'], ['outputTax', 'Output Tax', 'money'], ['invoices', 'Invoices', 'int']] },
  { key: 'gst_detail', label: 'GST Detail', category: 'gst', desc: 'GST 按日明细', columns: [['date', 'Date', 'date'], ['taxable', 'Taxable', 'money'], ['tax', 'GST', 'money'], ['total', 'Total', 'money']] },

  // ---------- Members ----------
  { key: 'member_list', label: 'Member List', category: 'members', desc: '会员主档', columns: [['memberNo', 'Member No.', 'text'], ['name', 'Name', 'text'], ['phone', 'Phone', 'text'], ['points', 'Points', 'int'], ['creditBalance', 'Credit', 'money']] },
  { key: 'member_points', label: 'Member Points', category: 'members', desc: '会员积分', columns: [['memberNo', 'Member No.', 'text'], ['name', 'Name', 'text'], ['points', 'Points', 'int'], ['creditBalance', 'Credit', 'money']] },
  { key: 'member_topup', label: 'Member Top Up', category: 'members', desc: '会员充值', columns: [['receiptNo', 'Receipt No.', 'text'], ['memberNo', 'Member No.', 'text'], ['amount', 'Amount', 'money'], ['date', 'Date', 'date']] },
  { key: 'member_ledger', label: 'Member Ledger', category: 'members', desc: '会员积分流水', columns: [['memberNo', 'Member No.', 'text'], ['type', 'Type', 'text'], ['points', 'Points', 'int'], ['date', 'Date', 'date']] },

  // ---------- Stock ----------
  { key: 'stock_report', label: 'Stock Report', category: 'stock', desc: '库存现状', columns: [['code', 'Code', 'text'], ['name', 'Item', 'text'], ['stockQty', 'On Hand', 'int'], ['stockThreshold', 'Threshold', 'int']] },
  { key: 'stock_alert', label: 'Stock Alert', category: 'stock', desc: '低于安全库存', columns: [['code', 'Code', 'text'], ['name', 'Item', 'text'], ['stockQty', 'On Hand', 'int'], ['stockThreshold', 'Threshold', 'int'], ['shortage', 'Shortage', 'int']] },
  { key: 'stock_valuation', label: 'Stock Valuation', category: 'stock', desc: '库存成本估值', columns: [['code', 'Code', 'text'], ['name', 'Item', 'text'], ['stockQty', 'On Hand', 'int'], ['cost', 'Unit Cost', 'money'], ['value', 'Value', 'money']] },
  { key: 'customer_stock', label: 'Customer Stock', category: 'stock', desc: '客户寄存库存', columns: [['memberNo', 'Member No.', 'text'], ['itemName', 'Item', 'text'], ['qty', 'Qty', 'int'], ['unit', 'UOM', 'text']] },
  { key: 'stock_take', label: 'Stock Take', category: 'stock', desc: '盘点单', columns: [['ref', 'Reference', 'text'], ['date', 'Date', 'date'], ['lines', 'Lines', 'int'], ['status', 'Status', 'text']] },

  // ---------- Purchase ----------
  { key: 'purchase_summary', label: 'Purchase Summary', category: 'purchase', desc: '采购单汇总', columns: [['poNo', 'PO No.', 'text'], ['supplier', 'Supplier', 'text'], ['date', 'Date', 'date'], ['total', 'Total', 'money'], ['status', 'Status', 'text']] },
  { key: 'purchase_by_supplier', label: 'Purchase By Supplier', category: 'purchase', desc: '按供应商汇总', columns: [['supplier', 'Supplier', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money']] },

  // ---------- Staff ----------
  { key: 'attendance_report', label: 'Attendance Report', category: 'staff', desc: '考勤记录', columns: [['code', 'Code', 'text'], ['name', 'Name', 'text'], ['action', 'Action', 'text'], ['time', 'Time', 'date']] },
  { key: 'cashier_performance', label: 'Cashier Performance', category: 'staff', desc: '收银员绩效', columns: [['cashier', 'Cashier', 'text'], ['orders', 'Orders', 'int'], ['total', 'Total', 'money'], ['avgSpend', 'Avg / Order', 'money']] },

  // ---------- Day End ----------
  { key: 'day_end_history', label: 'Day End History', category: 'dayend', desc: '日结历史', columns: [['date', 'Date', 'date'], ['expectedCash', 'Expected', 'money'], ['countedCash', 'Counted', 'money'], ['difference', 'Difference', 'money'], ['closedAt', 'Closed', 'date']] },
];

export const REPORT_KEYS = REPORT_CATALOG.map((r) => r.key);

export function getReport(key) {
  return REPORT_CATALOG.find((r) => r.key === key) || null;
}

/** 取列定义;报表未登记时回退为按数据行推断。 */
export function reportColumns(key, rows = []) {
  const def = getReport(key);
  if (def) return def.columns.map(([k, label, kind]) => ({ key: k, label, kind }));
  const first = rows[0] || {};
  return Object.keys(first).map((k) => ({
    key: k,
    label: k,
    kind: typeof first[k] === 'number' ? 'money' : 'text',
  }));
}
