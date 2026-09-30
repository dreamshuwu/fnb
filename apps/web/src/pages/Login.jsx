import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('1000000002');
  const [password, setPassword] = useState('cashier123');
  const [err, setErr] = useState('');
  const navigate = useNavigate();
  const submit = async (e) => { e.preventDefault(); setErr(''); try { const u = await login(phone, password); navigate(u.role === 'kitchen' ? '/kds' : '/'); } catch { setErr('Login failed / invalid UserID or Password'); } };
  return <div className="legacy-login"><div className="legacy-login-title">Food and Beverage Management</div><div className="legacy-login-logo">SMPOS<small>COMPUTERISED POINT OF SALE</small></div><form onSubmit={submit} className="legacy-login-window"><header>▣ User Login</header><div className="legacy-login-body"><label>UserID<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{err && <div className="text-red-700 text-xs">{err}</div>}<div className="legacy-window-actions"><button className="legacy-btn green">Login</button><button type="button" className="legacy-btn pink" onClick={() => setPassword('')}>Clear</button></div><div className="text-[10px] text-center text-indigo-900">Demo UserID: 1000000002 / cashier123</div></div></form></div>;
}
