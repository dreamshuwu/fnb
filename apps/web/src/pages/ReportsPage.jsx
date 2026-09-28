import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function ReportsPage() {
  const [sales, setSales] = useState(null);
  const [daily, setDaily] = useState(null);

  useEffect(() => {
    (async () => {
      const [s, d] = await Promise.all([
        api.get('/reports/sales'),
        api.get('/reports/daily-close'),
      ]);
      setSales(s.data);
      setDaily(d.data);
    })();
  }, []);

  if (!sales) return <div>加载中…</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">报表</h2>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded shadow">
          <h3 className="font-bold mb-2">今日日结</h3>
          <div>营业额: ¥{daily.total}</div>
          <div>订单数: {daily.orderCount}</div>
          <div>销售扣减笔数: {daily.saleMovements}</div>
          <div className="mt-2">按支付方式:</div>
          {Object.entries(daily.byMethod).map(([k, v]) => (
            <div key={k}>
              {k}: ¥{v}
            </div>
          ))}
        </div>
        <div className="bg-white p-4 rounded shadow">
          <h3 className="font-bold mb-2">销售汇总(今日)</h3>
          <div>营业额: ¥{sales.total}</div>
          <div>订单数: {sales.count}</div>
          <div className="mt-2">按支付方式:</div>
          {Object.entries(sales.byMethod).map(([k, v]) => (
            <div key={k}>
              {k}: ¥{v}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
