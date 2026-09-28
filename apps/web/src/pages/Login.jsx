import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('1000000002');
  const [password, setPassword] = useState('cashier123');
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const u = await login(phone, password);
      navigate(u.role === 'kitchen' ? '/kds' : '/');
    } catch {
      setErr('登录失败,请检查手机 / 密码');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={submit} className="bg-white p-8 rounded shadow w-80 space-y-4">
        <h1 className="text-xl font-bold">F&B POS 登录</h1>
        <input
          className="w-full border p-2 rounded"
          placeholder="手机"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          type="password"
          className="w-full border p-2 rounded"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button className="w-full bg-blue-600 text-white p-2 rounded">登录</button>
        <div className="text-xs text-slate-400">默认账号见 README(admin/manager/cashier/waiter/kitchen)</div>
      </form>
    </div>
  );
}
